package ru.genesis.calendar.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Actual JS bridge/Room capability lifecycle on synthetic QA scopes. No cloud
 * account, provider IO, personal database or release package is used. */
@RunWith(AndroidJUnit4::class)
class AuroraOperationBridgeTest {
    private class Rig : AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="aurora-operation-${UUID.randomUUID()}"
        val scope=ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(owner)
        val jobs=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        val replies=ConcurrentHashMap<String,CompletableDeferred<JSONObject>>()
        @Volatile var authorized=true
        var onRequest:suspend ()->Unit={}
        val gateway=object: AuroraGateway {
            override fun check(){check(authorized && app.workspaceScope==scope){"AURORA_ACCOUNT_CHANGED"}}
            override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account")
                .put("key",Base64.getEncoder().encodeToString(ByteArray(32){it.toByte()})))
            override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
                check();onRequest();return JSONObject().put("revision",1)
            }
            override suspend fun billing(method:String,path:String,body:JSONObject?)=error("Synthetic billing disabled")
        }
        val store:AuroraNativeStore
        val bridge:AuroraJavascriptBridge
        val key="genesis-aurora-workspace-v1:$owner:pending"
        init {
            check(BuildConfig.DEBUG && app.packageName.contains(".qa"))
            app.activateAccount(owner)
            store=AuroraNativeStore(app,owner,scope,gateway)
            bridge=AuroraJavascriptBridge(store,gateway,jobs,{id,value->replies.remove(id)?.complete(value)},
                {},{},{},{},{_,_->},{})
        }
        suspend fun call(method:String,payload:JSONObject=JSONObject()):JSONObject {
            val id=UUID.randomUUID().toString();val reply=CompletableDeferred<JSONObject>();replies[id]=reply
            bridge.postMessage(JSONObject().put("id",id).put("method",method).put("payload",payload).toString())
            return try { withTimeout(10_000){reply.await()} } finally { replies.remove(id) }
        }
        suspend fun begin(token:String)=call("operationBegin",JSONObject().put("operationId",token))
        suspend fun end(token:String)=call("operationEnd",JSONObject().put("operationId",token))
        override fun close(){bridge.stop();jobs.cancel();app.activateAccount(null)}
    }
    @Test fun bridgeBindsSynchronousStorageAndRejectsExpiredOrForeignTokens()=runBlocking {
        val rig=Rig()
        try {
            val token=UUID.randomUUID().toString()
            assertEquals(token,rig.begin(token).getJSONObject("value").getString("operationId"))
            rig.bridge.setItem(rig.key,"retained-synthetic-ciphertext",token)
            assertEquals("retained-synthetic-ciphertext",rig.bridge.getItem(rig.key,token))
            assertTrue(runCatching { rig.bridge.getItem(rig.key,UUID.randomUUID().toString()) }.isFailure)
            assertFalse(rig.app.database.dao().document(rig.scope,"aurora-pending")!!.encrypted.contains("retained-synthetic-ciphertext"))
            assertTrue(rig.end(token).has("value"))
            assertTrue(runCatching { rig.bridge.removeItem(rig.key,token) }.isFailure)
            assertEquals("retained-synthetic-ciphertext",rig.store.getItem(rig.key))
        } finally {rig.close()}
    }
    @Test fun cancelledUnknownBeginCannotAcquireAnOrphanPermitAfterItsResponseTimesOut()=runBlocking {
        val rig=Rig();var blocker:NativeLegacyOperationPermit?=null
        try {
            val held=NativeLegacyOperationPermit.acquire(rig.app.database,rig.scope,{});blocker=held
            val token=UUID.randomUUID().toString();val pending=async(Dispatchers.IO){rig.begin(token)}
            assertTrue(rig.end(token).has("value"));held.finish()
            assertEquals("E2EE_INVALID_LEGACY_OPERATION",pending.await().getString("error"))
            withTimeout(10_000){NativeLegacyOperationPermit.acquire(rig.app.database,rig.scope,{}).finish()}
        } finally {blocker?.close();rig.close()}
    }
    @Test fun stoppedViewDrainsBorrowedRequestBeforeMigrationAndRetainsOriginalJournal()=runBlocking {
        val rig=Rig();val release=CompletableDeferred<Unit>();val entered=CompletableDeferred<Unit>()
        try {
            val token=UUID.randomUUID().toString();assertTrue(rig.begin(token).has("value"))
            rig.bridge.setItem(rig.key,"original-encrypted-journal",token)
            val original=rig.app.database.dao().document(rig.scope,"aurora-pending")!!.encrypted
            rig.onRequest={entered.complete(Unit);release.await()}
            val request=async(Dispatchers.IO){rig.call("request",JSONObject().put("operationId",token).put("method","PUT")
                .put("path","/aurora-workspace").put("body",JSONObject()))}
            withTimeout(10_000){entered.await()}
            val captured=CompletableDeferred<Unit>()
            val migration=async(Dispatchers.IO){NativeLegacyScopeFence(rig.app.database,rig.owner,"personal:${rig.owner}",{}).withFence {
                assertEquals(original,rig.app.database.dao().document(rig.scope,"aurora-pending")!!.encrypted);captured.complete(Unit)
            }}
            rig.bridge.stop();assertNull(withTimeoutOrNull(150){captured.await()})
            release.complete(Unit);withTimeout(10_000){migration.await()};request.cancelAndJoin()
            assertTrue(runCatching{rig.bridge.removeItem(rig.key,token)}.isFailure)
        } finally {release.complete(Unit);rig.close()}
    }
    @Test fun endingAnOperationRemainsPossibleAfterTheCapturedAccountExpires()=runBlocking {
        val rig=Rig()
        try {
            val token=UUID.randomUUID().toString();assertTrue(rig.begin(token).has("value"))
            rig.authorized=false
            assertTrue(runCatching{rig.bridge.checkSession(token)}.isFailure)
            assertTrue(rig.end(token).has("value"))
            withTimeout(10_000){NativeLegacyOperationPermit.acquire(rig.app.database,rig.scope,{}).finish()}
        } finally {rig.close()}
    }
}
