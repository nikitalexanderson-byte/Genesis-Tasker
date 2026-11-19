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
                {_,_->pickers.incrementAndGet();null},{restarts.incrementAndGet()},{method->beforeUiDispatch(method)})
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
}
