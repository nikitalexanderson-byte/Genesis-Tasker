package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

class E2eeContentPlanTest {
    private class Memory:E2eeRecordStorage {
        val rows=mutableMapOf<String,E2eeLocalRecord>();var writes=0
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected){"E2EE_LOCAL_CONFLICT"}
            for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value;writes++}
    }
    private val inventory by lazy{val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile};E2eePrivatePaths(JSONObject(file.readText()))}
    private inner class Rig {
        val memory=Memory();val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val vault=UnlockedE2eeVault(memory,UnlockedE2eeVault.Scope("actor-owner","device:content-plan","plan-device",1,1,1,"local-root",keys.signing.private,mapOf("local-root" to root)){if(it=="plan-device")keys.signing.public else null})
        val context=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId","content-owner").put("scopeId","personal:content-plan")
            .put("domain","workspace").put("objectId","plan-context").put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
            .put("revision",1).put("keyId","content-root").put("deviceId","plan-device").put("operationId",UUID.randomUUID().toString()))
        var live=true;var complete=true
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        val read=E2eeContentPlan.ReadOptions(vault,root,keys.signing.public,context,E2eeSourceStage.Target("content-owner","personal:content-plan","personal"),UUID.randomUUID().toString(),E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(7))),inventory.required("personal").map{it.id},inventory,current)
        val coverage=read.paths.map{it to true}
        fun options(admit:(E2eeContentPlan.Admission)->Unit={})=E2eeContentPlan.Options(read,keys.signing.private,E2eeContentPlan.Capacity(128L*1024*1024,8000,8000),admit,{}, {check(complete){"E2EE_SOURCE_STAGE_EOF_REQUIRED"}})
        fun record(bytes:ByteArray,id:String="record",placement:String="remote",source:InputStream=bytes.inputStream())=E2eeContentPlan.Record(placement,"workspace",id,bytes.size,source,"\uFEFF\uD800-\uDFFF-α","application/json")
    }
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Incomplete or foreign content plan accepted")}
    @Test fun completeRemoteAndLocalStreamsReadBackBeforePublishingAnInertManifest(){
        val f=Rig();val writer=E2eeContentPlan.create(f.options());val bytes=ByteArray(E2eeFiles.CHUNK_BYTES*3+17){(it*37).toByte()};val local=byteArrayOf(9,8,7)
        writer.append("personal.workspace",f.record(bytes));writer.append("personal.local-work",f.record(local,"local-record","local"));val reference=writer.finish(f.coverage);val writes=f.memory.writes
        val result=E2eeContentPlan.open(f.read,reference).manifest;assertEquals(writes,f.memory.writes);assertEquals(5,result.getJSONArray("plan").length());assertEquals(1,result.getJSONArray("logical").length());assertEquals(1,result.getJSONArray("local").length())
        val logical=result.getJSONArray("logical").getJSONObject(0);assertEquals(E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)),logical.getString("plaintextHash"));assertEquals("\uFEFF\uD800-\uDFFF-α",logical.getString("filename"))
        val entry=E2eeMigrationLocal.validate(result.getJSONArray("local"),reference.attemptId,inventory.required("personal").flatMap{it.domains}.toSet()).single();val saved=E2eeMigrationLocal.open(f.vault,entry)
        try{assertArrayEquals(local,saved.bytes)}finally{saved.bytes.fill(0)};bytes.fill(0);local.fill(0)
    }
    @Test fun lateSourceAuthenticationFailureKeepsInertPrefixesAndCannotPublishACompletePlan(){
        val f=Rig();val writer=E2eeContentPlan.create(f.options());val bytes=ByteArray(E2eeFiles.CHUNK_BYTES+1){31};val delegate=bytes.inputStream()
        val source=object:InputStream(){override fun read():Int=error("UNUSED_READ");override fun read(out:ByteArray,offset:Int,length:Int):Int{val count=delegate.read(out,offset,length);if(count<0)error("E2EE_OLD_TAG_INVALID");return count}}
        refuses{writer.append("personal.workspace",f.record(bytes,source=source))};assertTrue(f.memory.rows.size>1);refuses{writer.finish(f.coverage)};assertTrue(bytes.all{it==31.toByte()});bytes.fill(0)
    }
    @Test fun quotaRefusalPreservesEveryPreviouslyProtectedOriginal(){
        val f=Rig();f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","original-source",byteArrayOf(3,2,1),null)));val before=f.memory.rows.toMap();var calls=0
        val writer=E2eeContentPlan.create(f.options{if(++calls==3)error("E2EE_NO_SPACE")});val bytes=ByteArray(E2eeFiles.CHUNK_BYTES*2){5}
        refuses{writer.append("personal.workspace",f.record(bytes))};refuses{writer.finish(f.coverage)};for((key,row)in before)assertSame(row,f.memory.rows[key]);bytes.fill(0)
    }
    @Test fun missingDuplicateCoverageAndIncompleteOriginalPreventPublication(){
        for(mode in listOf("missing","duplicate","original")){val f=Rig();val writer=E2eeContentPlan.create(f.options());writer.append("personal.workspace",f.record(byteArrayOf(1)));if(mode=="original")f.complete=false
            val coverage=if(mode=="missing")f.coverage.dropLast(1)else if(mode=="duplicate")f.coverage+f.coverage.first()else f.coverage;refuses{writer.finish(coverage)}}
    }
    @Test fun lateCiphertextDamageAndActorRetirementNeverProduceACompleteReadReceipt(){
        val f=Rig();val writer=E2eeContentPlan.create(f.options());val bytes=ByteArray(E2eeFiles.CHUNK_BYTES+1){2};writer.append("personal.workspace",f.record(bytes));val reference=writer.finish(f.coverage);val manifest=E2eeContentPlan.open(f.read,reference).manifest
        val plan=manifest.getJSONArray("plan");val recordId=plan.getJSONObject(plan.length()-2).getString("recordId");val key=f.memory.rows.keys.single{it.endsWith(recordId)};val row=f.memory.rows.getValue(key);val changed=row.envelope.toJson();val cipher=changed.getString("ciphertext")
        changed.put("ciphertext",(if(cipher[0]=='A')"B" else "A")+cipher.substring(1));f.memory.rows[key]=E2eeLocalRecord(row.serial,E2eeEnvelope.Envelope.fromJson(changed));refuses{E2eeContentPlan.open(f.read,reference)};f.live=false;refuses{E2eeContentPlan.open(f.read,reference)};bytes.fill(0)
    }
    @Test fun wrongPathDomainDuplicateRecordAndOversizedCommentsRefuseBeforeReadingNewSource(){
        val f=Rig();val writer=E2eeContentPlan.create(f.options());writer.append("personal.workspace",f.record(byteArrayOf(1)))
        for(mode in listOf("path","domain","duplicate","comment")){var reads=0;val source=object:InputStream(){override fun read():Int{reads++;return -1}}
            val record=E2eeContentPlan.Record("remote",if(mode=="domain")"shared-project" else if(mode=="comment")"shared-comment" else "workspace",if(mode=="duplicate")"record" else "different",if(mode=="comment")65537 else 1,source)
            refuses{writer.append(if(mode=="path")"project.content" else "personal.workspace",record)};assertEquals(0,reads)}
    }
    @Test fun contentMetadataUsesSeparateLexicalBudgetWithoutWeakeningExistingFileManifestBounds(){
        val large=("{\"rows\":["+"0,".repeat(140000)+"0]}").toByteArray();assertTrue(large.size>256*1024);E2eeFileManifestJson.readContentPlan(large)
        refuses{E2eeFileManifestJson.read(large)}
        for(text in listOf("{\"x\":1,\"\\u0078\":2}","{x:1}","{\"x\":1,}","{\"x\":01}","{\"x\":1}{}"))refuses{E2eeFileManifestJson.readContentPlan(text.toByteArray())}
    }
}
