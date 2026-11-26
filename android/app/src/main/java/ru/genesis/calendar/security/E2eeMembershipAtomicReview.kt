package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Paged v2 effects review. V1 request/consent bytes cannot enter this codec. */
internal object E2eeMembershipAtomicReview {
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
    private fun number(value:Any,max:Long)=E2eeCommands.integer(value).also{if(it>max)invalid()}
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun strings(value:JSONArray)=(0 until value.length()).map{value.getString(it)}
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun digest(value:Any)=E2eeMembershipAtomicContract.digest(value)
    fun previewRef(index:Int,page:JSONObject,after:Int):JSONObject {
        number(index,5000);number(after,5000)
        return JSONObject().put("index",index).put("after",after).put("count",page.getJSONArray("scopePlans").length())
            .put("pageHash",digest(JSONObject().put("format","genesis-membership-atomic-preview-page-v2").put("after",after).put("page",page)))
    }
    fun request(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("format","plan","previewPages","productPages","authorization")+(if(input.has("createdAt"))setOf("createdAt")else emptySet()));if(input.get("format")!="genesis-membership-atomic-review-v2")invalid()
        if(input.has("createdAt")){val time=input.getString("createdAt");if(!time.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")))invalid();java.time.Instant.parse(time)}
        val plan=E2eeMembershipAtomicContract.plan(input.getJSONObject("plan"));val previews=input.getJSONArray("previewPages");val size=plan.getJSONArray("scopeIds").length()
        val authorization=input.getJSONObject("authorization");E2eeKeys.exact(authorization,setOf("command","signature"));val command=authorization.getJSONObject("command");E2eeCommands.commandBytes(command).fill(0);E2eeEnvelope.decode(authorization.getString("signature"),64)
        val payload=command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("intentId","planHash"));if(command.get("ownerId")!=plan.get("actorId")||command.get("action")!="membership-atomic-begin"||payload.get("intentId")!=plan.get("intentId")||payload.get("planHash")!=digest(plan))invalid()
        if(previews.length() !in 1..size)invalid();var next=0L
        for((index,ref)in rows(previews).withIndex()){
            E2eeKeys.exact(ref,setOf("index","after","count","pageHash"));if(number(ref.get("index"),5000)!=index.toLong()||number(ref.get("after"),5000)!=next)invalid()
            val count=number(ref.get("count"),200);if(count<1)invalid();next+=count;E2eeEnvelope.decode(ref.getString("pageHash"),32)
        }
        if(next!=size.toLong())invalid();val products=E2eeMembershipAtomicContract.refs(input.getJSONArray("productPages"),true)
        if(rows(products).any{it.get("kind")!="product-packets"})invalid();return JSONObject(input.toString())
    }
    fun fingerprint(input:JSONObject)=digest(request(input))
    fun part(input:JSONObject,rawRequest:JSONObject):JSONObject {
        val header=request(rawRequest);E2eeKeys.exact(input,setOf("format","fingerprint","kind","index","page"))
        if(input.get("format")!="genesis-membership-atomic-review-part-v2"||input.get("fingerprint")!=fingerprint(header)||input.get("kind") !in setOf("plan","preview","products"))invalid()
        val index=number(input.get("index"),9999).toInt();val page=input.getJSONObject("page")
        if(input.get("kind")=="preview"){
            val refs=header.getJSONArray("previewPages");if(index !in 0 until refs.length())invalid();val ref=refs.getJSONObject(index)
            E2eeKeys.exact(page,setOf("intentId","planHash","changeHash","scopePlans","next"));if(page.getJSONArray("scopePlans").length().toLong()!=number(ref.get("count"),200)||!same(previewRef(index,page,number(ref.get("after"),5000).toInt()),ref))invalid()
        }else{
            E2eeMembershipAtomicContract.page(page);val refs=if(input.get("kind")=="plan")header.getJSONObject("plan").getJSONArray("pages")else header.getJSONArray("productPages")
            if(index !in 0 until refs.length()||!same(E2eeMembershipAtomicContract.pageRef(index,page),refs.getJSONObject(index))||input.get("kind")=="products"&&page.get("kind")!="product-packets")invalid()
        };return JSONObject(input.toString())
    }
    fun rotationShape(input:JSONObject,header:JSONObject,scope:JSONObject):JSONObject {
        val plan=JSONObject(scope.toString()).put("roles",JSONArray(rows(scope.getJSONArray("roles")).map{JSONObject().put("deviceId",it.get("deviceId")).put("role",it.get("role"))}))
        return E2eeMembershipExchange.rotationShapeForHash(input,E2eeMembershipAtomicContract.changeHash(header.getJSONObject("plan")),plan)
    }
    fun approval(input:JSONObject,header:JSONObject,scope:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("format","requestFingerprint","scopeId","packet"))
        if(input.get("format")!="genesis-membership-atomic-owner-approval-v2"||input.get("requestFingerprint")!=fingerprint(header)||input.get("scopeId")!=scope.get("scopeId"))invalid()
        rotationShape(input.getJSONObject("packet"),header,scope);return JSONObject(input.toString())
    }
    fun recipients(anchor:JSONObject,scope:JSONObject,ports:E2eeMembershipPeerPorts,request:JSONObject,retained:Boolean=false):Boolean {
        ports.current();val id=anchor.getString("scopeId");val target=E2eeDeviceAccessContract.target(ports.target(id));ports.current()
        if(listOf("scopeId","ownerId","kind","resourceId").any{target.get(it)!=anchor.get(it)})invalid()
        val previous=ports.checkpoint(id);ports.current();val response=ports.directory(id);ports.current();val revision=E2eeCommands.integer(anchor.get("directoryRevision"),1);var frame:E2eeDirectory.Verified?=null
        val current=E2eeDirectory.verify(anchor.getString("ownerId"),id,target.getJSONObject("authority"),response.getJSONArray("events"),previous){if(it.checkpoint.revision==revision)frame=it};ports.current()
        val observed=frame?:invalid()
        if(observed.checkpoint.hash!=anchor.get("checkpointHash")||observed.generation!=E2eeCommands.integer(anchor.get("generation"),1)||observed.kind!=anchor.get("kind")||observed.resourceId!=anchor.get("resourceId")||observed.cryptoEpoch!=E2eeCommands.integer(scope.get("cryptoEpoch"),1)||observed.securityEpoch!=E2eeCommands.integer(scope.get("securityEpoch"),1))invalid()
        if(!retained&&current.checkpoint.revision!=revision)error("E2EE_MEMBERSHIP_STALE");val live=observed.devices.values.filter{!it.revoked};val roles=scope.getJSONArray("roles")
        if(live.size!=roles.length())invalid();for(role in rows(roles)){
            val device=observed.devices[role.getString("deviceId")]?:invalid()
            if(device.revoked||device.userId!=role.get("userId")||device.userId==anchor.get("ownerId")&&role.get("role")!="owner"||device.userId!=anchor.get("ownerId")&&role.get("role")=="owner")invalid()
        }
        val authorization=request.getJSONObject("authorization");val signer=observed.devices[authorization.getJSONObject("command").getString("deviceId")];var actorVerified=false
        if(signer!=null&&!signer.revoked&&signer.userId==request.getJSONObject("plan").get("actorId")&&signer.role in setOf("owner","writer")){
            E2eeCommands.verify(authorization,E2eeDirectory.signingKey(signer.signingKey));ports.current();actorVerified=true
        };ports.remember(target,response.getJSONArray("events"));ports.current();return actorVerified
    }
    class Collector(rawHeader:JSONObject,private val peers:E2eeMembershipPeerPorts,private val retained:Boolean=false){
        val header=request(rawHeader).also{if(!retained&&!it.has("createdAt"))error("E2EE_MEMBERSHIP_REVIEW_REQUIRED")};val fingerprint=fingerprint(header);private val plan=header.getJSONObject("plan")
        private var planAt=0;private var previewAt=0;private var productAt=0;private var finished=false;private var actorVerified=false
        private val anchors=mutableMapOf<String,JSONObject>();private val scopes=linkedMapOf<String,JSONObject>();private val products=mutableMapOf<String,JSONObject>();private val origins=linkedMapOf<String,JSONObject>()
        private var operation:JSONObject?=null;private val grants=mutableListOf<JSONObject>();private val unique=mutableSetOf<String>()
        @Synchronized fun consume(input:JSONObject){
            peers.current();if(finished)invalid();val part=part(input,header);val kind=part.getString("kind");val index=number(part.get("index"),9999).toInt();val page=part.getJSONObject("page")
            if(kind=="plan"){
                if(index!=planAt||previewAt!=0||productAt!=0)invalid();val pageKind=page.getString("kind")
                for(row in rows(page.getJSONArray("items"))){
                    val key=when(pageKind){
                        "operation"->{if(operation!=null)invalid();operation=JSONObject(row.toString());continue}
                        "operation-grants"->{grants.add(row);"grant:"+row.getString("projectId")}
                        "anchors"->{val scope=row.getString("scopeId");if(scope !in strings(plan.getJSONArray("scopeIds")))invalid();if(!retained&&!row.has("productIndexHash"))error("E2EE_MEMBERSHIP_REVIEW_REQUIRED");anchors[scope]=row;"anchor:"+scope}
                        "product-operations"->{val scope=row.getString("scopeId");if(scope !in strings(plan.getJSONArray("scopeIds")))invalid();val key="product:"+scope+"\u0000"+row.getString("intentId");products[key]=row
                            for(op in rows(row.getJSONArray("operations")))if(!unique.add("entity:"+scope+"\u0000"+op.getString("entityId")))invalid();key}
                        "acl"->"acl:"+row.getString("table")+"\u0000"+digest(E2eeMembershipContract.fields(row.getJSONObject("key")))
                        "clear-assignments","role-events"->pageKind+":"+row.getString("projectId")+"\u0000"+row.getString("userId")
                        "revoke-invitations"->pageKind+":"+row.getString("kind")+"\u0000"+row.getString("resourceId")+"\u0000"+row.getString("userId")
                        else->invalid()
                    };if(!unique.add(key))invalid()
                };if(pageKind=="acl")E2eeMembershipContract.changes(page.getJSONArray("items"));planAt++;return
            }
            val op=operation?:invalid();if(planAt!=plan.getJSONArray("pages").length()||anchors.keys.sorted()!=strings(plan.getJSONArray("scopeIds")))invalid()
            if(op.get("kind")=="project-grants"){if(grants.size>5000||op.getBoolean("allProjects")&&grants.isNotEmpty())invalid()}else if(grants.isNotEmpty())invalid()
            if(kind=="preview"){
                if(index!=previewAt||productAt!=0)invalid();val ref=header.getJSONArray("previewPages").getJSONObject(index)
                val checked=E2eeMembershipAtomicPreview.page(page,plan,digest(plan),number(ref.get("after"),5000).toInt(),anchors)
                for(scope in rows(checked.getJSONArray("scopePlans"))){val checkedActor=recipients(anchors[scope.getString("scopeId")]!!,scope,peers,header,retained);peers.current();actorVerified=actorVerified||checkedActor;scopes[scope.getString("scopeId")]=scope};previewAt++;return
            }
            if(previewAt!=header.getJSONArray("previewPages").length()||index!=productAt)invalid()
            for(packet in rows(page.getJSONArray("items"))){
                val command=packet.getJSONObject("command");val payload=command.getJSONObject("payload");val scope=command.getString("scopeId");val key="product:"+scope+"\u0000"+payload.getString("intentId");val expected=products[key]?:invalid();val anchor=anchors[scope]?:invalid()
                if(key in origins||!same(payload.get("operations"),expected.get("operations")))invalid();val proof=E2eeMembershipAtomicProofs.verify(plan,anchor,packet,peers);peers.current()
                origins[key]=JSONObject(proof.toString()).put("scopeId",scope).put("intentId",payload.get("intentId"))
            };productAt++
        }
        @Synchronized fun finish():JSONObject {
            peers.current();if(finished||!actorVerified||planAt!=plan.getJSONArray("pages").length()||previewAt!=header.getJSONArray("previewPages").length()||productAt!=header.getJSONArray("productPages").length()||origins.size!=products.size||scopes.keys.sorted()!=strings(plan.getJSONArray("scopeIds")))invalid();finished=true
            return JSONObject().put("fingerprint",fingerprint).put("scopes",JSONArray(scopes.values.map{JSONObject(it.toString())})).put("products",JSONArray(origins.values.map{JSONObject(it.toString())}))
        }
    }
}
