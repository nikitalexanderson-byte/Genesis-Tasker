package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** The normal source/bootstrapping reader supports old whole tables and
 * bounded immutable shards with exact count, digest and final EOF. */
internal object E2eePrivateTableReader{
    class Opened(val bytes:ByteArray,val revision:Long)
    private fun invalid():Nothing=error("E2EE_PRIVATE_SEED_REQUIRED")
    private fun document(bytes:ByteArray,pathId:String,table:String):JSONObject{val value=E2eeFileManifestJson.readPrivateDocument(bytes);if(value.getString("pathId")!=pathId||value.getString("table")!=table||value.getString("execution")!="content-only")invalid();return value}
    private fun rows(value:JSONObject):JSONArray{E2eeKeys.exact(value,setOf("format","pathId","table","rows","execution"));if(value.getString("format")!="genesis-private-table-v1")invalid();val rows=value.getJSONArray("rows");if(rows.length()>1000000)invalid();for(at in 0 until rows.length())rows.getJSONObject(at);return rows}
    fun read(read:(String)->Opened,objectId:String,pathId:String,table:String,current:()->Unit,expectedCount:Int?=null):JSONArray{
        listOf(objectId,pathId,table).forEach(E2eeKeys::technical);current();val opened=read(objectId);current();val root=try{if(opened.revision!=1L)invalid();document(opened.bytes,pathId,table)}finally{opened.bytes.fill(0)}
        if(root.getString("format")=="genesis-private-table-v1"){val rows=rows(root);if(expectedCount!=null&&rows.length()!=expectedCount)invalid();return rows}
        E2eeKeys.exact(root,setOf("format","pathId","table","count","parts","execution"));val count=E2eeCommands.integer(root.get("count"),1);val parts=root.getJSONArray("parts");if(root.getString("format")!="genesis-private-table-shards-v2"||count>1000000||expectedCount!=null&&count!=expectedCount.toLong()||parts.length() !in 1..10000)invalid();val result=JSONArray()
        for(at in 0 until parts.length()){current();val part=parts.getJSONObject(at);E2eeKeys.exact(part,setOf("objectId","count","size","sha256"));val size=E2eeCommands.integer(part.get("size"),1);val expectedRows=E2eeCommands.integer(part.get("count"),1);if(part.getString("objectId")!="$objectId:part:$at"||size>E2eeFiles.MAX_FILE_BYTES)invalid();E2eeEnvelope.decode(part.getString("sha256"),32).fill(0);val value=read(part.getString("objectId"));current()
            try{if(value.revision!=1L||value.bytes.size.toLong()!=size||E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(value.bytes))!=part.getString("sha256"))invalid();val page=rows(document(value.bytes,pathId,table));if(page.length().toLong()!=expectedRows||result.length().toLong()+expectedRows>count)invalid();for(index in 0 until page.length())result.put(page.getJSONObject(index));current()}finally{value.bytes.fill(0)}
        }if(result.length().toLong()!=count)invalid();return result
    }
}
