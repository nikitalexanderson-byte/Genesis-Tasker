package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeCommands
import ru.genesis.calendar.security.E2eeKeys

/** Byte-compatible live document schemas with app/e2ee/diary-product-state.ts. */
internal object PrivateDiaryState{
    fun revision(value:Any?):Long=E2eeCommands.integer(requireNotNull(value)).also{check(it<9_007_199_254_740_991L){"E2EE_DIARY_SOURCE_INVALID"}}
    fun rows(value:JSONArray):List<JSONObject>{check(value.length()<=20000){"E2EE_DIARY_SOURCE_INVALID"};return(0 until value.length()).map{value.getJSONObject(it)}}
    fun array(rows:List<JSONObject>)=JSONArray().apply{rows.forEach{put(JSONObject(it.toString()))}}
    fun entry(note:DiaryNote?,id:String,revision:Long)=JSONObject().put("id",id).put("note",note?.json()?:JSONObject.NULL).put("revision",revision)
        .put("deleted",note==null).put("updatedAt",note?.updatedAt?:java.time.Instant.now().toString())
    private fun entries(input:JSONArray){val seen=mutableSetOf<String>()
        for(row in rows(input)){
            E2eeKeys.exact(row,setOf("id","note","revision","deleted","updatedAt"));val id=row.getString("id");check(DiaryNote.idPattern.matches(id)&&seen.add(id)){"E2EE_DIARY_SOURCE_INVALID"}
            revision(row.get("revision"));check(row.get("deleted") is Boolean&&DiaryNote.validDate(row.opt("updatedAt"))){"E2EE_DIARY_SOURCE_INVALID"}
            if(row.getBoolean("deleted"))check(row.isNull("note")){"E2EE_DIARY_SOURCE_INVALID"}else check(DiaryNote.parse(row.getJSONObject("note")).id==id){"E2EE_SCOPE_BINDING_MISMATCH"}
        }
    }
    fun remote(input:JSONObject,owner:String):JSONObject{
        E2eeKeys.exact(input,setOf("protocol","ownerId","syncEnabled","settingsRevision","dreamSettings","records"))
        check(input.get("protocol")==1&&input.get("ownerId")==owner&&input.get("syncEnabled") is Boolean){"E2EE_DIARY_SOURCE_INVALID"}
        revision(input.get("settingsRevision"));DreamSettings.parse(input.getJSONObject("dreamSettings"));entries(input.getJSONArray("records"))
        check(input.getBoolean("syncEnabled")||rows(input.getJSONArray("records")).all{it.getBoolean("deleted")}){"E2EE_DIARY_SOURCE_INVALID"};return JSONObject(input.toString())
    }
    fun device(input:JSONObject,owner:String,device:String):JSONObject{
        E2eeKeys.exact(input,setOf("protocol","ownerId","deviceId","migrationHistory","paused","records","drafts","promotions"))
        check(input.get("protocol")==1&&input.get("ownerId")==owner&&input.get("deviceId")==device&&input.get("migrationHistory") in setOf("present","not-on-this-device")&&input.get("paused") is Boolean){"E2EE_DIARY_SOURCE_INVALID"}
        entries(input.getJSONArray("records"));val drafts=mutableSetOf<String>()
        for(row in rows(input.getJSONArray("drafts"))){
            E2eeKeys.exact(row,setOf("key","note","revision","localOnly","editorState"));val key=E2eeKeys.technical(row.getString("key"))
            check(key.startsWith("diary-draft:")&&drafts.add(key)&&row.get("localOnly") is Boolean){"E2EE_DIARY_SOURCE_INVALID"};revision(row.get("revision"));DiaryNote.parseDraft(row.getJSONObject("note"))
            check(row.isNull("editorState")||row.opt("editorState") is String&&row.getString("editorState").length<=1024*1024){"E2EE_DIARY_SOURCE_INVALID"}
        }
        val sources=mutableSetOf<String>();val destinations=mutableSetOf<String>();val records=rows(input.getJSONArray("records"))
        for(row in rows(input.getJSONArray("promotions"))){
            E2eeKeys.exact(row,setOf("sourceId","sourceRevision","id"));val source=row.getString("sourceId");val id=row.getString("id");val revision=revision(row.get("sourceRevision"))
            check(DiaryNote.idPattern.matches(source)&&DiaryNote.idPattern.matches(id)&&source!=id&&sources.add(source)&&destinations.add(id)
                &&records.any{it.getString("id")==source&&!it.getBoolean("deleted")&&it.getLong("revision")==revision}){"E2EE_DIARY_SOURCE_INVALID"}
        };return JSONObject(input.toString())
    }
}
