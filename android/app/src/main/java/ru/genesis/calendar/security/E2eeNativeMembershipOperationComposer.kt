package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Uses the same pure effects composer/batching as web. Normal native
 * repositories keep keys, immutable drafts, HTTP and foreground lifetime. */
internal class E2eeNativeMembershipOperationComposer(private val context:Context,private val account:E2eeProductAccount,
    private val owners:E2eeMembershipAtomicOwnerReviews,private val guard:()->Unit){
    private val mutex=Mutex();private val trust=E2eeSharedTrust(account);private val records=mutableMapOf<String,E2eeSharedRecords>()
    private val runtime=NativeAdviceProductRuntime(context,"membership-operation");private val planner=E2eeMembershipOperationPlanner(context,::current)
    private val stager=account.membershipAtomic()
    private val operations=E2eeNativeMembershipOperations(context,account,::current)
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private suspend fun active(id:String){current();if(!operations.isCancelled(id))return
        try{val state=stager.inspect(id);current();if(!state.getBoolean("cancelRequested"))stager.cancel(id)}catch(error:Exception){if(error.message!="E2EE_MEMBERSHIP_PLAN_REQUIRED")throw error};error("E2EE_MEMBERSHIP_CANCELLED")
    }
    private fun open(expected:JSONObject):JSONObject {
        current();val scopeId=expected.getString("scopeId");val opened=trust.open(scopeId);current();val directory=opened.directory;val own=directory.devices[account.device.deviceId];val root=expected.getJSONObject("root")
        check(directory.kind in setOf("space","project")&&directory.ownerId==expected.get("ownerId")&&own!=null&&!own.revoked&&own.userId==account.ownerId&&root.get("entityId")==directory.kind+":"+directory.resourceId
            &&directory.generation==E2eeCommands.integer(root.get("generation"),1)&&directory.checkpoint.revision==E2eeCommands.integer(root.get("directoryRevision"),1)&&directory.checkpoint.hash==root.get("checkpointHash")){"E2EE_MEMBERSHIP_STALE"}
        val repository=E2eeSharedRecords(context,account,scopeId,directory.kind,directory.resourceId);records[scopeId]=repository;val entities=repository.index();current()
        check(root.has("productIndexHash")&&E2eeMembershipProductIndex.hash(scopeId,entities)==root.get("productIndexHash")){"E2EE_MEMBERSHIP_STALE"}
        return JSONObject().put("binding",JSONObject().put("scopeId",scopeId).put("kind",directory.kind).put("resourceId",directory.resourceId)).put("entities",entities)
    }
    private suspend fun effectBatches(draft:JSONObject,scope:JSONObject,opened:JSONObject):JSONArray {
        val plan=draft.getJSONObject("proposal").getJSONObject("plan");val binding=opened.getJSONObject("binding");val id=binding.getString("resourceId");val kind=binding.getString("kind")
        val clears=kind=="project"&&rows(plan.getJSONArray("clearAssignments")).any{it.get("projectId")==id}
        val categories=rows(plan.getJSONArray("changes")).filter{kind=="space"&&it.get("table")=="shared_member_categories"&&it.getJSONObject("key").get("space_id")==id}.map{it.getJSONObject("key").getString("id")}.toSet()
        val versions=JSONArray();val scopeId=scope.getString("scopeId");val repository=records[scopeId]?:error("E2EE_SHARED_SCOPE_UNLOCK_REQUIRED")
        for(entity in rows(opened.getJSONArray("entities")))if(!entity.getBoolean("deleted")&&(entity.get("kind")=="task"&&clears||entity.get("kind")=="category"&&entity.getString("entityId").removePrefix("category:") in categories)){
            versions.put(repository.read(entity));current()
        }
        val input=JSONObject().put("binding",binding).put("actorId",account.ownerId).put("intentId",draft.get("intentId")).put("createdAt",draft.get("createdAt")).put("plan",plan)
            .put("snapshot",draft.getJSONObject("proposal").get("snapshot")).put("entities",opened.get("entities")).put("versions",versions)
        val result=runtime.execute(JSONObject().put("protocol",1).put("mode","membership-operation-edits-v2").put("input",input),::current){_,_->error("E2EE_MEMBERSHIP_OPERATION_INVALID")};current();return result.getJSONArray("batches")
    }
    suspend fun compose(intentId:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();E2eeKeys.technical(intentId);val draft=operations.execute("start",JSONObject().put("id",intentId)).getJSONObject("state");current()
        check(draft.get("ownerId")==account.ownerId&&!draft.isNull("proposal")&&!draft.isNull("review")){"E2EE_MEMBERSHIP_REVIEW_REQUIRED"}
        val proposal=draft.getJSONObject("proposal");check(draft.getJSONObject("review").get("fingerprint")==proposal.get("fingerprint")){"E2EE_MEMBERSHIP_REVIEW_REQUIRED"}
        val plan=proposal.getJSONObject("plan");if(plan.getJSONArray("scopeIds").length()==0)return@withLock JSONObject().put("state","unchanged").put("intentId",intentId)
        val scopes=rows(plan.getJSONArray("requiredScopes"));val staged=mutableListOf<Pair<String,String>>()
        for(scope in scopes){val opened=open(scope);val batches=effectBatches(draft,scope,opened);val scopeId=scope.getString("scopeId");active(intentId)
            for(index in 0 until batches.length()){
                val productId=E2eeMembershipAtomicContract.digest(JSONObject().put("format","genesis-membership-product-batch-v2").put("actorId",account.ownerId).put("intentId",intentId).put("scopeId",scopeId).put("batch",index))
                records[scopeId]!!.product.stage(batches.getJSONArray(index),productId,intentId);current();active(intentId);staged.add(scopeId to productId)
            }
        }
        // Every local draft precedes mutation IO; concurrent new heads require
        // explicit re-review rather than silently omitting affected tasks.
        for(scope in scopes){open(scope);current()};val products=JSONArray()
        for((scopeId,productId)in staged){active(intentId);val operations=records[scopeId]!!.product.prepare(productId);current();active(intentId);products.put(JSONObject().put("scopeId",scopeId).put("intentId",productId).put("operations",operations))}
        val atomic=planner.atomicPlan(account.ownerId,intentId,proposal.getJSONObject("snapshot").getString("spaceId"),proposal.getString("fingerprint"),proposal.getJSONObject("snapshot"),draft.getJSONObject("operation"),products);current()
        active(intentId);stager.create(atomic.getJSONObject("plan"),atomic.getJSONArray("pages"));current();active(intentId);val packets=JSONArray()
        for(row in rows(products)){val scopeId=row.getString("scopeId");val scope=scopes.single{it.get("scopeId")==scopeId};val entity=scope.getJSONObject("root").getString("entityId");val kind=entity.substringBefore(':');val resource=entity.substringAfter(':')
            packets.put(account.sharedScope(scopeId,kind,resource).client.prepareMembershipProduct(row.getString("intentId"),atomic.getString("changeHash"),row.getJSONArray("operations")));current();active(intentId)}
        E2eeNativeMembershipAtomicReview.prepare(stager,owners,intentId,packets,::current,draft.getString("createdAt")).put("state","review").put("intentId",intentId).also{current();active(intentId)}
    }}
    suspend fun packets(intentId:String,fingerprint:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();active(intentId);val state=stager.inspect(intentId);val saved=owners.inspect(fingerprint);current();val request=saved.getJSONObject("request");val plan=request.getJSONObject("plan")
        check(!state.getBoolean("cancelRequested")&&plan.get("actorId")==account.ownerId&&plan.get("intentId")==intentId&&E2eeMembershipAtomicContract.digest(plan)==state.get("planHash")){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        val reviewed=owners.review(fingerprint);current();val rotations=JSONArray()
        for(scope in rows(reviewed.getJSONArray("scopes"))){val approval=owners.exportApproval(fingerprint,scope.getString("scopeId"));current();val checked=owners.acceptApproval(fingerprint,approval);current();check(E2eeProductJson.same(approval,checked)){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"};rotations.put(checked.get("packet"))}
        val pages=E2eeMembershipAtomicContract.pages("rotation-packets",rotations)
        for(index in 0 until request.getJSONArray("productPages").length()){pages.put(owners.part(fingerprint,"products",index).get("page"));current()}
        active(intentId);stager.createPackets(intentId,pages).also{current();active(intentId)}
    }}
    override fun toString()="E2eeNativeMembershipOperationComposer([redacted])"
}
