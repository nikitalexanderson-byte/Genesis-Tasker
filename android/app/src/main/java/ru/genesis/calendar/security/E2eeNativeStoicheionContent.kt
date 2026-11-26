package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Practice content uses the ordinary separate aggregate. Draw/reroll service
 * state is never imported; the common engine validates the complete work model. */
internal class E2eeNativeStoicheionContent(private val account:E2eeProductAccount,private val current:()->Unit){
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun validate(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("version","works","removed"));check(value.get("version")==1&&value.getJSONArray("works").length()<=10000&&value.getJSONArray("removed").length()<=10000){"RESTORATION_WORK_INVALID"};val seen=mutableSetOf<String>()
        for(key in listOf("works","removed"))for(row in rows(value.getJSONArray(key))){val id=E2eeKeys.technical(row.getString("id"));check(id.startsWith("restoration-work:")||id.startsWith("restoration-habit:")){"RESTORATION_WORK_INVALID"};check(seen.add(id)){"RESTORATION_WORK_INVALID"};E2eeCommands.integer(row.get("version"),1);java.time.Instant.parse(row.getString("createdAt"));java.time.Instant.parse(row.getString("updatedAt"));check(row.getString("syncState") in setOf("local","pending","synced")){"RESTORATION_WORK_INVALID"};if(key=="works")row.getJSONObject("snapshot")}
        return JSONObject(value.toString())
    }
    private val document=E2eeFeatureDocument(account,"stoicheion","personal-stoicheion-live-v1",::validate,{
        val row=account.client.read("stoicheion","personal-stoicheion-workspace-v1")?:error("E2EE_PRIVATE_SEED_REQUIRED");try{current();val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","document"));check(value.get("protocol")==1&&value.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};validate(value.getJSONObject("document"))}finally{row.bytes.fill(0)}
    },current)
    @Synchronized fun restoreView():JSONObject{current();val before=document.read(true);check(before.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};val opened=document.flush();val value=validate(opened.getJSONObject("document"));val records=JSONArray();for((key,deleted)in listOf("works" to false,"removed" to true))for(row in rows(value.getJSONArray(key)))records.put(JSONObject().put("id",row.get("id")).put("revision",1).put("deleted",deleted).put("value",if(deleted)JSONObject.NULL else JSONObject(row.toString())).put("localOnly",false));return JSONObject().put("checkpoint","stoicheion:"+opened.getLong("remoteRevision")).put("pending",opened.get("pending")).put("records",records)}
    @Synchronized fun restoreAdd(work:JSONObject){current();val before=document.read(false);check(!before.getBoolean("pending")&&before.isNull("conflict")){"E2EE_PENDING_REVIEW_REQUIRED"};val value=validate(before.getJSONObject("document"));check((rows(value.getJSONArray("works"))+rows(value.getJSONArray("removed"))).none{it.get("id")==work.get("id")}){"E2EE_RESTORE_OUTCOME_REQUIRED"};value.getJSONArray("works").put(JSONObject(work.toString()));document.write(validate(value));current();document.flush();current()}
}
