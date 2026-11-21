package ru.genesis.calendar.data

import androidx.room.migration.Migration
import androidx.room.RoomDatabase
import ru.genesis.calendar.data.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.sync.withLock
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.security.E2eeDirectory
import ru.genesis.calendar.security.E2eeKeys
import ru.genesis.calendar.security.E2eeMigration
import ru.genesis.calendar.security.E2eeMigrationFence
import java.util.UUID

/** Additive upgrade. All four original tables/rows, ciphertext, counters and
 * pending operations survive; there is no destructive migration fallback. */
internal object LegacyScopeFenceSql {
    val callback = object : RoomDatabase.Callback() {
        override fun onOpen(db: SupportSQLiteDatabase) {
            val owns=!db.inTransaction();if(owns)db.beginTransaction()
            try { install(db);if(owns)db.setTransactionSuccessful() } finally { if(owns)db.endTransaction() }
        }
    }
    val migration1To2 = object : Migration(1,2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS e2ee_legacy_fences (scope TEXT NOT NULL, ownerId TEXT NOT NULL, remoteScopeId TEXT NOT NULL, phase TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(scope))")
            install(db)
        }
    }
    fun install(db: SupportSQLiteDatabase) {
        for(table in listOf("tasks","documents","outbox","reminders"))for(action in listOf("INSERT","UPDATE","DELETE")) {
            val scopes=when(action) { "INSERT" -> "scope=NEW.scope"; "DELETE" -> "scope=OLD.scope"; else -> "scope=OLD.scope OR scope=NEW.scope" }
            db.execSQL("CREATE TRIGGER IF NOT EXISTS e2ee_legacy_${table}_${action.lowercase()} BEFORE $action ON $table WHEN EXISTS(SELECT 1 FROM e2ee_legacy_fences WHERE $scopes) BEGIN SELECT RAISE(ABORT,'E2EE_LOCAL_LEGACY_WRITE_FORBIDDEN'); END")
            // Personal migration also retains member-owned shared-map child
            // caches. Cover descendants with an additive trigger, including
            // databases that already installed the earlier exact-scope one.
            fun descendant(row:String)="substr($row.scope,1,length(scope)+1)=scope||':'"
            val descendants=when(action){"INSERT"->descendant("NEW");"DELETE"->descendant("OLD");else->"${descendant("OLD")} OR ${descendant("NEW")}"}
            db.execSQL("CREATE TRIGGER IF NOT EXISTS e2ee_legacy_descendant_${table}_${action.lowercase()} BEFORE $action ON $table WHEN EXISTS(SELECT 1 FROM e2ee_legacy_fences WHERE $descendants) BEGIN SELECT RAISE(ABORT,'E2EE_LOCAL_LEGACY_WRITE_FORBIDDEN'); END")
        }
        // BEFORE INSERT also covers SQLite REPLACE when recursive DELETE triggers
        // are disabled. A legacy/import writer cannot remove an active deny row.
        db.execSQL("CREATE TRIGGER IF NOT EXISTS e2ee_fence_insert BEFORE INSERT ON e2ee_legacy_fences WHEN NEW.phase NOT IN ('preparing','active') OR EXISTS(SELECT 1 FROM e2ee_legacy_fences WHERE scope=NEW.scope AND phase='active') BEGIN SELECT RAISE(ABORT,'E2EE_LOCAL_DOWNGRADE_FORBIDDEN'); END")
        db.execSQL("CREATE TRIGGER IF NOT EXISTS e2ee_fence_update BEFORE UPDATE ON e2ee_legacy_fences WHEN OLD.phase='active' OR NEW.scope<>OLD.scope OR NEW.ownerId<>OLD.ownerId OR NEW.remoteScopeId<>OLD.remoteScopeId OR NEW.token<>OLD.token OR NEW.phase NOT IN ('preparing','active') BEGIN SELECT RAISE(ABORT,'E2EE_LOCAL_DOWNGRADE_FORBIDDEN'); END")
        db.execSQL("CREATE TRIGGER IF NOT EXISTS e2ee_fence_delete BEFORE DELETE ON e2ee_legacy_fences WHEN OLD.phase='active' BEGIN SELECT RAISE(ABORT,'E2EE_LOCAL_DOWNGRADE_FORBIDDEN'); END")
    }
}

