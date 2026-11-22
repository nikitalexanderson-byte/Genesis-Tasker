package ru.genesis.calendar.auth

import org.json.JSONObject
import ru.genesis.calendar.security.E2eeKeys

/** Constructed only by rereading the reviewed local operation and completed
 * cryptographic apply. Neither an HTTP response nor a pasted review creates it. */
internal class VerifiedPrivateProjectAccessReceipt private constructor(private val command:String,private val value:JSONObject){
    fun forCommand(expected:JSONObject):JSONObject{check(PlanningLifecycle.canonical(expected)==command){"PROJECT_ACCESS_RECEIPT_INVALID"};return JSONObject(value.toString())}
    companion object{
        suspend fun read(controller:AuthController,space:String,user:String,command:JSONObject):VerifiedPrivateProjectAccessReceipt{
            val body=ProjectAccessProtocol.body(command);val id=body.getString("operationId");E2eeKeys.technical(id)
            val source=controller.loadPrivateMembershipOperation(id);val operation=source.getJSONObject("operation")
            check(operation.get("kind")=="project-grants"&&operation.get("spaceId")==space&&operation.get("userId")==user&&
                PlanningLifecycle.canonical(ProjectAccessProtocol.draft(operationDraft(operation),true))==PlanningLifecycle.canonical(ProjectAccessProtocol.draft(operationDraft(body),true))){"PROJECT_ACCESS_RECEIPT_INVALID"}
            val result=controller.completedPrivateMembershipOperation(id)?:error("E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED")
            val stored=JSONObject().put("format","genesis-private-project-access-result-v1").put("operationId",id).put("confirmedIntentId",result.get("operationId"))
                .put("revision",result.get("revision")).put("changed",result.get("changed")).put("allProjects",operation.get("allProjects")).put("grants",operation.get("grants"))
            return VerifiedPrivateProjectAccessReceipt(PlanningLifecycle.canonical(command),saved(command,stored))
        }
        private fun operationDraft(value:JSONObject)=JSONObject().put("allProjects",value.get("allProjects")).put("grants",value.get("grants"))
        /** Only validation of an already authenticated journal record uses this
         * relaxed revision rule. Network receipts retain the exact +1 rule. */
        fun saved(command:JSONObject,raw:JSONObject):JSONObject{
            check(raw.keys().asSequence().toSet()==setOf("format","operationId","confirmedIntentId","revision","changed","allProjects","grants")&&raw.get("format")=="genesis-private-project-access-result-v1"){"PROJECT_ACCESS_RECEIPT_INVALID"}
            val body=ProjectAccessProtocol.body(command);check(raw.get("operationId")==body.get("operationId")){"PROJECT_ACCESS_RECEIPT_INVALID"};E2eeKeys.technical(raw.getString("confirmedIntentId"))
            for(key in listOf("revision","changed")){val number=raw.get(key);check(number is Int||number is Long){"PROJECT_ACCESS_RECEIPT_INVALID"};check((number as Number).toLong() in 0..Int.MAX_VALUE.toLong()){"PROJECT_ACCESS_RECEIPT_INVALID"}}
            check(raw.getLong("revision")>=command.getJSONObject("body").getLong("expectedRevision")+1&&
                PlanningLifecycle.canonical(ProjectAccessProtocol.draft(operationDraft(raw),true))==PlanningLifecycle.canonical(ProjectAccessProtocol.draft(operationDraft(body),true))){"PROJECT_ACCESS_RECEIPT_INVALID"}
            return JSONObject(raw.toString())
        }
    }
    override fun toString()="VerifiedPrivateProjectAccessReceipt([redacted])"
}
