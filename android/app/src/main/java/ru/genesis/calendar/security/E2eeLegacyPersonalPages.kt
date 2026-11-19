package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64

/** Completeness of the signed transport, not validation/unlock of private rows.
 * The category adapter must still authenticate every original and logical ID. */
internal object E2eeLegacyPersonalPages {
    suspend fun collect(context:E2eeMigrationSourceContext,source:String,assertCurrent:()->Unit,
        readPage:suspend (E2eeMigrationSourceContext,String,Long)->JSONObject):JSONObject {
        val names=when(source){"mindmaps"->listOf("maps","versions","receipts","deletions");"physis"->listOf("owners","records","usedIds","receipts");else->error("E2EE_LEGACY_PAGE_INVALID")}
        E2eeKeys.technical(context.ownerId);E2eeKeys.technical(context.scopeId);E2eeKeys.technical(context.migrationId)
        check(context.fence>0&&context.generation>0){"E2EE_LEGACY_PAGE_INVALID"};E2eeEnvelope.decode(context.sourceHash,32).fill(0)
        var header:JSONObject?=null;var totals:JSONObject?=null;var oldKey=JSONObject().put("keyMode","empty").put("key",JSONObject.NULL)
        val result=JSONObject();var bytes=0L;var pages=0
        for(table in names){
            val rows=JSONArray();var offset=0L
            while(true){
                assertCurrent();check(++pages<=10000){"E2EE_SOURCE_TOO_LARGE"};val page=JSONObject(readPage(context,table,offset).toString());assertCurrent()
                E2eeKeys.exact(page,setOf("protocol","ownerId","scopeId","migrationId","fence","sourceHash","legacyGeneration","checkpointHash","directoryRevision","table","offset","totals","rows","nextOffset","legacyKey"))
                check(page.get("ownerId")==context.ownerId&&page.get("scopeId")==context.scopeId&&page.get("migrationId")==context.migrationId
                    &&E2eeCommands.integer(page.get("protocol"))==1L&&E2eeCommands.integer(page.get("fence"),1)==context.fence&&page.get("sourceHash")==context.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
                val legacy=E2eeCommands.integer(page.get("legacyGeneration"));val revision=E2eeCommands.integer(page.get("directoryRevision"),1);E2eeEnvelope.decode(page.getString("checkpointHash"),32).fill(0)
                check(legacy<context.generation){"E2EE_GENERATION_REVIEW_REQUIRED"}
                val entries=page.getJSONArray("rows");check(page.get("table")==table&&E2eeCommands.integer(page.get("offset"))==offset&&entries.length()<=128){"E2EE_LEGACY_PAGE_INVALID"}
                val serialized=page.toString().toByteArray(Charsets.UTF_8);val size=serialized.size;serialized.fill(0);bytes+=size
                check(size<=16*1024*1024&&bytes<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"}
                val counts=page.getJSONObject("totals");E2eeKeys.exact(counts,names.toSet());val count=names.sumOf{E2eeCommands.integer(counts.get(it))};check(count<=1000000){"E2EE_SOURCE_TOO_LARGE"}
                val identity=JSONObject().put("protocol",1).put("ownerId",context.ownerId).put("scopeId",context.scopeId).put("migrationId",context.migrationId).put("fence",context.fence)
                    .put("sourceHash",context.sourceHash).put("legacyGeneration",legacy).put("checkpointHash",page.get("checkpointHash")).put("directoryRevision",revision)
                if(header==null){header=identity;totals=JSONObject(counts.toString())}else{
                    check(E2eeCommands.canonical(header).contentEquals(E2eeCommands.canonical(identity))){"E2EE_LEGACY_PAGE_INVALID"}
                    check(names.all{E2eeCommands.integer(totals!!.get(it))==E2eeCommands.integer(counts.get(it))}){"E2EE_LEGACY_PAGE_INVALID"}
                }
                val old=page.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"));val mode=old.getString("keyMode")
                check(mode in setOf("account","client","empty")){"E2EE_LEGACY_PAGE_INVALID"}
                if(mode=="account"){
                    val encoded=old.getString("key");val raw=try{Base64.getDecoder().decode(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_PAGE_INVALID")}
                    try{check(raw.size==32&&Base64.getEncoder().encodeToString(raw)==encoded){"E2EE_LEGACY_PAGE_INVALID"}}finally{raw.fill(0)}
                }else check(old.isNull("key")){"E2EE_LEGACY_PAGE_INVALID"}
                if(mode!="empty"){
                    check(oldKey.get("keyMode")=="empty"||oldKey.get("keyMode")==mode&&oldKey.get("key")==old.get("key")){"E2EE_LEGACY_PAGE_INVALID"};oldKey=JSONObject(old.toString())
                }
                val total=E2eeCommands.integer(counts.get(table));val next=offset+entries.length()
                check(next<=total&&if(next<total)!page.isNull("nextOffset")&&E2eeCommands.integer(page.get("nextOffset"),1)==next&&next>offset else page.isNull("nextOffset")){"E2EE_LEGACY_PAGE_INVALID"}
                for(index in 0 until entries.length())rows.put(entries.getJSONObject(index))
                if(page.isNull("nextOffset")){check(rows.length().toLong()==total){"E2EE_LEGACY_PAGE_INVALID"};break};offset=next
            }
            result.put(table,rows)
        }
        assertCurrent();val output=requireNotNull(header);for(name in names)output.put(name,result.get(name));return output.put("legacyKey",oldKey)
    }
}
