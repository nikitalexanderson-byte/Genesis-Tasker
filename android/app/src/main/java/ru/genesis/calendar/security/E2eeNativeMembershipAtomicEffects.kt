package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Independently decrypts original and proposed content in the OWNED scope.
 * The shared pure validator accepts only normal declared membership effects. */
internal class E2eeNativeMembershipAtomicEffects(private val context:Context,private val account:E2eeProductAccount,private val guard:()->Unit){
    private val runtime=NativeAdviceProductRuntime(context,"membership-operation")
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    suspend fun verify(request:JSONObject,scope:JSONObject,load:(Int)->JSONObject):JSONObject{
        current();check(scope.get("ownerId")==account.ownerId&&request.has("createdAt")){"E2EE_OWNER_REQUIRED"};val scopeId=scope.getString("scopeId");val kind=scope.getString("kind");val resource=scope.getString("resourceId")
        val opened=E2eeSharedTrust(account).open(scopeId);current();check(opened.directory.ownerId==account.ownerId&&opened.directory.kind==kind&&opened.directory.resourceId==resource){"E2EE_SCOPE_BINDING_MISMATCH"}
        val pages=JSONArray();val changes=mutableListOf<JSONObject>();val clears=mutableListOf<JSONObject>();val products=mutableListOf<JSONObject>()
        for(index in 0 until request.getJSONObject("plan").getJSONArray("pages").length()){
            val page=load(index);current();pages.put(page)
            when(page.get("kind")){"acl"->changes.addAll(rows(page.getJSONArray("items")));"clear-assignments"->clears.addAll(rows(page.getJSONArray("items")));"product-operations"->products.addAll(rows(page.getJSONArray("items")))}
        }
        val repository=E2eeSharedRecords(context,account,scopeId,kind,resource);val entities=repository.index();current();val hash=E2eeMembershipProductIndex.hash(scopeId,entities)
        val clearTasks=kind=="project"&&clears.any{it.get("projectId")==resource};val categories=changes.filter{kind=="space"&&it.get("table")=="shared_member_categories"&&it.getJSONObject("key").get("space_id")==resource}.map{it.getJSONObject("key").getString("id")}.toSet()
        val versions=JSONArray();val candidates=JSONArray()
        for(entity in rows(entities))if(!entity.getBoolean("deleted")&&(entity.get("kind")=="task"&&clearTasks||entity.get("kind")=="category"&&entity.getString("entityId").removePrefix("category:") in categories)){
            versions.put(repository.read(entity));current()
        }
        for(product in products.filter{it.get("scopeId")==scopeId})for(operation in rows(product.getJSONArray("operations"))){
            val candidate=JSONObject().put("entityId",operation.get("entityId")).put("kind",operation.get("kind")).put("revision",E2eeCommands.integer(operation.get("expectedRevision"))+1)
                .put("domain",operation.get("domain")).put("objectId",operation.get("objectId")).put("payloadHash",operation.get("payloadHash")).put("parentId",operation.get("parentId"))
                .put("authorId",request.getJSONObject("plan").get("actorId")).put("deleted",operation.get("action")=="delete").put("metadata",operation.get("metadata")).put("updatedAt",request.get("createdAt"))
            candidates.put(repository.product.read(candidate));current()
        }
        val input=JSONObject().put("request",request).put("scope",scope).put("pages",pages).put("entities",entities).put("versions",versions).put("candidates",candidates)
        val result=runtime.execute(JSONObject().put("protocol",1).put("mode","membership-owner-effects-v2").put("input",input),::current){_,_->error("E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE")};current()
        check(E2eeMembershipProductIndex.hash(scopeId,repository.index())==hash){"E2EE_MEMBERSHIP_STALE"};current();return result
    }
}
