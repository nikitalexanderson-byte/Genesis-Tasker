package ru.genesis.calendar.security

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

class E2eeLegacyArchiveFragmentsTest {
    private val context=E2eeMigrationSourceContext("archive-owner","personal:archive-owner","migration",4,E2eeEnvelope.encode(ByteArray(32)),2)
    private val names=listOf("stages","safety","receipts")
    private val oldKey=Base64.getEncoder().encodeToString(ByteArray(32){7})
    private inner class Fixture {
        val raw=linkedMapOf("stages" to mutableListOf("{ \"id\":\"stage\",\"payload_json\":\"[1,2]\",\"note\":\"личное 🌙\" }","{\"id\":\"uncertain-stage\"}"),
            "safety" to mutableListOf("{\"id\":\"old-safety\",\"snapshot_json\":\"{ \\\"exact\\\": true }\"}"),
            "receipts" to mutableListOf("{\"operation_id\":\"exact-uncertain-operation\",\"generation\":0}"))
        val calls=mutableListOf<Triple<String,Long,Long>>()
        var live=true;var chunkSize=13
        fun page(actual:E2eeMigrationSourceContext,table:String,offset:Long,byteOffset:Long):JSONObject {
            assertSame(context,actual);calls+=Triple(table,offset,byteOffset)
            val rows=raw.getValue(table);val bytes=if(rows.isEmpty())byteArrayOf()else rows[offset.toInt()].toByteArray(Charsets.UTF_8)
            val next=minOf(bytes.size.toLong(),byteOffset+chunkSize).toInt();val part=bytes.copyOfRange(byteOffset.toInt(),next)
            return try{JSONObject().put("protocol",1).put("ownerId",context.ownerId).put("scopeId",context.scopeId).put("migrationId",context.migrationId).put("fence",context.fence)
                .put("sourceHash",context.sourceHash).put("legacyGeneration",0).put("checkpointHash",context.sourceHash).put("directoryRevision",1)
                .put("encoding","utf8-json-fragments-v1").put("table",table).put("offset",offset).put("byteOffset",byteOffset)
                .put("totals",JSONObject().apply{names.forEach{put(it,raw.getValue(it).size)}}).put("rowBytes",bytes.size)
                .put("rowHash",if(bytes.isEmpty())JSONObject.NULL else E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
                .put("chunk",E2eeEnvelope.encode(part)).put("nextByteOffset",if(next<bytes.size)next else JSONObject.NULL)
                .put("nextOffset",if(next<bytes.size)offset else if(offset+1<rows.size)offset+1 else JSONObject.NULL)
                .put("legacyKey",JSONObject().put("keyMode",if(bytes.isNotEmpty()&&table!="receipts")"account" else "empty")
                    .put("key",if(bytes.isNotEmpty()&&table!="receipts")oldKey else JSONObject.NULL))
            }finally{bytes.fill(0);part.fill(0)}
        }
        suspend fun run(change:(JSONObject,Int)->Unit={_,_->})=E2eeLegacyArchiveFragments.collect(context,{check(live){"E2EE_ACCOUNT_CHANGED"}}){bound,table,offset,byteOffset->
            page(bound,table,offset,byteOffset).also{change(it,calls.size)}
        }
    }
    private suspend fun refused(action:suspend ()->Unit){
        try{action();fail("Incomplete archive fragments were accepted")}
        catch(error:Exception){assertTrue("Unexpected error: ${error.javaClass.simpleName}",error.message?.startsWith("E2EE_")==true)}
    }
    @Test fun everyExactRawRowAndUncertainIdSurvivesOneByteUtf8Fragments():Unit=runBlocking {
        val f=Fixture();f.chunkSize=1;val result=f.run()
        assertEquals("utf8-json-rows-v1",result.getString("encoding"));assertEquals(oldKey,result.getJSONObject("legacyKey").getString("key"))
        for(name in names)assertEquals(f.raw.getValue(name),(0 until result.getJSONArray(name).length()).map{result.getJSONArray(name).getString(it)})
        assertTrue(f.calls.any{it.third>0});assertFalse(result.has("chunk"));assertFalse(result.has("rowHash"))
    }
    @Test fun emptyTablesAreExplicitAndNeverInventAnOldKey():Unit=runBlocking {
        val f=Fixture();f.raw.values.forEach{it.clear()};val result=f.run()
        for(name in names)assertEquals(0,result.getJSONArray(name).length());assertEquals(3,f.calls.size)
        assertEquals("empty",result.getJSONObject("legacyKey").getString("keyMode"));assertTrue(result.getJSONObject("legacyKey").isNull("key"))
    }
    @Test fun foreignContextFalseEofOffsetsFutureEncodingAndNonCanonicalChunksAreRefused():Unit=runBlocking {
        val changes=listOf<(JSONObject)->Unit>({it.put("ownerId","foreign")},{it.put("scopeId","foreign")},{it.put("migrationId","other")},
            {it.put("fence",5)},{it.put("sourceHash",E2eeEnvelope.encode(ByteArray(32){1}))},{it.put("encoding","future")},
            {it.put("table","users")},{it.put("offset",1)},{it.put("byteOffset",1)},{it.put("extra",true)},
            {it.put("rowBytes",0)},{it.put("chunk","")},{it.put("chunk",it.getString("chunk")+"=")},
            {it.put("nextByteOffset",0)},{it.put("nextByteOffset",JSONObject.NULL)},{it.put("nextOffset",1)},{it.put("nextOffset",JSONObject.NULL)})
        for(change in changes)refused{Fixture().run{page,_->change(page)}}
    }
    @Test fun changedIdentityTotalsLengthsHashesAndOldKeysCannotSpliceRows():Unit=runBlocking {
        val changes=listOf<(JSONObject)->Unit>({it.getJSONObject("totals").put("safety",2)},
            {it.put("checkpointHash",E2eeEnvelope.encode(ByteArray(32){1}))},{it.put("directoryRevision",2)},
            {it.put("legacyGeneration",1)},{it.put("rowBytes",1000)},{it.put("rowHash",E2eeEnvelope.encode(ByteArray(32){2}))},
            {it.getJSONObject("legacyKey").put("key",Base64.getEncoder().encodeToString(ByteArray(32){8}))})
        for(change in changes)refused{Fixture().run{page,count->if(count>1)change(page)}}
    }
    @Test fun currentGenerationRowsAndUnsupportedLargeRowsRefuseBeforeReturningPartialData():Unit=runBlocking {
        for(change in listOf<(JSONObject)->Unit>({it.put("legacyGeneration",2)},{it.put("rowBytes",64L*1024*1024+1)},
            {it.getJSONObject("totals").put("stages",1000001)},{it.put("chunk",E2eeEnvelope.encode(ByteArray(1024*1024+1)))})){
            refused{Fixture().run{page,_->change(page)}}
        }
    }
    @Test fun alteredBytesFailFullHashEvenWithOtherwiseValidMetadata():Unit=runBlocking {
        refused{Fixture().run{page,_->val bytes=E2eeEnvelope.decode(page.getString("chunk"),1,1024*1024)
            try{bytes[0]=(bytes[0].toInt() xor 1).toByte();page.put("chunk",E2eeEnvelope.encode(bytes))}finally{bytes.fill(0)}}}
    }
    @Test fun oldKeysAreRequiredForPrivateRowsAndForbiddenForReceiptOrEmptyRows():Unit=runBlocking {
        refused{Fixture().run{page,_->page.put("legacyKey",JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))}}
        refused{Fixture().run{page,_->if(page.get("table")=="receipts")page.put("legacyKey",JSONObject().put("keyMode","account").put("key",oldKey))}}
        refused{Fixture().run{page,_->page.getJSONObject("legacyKey").put("key",JSONObject.NULL)}}
        val f=Fixture();f.raw.getValue("stages").clear();refused{f.run{page,_->if(page.get("table")=="stages")page.put("legacyKey",JSONObject().put("keyMode","account").put("key",oldKey))}}
    }
    @Test fun clientLockedProvenanceRemainsExplicitWithoutInventingAKey():Unit=runBlocking {
        val result=Fixture().run{page,_->if(page.getJSONObject("legacyKey").get("keyMode")=="account")page.put("legacyKey",JSONObject().put("keyMode","client").put("key",JSONObject.NULL))}
        assertEquals("client",result.getJSONObject("legacyKey").getString("keyMode"));assertTrue(result.getJSONObject("legacyKey").isNull("key"))
    }
    @Test fun accountChangeAfterAResponseStopsBeforeAnotherFragment():Unit=runBlocking {
        val f=Fixture();refused{f.run{_,_->f.live=false}};assertEquals(1,f.calls.size)
    }
    @Test fun rowsBeyondTheOrdinaryPagerCapJoinWithoutTruncation():Unit=runBlocking {
        val f=Fixture();f.chunkSize=1024*1024;f.raw["stages"]=mutableListOf("{\"payload_json\":\""+"x".repeat(9*1024*1024)+"\"}")
        val result=f.run();assertEquals(f.raw.getValue("stages").single(),result.getJSONArray("stages").getString(0))
        assertTrue(f.calls.count{it.first=="stages"}>8)
    }
    @Test fun rawDuplicateNamesAndWhitespaceReachTheCommonParserWithoutJSONObjectOverwriting():Unit=runBlocking {
        val f=Fixture();f.raw["stages"]=mutableListOf("{ \"id\":\"original\",\"\\u0069d\":\"other\",\"payload_json\":\"[]\" }")
        assertEquals(f.raw.getValue("stages").single(),f.run().getJSONArray("stages").getString(0))
    }
    @Test fun authenticatedInvalidUtf8RefusesRatherThanReplacingPrivateBytes():Unit=runBlocking {
        val f=Fixture();f.chunkSize=1024
        refused{f.run{page,_->if(page.get("table")=="stages"&&page.getLong("offset")==0L){
            val bytes=byteArrayOf(0xc3.toByte(),0x28)
            page.put("chunk",E2eeEnvelope.encode(bytes)).put("rowBytes",2).put("rowHash",E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
                .put("nextByteOffset",JSONObject.NULL).put("nextOffset",1)
        }}}
    }
    @Test fun emitActualCollectorRowsForTheSharedStrictParser():Unit=runBlocking {
        val f=Fixture();f.chunkSize=1;val result=f.run();result.getJSONObject("legacyKey").put("key",JSONObject.NULL)
        val duplicate=Fixture();duplicate.raw["stages"]=mutableListOf("{\"id\":\"original\",\"\\u0069d\":\"other\"}")
        val duplicateResult=duplicate.run();duplicateResult.getJSONObject("legacyKey").put("key",JSONObject.NULL)
        val root=generateSequence<java.io.File>(java.io.File(requireNotNull(System.getProperty("user.dir"))).absoluteFile){it.parentFile}
            .first{java.io.File(it,"contracts/e2ee").isDirectory&&java.io.File(it,"android/app").isDirectory}
        val output=java.io.File(root,"output/release-3.3.6/runtime/archives-native-fragments-vector.json");requireNotNull(output.parentFile).mkdirs()
        val bound=JSONObject().put("ownerId",context.ownerId).put("scopeId",context.scopeId).put("migrationId",context.migrationId)
            .put("fence",context.fence).put("sourceHash",context.sourceHash).put("generation",context.generation)
        output.writeText(JSONObject().put("protocol",1).put("synthetic",true).put("context",bound).put("transport",result).put("duplicate",duplicateResult).toString(2),Charsets.UTF_8)
    }
}
