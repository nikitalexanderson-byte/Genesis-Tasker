package ru.genesis.calendar.security

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class E2eeLegacyPersonalPagesTest {
    private val context=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private val key=Base64.getEncoder().encodeToString(ByteArray(32){9})
    private val names=listOf("maps","versions","receipts","deletions")
    private fun page(table:String,offset:Long)=JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",context.scopeId).put("migrationId",context.migrationId).put("fence",7)
        .put("sourceHash",context.sourceHash).put("legacyGeneration",0).put("checkpointHash",context.sourceHash).put("directoryRevision",1).put("table",table).put("offset",offset)
        .put("totals",JSONObject().apply{names.forEach{put(it,3)}}).put("rows",JSONArray().apply{for(i in offset until minOf(offset+2,3))put(JSONObject().put("id","$table-$i").put("raw","{ \"exact\": true }"))})
        .put("nextOffset",if(offset==0L)2 else JSONObject.NULL).put("legacyKey",if(table in setOf("maps","versions"))JSONObject().put("keyMode","account").put("key",key) else JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))
    private suspend fun rejects(action:suspend ()->Unit){try{action();fail("Expected incomplete source refusal")}catch(error:IllegalStateException){assertTrue(error.message?.startsWith("E2EE_")==true)}}
    @Test fun completeExactRowsAndOneOldKeyAreCollectedAcrossEveryTableAndOffset()=runBlocking{
        val calls=mutableListOf<Pair<String,Long>>();val result=E2eeLegacyPersonalPages.collect(context,"mindmaps",{}){actual,table,offset->assertEquals(context,actual);calls+=table to offset;page(table,offset)}
        assertEquals(8,calls.size);for(name in names){assertEquals(listOf(0L,2L),calls.filter{it.first==name}.map{it.second});assertEquals(3,result.getJSONArray(name).length());assertEquals("{ \"exact\": true }",result.getJSONArray(name).getJSONObject(2).getString("raw"))};assertEquals(key,result.getJSONObject("legacyKey").getString("key"))
    }
    @Test fun tamperedContextSkippedOffsetFalseEofAndChangedHeadersNeverReturnPartialData()=runBlocking{
        val modifications=listOf<(JSONObject)->Unit>({it.put("ownerId","foreign")},{it.put("nextOffset",1)},{it.put("nextOffset",JSONObject.NULL)},{it.put("offset",5)},
            {it.put("rows",JSONArray())},{it.put("legacyGeneration",2)},{it.put("table","users")})
        for(change in modifications)rejects{E2eeLegacyPersonalPages.collect(context,"mindmaps",{}){_,table,offset->page(table,offset).also(change)}}
        var index=0;rejects{E2eeLegacyPersonalPages.collect(context,"mindmaps",{}){_,table,offset->page(table,offset).also{if(index++>0)it.getJSONObject("totals").put("versions",4)}}}
    }
    @Test fun anEmptySourceIsExplicitAndAnAccountChangeStopsFurtherPages()=runBlocking{
        val result=E2eeLegacyPersonalPages.collect(context,"physis",{}){_,table,_->page("maps",0).put("table",table).put("totals",JSONObject().put("owners",0).put("records",0).put("usedIds",0).put("receipts",0))
            .put("rows",JSONArray()).put("nextOffset",JSONObject.NULL).put("legacyKey",JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))}
        assertEquals(0,result.getJSONArray("records").length());assertEquals("empty",result.getJSONObject("legacyKey").getString("keyMode"))
        var live=true;var calls=0;rejects{E2eeLegacyPersonalPages.collect(context,"mindmaps",{check(live){"E2EE_ACCOUNT_CHANGED"}}){_,table,offset->calls++;live=false;page(table,offset)}};assertEquals(1,calls)
    }
}
