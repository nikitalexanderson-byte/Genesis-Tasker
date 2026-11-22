package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.MessageDigest

/** Same packaged source catalogue as web/server. No request-controlled SQL or
 * inference of read grants from the conservative legacy fence inventory. */
internal class E2eePrivatePathCatalogue(context:Context){
    private val value=context.assets.open("private-path-sources-v1.json").use{input->
        val bytes=input.readBytes();try{check(bytes.size<=256*1024){"E2EE_SOURCE_PATH_FORBIDDEN"};JSONObject(bytes.toString(Charsets.UTF_8))}finally{bytes.fill(0)}}
    init{check(value.getInt("version")==1){"E2EE_SOURCE_PATH_FORBIDDEN"}}
    fun tables(kind:String,pathId:String):List<String>{val rows=value.getJSONArray("paths")
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);if(row.get("id")==pathId&&row.get("scope")==kind){val names=row.getJSONArray("server");return(0 until names.length()).map{names.getString(it)}}}
        error("E2EE_SOURCE_PATH_FORBIDDEN")}
    fun columns(table:String):List<String>{val rows=value.getJSONArray("tables");for(at in 0 until rows.length()){val row=rows.getJSONObject(at);if(row.getString("table")==table){val columns=row.getJSONArray("columns");return(0 until columns.length()).map{columns.getString(it)}}};error("E2EE_SOURCE_PATH_FORBIDDEN")}
}

/** Framing/completeness only. Original row JSON strings are passed to the common
 * duplicate-name parser before semantic reconciliation or completeness. */
