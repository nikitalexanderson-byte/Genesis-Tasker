package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.NativeBackupEpochStore
import ru.genesis.calendar.security.WorkspaceCipher
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real owner mutex, Room, DataStore and Keystore; synthetic IO only. This is
 * normal backup exclusion, not acceptance of the unfinished archive source. */
class BackupOperationFenceTest {
    private class Rig {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="backup-fence-${UUID.randomUUID()}"
        val scope=CloudAccountSnapshot.scopeFor(owner)
        var epoch=0L
        suspend fun start(){app.activateAccount(owner);epoch=app.workspaceEpoch}
        fun check(){check(app.workspaceScope==scope&&app.workspaceEpoch==epoch){"BACKUP_OWNER"}}
        fun gateway(io:suspend(String,String,JSONObject?)->JSONObject)=object:BackupGateway {
            override fun check()=this@Rig.check()
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject{check();return io(method,path,body).also{check()}}
            override suspend fun quiesce()=error("No identity retirement in this fixture")
        }
        suspend fun finish(){app.activateAccount(null)}
        suspend fun openSafety(id:String):JSONObject {
            val kind="backup-safety:$id";val dao=app.database.dao();val manifest=JSONObject(requireNotNull(dao.document(scope,kind)).encrypted)
            val text=buildString{repeat(manifest.getInt("chunks")){append(requireNotNull(dao.document(scope,"$kind/chunk/$it")).encrypted)}}
            assertEquals(manifest.getInt("length"),text.length)
            return JSONObject(LocalCipher().decrypt(text,"$scope/$kind"))
        }
    }
    private suspend fun rejected(action:suspend ()->Unit){
        try{action();fail("Backup crossed the durable owner fence")}
        catch(error:AuthApiError){assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",error.code)}
    }
    @Test fun admittedResponseAndGenerationReceiptFinishBeforeMigrationCapture()=runBlocking {
        val rig=Rig();rig.start();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            val gateway=rig.gateway{_,path,_->assertEquals("/backup/v1/status",path);entered.complete(Unit);release.await();JSONObject().put("generation",2)}
            val store=BackupNativeStore(rig.app,rig.owner,rig.scope,gateway);val epochs=NativeBackupEpochStore(rig.app)
            val old=async(Dispatchers.IO){store.request("GET","/backup/v1/status",null)}
            withTimeout(10000){entered.await()};val captured=CompletableDeferred<Unit>()
            val migration=async(Dispatchers.IO){NativeLegacyScopeFence(rig.app.database,rig.owner,"personal:${rig.owner}",rig::check).withFence{
                assertEquals(2L,epochs.pending(rig.scope));captured.complete(Unit)
            }}
            assertNull(withTimeoutOrNull(150){captured.await()});assertNull(epochs.pending(rig.scope))
            release.complete(Unit);assertTrue(withTimeout(10000){old.await()}.getBoolean("needsReconciliation"));withTimeout(10000){migration.await()}
            rejected{store.request("GET","/backup/v1/status",null)}
        }finally{release.complete(Unit);rig.finish()}
    }
    @Test fun submittedSafetyInputIsFrozenBeforeWaitingAndNestedProtectCurrentDoesNotDeadlock()=runBlocking {
        val rig=Rig();rig.start();var permit:NativeLegacyOperationPermit?=null
        try{
            permit=NativeLegacyOperationPermit.acquire(rig.app.database,rig.scope,rig::check)
            val queued=CompletableDeferred<Unit>();val input=JSONObject().put("private","original submitted content")
            val safety=BackupSafetyStore(rig.app,rig.scope,{rig.check();queued.complete(Unit)})
            val saving=async(Dispatchers.IO){safety.protect(input)};withTimeout(10000){queued.await()}
            input.put("private","changed after waiting");permit.finish();permit=null
            val held=rig.openSafety(withTimeout(10000){saving.await()});assertEquals("original submitted content",held.getString("private"))
            val current=withTimeout(10000){safety.protectCurrent()};assertEquals("native-protected-state-v1",rig.openSafety(current).getString("format"))
        }finally{permit?.close();rig.finish()}
    }
    @Test fun preparingAndActiveMarkersDenyEveryBackupEntryWithoutIoPruneOrPreferenceReset()=runBlocking {
        for(active in listOf(false,true)){
            val rig=Rig();rig.start();var calls=0
            try{
                val dao=rig.app.database.dao();dao.putDocument(DocumentRecord(rig.scope,"habits","original-encrypted-content",1))
                val preferences=LocalPreferences(rig.app,rig.scope);preferences.setPending("language","en")
                val before=preferences.backupRaw().toString();val fence=NativeLegacyScopeFence(rig.app.database,rig.owner,"personal:${rig.owner}",rig::check)
                fence.withFence{};if(active)assertEquals(1,dao.activateLegacyScopeFence(rig.scope,requireNotNull(fence.token())))
                val store=BackupNativeStore(rig.app,rig.owner,rig.scope,rig.gateway{_,_,_->calls++;JSONObject()})
                val snapshot=JSONObject().put("ownerId",rig.owner).put("sections",JSONArray())
                rejected{store.request("GET","/backup/v1/status",null)};rejected{store.capture()};rejected{store.current()}
                rejected{store.open(JSONObject(),"workspace")};rejected{store.seal(JSONObject(),"workspace")}
                rejected{store.materialize(snapshot)};rejected{store.retain(snapshot)};rejected{store.reconcile()}
                val safety=BackupSafetyStore(rig.app,rig.scope,rig::check)
                rejected{safety.protect(snapshot)};rejected{safety.protectCurrent()};rejected{safety.resetAfterProtection()}
                assertEquals(0,calls);assertEquals("original-encrypted-content",dao.document(rig.scope,"habits")?.encrypted)
                assertFalse(dao.backupDocuments(rig.scope).any{it.kind.startsWith("backup-safety:")})
                assertEquals(before,preferences.backupRaw().toString());assertNull(NativeBackupEpochStore(rig.app).pending(rig.scope))
            }finally{rig.finish()}
        }
    }
    @Test fun switchingAwayAndBackToTheSameOwnerInvalidatesAQueuedBackupBeforeAnySafetyWrite()=runBlocking {
        val rig=Rig();rig.start();var permit:NativeLegacyOperationPermit?=null
        try{
            permit=NativeLegacyOperationPermit.acquire(rig.app.database,rig.scope,{})
            val entered=CompletableDeferred<Unit>();val gateway=object:BackupGateway{
                override fun check(){rig.check();entered.complete(Unit)}
                override suspend fun request(method:String,path:String,body:JSONObject?)=error("No IO")
                override suspend fun quiesce()=error("No reset")
            }
            val store=BackupNativeStore(rig.app,rig.owner,rig.scope,gateway)
            val saving=async(Dispatchers.IO){try{store.retain(JSONObject().put("ownerId",rig.owner));false}catch(error:IllegalStateException){assertEquals("BACKUP_OWNER",error.message);true}}
            withTimeout(10000){entered.await()};rig.app.activateAccount(null);rig.app.activateAccount(rig.owner)
            permit.finish();permit=null;assertTrue(withTimeout(10000){saving.await()})
            assertFalse(rig.app.database.dao().backupDocuments(rig.scope).any{it.kind.startsWith("backup-safety:")})
        }finally{permit?.close();rig.finish()}
    }
    @Test fun nestedNativeTransportBorrowsTheAdmittedBackupPermitAheadOfAWaitingMigration():Unit=runBlocking {
        val rig=Rig();rig.start();val entered=CompletableDeferred<Unit>();val release=CountDownLatch(1)
        val rawKey=ByteArray(32){7};val envelope=WorkspaceCipher.encrypt("{\"private\":\"original content\"}".toByteArray(),rawKey,byteArrayOf())
        try{
            val gateway=rig.gateway{_,path,_->assertEquals("/workspace",path)
                NativeLegacyTransportGate(rig.app.database).request(rig.scope,rig::check){
                    entered.complete(Unit);check(release.await(10,TimeUnit.SECONDS));JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(rawKey)))
                }
            }
            val store=BackupNativeStore(rig.app,rig.owner,rig.scope,gateway)
            val reading=async(Dispatchers.IO){store.open(JSONObject().put("iv",envelope.iv).put("ciphertext",envelope.ciphertext),"workspace") as JSONObject}
            withTimeout(10000){entered.await()};val captured=CompletableDeferred<Unit>()
            val migration=async(Dispatchers.IO){NativeLegacyScopeFence(rig.app.database,rig.owner,"personal:${rig.owner}",rig::check).withFence{captured.complete(Unit)}}
            assertNull(withTimeoutOrNull(150){captured.await()});release.countDown()
            assertEquals("original content",withTimeout(10000){reading.await()}.getString("private"));withTimeout(10000){migration.await()}
        }finally{release.countDown();rawKey.fill(0);rig.finish()}
    }
    @Test fun oversizedBackupPlaintextIsRefusedBeforeReadingAnyLegacyKey()=runBlocking {
        val rig=Rig();rig.start();var calls=0
        try{
            val store=BackupNativeStore(rig.app,rig.owner,rig.scope,rig.gateway{_,_,_->calls++;error("No key request is allowed")})
            val oversized=object:CharSequence {
                override val length=GenesisBackupContainer.MAX_PLAIN+1
                override fun get(index:Int):Char=error("Oversize text must be refused before reading it")
                override fun subSequence(startIndex:Int,endIndex:Int):CharSequence=error("Oversize text must be refused before reading it")
                override fun toString():String=error("Oversize text must be refused before materializing it")
            }
            try{store.seal(oversized,"workspace");fail("Oversize backup was accepted")}
            catch(error:IllegalArgumentException){assertEquals("BACKUP_TOO_LARGE",error.message)}
            assertEquals(0,calls);assertFalse(rig.app.database.dao().backupDocuments(rig.scope).any{it.kind.startsWith("backup-safety:")})
        }finally{rig.finish()}
    }
}
