package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONArray
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Runs the same pure ACL business planner as the browser. This channel has no
 * key, storage or network ports. The caller owns foreground/session checks and
 * must persist the original operation before obtaining any remote snapshot. */
internal class E2eeMembershipOperationPlanner(context:Context,private val current:()->Unit){
    private val runtime=NativeAdviceProductRuntime(context,"membership-operation")
    private val mutex=Mutex()
    suspend fun plan(snapshot:JSONObject,operation:JSONObject):JSONObject=mutex.withLock{
        current()
        val input=JSONObject().put("protocol",1).put("mode","membership-operation-v1")
            .put("snapshot",JSONObject(snapshot.toString())).put("operation",JSONObject(operation.toString()))
        val result=runtime.execute(input,current){_,_->error("E2EE_MEMBERSHIP_OPERATION_INVALID")}
        current();result
    }
    suspend fun atomicPlan(actorId:String,intentId:String,spaceId:String,reviewFingerprint:String,snapshot:JSONObject,operation:JSONObject,products:JSONArray):JSONObject=mutex.withLock{
        current()
        val input=JSONObject().put("protocol",1).put("mode","membership-atomic-plan-v2").put("actorId",actorId).put("intentId",intentId)
            .put("spaceId",spaceId).put("reviewFingerprint",reviewFingerprint).put("snapshot",JSONObject(snapshot.toString()))
            .put("operation",JSONObject(operation.toString())).put("products",JSONArray(products.toString()))
        val result=runtime.execute(input,current){_,_->error("E2EE_MEMBERSHIP_OPERATION_INVALID")}
        current();result
    }
}
