package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Foreground staging/review only. Product packets are already immutable in
 * normal scope outboxes; no rotation or final consent happens here. */
internal object E2eeNativeMembershipAtomicReview {
    suspend fun prepare(stager:E2eeMembershipAtomicStager,owners:E2eeMembershipAtomicOwnerReviews,intent:String,rawPackets:JSONArray,current:()->Unit):JSONObject {
        current();val packets=JSONArray(rawPackets.toString());val state=stager.inspect(intent);current()
        check(state.getBoolean("ready")&&!state.getBoolean("cancelRequested")){"E2EE_MEMBERSHIP_REVIEW_REQUIRED"}
        val products=E2eeMembershipAtomicContract.pages("product-packets",packets);val previews=JSONArray();val refs=JSONArray();var after=0
        while(true){val page=stager.previewPage(intent,after);current();refs.put(E2eeMembershipAtomicReview.previewRef(previews.length(),page,after));previews.put(page);if(page.isNull("next"))break;after=E2eeCommands.integer(page.get("next")).toInt()}
        val productRefs=JSONArray();for(index in 0 until products.length())productRefs.put(E2eeMembershipAtomicContract.pageRef(index,products.getJSONObject(index)))
        val authorization=stager.reviewAuthorization(intent);current()
        val request=E2eeMembershipAtomicReview.request(JSONObject().put("format","genesis-membership-atomic-review-v2").put("plan",state.get("plan")).put("previewPages",refs).put("productPages",productRefs).put("authorization",authorization))
        val fingerprint=owners.create(request);current()
        fun put(kind:String,index:Int,page:JSONObject){owners.putPart(JSONObject().put("format","genesis-membership-atomic-review-part-v2").put("fingerprint",fingerprint).put("kind",kind).put("index",index).put("page",page));current()}
        for(index in 0 until state.getJSONObject("plan").getJSONArray("pages").length())put("plan",index,stager.readPlanPage(intent,index))
        for(index in 0 until previews.length())put("preview",index,previews.getJSONObject(index))
        for(index in 0 until products.length())put("products",index,products.getJSONObject(index))
        return JSONObject().put("fingerprint",fingerprint).put("request",request).put("review",owners.review(fingerprint)).also{current()}
    }
}
