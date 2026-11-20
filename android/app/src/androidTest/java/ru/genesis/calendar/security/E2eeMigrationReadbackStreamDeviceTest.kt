package ru.genesis.calendar.security

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Real provider and lifecycle checks with synthetic signed request/response
 * ports; not an HTTP/backend/product coordinator or recovery acceptance. */
class E2eeMigrationReadbackStreamDeviceTest {
    private class Memory:E2eeRecordStorage {
        override fun get(key:String):E2eeLocalRecord?=null
        override fun list(prefix:String)=emptyList<String>()
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){error("NO_STORAGE_WRITES_IN_READBACK_TRANSPORT")}
    }
    private class Device:E2eeScopeDevice {
        override val ownerId="owner";override val deviceId="device";val privateKeys=E2eeKeys.generateDeviceKeys()
        private val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        override val vault=UnlockedE2eeVault(Memory(),UnlockedE2eeVault.Scope(ownerId,"device:readback",deviceId,1,1,1,"local-root",privateKeys.signing.private,mapOf("local-root" to root)){if(it==deviceId)privateKeys.signing.public else null})
        override fun requireOpen(){vault.requireOpen()}
        override fun keys():E2eeKeys.DeviceKeys{requireOpen();return privateKeys}
        override fun ensureDurableKeys(){requireOpen()}
        override fun rememberDirectory(scopeId:String,pin:JSONObject,events:JSONArray,scopeOwner:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified=error("NO_DIRECTORY_WRITE_IN_READBACK")
        override fun savedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified?=null
    }
    private class Rig(large:Boolean=false):AutoCloseable {
        val device=Device();var mode="normal";val calls=mutableListOf<JSONObject>();val sizes=if(large)listOf(4*1024*1024,3,3)else listOf(3,3,3)
        val directory=E2eeDirectory.Verified("owner","personal:stream-readback","owner","personal",1,1,"content-root",2,"uploading",E2eeDirectory.Checkpoint(1,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),JSONObject(),JSONObject(),mutableMapOf())
        val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val rows=listOf("workspace" to "a","workspace" to "b","attachment" to "chunk-a").mapIndexed{index,(domain,id)->val bytes=ByteArray(sizes[index]){(it*31+index*17).toByte()}
            try{E2eeEnvelope.seal(root,device.privateKeys.signing.private,E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",directory.ownerId).put("scopeId",directory.scopeId)
                .put("domain",domain).put("objectId",id).put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
                .put("revision",1).put("keyId","content-root").put("deviceId",device.deviceId).put("operationId",UUID.randomUUID().toString())),bytes)}finally{bytes.fill(0)}}
        val transport=E2eeSignedMigrationTransport(device,directory,setOf("workspace")){path,packet->
            assertEquals("/read",path);val command=E2eeCommands.verify(packet,device.privateKeys.signing.public);calls+=command;val payload=command.getJSONObject("payload");val action=command.getString("action")
            val selected=rows.filter{row->val context=row.context.toJson();context.get("domain")==payload.get("domain")&&if(action=="get")context.get("objectId")==payload.get("objectId")else mode=="loop"||context.getString("objectId")>payload.getString("after")}.take(1).map{it.toJson()}.toMutableList()
            if(mode=="foreign"&&selected.isNotEmpty())selected.first().getJSONObject("context").put("scopeId","personal:foreign")
            if(mode=="oversized"){selected.clear();repeat(2){selected+=rows.first().toJson()}}
            if(mode=="get-duplicate"&&selected.isNotEmpty())selected+=JSONObject(selected.first().toString())
            if(mode=="retire")device.vault.lock()
            JSONObject().put("checkpointHash",directory.checkpoint.hash).put("directoryRevision",directory.checkpoint.revision+if(mode=="directory")1 else 0).put("envelopes",JSONArray(selected))
        }
        override fun close(){device.vault.lock()}
    }
    private suspend fun refuses(body:suspend()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};error("Incomplete readback accepted")}
    @Test fun singleEnvelopePagesAndDirectGetAuthenticateLargestAllowedEnvelopeWithoutAnAggregate()=runBlocking {
        val app=InstrumentationRegistry.getInstrumentation().targetContext;check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        Rig(true).use{f->val hashes=JSONArray();var bytes=0L;var callbacks=0
            assertEquals(3,f.transport.forEachEnvelope{envelope->val context=envelope.context.toJson();val index=when(context.getString("objectId")){"a"->0;"b"->1;else->2}
                val opened=E2eeEnvelope.open(f.root,f.device.privateKeys.signing.public,f.rows[index].context,envelope)
                try{assertEquals(f.sizes[index],opened.size);for(at in opened.indices)if(opened[at]!=((at*31+index*17).toByte()))error("ORIGINAL_BYTE_MISMATCH")
                    hashes.put(E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(opened)));bytes+=opened.size;callbacks++}finally{opened.fill(0)}})
            assertEquals(3,callbacks);assertEquals(5,f.calls.size);assertTrue(f.calls.all{it.getJSONObject("payload").getInt("limit")==1})
            val got=requireNotNull(f.transport.getEnvelope("workspace","a"));assertEquals(E2eeEnvelope.payloadHash(f.rows.first()),E2eeEnvelope.payloadHash(got));assertNull(f.transport.getEnvelope("workspace","missing"))
            val proof=JSONObject().put("synthetic",true).put("api",android.os.Build.VERSION.SDK_INT).put("sizes",JSONArray(f.sizes)).put("sha256",hashes).put("bytes",bytes).put("count",callbacks).put("pageLimit",1)
            File(app.getExternalFilesDir(null),"readback-stream336-provider.json").outputStream().use{out->out.write(proof.toString().toByteArray());out.fd.sync()}
        }
    }
    @Test fun providerBackpressureRetirementAndMalformedResponsesDoNotReturnCompleteInventory()=runBlocking {
        Rig().use{f->val reached=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val pending=async(start=CoroutineStart.UNDISPATCHED){refuses{f.transport.forEachEnvelope{reached.complete(Unit);release.await()}}}
            reached.await();assertEquals(1,f.calls.size);f.device.vault.lock();release.complete(Unit);pending.await();assertEquals(1,f.calls.size)}
        for(mode in listOf("loop","foreign","oversized","directory","retire"))Rig().use{f->f.mode=mode;refuses{f.transport.forEachEnvelope{}}}
        for(mode in listOf("foreign","directory","get-duplicate","retire"))Rig().use{f->f.mode=mode;refuses{f.transport.getEnvelope("workspace","a")}}
        Rig().use{f->refuses{f.transport.forEachEnvelope{error("E2EE_NO_SPACE")}};assertEquals(1,f.calls.size);val before=f.calls.size
            refuses{f.transport.getEnvelope("diary","a")};refuses{f.transport.getEnvelope("workspace","")};assertEquals(before,f.calls.size)}
    }
}
