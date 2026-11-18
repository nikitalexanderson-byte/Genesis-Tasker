package ru.genesis.calendar.data

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.genesis.calendar.auth.AuthApiError
import java.util.concurrent.ConcurrentHashMap

/** Current Android app/WorkManager writers use one process (no :process services).
 * Controllers and independent Room instances must use the SAME scope mutex.
 * SQLite separately enforces persistent storage barriers across connections. */
internal object LegacyScopeLocks {
    private val locks = ConcurrentHashMap<String, Mutex>()
    fun identity(db: GenesisDatabase, scope: String) =
        "${db.openHelper.databaseName ?: "memory:${System.identityHashCode(db)}"}\u0000$scope"
    fun mutex(db: GenesisDatabase, scope: String): Mutex = locks.getOrPut(identity(db,scope)) { Mutex() }
}

/** Blocks before any legacy personal socket is created; keeps its permit until
 * the complete response/cleanup, so migration cannot snapshot behind a late IO.
 * This is NOT an endpoint allowlist, a shared-scope guard or external consent. */
internal class NativeLegacyTransportGate(private val db: GenesisDatabase) {
    fun <T> request(scope: String, assertCurrent: () -> Unit, operation: () -> T): T {
        require(scope.matches(Regex("account-[a-f0-9]{32}"))) { "E2EE_SCOPE_BINDING_MISMATCH" }
        // Lock order is scope -> Room. Network inside a Room transaction would
        // invert it and deadlock against preparation. Reject before taking a lock
        // (also detects suspended transactions on a different coroutine context).
        try {
            check(!genesisRoomTransactionActive()&&!db.inTransaction())
        } catch (_: IllegalStateException) {
            throw AuthApiError("E2EE_LEGACY_TRANSACTION_IO_FORBIDDEN")
        }
        NativeLegacyOperationPermit.current()?.let { permit ->
            return permit.borrowTransport(db,scope,assertCurrent,operation)
        }
        return runBlocking {
            LegacyScopeLocks.mutex(db, scope).withLock {
                assertCurrent()
                if (db.dao().legacyScopeFence(scope) != null)
                    throw AuthApiError("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")
                assertCurrent()
                operation().also { assertCurrent() }
            }
        }
    }
}
