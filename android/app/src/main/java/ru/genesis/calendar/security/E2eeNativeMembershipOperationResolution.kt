package ru.genesis.calendar.security

import org.json.JSONObject

internal object E2eeNativeMembershipOperationResolution {
    suspend fun cancel(id:String,operations:E2eeNativeMembershipOperations,stager:E2eeMembershipAtomicStager,current:()->Unit):JSONObject {
        current();operations.execute("cancel",JSONObject().put("id",id));current()
        try{stager.inspect(id);current()}catch(error:Exception){if(error.message=="E2EE_MEMBERSHIP_PLAN_REQUIRED")return JSONObject().put("intentId",id).put("outcome","cancelled").put("server","absent");throw error}
        try{stager.cancel(id);current();return JSONObject().put("intentId",id).put("outcome","cancelled").put("server","cancelled")}
        catch(error:Exception){if(error.message=="E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED")return JSONObject().put("intentId",id).put("outcome","reconcile-required");throw error}
    }
    suspend fun resolve(id:String,operations:E2eeNativeMembershipOperations,stager:E2eeMembershipAtomicStager,current:()->Unit):JSONObject {
        val outcome=cancel(id,operations,stager,current);current();check(outcome.get("outcome")=="cancelled"){"E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED"}
        val fork=operations.execute("fork",JSONObject().put("id",id));current();val next=fork.getString("id");var draft=fork.getJSONObject("state")
        if(draft.isNull("proposal")&&!draft.optBoolean("cancelled",false)){draft=operations.execute("preview",JSONObject().put("id",next)).getJSONObject("state");current()}
        return JSONObject().put("previousIntentId",id).put("intentId",next).put("draft",draft)
    }
}
