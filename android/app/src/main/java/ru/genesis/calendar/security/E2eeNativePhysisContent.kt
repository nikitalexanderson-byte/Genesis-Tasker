package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Normal Physis aggregate format. The common bundled domain engine validates
 * the full health schema on source and readback before an add-only write. */
internal class E2eeNativePhysisContent(private val account:E2eeProductAccount,private val current:()->Unit){
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun validate(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("version","ownerId","records"));check(value.get("version")==1&&value.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};val records=rows(value.getJSONArray("records"));check(records.size<=100000){"E2EE_PHYSIS_SOURCE_INVALID"};val seen=mutableSetOf<String>()
        for(row in records){E2eeKeys.exact(row,setOf("id","record","revision","deleted"));val id=E2eeKeys.technical(row.getString("id"));check(id.matches(Regex("[a-fA-F0-9-]{36}"))&&seen.add(id)&&row.get("deleted") is Boolean){"E2EE_PHYSIS_SOURCE_INVALID"};E2eeCommands.integer(row.get("revision"),0);if(row.getBoolean("deleted"))check(row.isNull("record")){"E2EE_PHYSIS_SOURCE_INVALID"}else check(row.getJSONObject("record").get("id")==id){"E2EE_SCOPE_BINDING_MISMATCH"}}
        return JSONObject(value.toString())
    }
    private fun original(id:String):JSONObject{val value=account.client.read("physis",id)?:error("E2EE_PRIVATE_SEED_REQUIRED");try{current();return E2eeFileManifestJson.readPrivateDocument(value.bytes)}finally{value.bytes.fill(0)}}
    private fun seed():JSONObject{
        val index=original("personal-physis-index-v1");E2eeKeys.exact(index,setOf("protocol","ownerId","records"));check(index.get("protocol")==1&&index.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};val records=JSONArray();val ids=mutableSetOf<String>()
        for(item in rows(index.getJSONArray("records"))){E2eeKeys.exact(item,setOf("id","objectId","deleted"));val id=item.getString("objectId");check(id.matches(Regex("personal-physis-record:[a-f0-9-]{36}"))&&ids.add(id)){"E2EE_PHYSIS_SOURCE_INVALID"};val row=original(id);E2eeKeys.exact(row,setOf("protocol","ownerId","id","record","revision","deleted"));check(row.get("protocol")==1&&row.get("ownerId")==account.ownerId&&row.get("id")==item.get("id")&&row.get("deleted")==item.get("deleted")){"E2EE_SCOPE_BINDING_MISMATCH"};records.put(JSONObject().put("id",row.get("id")).put("record",row.get("record")).put("revision",row.get("revision")).put("deleted",row.get("deleted")))}
        return validate(JSONObject().put("version",1).put("ownerId",account.ownerId).put("records",records))
    }
    private val document=E2eeFeatureDocument(account,"physis","personal-physis-live-v1",::validate,::seed,current)
    @Synchronized fun restoreView():JSONObject{current();val before=document.read(true);check(before.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};val view=document.flush();current();val records=JSONArray();for(row in rows(view.getJSONObject("document").getJSONArray("records")))records.put(JSONObject().put("id",row.get("id")).put("revision",row.get("revision")).put("deleted",row.get("deleted")).put("value",row.get("record")).put("localOnly",false));return JSONObject().put("checkpoint","physis:"+view.getLong("remoteRevision")).put("pending",view.get("pending")).put("records",records)}
    @Synchronized fun restoreAdd(input:JSONObject){current();val before=document.read(false);check(!before.getBoolean("pending")&&before.isNull("conflict")){"E2EE_PENDING_REVIEW_REQUIRED"};val value=before.getJSONObject("document");val records=rows(value.getJSONArray("records"));check(records.none{it.get("id")==input.get("id")}){"E2EE_RESTORE_OUTCOME_REQUIRED"};val updated=JSONArray(records);updated.put(JSONObject().put("id",input.get("id")).put("record",JSONObject(input.toString())).put("revision",1).put("deleted",false));document.write(JSONObject(value.toString()).put("records",updated));current();document.flush();current()}
}