internal object E2eePrivatePathFragments {
    suspend fun collect(context:E2eeMigrationSourceContext,kind:String,resourceId:String,pathId:String,tables:List<String>,assertCurrent:()->Unit,
        read:suspend(E2eeMigrationSourceContext,String,String,Long,Long)->JSONObject,readBatch:(suspend(E2eeMigrationSourceContext,String,String,Long,Long)->JSONObject)?=null):JSONObject {
        E2eeKeys.technical(resourceId);check(pathId.startsWith("$kind.")&&tables.size<=128&&tables.toSet().size==tables.size){"E2EE_SOURCE_PATH_FORBIDDEN"}
        val output=JSONObject();var expectedTotals:JSONObject?=null;var checkpoint:String?=null;var revision:Long?=null;var requests=0;var totalBytes=0L;var wire=0L
        val buffered=java.util.ArrayDeque<JSONObject>()
        suspend fun next(table:String,offset:Long,byteOffset:Long):JSONObject{assertCurrent();if(readBatch==null)return read(context,pathId,table,offset,byteOffset)
            if(buffered.isEmpty()){val value=readBatch(context,pathId,table,offset,byteOffset);assertCurrent();if(value.has("fragments")){E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","kind","resourceId","migrationId","fence","sourceHash","checkpointHash","directoryRevision","pathId","table","offset","byteOffset","fragments"));check(value.get("protocol")==1&&value.get("ownerId")==context.ownerId&&value.get("scopeId")==context.scopeId&&value.get("kind")==kind&&value.get("resourceId")==resourceId&&value.get("migrationId")==context.migrationId&&E2eeCommands.integer(value.get("fence"))==context.fence&&value.get("sourceHash")==context.sourceHash&&value.get("pathId")==pathId&&value.get("table")==table&&E2eeCommands.integer(value.get("offset"))==offset&&E2eeCommands.integer(value.get("byteOffset"))==byteOffset){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};val fragments=value.getJSONArray("fragments");check(fragments.length() in 1..50){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};for(at in 0 until fragments.length())buffered.addLast(fragments.getJSONObject(at))}else buffered.addLast(value)}
            val value=buffered.removeFirst();check(value.get("pathId")==pathId&&value.get("table")==table&&E2eeCommands.integer(value.get("offset"))==offset&&E2eeCommands.integer(value.get("byteOffset"))==byteOffset){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};return value}
        for(table in tables){val rows=JSONArray();output.put(table,rows);var offset=0L
            while(true){var position=0;var bytes:ByteArray?=null;var expectedHash:String?=null;var last=false
                try{while(true){
                    assertCurrent();check(++requests<=1000000){"E2EE_SOURCE_TOO_LARGE"};val page=next(table,offset,position.toLong());assertCurrent()
                    E2eeKeys.exact(page,setOf("protocol","ownerId","scopeId","kind","resourceId","migrationId","fence","sourceHash","checkpointHash","directoryRevision","pathId","table","offset","byteOffset","totals","rowBytes","rowHash","chunk","nextByteOffset","nextOffset"))
                    check(page.getInt("protocol")==1&&page.get("ownerId")==context.ownerId&&page.get("scopeId")==context.scopeId&&page.get("kind")==kind&&page.get("resourceId")==resourceId
                        &&page.get("pathId")==pathId&&page.get("migrationId")==context.migrationId&&E2eeCommands.integer(page.get("fence"),1)==context.fence&&page.get("sourceHash")==context.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
                    check(page.get("table")==table&&E2eeCommands.integer(page.get("offset"))==offset&&E2eeCommands.integer(page.get("byteOffset"))==position.toLong()){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"}
                    val totals=page.getJSONObject("totals");E2eeKeys.exact(totals,tables.toSet());check(tables.sumOf{E2eeCommands.integer(totals.get(it))}<=1000000){"E2EE_SOURCE_TOO_LARGE"}
                    val pin=page.getString("checkpointHash");E2eeEnvelope.decode(pin,32).fill(0);val rev=E2eeCommands.integer(page.get("directoryRevision"),1)
                    if(expectedTotals==null){expectedTotals=JSONObject(totals.toString());checkpoint=pin;revision=rev}
                    else check(checkpoint==pin&&revision==rev&&tables.all{expectedTotals!!.get(it)==totals.get(it)}){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"}
                    val encoded=page.toString().toByteArray(Charsets.UTF_8);try{wire+=encoded.size;check(encoded.size<=2*1024*1024&&wire<=2147483647L){"E2EE_SOURCE_TOO_LARGE"}}finally{encoded.fill(0)}
                    val count=E2eeCommands.integer(totals.get(table));val length=E2eeCommands.integer(page.get("rowBytes"));check(length<=64L*1024*1024){"E2EE_SOURCE_TOO_LARGE"}
                    if(count==0L){check(offset==0L&&position==0&&length==0L&&page.isNull("rowHash")&&page.getString("chunk").isEmpty()&&page.isNull("nextByteOffset")&&page.isNull("nextOffset")){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};last=true;break}
                    check(offset<count&&length>0){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};val hash=page.getString("rowHash");E2eeEnvelope.decode(hash,32).fill(0)
                    if(bytes==null){totalBytes+=length;check(totalBytes<=128L*1024*1024){"E2EE_SOURCE_TOO_LARGE"};bytes=ByteArray(length.toInt());expectedHash=hash}
                    val body=requireNotNull(bytes);check(length.toInt()==body.size&&hash==expectedHash){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"}
                    val part=E2eeEnvelope.decode(page.getString("chunk"),1,1024*1024)
                    try{val next=position+part.size;check(next<=body.size&&(if(next<body.size)E2eeCommands.integer(page.get("nextByteOffset"))==next.toLong()else page.isNull("nextByteOffset"))
                        &&(if(next<body.size)E2eeCommands.integer(page.get("nextOffset"))==offset else if(offset+1<count)E2eeCommands.integer(page.get("nextOffset"))==offset+1 else page.isNull("nextOffset"))){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};part.copyInto(body,position);position=next}finally{part.fill(0)}
                    if(position==body.size){val actual=MessageDigest.getInstance("SHA-256").digest(body)
                        try{assertCurrent();check(E2eeEnvelope.encode(actual)==expectedHash){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"}}finally{actual.fill(0)}
                        rows.put(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(body)).toString());last=page.isNull("nextOffset");if(last)check(rows.length().toLong()==count){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};break}
                }}finally{bytes?.fill(0)}
                if(last)break;offset++
            }
        }
        assertCurrent();check(buffered.isEmpty()){"E2EE_PRIVATE_PATH_TRANSPORT_INVALID"};return JSONObject().put("protocol",1).put("ownerId",context.ownerId).put("scopeId",context.scopeId).put("kind",kind).put("resourceId",resourceId).put("pathId",pathId).put("tables",output).put("encoding","utf8-json-rows-v1")
    }
}
