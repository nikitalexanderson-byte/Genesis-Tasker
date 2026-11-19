package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64

/** Bounded signed-source transport only. Call after the complete protected local
 * capture. Rows remain ORIGINAL UTF-8 JSON text: Android JSONObject would silently
 * replace duplicate private names. The shared strict parser must validate them
 * before category reconciliation. No restore, prune or activation authority. */
internal object E2eeLegacyArchiveFragments {
    private val tables=listOf("stages","safety","receipts")
    private val headerFields=setOf("protocol","ownerId","scopeId","migrationId","fence","sourceHash","legacyGeneration","checkpointHash","directoryRevision")
    private const val MAX_ROW=64*1024*1024
    private const val MAX_TOTAL=128L*1024*1024
    private const val MAX_WIRE=192L*1024*1024
    private const val MAX_CHUNK=1024*1024
    private fun invalid():Nothing=error("E2EE_ARCHIVE_TRANSPORT_INVALID")
    private fun integer(value:Any,minimum:Long=0):Long=E2eeCommands.integer(value,minimum).also{if(it>=9007199254740991L)invalid()}
    private fun exact(value:JSONObject,fields:Set<String>){if(value.keys().asSequence().toSet()!=fields)invalid()}
    private fun key(value:JSONObject):JSONObject {
        exact(value,setOf("keyMode","key"));val mode=value.getString("keyMode")
        if(mode !in setOf("account","client","empty"))invalid()
        if(mode=="account"){
            val encoded=value.getString("key");if(encoded.length!=44)invalid()
            val raw=try{Base64.getDecoder().decode(encoded)}catch(_:IllegalArgumentException){invalid()}
            try{if(raw.size!=32||Base64.getEncoder().encodeToString(raw)!=encoded)invalid()}finally{raw.fill(0)}
        }else if(!value.isNull("key"))invalid()
        return JSONObject(value.toString())
    }
    suspend fun collect(context:E2eeMigrationSourceContext,assertCurrent:()->Unit,
        readFragment:suspend (E2eeMigrationSourceContext,String,Long,Long)->JSONObject):JSONObject=try {
        E2eeKeys.technical(context.ownerId);E2eeKeys.technical(context.scopeId);E2eeKeys.technical(context.migrationId)
        integer(context.fence,1);integer(context.generation,1);E2eeEnvelope.decode(context.sourceHash,32).fill(0)
        var header:JSONObject?=null;var totals:JSONObject?=null
        var retainedKey=JSONObject().put("keyMode","empty").put("key",JSONObject.NULL)
        var requests=0;var wireBytes=0L;var sourceBytes=0L
        suspend fun read(table:String,offset:Long,byteOffset:Long):JSONObject {
            assertCurrent();check(++requests<=10000){"E2EE_SOURCE_TOO_LARGE"}
            val page=JSONObject(readFragment(context,table,offset,byteOffset).toString());assertCurrent()
            exact(page,headerFields+setOf("encoding","table","offset","byteOffset","totals","rowBytes","rowHash","chunk","nextByteOffset","nextOffset","legacyKey"))
            check(integer(page.get("protocol"))==1L&&page.get("ownerId")==context.ownerId&&page.get("scopeId")==context.scopeId
                &&page.get("migrationId")==context.migrationId&&integer(page.get("fence"),1)==context.fence&&page.get("sourceHash")==context.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
            val legacy=integer(page.get("legacyGeneration"));integer(page.get("directoryRevision"),1)
            E2eeEnvelope.decode(page.getString("checkpointHash"),32).fill(0)
            check(legacy<context.generation){"E2EE_GENERATION_REVIEW_REQUIRED"}
            if(page.get("encoding")!="utf8-json-fragments-v1"||page.get("table")!=table||integer(page.get("offset"))!=offset||integer(page.get("byteOffset"))!=byteOffset)invalid()
            val counts=page.getJSONObject("totals");exact(counts,tables.toSet());val count=tables.sumOf{integer(counts.get(it))}
            check(count<=1000000){"E2EE_SOURCE_TOO_LARGE"}
            val identity=JSONObject();for(field in headerFields)identity.put(field,page.get(field))
            if(header==null){header=identity;totals=JSONObject(counts.toString())}else {
                if(!E2eeCommands.canonical(requireNotNull(header)).contentEquals(E2eeCommands.canonical(identity))||
                    tables.any{integer(requireNotNull(totals).get(it))!=integer(counts.get(it))})invalid()
            }
            val old=key(page.getJSONObject("legacyKey"));val mode=old.getString("keyMode")
            if(mode!="empty"){
                if(retainedKey.get("keyMode")!="empty"&&(retainedKey.get("keyMode")!=mode||retainedKey.get("key")!=old.get("key")))invalid()
                retainedKey=old
            }
            val length=integer(page.get("rowBytes"));check(length<=MAX_ROW){"E2EE_SOURCE_TOO_LARGE"}
            if((table=="receipts"||length==0L)&&mode!="empty"||table!="receipts"&&length>0&&mode=="empty")invalid()
            if(page.get("chunk") !is String)invalid()
            val encoded=page.toString().toByteArray(Charsets.UTF_8);val size=encoded.size;encoded.fill(0);wireBytes+=size
            check(size<=2*1024*1024&&wireBytes<=MAX_WIRE){"E2EE_SOURCE_TOO_LARGE"}
            return page
        }
        val result=JSONObject()
        for(table in tables){
            val rows=JSONArray();var offset=0L
            while(true){
                var page=read(table,offset,0);val total=integer(requireNotNull(totals).get(table));val length=integer(page.get("rowBytes")).toInt()
                if(total==0L){
                    if(offset!=0L||length!=0||!page.isNull("rowHash")||page.get("chunk")!=""||!page.isNull("nextByteOffset")||!page.isNull("nextOffset"))invalid()
                    break
                }
                if(offset>=total||length<1)invalid()
                val rowHash=page.getString("rowHash");val expected=E2eeEnvelope.decode(rowHash,32);var buffer:ByteArray?=null
                try {
                    sourceBytes+=length;check(sourceBytes<=MAX_TOTAL){"E2EE_SOURCE_TOO_LARGE"};buffer=ByteArray(length);var position=0
                    while(true){
                        if(integer(page.get("rowBytes"))!=length.toLong()||page.get("rowHash")!=rowHash)invalid()
                        val part=E2eeEnvelope.decode(page.getString("chunk"),1,MAX_CHUNK);val next=position+part.size
                        try {
                            if(next>length)invalid()
                            if(next<length){
                                if(page.isNull("nextByteOffset")||integer(page.get("nextByteOffset"))!=next.toLong()||page.isNull("nextOffset")||integer(page.get("nextOffset"))!=offset)invalid()
                            }else {
                                if(!page.isNull("nextByteOffset"))invalid()
                                if(offset+1<total){if(page.isNull("nextOffset")||integer(page.get("nextOffset"))!=offset+1)invalid()}
                                else if(!page.isNull("nextOffset"))invalid()
                            }
                            part.copyInto(buffer,position)
                        }finally{part.fill(0)}
                        position=next;if(position==length)break;page=read(table,offset,position.toLong())
                    }
                    val actual=MessageDigest.getInstance("SHA-256").digest(buffer)
                    try{assertCurrent();if(!MessageDigest.isEqual(actual,expected))invalid()}finally{actual.fill(0)}
                    val text=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(buffer)).toString()
                    // Do not parse or canonicalize before the shared strict parser.
                    rows.put(text)
                }finally{buffer?.fill(0);expected.fill(0)}
                if(page.isNull("nextOffset")){if(rows.length().toLong()!=total)invalid();break};offset++
            }
            result.put(table,rows)
        }
        assertCurrent();val output=requireNotNull(header);for(table in tables)output.put(table,result.get(table))
        output.put("encoding","utf8-json-rows-v1").put("legacyKey",retainedKey)
    }catch(_:JSONException){invalid()}catch(_:java.nio.charset.CharacterCodingException){invalid()}
}
