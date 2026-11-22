package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal class E2eeMembershipOwnerReview(private val account:E2eeProductAccount,private val openOwned:(JSONObject)->E2eeScopeClient,private val guard:()->Unit={}) {
    companion object {private const val PREFIX="membership-owner-review:"}
    private fun current(){guard();account.requireOpen()}
    private fun identity(fingerprint:String,scopeId:String)=fingerprint+":"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(scopeId.toByteArray(Charsets.UTF_8)))
    private fun plan(request:JSONObject,scopeId:String):JSONObject {val plans=request.getJSONObject("preview").getJSONArray("scopePlans");return (0 until plans.length()).map{plans.getJSONObject(it)}.singleOrNull{it.get("scopeId")==scopeId}?:error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")}
    private fun store(id:String):E2eeDeviceDocument {E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,PREFIX+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","id","scopeId","request","reviewedFingerprint","reviewedRoles","packet"));val request=E2eeMembershipExchange.request(value.getJSONObject("request"));val fingerprint=E2eeMembershipExchange.fingerprint(request)
        check(value.get("format")=="genesis-membership-owner-review-v1"&&value.get("ownerId")==account.ownerId&&value.get("id")==id&&value.get("reviewedFingerprint")==fingerprint&&id==identity(fingerprint,value.getString("scopeId"))){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        val plan=plan(request,value.getString("scopeId"));check(plan.get("ownerId")==account.ownerId&&E2eeProductJson.same(value.get("reviewedRoles"),plan.get("roles"))){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        if(!value.isNull("packet"))E2eeMembershipExchange.rotationShape(value.getJSONObject("packet"),request,plan);JSONObject(value.toString())
    },::current)}
    @Synchronized fun inspect(id:String):JSONObject {current();return store(id).load()?.value?.also{current()}?:error("E2EE_MEMBERSHIP_PLAN_REQUIRED")}
    @Synchronized fun list():List<JSONObject>{current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{inspect(it.removePrefix(PREFIX))}}
    @Synchronized fun approve(input:JSONObject,scopeId:String,comparedFingerprint:String,explicitRoles:JSONArray):JSONObject {
        current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val request=E2eeMembershipExchange.request(input);val roles=JSONArray(explicitRoles.toString());val fingerprint=E2eeMembershipExchange.fingerprint(request)
        check(fingerprint==comparedFingerprint){"E2EE_MEMBERSHIP_FINGERPRINT_REQUIRED"};val plan=plan(request,scopeId);check(plan.get("ownerId")==account.ownerId&&E2eeProductJson.same(roles,plan.get("roles"))){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        val id=identity(fingerprint,scopeId);val store=store(id);val before=store.load();current()
        if(before!=null){check(E2eeProductJson.same(before.value.get("request"),request)&&E2eeProductJson.same(before.value.get("reviewedRoles"),roles)){"E2EE_LOCAL_CONFLICT"};if(!before.value.isNull("packet"))return exportValue(before.value)}
        else store.save(JSONObject().put("format","genesis-membership-owner-review-v1").put("ownerId",account.ownerId).put("id",id).put("scopeId",scopeId).put("request",request).put("reviewedFingerprint",fingerprint).put("reviewedRoles",roles).put("packet",JSONObject.NULL),null)
        current();val client=openOwned(plan);current();client.refresh();current();val packet=client.prepareMembershipRotation(request.getJSONObject("preview").getString("changeHash"),roles,plan.getJSONObject("manifest"),plan);current()
        E2eeMembershipExchange.rotationShape(packet,request,plan);val saved=store.load()?:error("E2EE_LOCAL_CONFLICT");check(E2eeProductJson.same(saved.value.get("request"),request)&&saved.value.isNull("packet")){"E2EE_LOCAL_CONFLICT"}
        store.save(JSONObject(saved.value.toString()).put("packet",packet),saved.serial);current();return exportValue(inspect(id))
    }
    private fun exportValue(value:JSONObject):JSONObject {check(!value.isNull("packet")){"E2EE_MEMBERSHIP_PLAN_REQUIRED"};return JSONObject().put("format","genesis-membership-owner-approval-v1").put("requestFingerprint",value.get("reviewedFingerprint")).put("scopeId",value.get("scopeId")).put("packet",JSONObject(value.getJSONObject("packet").toString()))}
    @Synchronized fun export(id:String)=exportValue(inspect(id))
    override fun toString()="E2eeMembershipOwnerReview([redacted])"
}
