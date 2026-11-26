package ru.genesis.calendar.data

import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.security.*
import java.util.UUID

/** Real SQLite/Room upgrade and storage-policy checks, only unique synthetic DBs
 * in the isolated QA package. No main database, accounts or device data resets. */
@RunWith(AndroidJUnit4::class)
class E2eeLegacyScopeFenceTest {
    internal val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    internal val owner="synthetic-room-owner"
    internal val scope=CloudAccountSnapshot.scopeFor(owner)
    internal val remote="personal:$owner"
    internal fun open(name: String) = Room.databaseBuilder(context,GenesisDatabase::class.java,name).addMigrations(LegacyScopeFenceSql.migration1To2).addCallback(LegacyScopeFenceSql.callback).build()
    internal fun expectedSchema1Rows() = listOf("$scope|task|synthetic-original-task-ciphertext|3|0|0",
        "$scope|cloud-base|synthetic-original-document-ciphertext|7", "$scope|task|3|synthetic-pending-operation|local",
        "$scope|reminder|task|occurrence|3|1000|pending|<null>")
    internal fun original(db: SupportSQLiteDatabase): List<String> = listOf("tasks","documents","outbox","reminders").flatMap { table ->
        db.query("SELECT * FROM $table WHERE scope=? ORDER BY 2",arrayOf(scope)).use { cursor ->
            val rows=mutableListOf<String>();while(cursor.moveToNext())rows += (0 until cursor.columnCount).joinToString("|") { cursor.getString(it) ?: "<null>" };rows
        }
    }
    private fun expectBlocked(operation: () -> Unit,code: String = "E2EE_LOCAL_LEGACY_WRITE_FORBIDDEN") {
        try { operation();fail("Legacy write was accepted") }
        catch(error: android.database.SQLException) { assertTrue(error.message?.contains(code) == true) }
    }
    internal fun schema1(name: String) {
        val fixture=InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee-room-v1.json").bufferedReader().use { JSONObject(it.readText()).getJSONObject("database") }
        val helper=FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(context).name(name)
            .callback(object : SupportSQLiteOpenHelper.Callback(1) {
                override fun onCreate(db: SupportSQLiteDatabase) {
                    val entities=fixture.getJSONArray("entities")
                    for(index in 0 until entities.length()) {
                        val entity=entities.getJSONObject(index);val table=entity.getString("tableName")
                        db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                        val indices=entity.optJSONArray("indices") ?: JSONArray()
                        for(i in 0 until indices.length())db.execSQL(indices.getJSONObject(i).getString("createSql").replace("\${TABLE_NAME}",table))
                    }
                    val setup=fixture.getJSONArray("setupQueries");for(index in 0 until setup.length())db.execSQL(setup.getString(index))
                }
                override fun onUpgrade(db: SupportSQLiteDatabase,oldVersion: Int,newVersion: Int) = error("Unexpected fixture upgrade")
            }).build())
        try {
            val db=helper.writableDatabase
            db.execSQL("INSERT INTO tasks VALUES(?,?,?,?,?,?)",arrayOf<Any?>(scope,"task","synthetic-original-task-ciphertext",3,0,0))
            db.execSQL("INSERT INTO documents VALUES(?,?,?,?)",arrayOf<Any?>(scope,"cloud-base","synthetic-original-document-ciphertext",7))
            db.execSQL("INSERT INTO outbox VALUES(?,?,?,?,?)",arrayOf<Any?>(scope,"task",3,"synthetic-pending-operation","local"))
            db.execSQL("INSERT INTO reminders VALUES(?,?,?,?,?,?,?,?)",arrayOf<Any?>(scope,"reminder","task","occurrence",3,1000,"pending",null))
        } finally { helper.close() }
    }
    internal fun writeMatrix(db: SupportSQLiteDatabase) {
        val writes=listOf(
            "INSERT INTO tasks VALUES('$scope','new','new-ciphertext',1,0,0)",
            "UPDATE tasks SET done=1 WHERE scope='$scope'", "DELETE FROM tasks WHERE scope='$scope'",
            "INSERT INTO documents VALUES('$scope','new','new-ciphertext',1)",
            "UPDATE documents SET revision=8 WHERE scope='$scope'", "DELETE FROM documents WHERE scope='$scope'",
            "INSERT INTO outbox VALUES('$scope','new',1,'operation','local')",
            "UPDATE outbox SET state='sent' WHERE scope='$scope'", "DELETE FROM outbox WHERE scope='$scope'",
            "INSERT INTO reminders VALUES('$scope','new','task','occurrence',1,1000,'pending',NULL)",
            "UPDATE reminders SET state='delivered' WHERE scope='$scope'", "DELETE FROM reminders WHERE scope='$scope'",
            "UPDATE documents SET scope='unrelated' WHERE scope='$scope'",
            "INSERT OR REPLACE INTO tasks VALUES('$scope','task','replacement-ciphertext',99,1,1)")
        for(sql in writes)expectBlocked({db.execSQL(sql)})
    }
    internal fun directory(): Pair<E2eeDirectory.Verified,E2eeDirectory.Verified> {
        val authority=E2eeKeys.createRecoveryKit(owner);val device=E2eeKeys.generateDeviceKeys();val public=E2eeKeys.publicKeys(device);val root=E2eeKeys.freshSecret()
        fun capsule(recipient: String,key: String) = E2eeKeys.sealRoot(root,key,E2eeKeys.RootRecipient(owner,remote,1,"root-one",recipient))
        val command=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",remote).put("deviceId","device").put("action","bootstrap")
            .put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId","bootstrap")
            .put("payload",JSONObject().put("kind","personal").put("resourceId",owner).put("keyId","root-one").put("generation",1)
                .put("recoveryKit",authority.kit).put("deviceKeys",public).put("deviceCapsule",capsule("device",public.getString("receivingKey")))
                .put("recoveryCapsule",capsule("recovery",authority.kit.getJSONObject("authority").getString("receivingKey"))))
        command.getJSONObject("payload").put("selfProof",E2eeCommands.sign(command,device.signing.private).get("signature"))
        val events=JSONArray().put(E2eeCommands.sign(command,authority.keys.signing.private))
        val preparing=E2eeDirectory.verify(owner,remote,authority.kit.getJSONObject("authority"),events)
        val commit=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",remote).put("deviceId","device").put("action","migration-commit")
            .put("expectedRevision",preparing.checkpoint.revision).put("checkpointHash",preparing.checkpoint.hash).put("securityEpoch",1).put("operationId","commit")
            .put("payload",JSONObject().put("migrationId","synthetic-migration").put("fence",1).put("manifestHash",E2eeEnvelope.encode(ByteArray(32)))
                .put("verifiedCheckpoint",E2eeEnvelope.encode(ByteArray(32))).put("generation",1).put("objectCount",1))
        events.put(E2eeCommands.sign(commit,device.signing.private))
        val active=E2eeDirectory.verify(owner,remote,authority.kit.getJSONObject("authority"),events);root.fill(0)
        return preparing to active
    }
    @Test fun directSchema1UpgradePreservesAllOriginalRowsAndBlocksEveryLegacyMutation() = runBlocking {
        val name="qa-e2ee-fence-${UUID.randomUUID()}.db";schema1(name);val room=open(name)
        try {
            val sql=room.openHelper.writableDatabase
            sql.query("PRAGMA user_version").use { assertTrue(it.moveToFirst());assertEquals(2,it.getInt(0)) }
            val before=original(sql);assertEquals(expectedSchema1Rows(),before)
            assertNull(room.dao().legacyScopeFence(scope));room.dao().putDocument(DocumentRecord("unrelated","free","free-ciphertext",1))
            val fence=NativeLegacyScopeFence(room,owner,remote,{})
            fence.withFence { assertNotNull(room.dao().legacyScopeFence(scope));writeMatrix(sql) }
            assertEquals(before,original(sql));room.dao().putDocument(DocumentRecord("unrelated","free","updated-free-ciphertext",2))
            expectBlocked({sql.execSQL("UPDATE documents SET scope=? WHERE scope='unrelated'",arrayOf(scope))})
            val (preparing,_)=directory();val token=requireNotNull(fence.token())
            try { fence.releaseCancelled(token,preparing) { E2eeMigration.Status("new-attempt","uploading",0,0,emptyList(),null,false,1) };fail("Stale cancellation accepted") }
            catch(error: IllegalStateException){assertEquals("E2EE_LOCAL_DOWNGRADE_FORBIDDEN",error.message)}
            fence.releaseCancelled(token,preparing) { E2eeMigration.Status("synthetic-migration","cancelled",0,0,emptyList(),null,false,1) }
            room.dao().putDocument(DocumentRecord(scope,"after-cancel","new-ciphertext",1))
            assertEquals(before,original(sql).filterNot { it.contains("after-cancel") })
        } finally { room.close();check(name.startsWith("qa-e2ee-fence-"));context.deleteDatabase(name) }
    }
    @Test fun aFreshDatabaseAndConnectionReopenRetainAnIrreversibleActiveBarrier() = runBlocking {
        val name="qa-e2ee-fence-${UUID.randomUUID()}.db";var room=open(name)
        try {
            room.dao().putTask(TaskRecord(scope,"task","original-task",1,false))
            room.dao().putDocument(DocumentRecord(scope,"cloud-base","original-document",1))
            room.dao().putOutbox(OutboxRecord(scope,"task",1,"original-operation"))
            room.dao().putReminder(ReminderRecord(scope,"reminder","task","occurrence",1,1000))
            val before=original(room.openHelper.writableDatabase);val fence=NativeLegacyScopeFence(room,owner,remote,{})
            try { fence.withFence<Unit> { error("SYNTHETIC_PROCESS_DEATH") };fail("Synthetic interruption missing") }catch(error: IllegalStateException){assertEquals("SYNTHETIC_PROCESS_DEATH",error.message)}
            val token=requireNotNull(fence.token());room.close();room=open(name)
            val resumed=NativeLegacyScopeFence(room,owner,remote,{});assertEquals(token,resumed.token());writeMatrix(room.openHelper.writableDatabase)
            val (preparing,active)=directory();resumed.activate(active);resumed.activate(active)
            val sql=room.openHelper.writableDatabase
            expectBlocked({sql.execSQL("DELETE FROM e2ee_legacy_fences WHERE scope=?",arrayOf(scope))},"E2EE_LOCAL_DOWNGRADE_FORBIDDEN")
            expectBlocked({sql.execSQL("UPDATE e2ee_legacy_fences SET phase='preparing' WHERE scope=?",arrayOf(scope))},"E2EE_LOCAL_DOWNGRADE_FORBIDDEN")
            expectBlocked({sql.execSQL("INSERT OR REPLACE INTO e2ee_legacy_fences VALUES(?,?,?,?,?)",arrayOf(scope,owner,remote,"preparing",token))},"E2EE_LOCAL_DOWNGRADE_FORBIDDEN")
            try { resumed.releaseCancelled(token,preparing) { E2eeMigration.Status("synthetic-migration","cancelled",0,0,emptyList(),null,false,1) };fail("Active downgrade accepted") }
            catch(error: IllegalStateException){assertEquals("E2EE_LOCAL_DOWNGRADE_FORBIDDEN",error.message)}
            assertEquals(before,original(sql));room.close();room=open(name);assertEquals("active",room.dao().legacyScopeFence(scope)!!.phase)
            writeMatrix(room.openHelper.writableDatabase);assertEquals(before,original(room.openHelper.writableDatabase))
        } finally { room.close();check(name.startsWith("qa-e2ee-fence-"));context.deleteDatabase(name) }
    }
    @Test fun separateRoomControllersCannotReleaseAnEarlierCancellationDuringANewAttempt() = runBlocking {
        val name="qa-e2ee-fence-${UUID.randomUUID()}.db";val first=open(name);val second=open(name)
        val finish=CompletableDeferred<Unit>()
        try {
            val f1=NativeLegacyScopeFence(first,owner,remote,{});val f2=NativeLegacyScopeFence(second,owner,remote,{})
            val entered=CompletableDeferred<Unit>();val releaseStarted=CompletableDeferred<Unit>()
            var latest=E2eeMigration.Status("old","cancelled",0,0,emptyList(),null,false,1)
            val running=async(Dispatchers.IO) { f1.withFence { entered.complete(Unit);finish.await();latest=E2eeMigration.Status("new","uploading",0,0,emptyList(),null,false,1) } }
            entered.await();val token=requireNotNull(f1.token());val preparing=directory().first
            val releasing=async(Dispatchers.IO) {
                releaseStarted.complete(Unit)
                try { f2.releaseCancelled(token,preparing) { latest };false }
                catch(error: IllegalStateException) { error.message == "E2EE_LOCAL_DOWNGRADE_FORBIDDEN" }
            }
            releaseStarted.await();assertNull(withTimeoutOrNull(150) { releasing.await() })
            finish.complete(Unit);running.await();assertTrue(releasing.await());assertNotNull(first.dao().legacyScopeFence(scope))
        } finally { finish.complete(Unit);first.close();second.close();check(name.startsWith("qa-e2ee-fence-"));context.deleteDatabase(name) }
    }
}

