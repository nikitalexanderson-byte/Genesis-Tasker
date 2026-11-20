package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID

class E2eeContentPlanReadbackTest {
    private class Memory:E2eeRecordStorage {
        val rows=mutableMapOf<String,E2eeLocalRecord>();var writes=0
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected){"E2EE_LOCAL_CONFLICT"};for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value;writes++}
    }
    private val inventory by lazy{val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile};E2eePrivatePaths(JSONObject(file.readText()))}
    private inner class Rig(localOnly:Boolean=false,kind:String="personal") {
        val memory=Memory();val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val vault=UnlockedE2eeVault(memory,UnlockedE2eeVault.Scope("actor-owner","device:plan-readback","plan-device",1,1,1,"local-root",keys.signing.private,mapOf("local-root" to root)){if(it=="plan-device")keys.signing.public else null})
        val context=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId","content-owner").put("scopeId","$kind:plan-readback")
            .put("domain","workspace").put("objectId","plan-context").put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
            .put("revision",1).put("keyId","content-root").put("deviceId","plan-device").put("operationId",UUID.randomUUID().toString()))
        var live=true;val read=E2eeContentPlan.ReadOptions(vault,root,keys.signing.public,context,E2eeSourceStage.Target("content-owner","$kind:plan-readback",kind),UUID.randomUUID().toString(),E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(7))),inventory.required(kind).map{it.id},inventory){check(live){"E2EE_ACCOUNT_CHANGED"}}
        val reference:E2eeContentPlan.Reference;val manifest:JSONObject;val values=linkedMapOf<String,E2eeEnvelope.Envelope>();var gets=0;var walks=0
        val port=object:E2eeBoundedMigrationReadback {
            override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {walks++;for(value in values.values){yield();consume(E2eeEnvelope.Envelope.fromJson(value.toJson()))};return values.size}
            override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {gets++;yield();return values["$domain\u0000$objectId"]?.let{E2eeEnvelope.Envelope.fromJson(it.toJson())}}
        }
        init{
            val writer=E2eeContentPlan.create(E2eeContentPlan.Options(read,keys.signing.private,E2eeContentPlan.Capacity(128L*1024*1024,8000,8000),{},{},{}))
            val bytes=ByteArray(if(kind=="project")3 else E2eeFiles.CHUNK_BYTES*2+17){(it*37).toByte()}
            writer.append(read.paths.first(),E2eeContentPlan.Record(if(localOnly)"local" else "remote",if(kind=="project")"shared-comment" else "workspace","record",bytes.size,bytes.inputStream(),"α😀","application/json"));bytes.fill(0)
            if(kind=="personal"&&!localOnly)writer.append("personal.local-work",E2eeContentPlan.Record("local","workspace","local",3,byteArrayOf(9,8,7).inputStream()))
            reference=writer.finish(read.paths.map{it to true});manifest=E2eeContentPlan.open(read,reference).manifest
            val plan=manifest.getJSONArray("plan");for(index in 0 until plan.length()){val item=plan.getJSONObject(index);val row=requireNotNull(vault.read("outbox",item.getString("recordId")));try{values[item.getString("domain")+"\u0000"+item.getString("objectId")]=E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8)))}finally{row.bytes.fill(0)}}
        }
        suspend fun verify(port:E2eeBoundedMigrationReadback=this.port)=E2eeContentPlan.verifyReadback(read,reference,port)
    }
    private suspend fun refuses(body:suspend()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid readback accepted")}
    private fun flip(value:String)=(if(value[0]=='A')"B" else "A")+value.substring(1)
    @Test fun completeInventoryAndEveryOriginalByteAreVerifiedWithoutLocalWrites() {runBlocking{
        val f=Rig();val before=f.memory.rows.toMap();val writes=f.memory.writes;val receipt=f.verify();assertEquals(f.reference,receipt.reference);assertEquals(4,receipt.envelopes);assertEquals(1,receipt.remoteRecords);assertEquals(1,receipt.localRecords);assertEquals(4,f.gets);assertEquals(writes,f.memory.writes);for((key,row)in before)assertSame(row,f.memory.rows[key])
    }}
    @Test fun missingExtraDuplicateAndIncorrectCountNeverPassCompleteness() {runBlocking{
        val f=Rig();val all=f.values.values.toList()
        for(mode in listOf("missing","extra","duplicate","count"))refuses{f.verify(object:E2eeBoundedMigrationReadback by f.port {
            override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {
                val rows=when(mode){"missing"->all.drop(1);"duplicate"->all+all.first();"extra"->all+E2eeEnvelope.Envelope.fromJson(all.first().toJson().also{it.getJSONObject("context").put("objectId","unplanned")});else->all}
                for(value in rows)consume(value);return if(mode=="count")0 else rows.size
            }
        })};assertEquals(0,f.gets)
    }}
    @Test fun forgedSignaturesAndSwallowedCallbackErrorsCannotPassWithMatchingPayloadHashes() {runBlocking{
        val f=Rig();val all=f.values.values.toList();refuses{f.verify(object:E2eeBoundedMigrationReadback by f.port {
            override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {
                val bad=E2eeEnvelope.Envelope.fromJson(all.first().toJson().also{it.put("signature",flip(it.getString("signature")))});try{consume(bad)}catch(_:Exception){};for(value in all)try{consume(value)}catch(_:Exception){};return all.size
            }
        })};assertEquals(0,f.gets)
    }}
    @Test fun missingChangedOrForeignExactGetsCannotYieldAReceipt() {runBlocking{
        val f=Rig();for(mode in listOf("missing","ciphertext","signature","scope"))refuses{f.verify(object:E2eeBoundedMigrationReadback by f.port {
            override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {
                val raw=requireNotNull(f.port.getEnvelope(domain,objectId));if(mode=="missing")return null;val json=raw.toJson();if(mode=="scope")json.getJSONObject("context").put("scopeId","foreign")else json.put(mode,flip(json.getString(mode)));return E2eeEnvelope.Envelope.fromJson(json)
            }
        })}
    }}
    @Test fun lateCallbacksAreRevokedAndActorRetirementNeverProducesSuccess() {runBlocking{
        val f=Rig();var late:(suspend(E2eeEnvelope.Envelope)->Unit)?=null;f.verify(object:E2eeBoundedMigrationReadback by f.port {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {late=consume;return f.port.forEachEnvelope(consume)}})
        refuses{requireNotNull(late)(f.values.values.first())}
        for(mode in listOf("walk","get")){val g=Rig();refuses{g.verify(object:E2eeBoundedMigrationReadback by g.port {
            override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {val count=g.port.forEachEnvelope(consume);if(mode=="walk")g.live=false;return count}
            override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {val value=g.port.getEnvelope(domain,objectId);if(mode=="get")g.live=false;return value}
        })}}
    }}
    @Test fun localOnlyPlansRequireZeroRemoteObjectsAndSharedCommentsAreAuthenticated() {runBlocking{
        val local=Rig(true);val receipt=local.verify();assertEquals(0,receipt.envelopes);assertEquals(1,receipt.localRecords);assertEquals(0,local.gets);assertEquals(1,local.walks)
        refuses{local.verify(object:E2eeBoundedMigrationReadback by local.port {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit)=1})}
        val shared=Rig(kind="project");assertEquals(1,shared.verify().envelopes);assertEquals(1,shared.gets)
    }}
    @Test fun disappearingLocalOnlyPartsAreNotAcceptedAfterRemoteAwaits() {runBlocking{
        val f=Rig();val id=f.manifest.getJSONArray("local").getJSONObject(0).getString("recordId")+":0";val key=f.memory.rows.keys.single{it.endsWith(id)}
        refuses{f.verify(object:E2eeBoundedMigrationReadback by f.port {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {val count=f.port.forEachEnvelope(consume);f.memory.rows.remove(key);return count}})}
    }}
    @Test fun suspendedFileReaderAwaitsAcknowledgementAndWipesBorrowedPlaintextOnCancellation() {runBlocking{
        val f=Rig();val bytes=ByteArray(E2eeFiles.CHUNK_BYTES*2+17){(it*31).toByte()};val sealed=E2eeFiles.seal(f.root,f.keys.signing.private,f.context,bytes,"file","application/octet-stream")
        val values=sealed.chunks.associateBy{it.context.toJson().getString("objectId")};val entered=CompletableDeferred<Unit>();val blocked=CompletableDeferred<Unit>();var borrowed:ByteArray?=null;var fetches=0
        val task=async {E2eeFiles.openStreamSuspending(f.root,f.keys.signing.public,f.context,sealed.manifest,{id->yield();fetches++;requireNotNull(values[id])},{},{part->borrowed=part;entered.complete(Unit);blocked.await()})}
        entered.await();assertEquals(1,fetches);assertTrue(requireNotNull(borrowed).any{it!=0.toByte()});task.cancelAndJoin();assertTrue(requireNotNull(borrowed).all{it==0.toByte()});assertEquals(1,fetches);assertTrue(bytes.any{it!=0.toByte()});bytes.fill(0)
    }}
}
