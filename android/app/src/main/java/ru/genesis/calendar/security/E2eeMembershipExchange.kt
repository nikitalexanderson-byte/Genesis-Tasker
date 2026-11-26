package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal interface E2eeMembershipPeerPorts {
    fun target(scopeId:String):JSONObject
    fun directory(scopeId:String):JSONObject
    fun checkpoint(scopeId:String):E2eeDirectory.Checkpoint?
    fun remember(target:JSONObject,events:JSONArray)
    fun current()
}
internal object E2eeMembershipExchange {
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun strings(value:JSONArray)=(0 until value.length()).map{value.getString(it)}
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun digest(value:JSONObject):String {val bytes=E2eeCommands.canonical(value);return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
    fun request(value:JSONObject):JSONObject {
        E2eeKeys.exact(value,setOf("format","hashFormat","actorId","intentId","scopeIds","changes","preview"))
        if(value.get("format")!="genesis-membership-review-v1"||value.get("hashFormat")!=E2eeMembershipContract.HASH_FORMAT)invalid()
        E2eeKeys.technical(value.getString("actorId"));E2eeKeys.technical(value.getString("intentId"));val scopes=strings(value.getJSONArray("scopeIds"));scopes.forEach{E2eeKeys.technical(it)}
        if(scopes.size>256||scopes!=scopes.toSet().sorted())invalid();E2eeMembershipContract.changes(value.getJSONArray("changes"))
        val preview=value.getJSONObject("preview");E2eeKeys.exact(preview,setOf("intentId","changeHash","scopePlans"));val plans=rows(preview.getJSONArray("scopePlans"))
        if(preview.get("intentId")!=value.get("intentId")||plans.size!=scopes.size||preview.get("changeHash")!=E2eeMembershipContract.changeHash(value.getString("actorId"),value.getString("intentId"),value.getJSONArray("changes"),value.getJSONArray("scopeIds")))invalid()
        for(plan in plans){E2eeKeys.exact(plan,setOf("scopeId","ownerId","kind","resourceId","directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","roles","manifest"))
            listOf("scopeId","ownerId","resourceId").forEach{E2eeKeys.technical(plan.getString(it))};listOf("directoryRevision","cryptoEpoch","securityEpoch").forEach{E2eeCommands.integer(plan.get(it),1)}
            if(plan.get("kind") !in setOf("space","project"))invalid();E2eeEnvelope.decode(plan.getString("checkpointHash"),32);val roles=rows(plan.getJSONArray("roles"));if(roles.size>256)invalid();val ids=mutableSetOf<String>()
            for(role in roles){E2eeKeys.exact(role,setOf("deviceId","role"));if(!ids.add(E2eeKeys.technical(role.getString("deviceId")))||!role.isNull("role")&&role.get("role") !in setOf("owner","writer","commenter","reader"))invalid()}
            val manifest=plan.getJSONObject("manifest");E2eeKeys.exact(manifest,setOf("manifestHash","objectCount"));E2eeEnvelope.decode(manifest.getString("manifestHash"),32);if(E2eeCommands.integer(manifest.get("objectCount"))>10000)invalid()
        };if(plans.map{it.getString("scopeId")}.sorted()!=scopes)invalid();return JSONObject(value.toString())
    }
    fun fingerprint(input:JSONObject):String {val held=request(input);return digest(held.put("changes",E2eeMembershipContract.projection(held.getJSONArray("changes"))))}
    fun rotationShape(input:JSONObject,request:JSONObject,plan:JSONObject):JSONObject {
        return rotationShapeForHash(input,request.getJSONObject("preview").getString("changeHash"),plan)
    }
    fun rotationShapeForHash(input:JSONObject,changeHash:String,plan:JSONObject):JSONObject {
        E2eeEnvelope.decode(changeHash,32)
        E2eeKeys.exact(input,setOf("command","signature"));val c=input.getJSONObject("command");E2eeCommands.commandBytes(c);E2eeEnvelope.decode(input.getString("signature"),64)
        if(c.get("ownerId")!=plan.get("ownerId")||c.get("scopeId")!=plan.get("scopeId")||c.get("action")!="rotate-membership"||E2eeCommands.integer(c.get("expectedRevision"))!=E2eeCommands.integer(plan.get("directoryRevision"),1)||c.get("checkpointHash")!=plan.get("checkpointHash")||E2eeCommands.integer(c.get("securityEpoch"),1)!=E2eeCommands.integer(plan.get("securityEpoch"),1))invalid()
        val p=c.getJSONObject("payload");E2eeKeys.exact(p,setOf("membershipHash","revokedDeviceIds","roleChanges","cryptoEpoch","securityEpoch","keyId","capsules","recoveryCapsule","retiredManifestHash","retiredObjectCount"));val manifest=plan.getJSONObject("manifest")
        if(p.get("membershipHash")!=changeHash||E2eeCommands.integer(p.get("cryptoEpoch"),1)!=E2eeCommands.integer(plan.get("cryptoEpoch"),1)+1||E2eeCommands.integer(p.get("securityEpoch"),1)!=E2eeCommands.integer(plan.get("securityEpoch"),1)+1
            ||p.get("retiredManifestHash")!=manifest.get("manifestHash")||E2eeCommands.integer(p.get("retiredObjectCount"))!=E2eeCommands.integer(manifest.get("objectCount")))invalid();E2eeKeys.technical(p.getString("keyId"))
        val actual=rows(p.getJSONArray("roleChanges"))+strings(p.getJSONArray("revokedDeviceIds")).map{JSONObject().put("deviceId",it).put("role",JSONObject.NULL)}
        for(role in actual){E2eeKeys.exact(role,setOf("deviceId","role"));E2eeKeys.technical(role.getString("deviceId"))}
        val expected=rows(plan.getJSONArray("roles"));if(!same(JSONArray(actual.sortedBy{it.getString("deviceId")}),JSONArray(expected.sortedBy{it.getString("deviceId")})))invalid()
        fun capsule(value:JSONObject){E2eeKeys.exact(value,setOf("suite","enc","ciphertext"));if(value.get("suite")!=E2eeKeys.HPKE_SUITE)invalid();E2eeEnvelope.decode(value.getString("enc"),65);E2eeEnvelope.decode(value.getString("ciphertext"),48)}
        val ids=mutableSetOf<String>();for(row in rows(p.getJSONArray("capsules"))){E2eeKeys.exact(row,setOf("deviceId","capsule"));val id=E2eeKeys.technical(row.getString("deviceId"));if(!ids.add(id)||expected.none{it.get("deviceId")==id&&!it.isNull("role")})invalid();capsule(row.getJSONObject("capsule"))}
        if(ids.size!=expected.count{!it.isNull("role")})invalid();capsule(p.getJSONObject("recoveryCapsule"));return JSONObject(input.toString())
    }
    fun approval(input:JSONObject,source:JSONObject):JSONObject {
        val request=request(source);E2eeKeys.exact(input,setOf("format","requestFingerprint","scopeId","packet"))
        if(input.get("format")!="genesis-membership-owner-approval-v1"||input.get("requestFingerprint")!=fingerprint(request))invalid();E2eeKeys.technical(input.getString("scopeId"))
        val plan=rows(request.getJSONObject("preview").getJSONArray("scopePlans")).singleOrNull{it.get("scopeId")==input.get("scopeId")}?:invalid();rotationShape(input.getJSONObject("packet"),request,plan);return JSONObject(input.toString())
    }
    fun verify(input:JSONObject,source:JSONObject,ports:E2eeMembershipPeerPorts,confirmed:Boolean=false):JSONObject {
        ports.current();val request=request(source);val approval=approval(input,request);val scope=approval.getString("scopeId");val plan=rows(request.getJSONObject("preview").getJSONArray("scopePlans")).single{it.get("scopeId")==scope}
        val target=E2eeDeviceAccessContract.target(ports.target(scope));ports.current();if(target.get("scopeId")!=scope||listOf("ownerId","kind","resourceId").any{target.get(it)!=plan.get(it)})invalid()
        val previous=ports.checkpoint(scope);ports.current();val response=ports.directory(scope);ports.current();val events=response.getJSONArray("events");val frames=mutableMapOf<Long,E2eeDirectory.Verified>();val revision=E2eeCommands.integer(plan.get("directoryRevision"),1)
        val directory=E2eeDirectory.verify(plan.getString("ownerId"),scope,target.getJSONObject("authority"),events,previous){if(it.checkpoint.revision==revision)frames[revision]=it};ports.current();val frame=frames[revision]?:invalid()
        if(frame.kind!=plan.get("kind")||frame.resourceId!=plan.get("resourceId")||frame.checkpoint.hash!=plan.get("checkpointHash")||frame.cryptoEpoch!=E2eeCommands.integer(plan.get("cryptoEpoch"),1)||frame.securityEpoch!=E2eeCommands.integer(plan.get("securityEpoch"),1))invalid()
        val packet=approval.getJSONObject("packet");val c=packet.getJSONObject("command");val signer=frame.devices[c.getString("deviceId")]?:invalid();if(signer.revoked||signer.role!="owner"||signer.userId!=plan.get("ownerId"))invalid()
        E2eeCommands.verify(packet,E2eeDirectory.signingKey(signer.signingKey));ports.current();val hash=E2eeCommands.hash(c)
        if(revision<events.length()){if(E2eeCommands.hash(events.getJSONObject(revision.toInt()).getJSONObject("command"))!=hash)error("E2EE_MEMBERSHIP_STALE")}
        else{if(confirmed||directory.checkpoint.revision!=revision)error("E2EE_MEMBERSHIP_STALE")
            E2eeDirectory.verify(plan.getString("ownerId"),scope,target.getJSONObject("authority"),JSONArray(events.toString()).put(packet),directory.checkpoint);ports.current()}
        ports.remember(target,events);ports.current();return approval
    }
}
