package ru.genesis.calendar.security

import org.json.JSONObject

/** Same aggregate/baseline format as web. Domain engines validate both baseline
 * and candidate; a review is bound to the remote revision shown to the user. */
internal class E2eeFeatureDocument(private val account:E2eeProductAccount,private val domain:String,objectId:String,
    private val validate:(JSONObject)->JSONObject,private val seed:()->JSONObject,private val current:()->Unit){
    private var view:E2eePrivateDocument.Opened?=null
    private fun check(){account.requireOpen();current()}
    private fun state(document:JSONObject,base:JSONObject)=JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("document",document).put("base",base)
    private val document=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,domain,objectId,{value->
        E2eeKeys.exact(value,setOf("protocol","ownerId","document","base"));check(value.get("protocol")==1&&value.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        state(validate(value.getJSONObject("document")),validate(value.getJSONObject("base")))},::check,::check)
    private fun output():JSONObject{check();val opened=checkNotNull(view){"E2EE_PRODUCT_READ_REQUIRED"}
        return JSONObject().put("document",JSONObject(opened.value.getJSONObject("document").toString())).put("base",JSONObject(opened.value.getJSONObject("base").toString()))
            .put("pending",opened.pending).put("remoteRevision",opened.remoteRevision).put("conflict",opened.conflict?.let{JSONObject().put("document",JSONObject(it.value.getJSONObject("document").toString())).put("revision",it.revision)}?:JSONObject.NULL)}
    @Synchronized fun read(refresh:Boolean=true):JSONObject{
        check();if(view!=null&&!refresh)return output()
        try{view=document.load(account.offline)}catch(error:IllegalStateException){
            if(account.offline||error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error
            val candidate=validate(seed());check();val value=state(candidate,JSONObject(candidate.toString()));val serial=document.save(value,null,0)
            view=E2eePrivateDocument.Opened(value,serial,0,true)
        };return output()
    }
    @Synchronized fun write(input:JSONObject):JSONObject{
        check();val candidate=validate(JSONObject(input.toString()));read(false);val prior=checkNotNull(view);val base=prior.value.getJSONObject(if(prior.pending)"base" else "document")
        val value=state(candidate,JSONObject(base.toString()));val serial=document.save(value,prior.serial,prior.remoteRevision)
        view=E2eePrivateDocument.Opened(value,serial,prior.remoteRevision,true,prior.conflict);return output()
    }
    @Synchronized fun resolve(input:JSONObject,expectedRevision:Long):JSONObject{
        check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val candidate=validate(JSONObject(input.toString()));read(true);val prior=checkNotNull(view);val conflict=prior.conflict
        check(conflict!=null&&conflict.revision==expectedRevision){"E2EE_CONFLICT_REVIEW_STALE"}
        val value=state(candidate,JSONObject(conflict.value.getJSONObject("document").toString()));val serial=document.reviewConflict(value,prior.serial,expectedRevision)
        view=E2eePrivateDocument.Opened(value,serial,expectedRevision,true);return output()
    }
    @Synchronized fun flush():JSONObject{
        check();read(false);val prior=checkNotNull(view);check(prior.conflict==null){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
        if(!prior.pending||account.offline)return output()
        document.flush();view=document.load(true);check();val saved=checkNotNull(view)
        check(!saved.pending&&E2eeProductJson.same(prior.value,saved.value)){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return output()
    }
    override fun toString()="E2eeFeatureDocument([redacted])"
}
