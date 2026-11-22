package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Same product document as web. Workspace/tasks/tombstones commit together;
 * legacy snapshots are immutable seeds, never a fallback HTTP/key protocol. */
internal class E2eePersonalProduct(private val account:E2eeProductAccount){
    private var view:E2eePrivateDocument.Opened?=null
    private val document=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"workspace","personal-product-live-v1",::validate,account::requireOpen){
        account.requireOpen();val actor=account.directory.devices[account.device.deviceId]
        check(actor!=null&&!actor.revoked&&actor.userId==account.ownerId&&actor.role=="owner"){"E2EE_SCOPE_FORBIDDEN"}
    }
    private fun workspace(value:JSONObject):JSONObject{
        for(name in listOf("projects","categories","taskListLinks","taskLists"))check(value.getJSONArray(name).length()<=100000){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
        check(listOf("user","csrf","key","rawKey","recoveryCode","billing","entitlements","devices","tasks").none(value::has)){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};return value
    }
    private fun tasks(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","ownerId","tasks","externalCopy"));check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId&&value.getString("externalCopy")=="requires-new-consent"){"E2EE_SCOPE_BINDING_MISMATCH"}
        val rows=value.getJSONArray("tasks");check(rows.length()<=10000){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};val ids=mutableSetOf<String>()
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);E2eeKeys.exact(row,setOf("id","value","deleted"));val id=row.getString("id");check(ids.add(id)&&id.length in 1..512){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
            if(row.getBoolean("deleted"))check(row.isNull("value")){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}else check(row.getJSONObject("value").getString("id")==id&&row.getJSONObject("value").get("title") is String){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}}
        return value
    }
    private fun validate(value:JSONObject):JSONObject{E2eeKeys.exact(value,setOf("protocol","ownerId","contentRevision","workspace","tasks"));check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};E2eeCommands.integer(value.get("contentRevision"),1);workspace(value.getJSONObject("workspace"));tasks(value.getJSONObject("tasks"));return value}
    private fun current():E2eePrivateDocument.Opened{account.requireOpen();val value=requireNotNull(view){"E2EE_PRODUCT_READ_REQUIRED"};check(value.conflict==null){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return value}
    @Synchronized fun contentRevision():Long=current().value.getLong("contentRevision")
    @Synchronized fun load(offline:Boolean=false):JSONObject{
        account.requireOpen()
        try{view=document.load(offline)}catch(error:IllegalStateException){
            if(offline||error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error
            val workspace=account.client.read("workspace","personal-workspace-v1");val tasks=account.client.read("workspace","personal-tasks-live-v1")
            try{check(workspace!=null&&tasks!=null){"E2EE_PRODUCT_MIGRATION_CONTENT_REQUIRED"}
                val value=validate(JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("contentRevision",1).put("workspace",E2eeFileManifestJson.readPrivateDocument(workspace.bytes))
                    .put("tasks",E2eeFileManifestJson.readPrivateDocument(tasks.bytes)))
                val serial=document.save(value,null,0);view=E2eePrivateDocument.Opened(value,serial,0,true);document.flush();view=document.load(offline=true)
                check(view?.pending==false&&view?.value?.toString()==value.toString()){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
            }finally{workspace?.bytes?.fill(0);tasks?.bytes?.fill(0)}
        }
        return snapshot()
    }
    @Synchronized fun snapshot():JSONObject{
        val value=current().value;val result=JSONObject(value.getJSONObject("workspace").toString());val selected=JSONArray();val rows=value.getJSONObject("tasks").getJSONArray("tasks")
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);if(!row.getBoolean("deleted"))selected.put(JSONObject(row.getJSONObject("value").toString()).put("syncToGoogle",false).put("syncAccountIds",JSONArray()))}
        return result.put("tasks",selected)
    }
    private fun stage(value:JSONObject){val previous=current();value.put("contentRevision",previous.value.getLong("contentRevision")+1);val serial=document.save(validate(value),previous.serial,previous.remoteRevision);view=E2eePrivateDocument.Opened(value,serial,previous.remoteRevision,true)}
    @Synchronized fun stageSnapshot(input:JSONObject){
        val copy=JSONObject(input.toString());val submitted=copy.getJSONArray("tasks");copy.remove("tasks");workspace(copy);val previous=current().value;val prior=previous.getJSONObject("tasks");val rows=prior.getJSONArray("tasks");val incoming=mutableSetOf<String>();val next=JSONArray()
        for(i in 0 until submitted.length()){val value=submitted.getJSONObject(i);val id=value.getString("id");check(incoming.add(id)){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};next.put(JSONObject().put("id",id).put("value",value).put("deleted",false))}
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);val id=row.getString("id");check(!row.getBoolean("deleted")||id !in incoming){"TASK_DELETED"};if(id !in incoming)next.put(JSONObject().put("id",id).put("value",JSONObject.NULL).put("deleted",true))}
        stage(JSONObject(previous.toString()).put("workspace",copy).put("tasks",JSONObject(prior.toString()).put("tasks",next)))
    }
    @Synchronized fun restoreView():JSONObject{val state=current();val deleted=JSONArray();val rows=state.value.getJSONObject("tasks").getJSONArray("tasks");for(at in 0 until rows.length())if(rows.getJSONObject(at).getBoolean("deleted"))deleted.put(rows.getJSONObject(at).getString("id"));return JSONObject().put("snapshot",snapshot()).put("contentRevision",contentRevision()).put("deletedTaskIds",deleted).put("pending",state.pending)}
    @Synchronized fun restoreSnapshot(input:JSONObject,expectedContentRevision:Long){check(contentRevision()==expectedContentRevision){"E2EE_RESTORE_REVIEW_STALE"};stageSnapshot(input);flush()}
    @Synchronized fun flush():Long{val previous=current();if(!previous.pending||account.offline)return previous.remoteRevision;document.flush();view=document.load(offline=true)
        check(view?.pending==false&&view?.value?.toString()==previous.value.toString()){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return current().remoteRevision}
    override fun toString()="E2eePersonalProduct([redacted])"
}
