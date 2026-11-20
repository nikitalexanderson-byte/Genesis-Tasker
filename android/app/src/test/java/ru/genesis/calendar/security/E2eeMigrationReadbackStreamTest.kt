package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class E2eeMigrationReadbackStreamTest {
    private class Memory:E2eeRecordStorage {
        private val rows=mutableMapOf<String,E2eeLocalRecord>()
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected);for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value}
    }
    private class Device:E2eeScopeDevice {
        override val ownerId="owner";override val deviceId="device";val privateKeys=E2eeKeys.generateDeviceKeys()
        private val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        override val vault=UnlockedE2eeVault(Memory(),UnlockedE2eeVault.Scope(ownerId,"device:readback",deviceId,1,1,1,"local-root",privateKeys.signing.private,mapOf("local-root" to root)){if(it==deviceId)privateKeys.signing.public else null})
        override fun requireOpen(){vault.requireOpen()}
        override fun keys():E2eeKeys.DeviceKeys{requireOpen();return privateKeys}
        override fun ensureDurableKeys(){requireOpen()}
        override fun rememberDirectory(scopeId:String,pin:JSONObject,events:JSONArray,scopeOwner:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified=error("UNUSED_DIRECTORY_WRITE")
        override fun savedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified?=null
    }
    private class Rig {
        val device=Device();var mode="normal";val calls=mutableListOf<JSONObject>()
        val directory=E2eeDirectory.Verified("owner","personal:stream-readback","owner","personal",1,1,"content-root",2,"uploading",E2eeDirectory.Checkpoint(1,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),JSONObject(),JSONObject(),mutableMapOf())
        private val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val rows=listOf("workspace" to "a","workspace" to "b","attachment" to "chunk-a").map{(domain,id)->E2eeEnvelope.seal(root,device.privateKeys.signing.private,
            E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",directory.ownerId).put("scopeId",directory.scopeId)
                .put("domain",domain).put("objectId",id).put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
                .put("revision",1).put("keyId","content-root").put("deviceId",device.deviceId).put("operationId",UUID.randomUUID().toString())),byteArrayOf(1,2,3))}
        val transport=E2eeSignedMigrationTransport(device,directory,setOf("workspace")){path,packet->
            assertEquals("/read",path);val command=E2eeCommands.verify(packet,device.privateKeys.signing.public);calls+=command;val payload=command.getJSONObject("payload");val action=command.getString("action")
            val selected=rows.filter{row->val context=row.context.toJson();context.get("domain")==payload.get("domain")&&if(action=="get")context.get("objectId")==payload.get("objectId")else mode=="loop"||context.getString("objectId")>payload.getString("after")}.take(1).map{it.toJson()}.toMutableList()
            if(mode=="foreign"&&selected.isNotEmpty())selected.first().getJSONObject("context").put("scopeId","personal:foreign")
            if(mode=="oversized"){selected.clear();repeat(2){selected+=rows.first().toJson()}}
            if(mode=="get-duplicate"&&selected.isNotEmpty())selected+=JSONObject(selected.first().toString())
            if(mode=="retire")device.vault.lock()
            JSONObject().put("checkpointHash",directory.checkpoint.hash).put("directoryRevision",directory.checkpoint.revision+if(mode=="directory")1 else 0).put("envelopes",JSONArray(selected))
        }
    }
    private suspend fun refuses(code:String="E2EE_",body:suspend()->Unit):Throwable {
        try{body()}catch(error:Exception){assertTrue("Expected $code, got ${error.message}",error.message.orEmpty().contains(code));return error};error("Invalid readback accepted")
    }
    @Test fun boundedInventoryChecksFinalEmptyPagesForEachDomainAndIncludesAttachments()=runBlocking {
        val f=Rig();val received=mutableListOf<String>();assertEquals(3,f.transport.forEachEnvelope{val context=it.context.toJson();received+=context.getString("domain")+":"+context.getString("objectId")})
        assertEquals(listOf("workspace:a","workspace:b","attachment:chunk-a"),received);assertEquals(5,f.calls.size)
        assertTrue(f.calls.all{it.getString("action")=="read"&&it.getJSONObject("payload").getInt("limit")==1})
        assertEquals(listOf("","a","b"),f.calls.filter{it.getJSONObject("payload").getString("domain")=="workspace"}.map{it.getJSONObject("payload").getString("after")})
    }
    @Test fun pendingSinkStopsPrefetchAndRetirementAfterItsAcknowledgementStopsIo()=runBlocking {
        val f=Rig();val reached=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();var callbacks=0
        val pending=async(start=CoroutineStart.UNDISPATCHED){refuses("UNLOCK_REQUIRED"){f.transport.forEachEnvelope{callbacks++;reached.complete(Unit);release.await()}}}
        reached.await();assertEquals(1,f.calls.size);f.device.vault.lock();release.complete(Unit);pending.await();assertEquals(1,callbacks);assertEquals(1,f.calls.size)
    }
    @Test fun foreignLoopOversizedDirectoryAndRetiredResponsesCannotComplete()=runBlocking {
        for(mode in listOf("loop","foreign","oversized","directory","retire")){val f=Rig();f.mode=mode;refuses{f.transport.forEachEnvelope{}}}
    }
    @Test fun aFailedSinkCannotRequestAnotherPageAndContextCopiesCannotChangeTheCursor()=runBlocking {
        val f=Rig();refuses("NO_SPACE"){f.transport.forEachEnvelope{error("E2EE_NO_SPACE")}};assertEquals(1,f.calls.size)
        val g=Rig();assertEquals(3,g.transport.forEachEnvelope{it.context.toJson().put("objectId","changed-by-sink")})
        assertEquals(listOf("","a","b"),g.calls.filter{it.getJSONObject("payload").getString("domain")=="workspace"}.map{it.getJSONObject("payload").getString("after")})
    }
    @Test fun directGetUsesExactSignedIdsAndRefusesBeforeIoForDisallowedDomains()=runBlocking {
        val f=Rig();assertEquals("a",f.transport.getEnvelope("workspace","a")!!.context.toJson().getString("objectId"));assertEquals("get",f.calls.first().getString("action"))
        assertEquals(setOf("domain","objectId"),f.calls.first().getJSONObject("payload").keys().asSequence().toSet());assertNull(f.transport.getEnvelope("workspace","missing"));val before=f.calls.size
        refuses{f.transport.getEnvelope("diary","a")};refuses{f.transport.getEnvelope("workspace","")};assertEquals(before,f.calls.size)
        for(mode in listOf("foreign","directory","get-duplicate","retire")){val g=Rig();g.mode=mode;refuses{g.transport.getEnvelope("workspace","a")}}
    }
}
