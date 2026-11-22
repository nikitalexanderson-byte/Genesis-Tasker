package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Matching encrypted paged owner review store. Requests and consent are saved
 * and read back before network verification or key rotation, never applied. */
internal class E2eeMembershipAtomicOwnerReviews(private val account:E2eeProductAccount,private val peers:E2eeMembershipPeerPorts,
    private val openOwned:(JSONObject)->E2eeScopeClient,private val guard:()->Unit,
    private val reviewEffects:suspend (JSONObject,JSONObject,(Int)->JSONObject)->Unit){
    companion object {
        val prefixes=listOf("membership-atomic-owner-review:","membership-atomic-owner-part:","membership-atomic-owner-consent:","membership-atomic-owner-approval:")
        fun id(owner:String,fingerprint:String,kind:Int=0,suffix:String=""):String {
            E2eeKeys.technical(owner);E2eeEnvelope.decode(fingerprint,32)
            return prefixes[kind]+E2eeMembershipAtomicContract.digest(JSONObject().put("format","genesis-membership-atomic-owner-key-v2").put("ownerId",owner).put("fingerprint",fingerprint))+suffix
        }
        fun scopeSuffix(scope:String):String {E2eeKeys.technical(scope);return ":"+E2eeMembershipAtomicContract.digest(scope)}
    }
    private data class Stored(val value:JSONObject,val serial:Long)
    private val reviewMutex=Mutex()
    private fun current(){guard();account.requireOpen()}
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun read(id:String):Stored? {
        current();val row=account.device.vault.read("outbox",id);if(row==null){current();return null}
        return try{current();check(row.bytes.size in 1..6*1024*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};Stored(E2eeFileManifestJson.readPrivateDocument(row.bytes),row.serial)}finally{row.bytes.fill(0)}
    }
    private fun save(id:String,value:JSONObject,expected:Long?):Stored {
        current();val bytes=value.toString().toByteArray(Charsets.UTF_8)
        try{check(bytes.size<=6*1024*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};account.device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",id,bytes,expected)),::current)}finally{bytes.fill(0)}
        current();val saved=read(id)?:error("E2EE_LOCAL_CONFLICT");check(saved.serial==(expected?:0L)+1&&same(saved.value,value)){"E2EE_LOCAL_CONFLICT"};return saved
    }
    private fun request(fingerprint:String):JSONObject {
        val row=read(id(account.ownerId,fingerprint))?:error("E2EE_MEMBERSHIP_PLAN_REQUIRED");val value=row.value
        E2eeKeys.exact(value,setOf("format","ownerId","request"));if(row.serial!=1L||value.get("format")!="genesis-membership-atomic-owner-local-v2"||value.get("ownerId")!=account.ownerId)invalid()
        val request=E2eeMembershipAtomicReview.request(value.getJSONObject("request"));if(E2eeMembershipAtomicReview.fingerprint(request)!=fingerprint)invalid();return request
    }
    @Synchronized fun create(input:JSONObject):String {
        current();val request=E2eeMembershipAtomicReview.request(input);val fingerprint=E2eeMembershipAtomicReview.fingerprint(request);val key=id(account.ownerId,fingerprint)
        val value=JSONObject().put("format","genesis-membership-atomic-owner-local-v2").put("ownerId",account.ownerId).put("request",request);val old=read(key)
        if(old!=null){if(old.serial!=1L||!same(old.value,value))invalid()}else save(key,value,null);return fingerprint
    }
    @Synchronized fun putPart(input:JSONObject):JSONObject {
        current();val part=E2eeMembershipAtomicReview.part(input,request(input.getString("fingerprint")));val fingerprint=part.getString("fingerprint");val kind=part.getString("kind");val index=E2eeCommands.integer(part.get("index")).toInt()
        val key=id(account.ownerId,fingerprint,1,":"+kind+":"+index);val value=JSONObject().put("format","genesis-membership-atomic-owner-part-local-v2").put("ownerId",account.ownerId).put("part",part);val old=read(key)
        if(old!=null){if(old.serial!=1L||!same(old.value,value))invalid()}else save(key,value,null)
        return JSONObject().put("fingerprint",fingerprint).put("kind",kind).put("index",index)
    }
    private fun part(request:JSONObject,kind:String,index:Int):JSONObject {
        val fingerprint=E2eeMembershipAtomicReview.fingerprint(request);val row=read(id(account.ownerId,fingerprint,1,":"+kind+":"+index))?:error("E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED");val value=row.value
        E2eeKeys.exact(value,setOf("format","ownerId","part"));if(row.serial!=1L||value.get("format")!="genesis-membership-atomic-owner-part-local-v2"||value.get("ownerId")!=account.ownerId)invalid()
        val part=E2eeMembershipAtomicReview.part(value.getJSONObject("part"),request);if(part.get("kind")!=kind||E2eeCommands.integer(part.get("index"))!=index.toLong())invalid();return part
    }
    @Synchronized fun part(fingerprint:String,kind:String,index:Int)=part(request(fingerprint),kind,index)
    @Synchronized fun inspect(fingerprint:String)=JSONObject().put("fingerprint",fingerprint).put("request",request(fingerprint))
    @Synchronized fun pending():JSONArray {
        current();val result=JSONArray();val keys=account.device.vault.listLocal("outbox",prefixes[0]);current()
        for(key in keys){val row=read(key)?:invalid();val raw=row.value;E2eeKeys.exact(raw,setOf("format","ownerId","request"));val fingerprint=E2eeMembershipAtomicReview.fingerprint(raw.getJSONObject("request"));if(key!=id(account.ownerId,fingerprint))invalid();result.put(inspect(fingerprint))};return result
    }
    private fun complete(request:JSONObject):JSONObject {
        check(!account.offline){"E2EE_ONLINE_REQUIRED"};val collector=E2eeMembershipAtomicReview.Collector(request,peers)
        for(kind in listOf("plan","preview","products")){
            val refs=when(kind){"plan"->request.getJSONObject("plan").getJSONArray("pages");"preview"->request.getJSONArray("previewPages");else->request.getJSONArray("productPages")}
            for(index in 0 until refs.length()){collector.consume(part(request,kind,index));current()}
        };return collector.finish()
    }
    suspend fun review(fingerprint:String):JSONObject=reviewMutex.withLock{
        val request=request(fingerprint);val result=complete(request)
        for(scope in rows(result.getJSONArray("scopes")))if(scope.get("ownerId")==account.ownerId){reviewEffects(request,scope){index->part(request,"plan",index).getJSONObject("page")};current()};result
    }
    private fun anchor(request:JSONObject,scope:String):JSONObject {
        val refs=request.getJSONObject("plan").getJSONArray("pages")
        for(index in 0 until refs.length())if(refs.getJSONObject(index).get("kind")=="anchors")for(row in rows(part(request,"plan",index).getJSONObject("page").getJSONArray("items")))if(row.get("scopeId")==scope)return row
        invalid()
    }
    private fun consent(raw:JSONObject,fingerprint:String,scope:String,roles:JSONArray):JSONObject {
        E2eeKeys.exact(raw,setOf("format","ownerId","fingerprint","scopeId","roles","packet"))
        if(raw.get("format")!="genesis-membership-atomic-owner-consent-local-v2"||raw.get("ownerId")!=account.ownerId||raw.get("fingerprint")!=fingerprint||raw.get("scopeId")!=scope||!same(raw.get("roles"),roles))invalid();return JSONObject(raw.toString())
    }
    suspend fun approve(fingerprint:String,scopeId:String,displayedFingerprint:String,explicitRoles:JSONArray):JSONObject=reviewMutex.withLock{
        current();if(displayedFingerprint!=fingerprint)error("E2EE_MEMBERSHIP_FINGERPRINT_REQUIRED");val request=request(fingerprint);val review=complete(request)
        val scope=rows(review.getJSONArray("scopes")).singleOrNull{it.get("scopeId")==scopeId}?:invalid();if(scope.get("ownerId")!=account.ownerId||!same(explicitRoles,scope.get("roles")))invalid()
        reviewEffects(request,scope){index->part(request,"plan",index).getJSONObject("page")};current()
        val key=id(account.ownerId,fingerprint,2,scopeSuffix(scopeId));val old=read(key);val value:JSONObject;val serial:Long
        if(old!=null){value=consent(old.value,fingerprint,scopeId,explicitRoles);serial=old.serial;if(serial!=(if(value.isNull("packet"))1L else 2L))invalid()}
        else{value=JSONObject().put("format","genesis-membership-atomic-owner-consent-local-v2").put("ownerId",account.ownerId).put("fingerprint",fingerprint).put("scopeId",scopeId).put("roles",JSONArray(explicitRoles.toString())).put("packet",JSONObject.NULL);serial=save(key,value,null).serial}
        val packet=if(value.isNull("packet")){
            val client=openOwned(scope);current();client.refresh();current();val roles=JSONArray(rows(explicitRoles).map{JSONObject().put("deviceId",it.get("deviceId")).put("role",it.get("role"))})
            val signed=client.prepareMembershipRotation(E2eeMembershipAtomicContract.changeHash(request.getJSONObject("plan")),roles,scope.getJSONObject("manifest"),scope);current();E2eeMembershipAtomicReview.rotationShape(signed,request,scope)
            save(key,JSONObject(value.toString()).put("packet",signed),serial);signed
        }else value.getJSONObject("packet")
        E2eeMembershipAtomicProofs.verify(request.getJSONObject("plan"),anchor(request,scopeId),packet,peers);current()
        E2eeMembershipAtomicReview.approval(JSONObject().put("format","genesis-membership-atomic-owner-approval-v2").put("requestFingerprint",fingerprint).put("scopeId",scopeId).put("packet",packet),request,scope)
    }
    @Synchronized fun acceptApproval(fingerprint:String,input:JSONObject):JSONObject {
        current();val request=request(fingerprint);if(request.getJSONObject("plan").get("actorId")!=account.ownerId)invalid();val reviewed=complete(request)
        val scope=rows(reviewed.getJSONArray("scopes")).singleOrNull{it.get("scopeId")==input.get("scopeId")}?:invalid();val approval=E2eeMembershipAtomicReview.approval(input,request,scope)
        val key=id(account.ownerId,fingerprint,3,scopeSuffix(scope.getString("scopeId")));val old=read(key);val serial:Long
        if(old!=null){val value=old.value;E2eeKeys.exact(value,setOf("format","ownerId","fingerprint","approval","verified"));if(value.get("format")!="genesis-membership-atomic-owner-relay-local-v2"||value.get("ownerId")!=account.ownerId||value.get("fingerprint")!=fingerprint||!same(value.get("approval"),approval)||value.get("verified") !is Boolean||old.serial!=(if(value.getBoolean("verified"))2L else 1L))invalid();serial=old.serial}
        else serial=save(key,JSONObject().put("format","genesis-membership-atomic-owner-relay-local-v2").put("ownerId",account.ownerId).put("fingerprint",fingerprint).put("approval",approval).put("verified",false),null).serial
        E2eeMembershipAtomicProofs.verify(request.getJSONObject("plan"),anchor(request,scope.getString("scopeId")),approval.getJSONObject("packet"),peers);current()
        if(serial==1L)save(key,JSONObject().put("format","genesis-membership-atomic-owner-relay-local-v2").put("ownerId",account.ownerId).put("fingerprint",fingerprint).put("approval",approval).put("verified",true),serial)
        return approval
    }
    /** Read-only exact original. A new directory state never creates a new
     * signature or fresh consent while exporting an older approval. */
    @Synchronized fun exportApproval(fingerprint:String,scopeId:String):JSONObject {
        current();val request=request(fingerprint);var scope:JSONObject?=null
        for(index in 0 until request.getJSONArray("previewPages").length()){
            scope=rows(part(request,"preview",index).getJSONObject("page").getJSONArray("scopePlans")).singleOrNull{it.get("scopeId")==scopeId};if(scope!=null)break
        }
        val target=scope?:invalid();val own=target.get("ownerId")==account.ownerId;val row=read(id(account.ownerId,fingerprint,if(own)2 else 3,scopeSuffix(scopeId)))?:error("E2EE_MEMBERSHIP_PLAN_REQUIRED")
        if(row.serial!=2L)error("E2EE_MEMBERSHIP_REVIEW_REQUIRED");val approval:JSONObject
        if(own){val value=consent(row.value,fingerprint,scopeId,target.getJSONArray("roles"));if(value.isNull("packet"))invalid();approval=JSONObject().put("format","genesis-membership-atomic-owner-approval-v2").put("requestFingerprint",fingerprint).put("scopeId",scopeId).put("packet",value.get("packet"))}
        else{val value=row.value;E2eeKeys.exact(value,setOf("format","ownerId","fingerprint","approval","verified"));if(value.get("format")!="genesis-membership-atomic-owner-relay-local-v2"||value.get("ownerId")!=account.ownerId||value.get("fingerprint")!=fingerprint||value.get("verified")!=true||request.getJSONObject("plan").get("actorId")!=account.ownerId)invalid();approval=value.getJSONObject("approval")}
        return E2eeMembershipAtomicReview.approval(approval,request,target)
    }
    override fun toString()="E2eeMembershipAtomicOwnerReviews([redacted])"
}
