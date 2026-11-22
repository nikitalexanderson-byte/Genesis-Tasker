package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

internal interface E2eeMembershipTransport{
    fun membershipGraph(spaceId:String):JSONObject=error("E2EE_MEMBERSHIP_GRAPH_REQUIRED")
    fun membershipState(targets:JSONArray):JSONObject
    fun membershipPreview(intentId:String,changes:JSONArray):JSONObject
    fun membershipCommit(batch:JSONObject):JSONObject
}
/** Durable, owner-reviewed membership intent. No network retry implicitly
 * generates another root or adopts a server-provided recipient roster. */
internal class E2eeMembershipProduct(private val device:UnlockedE2eeDevice,private val personal:E2eeScopeClient,
    private val transport:E2eeMembershipTransport,private val openScope:(String)->E2eeScopeClient,private val current:()->Unit,private val peers:E2eeMembershipPeerPorts?=null){
    private class Loaded(val value:JSONObject,val serial:Long)
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun load(intentId:String):Loaded{
        E2eeKeys.technical(intentId);current();val row=device.vault.read("outbox","membership:$intentId")?:error("E2EE_MEMBERSHIP_PLAN_REQUIRED");current()
        try{val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","intentId","scopeIds","changes","preview","review","batch","result")+(if(value.has("hashFormat"))setOf("hashFormat")else emptySet())+(if(value.has("ownerApprovals"))setOf("ownerApprovals")else emptySet()))
            check(value.getInt("protocol")==1&&value.getString("ownerId")==device.ownerId&&value.getString("intentId")==intentId&&value.getJSONArray("scopeIds").length()<=256){"E2EE_CORRUPT_OUTBOX"}
            check(!value.has("hashFormat")||value.get("hashFormat")==E2eeMembershipContract.HASH_FORMAT){"E2EE_CORRUPT_OUTBOX"};E2eeMembershipContract.changes(value.getJSONArray("changes"),true)
            val scopes=scopeIds(value.getJSONArray("scopeIds"),false);scopes.forEach{E2eeKeys.technical(it)}
            check(scopes.distinct().size==scopes.size&&(0 until value.getJSONArray("scopeIds").length()).map{value.getJSONArray("scopeIds").getString(it)}==scopes){"E2EE_CORRUPT_OUTBOX"}
            if(value.has("ownerApprovals")){val rows=value.getJSONArray("ownerApprovals");check(rows.length()<=256){"E2EE_CORRUPT_OUTBOX"};val seen=mutableSetOf<String>()
                for(at in 0 until rows.length()){val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("approval","verified"));check(row.get("verified") is Boolean){"E2EE_CORRUPT_OUTBOX"};val approval=E2eeMembershipExchange.approval(row.getJSONObject("approval"),request(value));check(seen.add(approval.getString("scopeId"))){"E2EE_CORRUPT_OUTBOX"}}
            }
            return Loaded(value,row.serial)
        }finally{row.bytes.fill(0)}
    }
    private fun save(value:JSONObject,serial:Long?):Long{current();val bytes=value.toString().toByteArray(Charsets.UTF_8)
        try{device.vault.write(listOf(UnlockedE2eeVault.Write("outbox","membership:${value.getString("intentId")}",bytes,serial)));current()}finally{bytes.fill(0)};return(serial?:0)+1}
    private fun scopeIds(rows:JSONArray,objects:Boolean)= (0 until rows.length()).map{if(objects)rows.getJSONObject(it).getString("scopeId")else rows.getString(it)}.sorted()
    fun graph(spaceId:String):JSONObject{E2eeKeys.technical(spaceId);current();return transport.membershipGraph(spaceId).also{current()}}
    private fun request(state:JSONObject):JSONObject {
        check(!E2eeMembershipContract.grantReviewRequired(state.getJSONArray("changes"))){"E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED"}
        check(state.optString("hashFormat")==E2eeMembershipContract.HASH_FORMAT&&!state.isNull("preview")){"E2EE_MEMBERSHIP_PREVIEW_REQUIRED"}
        return E2eeMembershipExchange.request(JSONObject().put("format","genesis-membership-review-v1").put("hashFormat",E2eeMembershipContract.HASH_FORMAT).put("actorId",state.get("ownerId")).put("intentId",state.get("intentId"))
            .put("scopeIds",state.get("scopeIds")).put("changes",state.get("changes")).put("preview",state.get("preview")))
    }
    @Synchronized fun exportReview(intentId:String):JSONObject {val request=request(load(intentId).value);current();return JSONObject().put("request",request).put("fingerprint",E2eeMembershipExchange.fingerprint(request))}
    @Synchronized fun importOwnerApproval(intentId:String,input:JSONObject):JSONObject {
        val loaded=load(intentId);val state=loaded.value;val request=request(state);val approval=E2eeMembershipExchange.approval(JSONObject(input.toString()),request);var serial=loaded.serial
        val ports=peers?:error("E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED");val rows=JSONArray(state.optJSONArray("ownerApprovals")?.toString()?:"[]")
        val before=(0 until rows.length()).map{rows.getJSONObject(it)}.singleOrNull{it.getJSONObject("approval").get("scopeId")==approval.get("scopeId")}
        if(before!=null){check(same(before.get("approval"),approval)){"E2EE_MEMBERSHIP_APPROVAL_CHANGED"};if(before.getBoolean("verified"))return JSONObject(before.getJSONObject("approval").toString())}
        else{check(state.isNull("batch")){"E2EE_MEMBERSHIP_PLAN_LOCKED"};rows.put(JSONObject().put("approval",approval).put("verified",false));state.put("ownerApprovals",rows);serial=save(state,serial)}
        E2eeMembershipExchange.verify(approval,request,ports);current();for(at in 0 until rows.length()){val row=rows.getJSONObject(at);if(row.getJSONObject("approval").get("scopeId")==approval.get("scopeId"))row.put("verified",true)}
        state.put("ownerApprovals",rows);save(state,serial);return JSONObject(approval.toString())
    }
    @Synchronized fun readState(targets:JSONArray):JSONArray {
        current();check(targets.length() in 1..200){"E2EE_MEMBERSHIP_BATCH_INVALID"};val held=JSONArray(targets.toString())
        for(at in 0 until held.length()){val row=held.getJSONObject(at);E2eeKeys.exact(row,setOf("table","key"));val spec=E2eeMembershipContract.specs[row.getString("table")]?:error("E2EE_MEMBERSHIP_BATCH_INVALID")
            val key=row.getJSONObject("key");E2eeKeys.exact(key,spec.first);spec.first.forEach{E2eeKeys.technical(key.getString(it))}}
        val result=transport.membershipState(held);current();E2eeKeys.exact(result,setOf("rows"));val rows=result.getJSONArray("rows");check(rows.length()==held.length()){"E2EE_MEMBERSHIP_BATCH_INVALID"}
        for(at in 0 until rows.length()){val row=rows.getJSONObject(at);val expected=held.getJSONObject(at);E2eeKeys.exact(row,setOf("table","key","before","beforeHash"))
            val before=if(row.isNull("before"))null else row.getJSONObject("before")
            check(row.get("table")==expected.get("table")&&same(row.get("key"),expected.get("key"))&&row.get("beforeHash")==E2eeMembershipContract.beforeHash(expected.getString("table"),before)){"E2EE_MEMBERSHIP_STALE"}
            if(before!=null){val key=expected.getJSONObject("key");for(name in key.keys())check(before.get(name)==key.get(name)){"E2EE_MEMBERSHIP_STALE"}}
        };return JSONArray(rows.toString())
    }
    @Synchronized fun create(changes:JSONArray,expectedScopeIds:List<String>):String{
        val held=E2eeMembershipContract.changes(changes);val scopes=expectedScopeIds.sorted();current()
        check(held.length() in 1..200&&scopes.size<=256&&scopes.distinct().size==scopes.size){"E2EE_MEMBERSHIP_BATCH_INVALID"};scopes.forEach(E2eeKeys::technical)
        val id=UUID.randomUUID().toString();save(JSONObject().put("protocol",1).put("hashFormat",E2eeMembershipContract.HASH_FORMAT).put("ownerApprovals",JSONArray()).put("ownerId",device.ownerId).put("intentId",id).put("scopeIds",JSONArray(scopes)).put("changes",held)
            .put("preview",JSONObject.NULL).put("review",JSONObject.NULL).put("batch",JSONObject.NULL).put("result",JSONObject.NULL),null);return id
    }
    @Synchronized fun preview(intentId:String):JSONObject{
        val loaded=load(intentId);val state=loaded.value;check(state.optString("hashFormat")==E2eeMembershipContract.HASH_FORMAT&&!E2eeMembershipContract.grantReviewRequired(state.getJSONArray("changes"))){"E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED"};if(!state.isNull("preview"))return JSONObject(state.getJSONObject("preview").toString())
        val preview=transport.membershipPreview(intentId,state.getJSONArray("changes"));current();E2eeKeys.exact(preview,setOf("intentId","changeHash","scopePlans"));val plans=preview.getJSONArray("scopePlans")
        check(preview.getString("intentId")==intentId&&scopeIds(plans,true)==scopeIds(state.getJSONArray("scopeIds"),false)){"E2EE_MEMBERSHIP_ROTATION_INCOMPLETE"}
        val hash=E2eeMembershipContract.changeHash(device.ownerId,intentId,state.getJSONArray("changes"),state.getJSONArray("scopeIds"))
        check(preview.getString("changeHash")==hash){"E2EE_CONTEXT_MISMATCH"}
        for(at in 0 until plans.length()){val plan=plans.getJSONObject(at);E2eeKeys.exact(plan,setOf("scopeId","ownerId","kind","resourceId","directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","roles","manifest"))
            listOf("scopeId","ownerId","resourceId").forEach{E2eeKeys.technical(plan.getString(it))};E2eeEnvelope.decode(plan.getString("checkpointHash"),32);E2eeEnvelope.decode(plan.getJSONObject("manifest").getString("manifestHash"),32)
            check(plan.getString("kind") in setOf("project","space")&&plan.getJSONArray("roles").length()<=256){"E2EE_MEMBERSHIP_BATCH_INVALID"}}
        state.put("preview",preview);save(state,loaded.serial);return JSONObject(preview.toString())
    }
    @Synchronized fun prepare(intentId:String,explicitReview:JSONArray):JSONObject{
        val held=JSONArray(explicitReview.toString());val loaded=load(intentId);val state=loaded.value;var serial=loaded.serial
        check(state.optString("hashFormat")==E2eeMembershipContract.HASH_FORMAT&&!E2eeMembershipContract.grantReviewRequired(state.getJSONArray("changes"))){"E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED"}
        check(!state.isNull("preview")){"E2EE_MEMBERSHIP_PREVIEW_REQUIRED"};val plans=state.getJSONObject("preview").getJSONArray("scopePlans")
        check(scopeIds(held,true)==scopeIds(state.getJSONArray("scopeIds"),false)&&scopeIds(held,true).distinct().size==held.length()){"E2EE_MEMBERSHIP_ROTATION_INCOMPLETE"}
        val reviews=(0 until held.length()).associate{val row=held.getJSONObject(it);E2eeKeys.exact(row,setOf("scopeId","roles"));row.getString("scopeId") to row.getJSONArray("roles")}
        for(at in 0 until plans.length()){val plan=plans.getJSONObject(at);check(same(requireNotNull(reviews[plan.getString("scopeId")]),plan.getJSONArray("roles"))){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}}
        if(!state.isNull("review"))check(same(state.getJSONArray("review"),held)){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        if(!state.isNull("batch"))return JSONObject(state.getJSONObject("batch").toString())
        if(state.isNull("review")){state.put("review",held);serial=save(state,serial)}
        val rotations=JSONArray();val hash=state.getJSONObject("preview").getString("changeHash")
        val request=request(state);val approvals=state.optJSONArray("ownerApprovals")?:JSONArray()
        for(at in 0 until plans.length()){val plan=plans.getJSONObject(at);val imported=(0 until approvals.length()).map{approvals.getJSONObject(it)}.singleOrNull{it.getBoolean("verified")&&it.getJSONObject("approval").get("scopeId")==plan.get("scopeId")}
            if(imported!=null){val approved=E2eeMembershipExchange.verify(imported.getJSONObject("approval"),request,peers?:error("E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED"));current();rotations.put(approved.get("packet"))}
            else{check(plan.get("ownerId")==device.ownerId){"E2EE_MEMBERSHIP_OWNER_APPROVAL_REQUIRED"};val client=openScope(plan.getString("scopeId"));current()
                rotations.put(client.prepareMembershipRotation(hash,requireNotNull(reviews[plan.getString("scopeId")]),plan.getJSONObject("manifest"),plan));current()}}
        personal.refresh();current();val authorization=personal.authorizeMembership(intentId,hash);current();val batch=JSONObject().put("intentId",intentId).put("changes",state.getJSONArray("changes")).put("authorization",authorization).put("rotations",rotations)
        state.put("batch",batch);save(state,serial);return JSONObject(batch.toString())
    }
    @Synchronized fun submit(intentId:String):JSONObject{
        val loaded=load(intentId);val state=loaded.value;check(state.optString("hashFormat")==E2eeMembershipContract.HASH_FORMAT&&!E2eeMembershipContract.grantReviewRequired(state.getJSONArray("changes"))){"E2EE_MEMBERSHIP_HASH_REVIEW_REQUIRED"};check(!state.isNull("batch")){"E2EE_MEMBERSHIP_PLAN_REQUIRED"}
        if(!state.isNull("result"))return JSONObject(state.getJSONObject("result").toString())
        val batch=state.getJSONObject("batch");val result=transport.membershipCommit(batch);current()
        E2eeKeys.exact(result,setOf("intentId","changeHash","scopes","signInRequired"));val scopeResults=result.getJSONObject("scopes")
        check(result.getString("intentId")==intentId&&result.getString("changeHash")==state.getJSONObject("preview").getString("changeHash")&&result.get("signInRequired")==true&&scopeResults.keys().asSequence().toList().sorted()==scopeIds(state.getJSONArray("scopeIds"),false)){"E2EE_INVALID_RECEIPT"}
        val request=request(state);val rotations=batch.getJSONArray("rotations");for(at in 0 until rotations.length()){
            val signed=rotations.getJSONObject(at);val command=signed.getJSONObject("command");val payload=command.getJSONObject("payload");val scopeId=command.getString("scopeId");val receipt=scopeResults.getJSONObject(scopeId)
            E2eeKeys.exact(receipt,setOf("directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","signInRequired"));val bytes=(command.getString("checkpointHash")+"\u0000"+E2eeCommands.hash(command)).toByteArray(Charsets.UTF_8)
            val checkpoint=try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)};current()
            check(E2eeCommands.integer(receipt.get("directoryRevision"),1)==E2eeCommands.integer(command.get("expectedRevision"))+1&&receipt.get("checkpointHash")==checkpoint
                &&E2eeCommands.integer(receipt.get("cryptoEpoch"),1)==E2eeCommands.integer(payload.get("cryptoEpoch"),1)&&E2eeCommands.integer(receipt.get("securityEpoch"),1)==E2eeCommands.integer(payload.get("securityEpoch"),1)
                &&receipt.get("signInRequired")== (payload.getJSONArray("revokedDeviceIds").length()>0)){"E2EE_INVALID_RECEIPT"}
            if(peers!=null){E2eeMembershipExchange.verify(JSONObject().put("format","genesis-membership-owner-approval-v1").put("requestFingerprint",E2eeMembershipExchange.fingerprint(request)).put("scopeId",scopeId).put("packet",signed),request,peers,true);current()}
            else{val client=openScope(scopeId);current();client.confirmMembershipRotation(signed);current()}
        }
        state.put("result",result);save(state,loaded.serial);return JSONObject(result.toString())
    }
    @Synchronized fun pending():List<String>{current();return device.vault.listLocal("outbox","membership:").map{it.removePrefix("membership:")}.also{current()}}
    @Synchronized fun inspect(intentId:String)=JSONObject(load(intentId).value.toString())
    override fun toString()="E2eeMembershipProduct([redacted])"
}
