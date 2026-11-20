package ru.genesis.calendar.ui

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.NativeBackupEpochStore
import ru.genesis.calendar.data.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Actual bridge/owner mutex/Room/Keystore/DataStore. Only HTTP and the document
 * picker callback are synthetic; the separate SAF case uses actual pickers. */
class BackupWholeOperationTest {
    private class Rig {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="backup-job-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner)
        val jobs=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        val responses=ConcurrentHashMap<String,CompletableDeferred<JSONObject>>()
        val checks=AtomicInteger();val requests=AtomicInteger();val pickers=AtomicInteger();val restarts=AtomicInteger()
        var epoch=0L;@Volatile var live=true;var generation=0L
        var io:(()->Unit)?=null
        var beforeUiDispatch:suspend (String)->Unit={}
        var extraReply:JSONObject?=null
        var chosen:android.net.Uri?=null
        var beforeChoose:suspend ()->Unit={}
        var beforeFileRetention:()->Unit={}
        lateinit var bridge:BackupJavascriptBridge
        fun ownerCheck(){check(app.workspaceScope==account&&app.workspaceEpoch==epoch){"BACKUP_OWNER"}}
        fun check(){checks.incrementAndGet();check(live){"BACKUP_OWNER"};ownerCheck()}
        suspend fun start(){
            app.activateAccount(owner);epoch=app.workspaceEpoch
            val gateway=object:BackupGateway {
                override fun check()=this@Rig.check()
                override suspend fun quiesce(){check();live=false}
                override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                    check();assertTrue(method=="GET"&&path=="/backup/v1/status"||method=="POST"&&path=="/backup/v1/server-snapshot")
                    return NativeLegacyTransportGate(app.database).request(account,this@Rig::check){
                        requests.incrementAndGet();io?.invoke();JSONObject().put("generation",generation).apply{extraReply?.let{extra->for(key in extra.keys())put(key,extra.get(key))}}
                    }
                }
            }
            val store=BackupNativeStore(app,owner,account,gateway)
            bridge=BackupJavascriptBridge(store,gateway,app,owner,jobs,{id,value->responses.remove(id)?.complete(value)},
                {_,_->pickers.incrementAndGet();beforeChoose();chosen},{restarts.incrementAndGet()},{method->beforeUiDispatch(method)},{beforeFileRetention()})
        }
        fun submit(method:String,payload:JSONObject=JSONObject()):Deferred<JSONObject>{
            val id=UUID.randomUUID().toString();val result=CompletableDeferred<JSONObject>();responses[id]=result
            bridge.postMessage(JSONObject().put("id",id).put("method",method).put("payload",payload).toString());return result
        }
        suspend fun call(method:String,payload:JSONObject=JSONObject()):JSONObject=withTimeout(10000){submit(method,payload).await()}
        suspend fun begin(token:String=UUID.randomUUID().toString()):String {
            val reply=call("operationBegin",JSONObject().put("operationId",token));assertFalse(reply.toString(),reply.has("error"))
            assertEquals(token,reply.getJSONObject("value").getString("operationId"));return token
        }
        suspend fun end(token:String)=call("operationEnd",JSONObject().put("operationId",token))
        fun payload(token:String)=JSONObject().put("operationId",token)
        suspend fun finish(){bridge.stop();jobs.cancel();jobs.coroutineContext[Job]?.join();responses.values.forEach{it.cancel()};app.activateAccount(null)}
    }
    private fun ok(reply:JSONObject){assertFalse(reply.toString(),reply.has("error"))}
    private fun error(reply:JSONObject,code:String){assertEquals(code,reply.getString("error"))}

    @Test fun admittedJobKeepsItsCapabilityAcrossRpcGapsAndNestedRequestsAheadOfWaitingMigration():Unit=runBlocking {
        val r=Rig();r.start()
        try{
            val token=r.begin();ok(r.call("capture",r.payload(token)))
            val captured=CompletableDeferred<Unit>();val migration=async(Dispatchers.IO){NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{captured.complete(Unit)}}
            assertNull(withTimeoutOrNull(150){captured.await()})
            r.bridge.setHistory("{\"attempt\":\"2026-11-19T12:00:00Z\"}",token)
            ok(r.call("request",r.payload(token).put("method","GET").put("path","/backup/v1/status")))
            ok(r.call("capture",r.payload(token)));assertFalse(captured.isCompleted)
            ok(r.end(token));withTimeout(10000){migration.await()}
            error(r.call("operationBegin",r.payload(UUID.randomUUID().toString())),"E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")
            error(r.call("capture",r.payload(token)),"E2EE_INVALID_LEGACY_OPERATION")
            assertEquals(1,r.requests.get())
        }finally{r.finish()}
    }
    @Test fun endingAnUnawaitedHttpInvalidatesFirstButDrainsTheActualResponseBeforeMigration():Unit=runBlocking {
        val r=Rig();r.start();val release=CountDownLatch(1);val entered=CompletableDeferred<Unit>()
        try{
            val token=r.begin();r.generation=2;r.io={entered.complete(Unit);check(release.await(10,TimeUnit.SECONDS))}
            val response=r.submit("request",r.payload(token).put("method","GET").put("path","/backup/v1/status"));withTimeout(10000){entered.await()}
            error(r.end(token),"E2EE_UNAWAITED_LEGACY_OPERATION")
            val captured=CompletableDeferred<Unit>();val migration=async(Dispatchers.IO){NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{captured.complete(Unit)}}
            assertNull(withTimeoutOrNull(150){captured.await()});release.countDown()
            error(withTimeout(10000){response.await()},"E2EE_INVALID_LEGACY_OPERATION");withTimeout(10000){migration.await()}
            assertNull(NativeBackupEpochStore(r.app).pending(r.account))
        }finally{release.countDown();r.finish()}
    }
    @Test fun cleanupBeforeAQueuedBeginReceiptCannotPublishALateCapability():Unit=runBlocking {
        val r=Rig();r.start();var held:NativeLegacyOperationPermit?=null
        try{
            held=NativeLegacyOperationPermit.acquire(r.app.database,r.account,r::check)
            val initial=r.checks.get();val token=UUID.randomUUID().toString();val begin=r.submit("operationBegin",r.payload(token))
            withTimeout(10000){while(r.checks.get()<initial+2)delay(10)};ok(r.end(token));held.finish();held=null
            error(withTimeout(10000){begin.await()},"E2EE_INVALID_LEGACY_OPERATION")
            val next=r.begin();ok(r.call("capture",r.payload(next)));ok(r.end(next))
            try{r.bridge.setHistory("{}",token);fail("Ended capability wrote history")}catch(error:ru.genesis.calendar.auth.AuthApiError){assertEquals("E2EE_INVALID_LEGACY_OPERATION",error.code)}
        }finally{held?.close();r.finish()}
    }
    @Test fun viewCloseAndSameOwnerReloginDenyHistoryWritesAndReleaseTheMutex():Unit=runBlocking {
        for(close in listOf(false,true)){
            val r=Rig();r.start()
            try{
                val token=r.begin();if(close)r.bridge.stop()else{r.app.activateAccount(null);r.app.activateAccount(r.owner)}
                try{r.bridge.setHistory("{}",token);fail("Retired view wrote history")}catch(_:IllegalStateException){/* View or exact account epoch refused. */}
                if(!close)ok(r.end(token))
                val permit=withTimeout(10000){NativeLegacyOperationPermit.acquire(r.app.database,r.account,{})};permit.finish()
                assertNull(r.app.getSharedPreferences("genesis.backup.history.v1",0).getString(r.owner,null));assertEquals(0,r.requests.get())
            }finally{r.finish()}
        }
    }
    @Test fun noMutationOrPickerCanBypassTheWholeJobWhileReadOnlyStartupStatusRemainsAvailable():Unit=runBlocking {
        val r=Rig();r.start()
        try{
            ok(r.call("request",JSONObject().put("method","GET").put("path","/backup/v1/status")))
            for(method in listOf("capture","importChoose","exportBegin","reconcile"))error(r.call(method),"E2EE_INVALID_LEGACY_OPERATION")
            error(r.call("restart"),"BACKUP_RECONCILE_REQUIRED");assertEquals(0,r.pickers.get());assertEquals(0,r.restarts.get())
            val token=r.begin();ok(r.end(token));error(r.call("operationBegin",r.payload(token)),"E2EE_INVALID_LEGACY_OPERATION")
        }finally{r.finish()}
    }
    @Test fun verifiedResetSurvivesItsOwnHttpRetirementAndCanRestartOnlyAfterCapabilityCleanup():Unit=runBlocking {
        val r=Rig();r.start();r.generation=2
        try{
            LocalPreferences(r.app,r.account).setPending("language","en")
            val token=r.begin();val reset=r.call("reconcile",r.payload(token));ok(reset);assertEquals(2L,reset.getLong("value"))
            assertFalse(r.live);assertEquals(2L,NativeBackupEpochStore(r.app).accepted(r.account));assertNull(NativeBackupEpochStore(r.app).pending(r.account))
            assertTrue(r.bridge.currentSession(token));assertFalse(r.bridge.currentSession(""))
            assertEquals("",retain(r,form(),token))
            assertEquals("BACKUP_OWNER",retain(r,form()))
            error(r.call("restart"),"BACKUP_RECONCILE_REQUIRED");ok(r.end(token));assertFalse(r.bridge.currentSession(token));ok(r.call("restart"));assertEquals(1,r.restarts.get())
            error(r.call("restart"),"BACKUP_RECONCILE_REQUIRED")
        }finally{r.finish()}
    }
    @Test fun aPrivateReplyQueuedAfterIoCannotCrossAnAccountChangeBeforeUiPublication():Unit=runBlocking {
        val r=Rig();r.start();val queued=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            val token=r.begin();val canary="private archive from the departed account"
            r.extraReply=JSONObject().put("payload",canary)
            r.beforeUiDispatch={method->if(method=="request"){queued.complete(Unit);release.await()}}
            val reply=r.submit("request",r.payload(token).put("method","POST").put("path","/backup/v1/server-snapshot").put("body",JSONObject()))
            withTimeout(10000){queued.await()};r.app.activateAccount(null);r.app.activateAccount("next-${UUID.randomUUID()}");release.complete(Unit)
            val result=withTimeout(10000){reply.await()};error(result,"BACKUP_OWNER");assertFalse(result.toString().contains(canary));assertFalse(result.has("value"))
            ok(r.end(token));assertEquals(1,r.requests.get())
        }finally{release.complete(Unit);r.finish()}
    }
    @Test fun aLateBeginReceiptAfterSameOwnerReloginClosesItsCapabilityBeforePublishingRefusal():Unit=runBlocking {
        val r=Rig();r.start();val queued=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            val token=UUID.randomUUID().toString();r.beforeUiDispatch={method->if(method=="operationBegin"){queued.complete(Unit);release.await()}}
            val reply=r.submit("operationBegin",r.payload(token));withTimeout(10000){queued.await()}
            r.app.activateAccount(null);r.app.activateAccount(r.owner);release.complete(Unit)
            val result=withTimeout(10000){reply.await()};error(result,"BACKUP_OWNER");assertFalse(result.has("value"))
            val permit=withTimeout(10000){NativeLegacyOperationPermit.acquire(r.app.database,r.account,{})};permit.finish()
            ok(r.end(token));assertEquals(0,r.requests.get())
        }finally{release.complete(Unit);r.finish()}
    }
    @Test fun rendererSessionCheckRefusesAResponseThatWasDispatchedBeforeTheOwnerChanged():Unit=runBlocking {
        val r=Rig();r.start()
        try{
            val token=r.begin();assertTrue(r.bridge.currentSession(token));assertTrue(r.bridge.currentSession(""))
            r.extraReply=JSONObject().put("payload","private old archive already in the renderer queue")
            val response=r.call("request",r.payload(token).put("method","POST").put("path","/backup/v1/server-snapshot").put("body",JSONObject()));ok(response)
            r.app.activateAccount(null);r.app.activateAccount(r.owner)
            assertFalse(r.bridge.currentSession(token));assertFalse(r.bridge.currentSession(""));ok(r.end(token))
        }finally{r.finish()}
    }
    @Test fun selectedProviderFileTransfersExactBinaryBytesAndMetadataThenRetiresItsBuffer():Unit=runBlocking {
        val r=Rig();r.start();val directory=java.io.File(r.app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=java.io.File(directory,"QA336-исходный-${UUID.randomUUID()}.genesisbackup")
        val original=ByteArray(BackupImportFile.CHUNK+19){(it%256).toByte()};file.writeBytes(original)
        try{
            r.chosen=androidx.core.content.FileProvider.getUriForFile(r.app,"${r.app.packageName}.updates",file)
            val token=r.begin();val reply=r.call("importChoose",r.payload(token));ok(reply);val info=reply.getJSONObject("value")
            assertEquals(file.name,info.getString("name"));assertEquals(original.size,info.getInt("length"));assertEquals(file.length(),info.getLong("declaredSize"))
            assertTrue(info.isNull("lastModified"));assertFalse(info.toString().contains(file.absolutePath));val joined=java.io.ByteArrayOutputStream();var offset=0
            while(offset<original.size){val part=r.call("importChunk",r.payload(token).put("id",info.getString("id")).put("offset",offset));ok(part)
                val value=part.getJSONObject("value");assertEquals(offset,value.getInt("offset"));joined.write(java.util.Base64.getUrlDecoder().decode(value.getString("bytes")));offset=value.getInt("nextOffset")}
            assertArrayEquals(original,joined.toByteArray())
            assertEquals(java.security.MessageDigest.getInstance("SHA-256").digest(original).joinToString(""){"%02x".format(it)},info.getString("sha256"))
            ok(r.call("importClear",r.payload(token).put("id",info.getString("id"))))
            assertTrue(r.call("importChunk",r.payload(token).put("id",info.getString("id")).put("offset",0)).has("error"));ok(r.end(token))
            assertEquals(0,r.requests.get())
        }finally{original.fill(0);file.delete();r.finish()}
    }
    @Test fun cancelledReplacementKeepsTheOriginalTransferAndEndCannotLeaveBytesForAnotherJob():Unit=runBlocking {
        val r=Rig();r.start();val directory=java.io.File(r.app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=java.io.File(directory,"QA336-cancel-${UUID.randomUUID()}.genesisbackup");file.writeBytes(byteArrayOf(0,-1,0xc3.toByte(),0x28))
        try{
            r.chosen=androidx.core.content.FileProvider.getUriForFile(r.app,"${r.app.packageName}.updates",file)
            val token=r.begin();val first=r.call("importChoose",r.payload(token));ok(first);val id=first.getJSONObject("value").getString("id");r.chosen=null
            error(r.call("importChoose",r.payload(token)),"BACKUP_CANCELLED")
            ok(r.call("importChunk",r.payload(token).put("id",id).put("offset",0)));ok(r.end(token))
            val next=r.begin();assertTrue(r.call("importChunk",r.payload(next).put("id",id).put("offset",0)).has("error"));ok(r.end(next))
        }finally{file.delete();r.finish()}
    }
    @Test fun endingTheJobWhileItsPickerWaitsCannotPublishOrInstallAFileAfterCleanup():Unit=runBlocking {
        val r=Rig();r.start();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            r.chosen=android.net.Uri.parse("content://ru.genesis.synthetic.unavailable/picker-must-not-open")
            val token=r.begin();r.beforeChoose={entered.complete(Unit);release.await()}
            val result=r.submit("importChoose",r.payload(token));withTimeout(10000){entered.await()}
            error(r.end(token),"E2EE_UNAWAITED_LEGACY_OPERATION");release.complete(Unit)
            error(withTimeout(10000){result.await()},"E2EE_INVALID_LEGACY_OPERATION")
            val next=r.begin();ok(r.end(next));assertEquals(0,r.requests.get())
        }finally{release.complete(Unit);r.finish()}
    }
    @Test fun closingTheWindowDuringFileRetentionReturnsPromptlyAndMigrationStillWaitsForActualIo():Unit=runBlocking {
        val r=Rig();r.start();val entered=CompletableDeferred<Unit>();val release=CountDownLatch(1)
        val directory=java.io.File(r.app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=java.io.File(directory,"QA336-close-retain-${UUID.randomUUID()}.genesisbackup");file.writeBytes(ByteArray(300000){(it*17).toByte()})
        try{
            r.chosen=androidx.core.content.FileProvider.getUriForFile(r.app,"${r.app.packageName}.updates",file)
            r.beforeFileRetention={entered.complete(Unit);check(release.await(10,TimeUnit.SECONDS))}
            val token=r.begin();r.submit("importChoose",r.payload(token));withTimeout(10000){entered.await()}
            val close=async(Dispatchers.Main){r.bridge.stop()}
            val prompt=withTimeoutOrNull(1000){close.await();true}?:false
            val captured=CompletableDeferred<Unit>();val migration=async(Dispatchers.IO){
                NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{captured.complete(Unit)}
            }
            assertNull(withTimeoutOrNull(150){captured.await()});release.countDown();withTimeout(10000){close.await();migration.await()}
            assertTrue("Disposing the native window waited for bulk file IO",prompt)
            val views=r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views");assertEquals(1,views.length())
            assertFalse(views.getJSONObject(0).getBoolean("mounted"));assertEquals(0,views.getJSONObject(0).getJSONArray("files").length());assertEquals(0,r.requests.get())
        }finally{release.countDown();file.delete();r.finish()}
    }
    @Test fun endingTheJobDuringFileRetentionInvalidatesPromptlyButCannotReleaseItsPermitEarly():Unit=runBlocking {
        val r=Rig();r.start();val entered=CompletableDeferred<Unit>();val release=CountDownLatch(1)
        val directory=java.io.File(r.app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=java.io.File(directory,"QA336-end-retain-${UUID.randomUUID()}.genesisbackup");file.writeBytes(ByteArray(300000){(it*19).toByte()})
        try{
            r.chosen=androidx.core.content.FileProvider.getUriForFile(r.app,"${r.app.packageName}.updates",file)
            r.beforeFileRetention={entered.complete(Unit);check(release.await(10,TimeUnit.SECONDS))}
            val token=r.begin();val response=r.submit("importChoose",r.payload(token));withTimeout(10000){entered.await()}
            error(withTimeout(1000){r.end(token)},"E2EE_UNAWAITED_LEGACY_OPERATION")
            val captured=CompletableDeferred<Unit>();val migration=async(Dispatchers.IO){
                NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{captured.complete(Unit)}
            }
            assertNull(withTimeoutOrNull(150){captured.await()});release.countDown()
            error(withTimeout(10000){response.await()},"E2EE_INVALID_LEGACY_OPERATION");withTimeout(10000){migration.await()}
            r.bridge.stop();val views=r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views")
            assertEquals(0,views.getJSONObject(0).getJSONArray("files").length());assertEquals(0,r.requests.get())
        }finally{release.countDown();file.delete();r.finish()}
    }
    private fun form(settled:Boolean=true,file:JSONObject?=null)=JSONObject().put("protocol",1).put("state",JSONObject().put("key"," exact private input ")
        .put("operationId","original-uncertain-operation").put("confirmed",false).put("zero",0)).put("settled",settled).put("file",file?:JSONObject.NULL).toString()
    private fun retain(r:Rig,raw:String,token:String=""):String {
        val id=UUID.randomUUID().toString();var reply=""
        raw.chunked(131072).forEachIndexed{index,part->reply=r.bridge.retainFormChunk(id,index,(index+1)*131072>=raw.length,part,token);if(reply.isNotEmpty())return reply}
        return reply
    }
    private fun valueManifest(id:String)=JSONObject().put("protocol",2).put("fields",org.json.JSONArray().put(JSONObject().put("name","key").put("id",id)))
        .put("settled",true).put("file",JSONObject.NULL).toString()
    @Test fun valueAndManifestPortsDrainBeforeCaptureAndBothHonorThePersistentMemoryFence():Unit=runBlocking {
        val r=Rig();r.start();val captured=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            val token=r.begin();val first=UUID.randomUUID().toString();assertEquals("",r.bridge.retainValueChunk("key",first,0,true,"\"earlier input\"",token))
            assertEquals("",r.bridge.retainValueManifest(valueManifest(first),token))
            val migration=async(Dispatchers.IO){NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{
                val snapshot=r.app.backupMigrationMemory.capture(r.owner,r.epoch);captured.complete(Unit);release.await();snapshot
            }}
            assertNull(withTimeoutOrNull(150){captured.await()})
            val latest=UUID.randomUUID().toString();assertEquals("",r.bridge.retainValueChunk("key",latest,0,true,"\"complete before releasing job\"",token))
            val accepted=valueManifest(latest);assertEquals("",r.bridge.retainValueManifest(accepted,token));ok(r.end(token));withTimeout(10000){captured.await()}
            assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",r.bridge.retainValueChunk("key",UUID.randomUUID().toString(),0,true,"\"late input\"",""))
            assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",r.bridge.retainValueManifest(accepted,""));release.complete(Unit)
            val source=withTimeout(10000){migration.await()}.getJSONArray("views").getJSONObject(0).getJSONObject("valueForm")
            assertEquals(accepted,source.getString("rawManifest"));assertEquals(2,source.getJSONArray("values").length());assertEquals(2,source.getJSONArray("rawManifests").length())
        }finally{release.complete(Unit);r.finish()}
    }
    @Test fun valueFormCanFinishItsOwnVerifiedResetButCannotSurviveCapabilityOrAccountRetirement():Unit=runBlocking {
        val r=Rig();r.start();r.generation=2
        try{
            val token=r.begin();ok(r.call("reconcile",r.payload(token)));assertFalse(r.live)
            val id=UUID.randomUUID().toString();assertEquals("",r.bridge.retainValueChunk("key",id,0,true,"\"final original input\"",token))
            val raw=valueManifest(id);assertEquals("",r.bridge.retainValueManifest(raw,token))
            assertEquals("BACKUP_OWNER",r.bridge.retainValueChunk("key",UUID.randomUUID().toString(),0,true,"null",""))
            assertEquals("BACKUP_OWNER",r.bridge.retainValueManifest(raw,""));ok(r.end(token))
            assertEquals("E2EE_INVALID_LEGACY_OPERATION",r.bridge.retainValueManifest(raw,token))
            r.app.activateAccount(null);r.app.activateAccount(r.owner);assertFalse(r.bridge.currentSession(token))
            assertEquals("BACKUP_OWNER",r.bridge.retainValueChunk("key",UUID.randomUUID().toString(),0,true,"null",token))
            assertEquals(0,r.app.backupMigrationMemory.capture(r.owner,r.app.workspaceEpoch).getJSONArray("views").length())
        }finally{r.finish()}
    }
    @Test fun acceptedFormAndSelectedFileRemainExactAfterTransferRetirementAndActualBridgeStop():Unit=runBlocking {
        val r=Rig();r.start();val directory=java.io.File(r.app.cacheDir,"advice-shares");check(directory.isDirectory||directory.mkdirs())
        val file=java.io.File(directory,"QA336-retain-${UUID.randomUUID()}.genesisbackup");val original=byteArrayOf(0,-1,0xc3.toByte(),0x28);file.writeBytes(original)
        try{
            assertEquals("",retain(r,form()));r.chosen=androidx.core.content.FileProvider.getUriForFile(r.app,"${r.app.packageName}.updates",file)
            val token=r.begin();val picked=r.call("importChoose",r.payload(token));ok(picked);val info=picked.getJSONObject("value")
            ok(r.call("importClear",r.payload(token).put("id",info.getString("id"))))
            val selected=JSONObject().put("id",info.getString("id")).put("name",info.getString("name")).put("type",info.getString("type").lowercase())
                .put("size",original.size).put("lastModified",0)
            val raw=" \n"+form(file=selected)+"\n";assertEquals("",retain(r,raw,token));ok(r.end(token));r.bridge.stop()
            val captured=r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0)
            assertEquals(raw,captured.getString("rawForm"));assertFalse(captured.getBoolean("mounted"));val retained=captured.getJSONArray("files").getJSONObject(0)
            assertEquals(info.toString(),retained.getJSONObject("descriptor").toString());assertArrayEquals(original,java.util.Base64.getUrlDecoder().decode(retained.getString("bytes")))
            assertFalse(captured.toString().contains(file.absolutePath));assertEquals(0,r.requests.get())
        }finally{original.fill(0);file.delete();r.finish()}
    }
    @Test fun synchronousFinalJobStatePrecedesMigrationFreezeAndPreparingRefusesImmediately():Unit=runBlocking {
        val r=Rig();r.start();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        try{
            assertEquals("",retain(r,form()));val token=r.begin();assertEquals("",retain(r,form(false),token))
            val migration=async(Dispatchers.IO){NativeLegacyScopeFence(r.app.database,r.owner,"personal:${r.owner}",r::ownerCheck).withFence{
                val snapshot=r.app.backupMigrationMemory.capture(r.owner,r.epoch);entered.complete(Unit);release.await();snapshot
            }}
            assertNull(withTimeoutOrNull(150){entered.await()});val accepted=form().replace("exact private input","complete before releasing job")
            assertEquals("",retain(r,accepted,token));ok(r.end(token));withTimeout(10000){entered.await()}
            assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",retain(r,form()));release.complete(Unit)
            val captured=withTimeout(10000){migration.await()};assertEquals(accepted,captured.getJSONArray("views").getJSONObject(0).getString("rawForm"))
            assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",retain(r,form()))
            assertEquals(accepted,r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0).getString("rawForm"))
        }finally{release.complete(Unit);r.finish()}
    }
    @Test fun partialPublicationNeverHidesAcceptedInputAndOwnerChangeRetiresAllForms():Unit=runBlocking {
        val r=Rig();r.start()
        try{
            val accepted=form();assertEquals("",retain(r,accepted));val id=UUID.randomUUID().toString()
            assertEquals("",r.bridge.retainFormChunk(id,0,false," ".repeat(131072),""))
            assertThrows(IllegalStateException::class.java){r.app.backupMigrationMemory.capture(r.owner,r.epoch)}
            r.bridge.stop();assertEquals(accepted,r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0).getString("rawForm"))
            r.app.activateAccount(null);r.app.activateAccount(r.owner)
            assertEquals(0,r.app.backupMigrationMemory.capture(r.owner,r.app.workspaceEpoch).getJSONArray("views").length())
            assertEquals("BACKUP_VIEW_CLOSED",retain(r,form()));assertFalse(r.bridge.currentSession(""))
        }finally{r.finish()}
    }
    @Test fun ordinaryAdmittedBackgroundIoDoesNotBlockAcknowledgingCurrentFormInput():Unit=runBlocking {
        val r=Rig();r.start()
        try{
            val ordinary=NativeLegacyOperationPermit.acquire(r.app.database,r.account,r::check)
            try{assertEquals("",retain(r,form()));assertEquals(form(),r.app.backupMigrationMemory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0).getString("rawForm"))}
            finally{ordinary.finish()}
        }finally{r.finish()}
    }
}