/** Explicit two-process QA protocol. Ordinary suite runs skip these stages;
 * the host starts prepare, waits for the technical ready signal, force-stops only
 * the QA package, then invokes verify using the same fresh UUID. */
@RunWith(AndroidJUnit4::class)
class E2eeFenceProcessDeathTest {
    private val fixture=E2eeLegacyScopeFenceTest()
    private fun name(): String {
        val id=InstrumentationRegistry.getArguments().getString("e2eeFenceRunId")
        org.junit.Assume.assumeTrue("Explicit host process-kill orchestration required",id != null)
        check(id != null && UUID.fromString(id).toString() == id) { "Invalid synthetic run ID" }
        return "qa-e2ee-fence-process-$id.db"
    }
    @Test fun prepareAndWaitForHostKill() = runBlocking {
        val name=name();assertFalse(fixture.context.getDatabasePath(name).exists());fixture.schema1(name)
        val room=fixture.open(name)
        try {
            val before=fixture.original(room.openHelper.writableDatabase);assertEquals(fixture.expectedSchema1Rows(),before)
            val fence=NativeLegacyScopeFence(room,fixture.owner,fixture.remote,{})
            fence.withFence<Unit> {
                assertNotNull(fence.token());assertEquals(before,fixture.original(room.openHelper.writableDatabase))
                InstrumentationRegistry.getInstrumentation().sendStatus(1,android.os.Bundle().apply { putString("e2eeFenceReady","true") })
                kotlinx.coroutines.awaitCancellation()
            }
        } finally { room.close() }
    }
    @Test fun verifyAfterHostKilledThePreparingProcess() = runBlocking {
        val name=name();assertTrue(fixture.context.getDatabasePath(name).exists());val room=fixture.open(name)
        try {
            assertEquals(fixture.expectedSchema1Rows(),fixture.original(room.openHelper.writableDatabase))
            assertEquals("preparing",room.dao().legacyScopeFence(fixture.scope)!!.phase)
            fixture.writeMatrix(room.openHelper.writableDatabase)
            assertEquals(fixture.expectedSchema1Rows(),fixture.original(room.openHelper.writableDatabase))
            val fence=NativeLegacyScopeFence(room,fixture.owner,fixture.remote,{})
            fence.activate(fixture.directory().second);assertEquals("active",room.dao().legacyScopeFence(fixture.scope)!!.phase)
            fixture.writeMatrix(room.openHelper.writableDatabase)
        } finally { room.close();check(name.startsWith("qa-e2ee-fence-process-"));fixture.context.deleteDatabase(name) }
    }
}
