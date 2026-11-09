package ru.genesis.calendar.data

import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.NativeBackupEpoch
import ru.genesis.calendar.auth.NativeBackupEpochStore
import java.util.UUID

class BackupReconciliationTest {
    @Test fun queuedWriterCannotRepopulateRetiredCache()=runBlocking {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="backup-queued-${UUID.randomUUID()}"
        val scope=CloudAccountSnapshot.scopeFor(owner)
        app.activateAccount(owner)
        try {
            val transport=object:MindmapTransport {
                override fun check()=Unit
                override suspend fun workspace():JSONObject=error("No network in this fixture")
                override suspend fun request(path:String,body:JSONObject?):JSONObject=error("No network in this fixture")
            }
            val repository=MindmapRepository(app.database,scope,owner,transport)
            val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            val holding=launch(Dispatchers.IO) { app.database.withTransaction { entered.complete(Unit);release.await() } }
            entered.await()
            // Use a separate dispatcher: an undispatched child can inherit Room's
            // transaction thread while the holder resumes this test's continuation.
            val started=CompletableDeferred<Unit>()
            val queued=async(Dispatchers.IO) { started.complete(Unit);repository.saveView("late",JSONObject().put("zoom",2)) }
            started.await()
            NativeBackupEpoch.retireTransports();release.complete(Unit);holding.join()
            try {queued.await();fail("A queued old writer was accepted")}catch(_:CancellationException){}
            assertNull(app.database.dao().document(scope,"mindmap-view:late"))
        } finally {app.activateAccount(null)}
    }
    @Test fun protectedResetHoldsPreferencesAndRetiresOldWriters()=runBlocking {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="backup-qa-${UUID.randomUUID()}"
        val scope=CloudAccountSnapshot.scopeFor(owner)
        app.activateAccount(owner)
        try {
            val preferences=LocalPreferences(app,scope)
            preferences.setPending("language","en")
            val dao=app.database.dao()
            dao.putDocument(DocumentRecord(scope,"habits","encrypted-test-cache",1))
            dao.putDocument(DocumentRecord(scope,"messenger/test","unrelated-draft",1))
            dao.putOutbox(OutboxRecord(scope,"habits",1,"pending-old-generation"))
            val safety=BackupSafetyStore(app,scope)
            assertTrue(safety.hasLocalState())
            val captured=safety.captureRaw()
            assertEquals("en",captured.getJSONObject("preferences").getString("pending:language"))
            val epochs=NativeBackupEpochStore(app)
            epochs.observe(scope,2)
            val gateway=object:BackupGateway {
                override fun check(){check(app.workspaceScope==scope)}
                override suspend fun request(method:String,path:String,body:JSONObject?)=JSONObject().put("generation",2)
                override suspend fun quiesce(){NativeBackupEpoch.retireTransports()}
            }
            assertEquals(2L,BackupNativeStore(app,owner,scope,gateway).reconcile())
            assertEquals(2L,epochs.accepted(scope))
            assertNull(epochs.pending(scope))
            assertTrue(LocalPreferences(app,scope).pending.first().isEmpty())
            assertTrue(dao.outbox(scope).isEmpty())
            assertNull(dao.document(scope,"habits"))
            assertEquals("unrelated-draft",dao.document(scope,"messenger/test")?.encrypted)
            val manifest=dao.backupDocuments(scope).last { it.kind.startsWith("backup-safety:")&&!it.kind.contains("/chunk/") }
            val metadata=JSONObject(manifest.encrypted)
            val chunks=mutableListOf<String>()
            repeat(metadata.getInt("chunks")){chunks+=requireNotNull(dao.document(scope,"${manifest.kind}/chunk/$it")).encrypted}
            val encrypted=chunks.joinToString("")
            val held=JSONObject(LocalCipher().decrypt(encrypted,"$scope/${manifest.kind}"))
            assertEquals("en",held.getJSONObject("preferences").getString("pending:language"))
            assertEquals(1,held.getJSONArray("outbox").length())
            try {preferences.setPending("language","ru");fail("A retired preference writer was accepted")}
            catch(_:CancellationException){}
            LocalPreferences(app,scope).setPending("language","de")
            assertEquals("de",LocalPreferences(app,scope).pending.first()["language"])
        } finally { app.activateAccount(null) }
    }
}