/** A persistent storage barrier, independent of screens, processes and workers.
 * Exact Room scopes are explicit: shared child scopes need their own bound row.
 * Installing this barrier does not activate the product E2EE route by itself. */
internal class NativeLegacyScopeFence(private val db: GenesisDatabase, private val ownerId: String,
    private val remoteScopeId: String, private val assertCurrent: () -> Unit,
    private val storageScope: String = CloudAccountSnapshot.scopeFor(ownerId)) : E2eeMigrationFence {
    // App writers/controllers share one process; independent Room instances for
    // the same configured database must serialize migration/release too. SQLite
    // independently protects every old writer, including across connections.
    private val mutex by lazy { LegacyScopeLocks.mutex(db,storageScope) }
    init {
        E2eeKeys.technical(ownerId); E2eeKeys.technical(remoteScopeId)
        val account=CloudAccountSnapshot.scopeFor(ownerId)
        check(storageScope == account || storageScope.startsWith("$account:")) { "E2EE_SCOPE_BINDING_MISMATCH" }
    }
    private fun bound(row: LegacyScopeFenceRecord) {
        check(row.ownerId == ownerId && row.remoteScopeId == remoteScopeId && row.scope == storageScope) { "E2EE_SCOPE_BINDING_MISMATCH" }
    }
    override suspend fun <T> withFence(operation: suspend () -> T): T = mutex.withLock {
        assertCurrent()
        LegacyScopeLocks.freezeMemory(db,storageScope)
        db.withTransaction {
            LegacyScopeFenceSql.install(db.openHelper.writableDatabase)
            val row=db.dao().legacyScopeFence(storageScope)
            if(row == null) db.dao().insertLegacyScopeFence(LegacyScopeFenceRecord(storageScope,ownerId,remoteScopeId,"preparing",UUID.randomUUID().toString())) else bound(row)
            assertCurrent()
        }
        // The transaction committed before capture/network. Failures and process
        // death leave the barrier in place and every original row readable.
        operation().also { assertCurrent() }
    }
    suspend fun token(): String? { assertCurrent();return db.dao().legacyScopeFence(storageScope)?.also(::bound)?.token }
    suspend fun activate(directory: E2eeDirectory.Verified) = mutex.withLock {
        assertCurrent();check(directory.ownerId == ownerId && directory.scopeId == remoteScopeId && directory.state == "active") { "E2EE_SCOPE_BINDING_MISMATCH" }
        db.withTransaction {
            val row=db.dao().legacyScopeFence(storageScope) ?: error("E2EE_LOCAL_FENCE_REQUIRED");bound(row)
            if(row.phase != "active")check(db.dao().activateLegacyScopeFence(storageScope,row.token) == 1) { "E2EE_LOCAL_CONFLICT" }
            assertCurrent()
        }
    }
    /** Read the protected status NOW under the same controller barrier, never
     * accept an old cancelled Status captured before a subsequent restart.
     * Caller supplies a fresh signed directory and the bound migration::status.
     * Active barriers are irreversible; SQL independently enforces this. */
    suspend fun releaseCancelled(token: String, directory: E2eeDirectory.Verified, currentStatus: () -> E2eeMigration.Status?) = mutex.withLock {
        assertCurrent();check(directory.ownerId == ownerId && directory.scopeId == remoteScopeId && directory.state == "preparing") { "E2EE_LOCAL_DOWNGRADE_FORBIDDEN" }
        db.withTransaction {
            val row=db.dao().legacyScopeFence(storageScope) ?: error("E2EE_LOCAL_FENCE_REQUIRED");bound(row)
            check(row.phase == "preparing" && row.token == token) { "E2EE_LOCAL_DOWNGRADE_FORBIDDEN" }
            val status=currentStatus()
            check(status?.phase == "cancelled" && status.pendingAction == null && !status.resuming) { "E2EE_LOCAL_DOWNGRADE_FORBIDDEN" }
            check(db.dao().cancelLegacyScopeFence(storageScope,token) == 1) { "E2EE_LOCAL_CONFLICT" };assertCurrent()
        }
        LegacyScopeLocks.releaseCancelledMemory(db,storageScope)
    }
    override fun toString() = "NativeLegacyScopeFence([redacted])"
}
