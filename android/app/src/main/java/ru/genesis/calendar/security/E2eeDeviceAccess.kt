package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.Signature
import java.util.UUID

internal interface E2eeDeviceAccessPorts {
    fun target(scopeId:String):JSONObject
    fun client(target:JSONObject):E2eeScopeClient
    fun directory(scopeId:String):JSONObject
    fun challenge(target:JSONObject,deviceId:String,keys:JSONObject,requestId:String):JSONObject
    fun command(packet:JSONObject):JSONObject
    fun open(target:JSONObject)
}
/** Same exact request/grant custody and independent comparison as web. Caller
 * runs these foreground operations on IO. No original request is overwritten. */
internal class E2eeDeviceAccess(private val account:E2eeProductAccount,private val ports:E2eeDeviceAccessPorts,private val guard:()->Unit={}) {
    companion object {private const val PREFIX="device-access:";private fun invalid():Nothing=error("E2EE_DEVICE_ACCESS_INVALID")}
    private fun current(){guard();account.requireOpen()}
    private fun online(){current();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun approvalShape(input:JSONObject,request:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("command","signature"));val c=input.getJSONObject("command");E2eeCommands.commandBytes(c);E2eeEnvelope.decode(input.getString("signature"),64)
        val target=request.getJSONObject("target");if(c.get("ownerId")!=target.get("ownerId")||c.get("scopeId")!=target.get("scopeId")||c.get("action")!="enroll")invalid()
        val payload=c.getJSONObject("payload");E2eeKeys.exact(payload,setOf("challenge","capsule","historyCapsules","selfProof"))
        if(!same(payload.get("challenge"),request.get("challenge"))||payload.get("selfProof")!=request.get("selfProof"))invalid()
        fun capsule(value:JSONObject){E2eeKeys.exact(value,setOf("suite","enc","ciphertext"));if(value.get("suite")!=E2eeKeys.HPKE_SUITE)invalid();E2eeEnvelope.decode(value.getString("enc"),65);E2eeEnvelope.decode(value.getString("ciphertext"),48)}
        capsule(payload.getJSONObject("capsule"));val history=payload.getJSONArray("historyCapsules");if(history.length()>2048)invalid()
        for(at in 0 until history.length()){val grant=history.getJSONObject(at);E2eeKeys.exact(grant,setOf("cryptoEpoch","keyId","capsule"));E2eeCommands.integer(grant.get("cryptoEpoch"),1);E2eeKeys.technical(grant.getString("keyId"));capsule(grant.getJSONObject("capsule"))}
        return JSONObject(input.toString())
    }
    private fun store(id:String):E2eeDeviceDocument {E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,PREFIX+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","id","mode","target","request","reviewedFingerprint","approval","complete"))
        if(value.get("format")!="genesis-device-access-v1"||value.get("ownerId")!=account.ownerId||value.get("id")!=id||value.get("mode") !in setOf("request","grant")||value.get("complete") !is Boolean)invalid()
        val target=E2eeDeviceAccessContract.target(value.getJSONObject("target"))
        if(!value.isNull("request")){val request=E2eeDeviceAccessContract.request(value.getJSONObject("request"));if(!same(request.get("target"),target))invalid();val challenge=request.getJSONObject("challenge")
            if(value.get("mode")=="request"&&(challenge.get("userId")!=account.ownerId||challenge.get("deviceId")!=account.device.deviceId))invalid()
            if(!value.isNull("approval"))approvalShape(value.getJSONObject("approval"),request)
        }else if(!value.isNull("approval")||!value.isNull("reviewedFingerprint")||value.get("mode")=="grant"||value.getBoolean("complete"))invalid()
        if(value.get("mode")=="grant")E2eeEnvelope.decode(value.getString("reviewedFingerprint"),32)else if(!value.isNull("reviewedFingerprint"))invalid()
        if(value.getBoolean("complete")&&value.isNull("approval"))invalid();JSONObject(value.toString())
    },::current)}
    @Synchronized fun inspect(id:String):JSONObject {current();return store(id).load()?.value?.also{current()}?:error("E2EE_DEVICE_ACCESS_REQUIRED")}
    @Synchronized fun pending():List<JSONObject> {current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{inspect(it.removePrefix(PREFIX))}.filter{!it.getBoolean("complete")||it.get("mode")=="grant"}}
    @Synchronized fun create(scopeId:String):String {
        online();val target=E2eeDeviceAccessContract.target(ports.target(scopeId));current();val id=UUID.randomUUID().toString()
        store(id).save(JSONObject().put("format","genesis-device-access-v1").put("ownerId",account.ownerId).put("id",id).put("mode","request").put("target",target)
            .put("request",JSONObject.NULL).put("reviewedFingerprint",JSONObject.NULL).put("approval",JSONObject.NULL).put("complete",false),null);current();return id
    }
    @Synchronized fun request(id:String):JSONObject {
        online();val store=store(id);val before=store.load()?:invalid();current();if(before.value.get("mode")!="request")invalid();if(!before.value.isNull("request"))return before.value
        val target=E2eeDeviceAccessContract.target(ports.target(before.value.getJSONObject("target").getString("scopeId")));current();check(same(target,before.value.get("target"))){"E2EE_AUTHORITY_CHANGED"}
        val keys=E2eeKeys.publicKeys(account.device.keys());val challenge=E2eeDeviceAccessContract.challenge(ports.challenge(target,account.device.deviceId,keys,id),target);current()
        if(challenge.get("userId")!=account.ownerId||challenge.get("deviceId")!=account.device.deviceId||challenge.get("signingKey")!=keys.get("signingKey")||challenge.get("receivingKey")!=keys.get("receivingKey"))invalid()
        val bytes=E2eeDeviceAccessContract.proof(challenge);val proof=try{val signer=Signature.getInstance("SHA256withECDSA");signer.initSign(account.device.keys().signing.private);signer.update(bytes);E2eeEnvelope.encode(E2eeEnvelope.derToP1363(signer.sign()))}finally{bytes.fill(0)}
        val request=E2eeDeviceAccessContract.verify(JSONObject().put("format","genesis-device-access-request-v1").put("target",target).put("challenge",challenge).put("selfProof",proof));current()
        store.save(JSONObject(before.value.toString()).put("request",request),before.serial);current();return inspect(id)
    }
    @Synchronized fun approve(input:JSONObject,comparedFingerprint:String):JSONObject {
        online();val request=E2eeDeviceAccessContract.verify(input);val fingerprint=E2eeDeviceAccessContract.fingerprint(request);current();check(fingerprint==comparedFingerprint){"E2EE_DEVICE_FINGERPRINT_REQUIRED"}
        val id="grant:$fingerprint";val store=store(id);val before=store.load();current()
        if(before!=null){if(before.value.get("mode")!="grant"||!same(before.value.get("request"),request)||before.value.get("reviewedFingerprint")!=fingerprint)invalid();if(!before.value.isNull("approval"))return before.value}
        else store.save(JSONObject().put("format","genesis-device-access-v1").put("ownerId",account.ownerId).put("id",id).put("mode","grant").put("target",request.get("target")).put("request",request)
            .put("reviewedFingerprint",fingerprint).put("approval",JSONObject.NULL).put("complete",false),null)
        current();val target=E2eeDeviceAccessContract.target(ports.target(request.getJSONObject("target").getString("scopeId")));current();check(same(target,request.get("target"))){"E2EE_AUTHORITY_CHANGED"}
        val client=ports.client(target);current();client.refresh();current();val approval=client.prepareDeviceAccess(request,fingerprint);current();val saved=store.load()?:error("E2EE_LOCAL_CONFLICT")
        check(same(saved.value.get("request"),request)&&saved.value.isNull("approval")){"E2EE_LOCAL_CONFLICT"}
        store.save(JSONObject(saved.value.toString()).put("approval",approval).put("complete",true),saved.serial);current();return inspect(id)
    }
    @Synchronized fun stageApproval(id:String,input:JSONObject):JSONObject {
        online();val store=store(id);val before=store.load()?:invalid();current();if(before.value.get("mode")!="request"||before.value.isNull("request"))invalid()
        val approval=approvalShape(input,before.value.getJSONObject("request"));if(!before.value.isNull("approval")){check(same(before.value.get("approval"),approval)){"E2EE_DEVICE_APPROVAL_CHANGED"};return before.value}
        store.save(JSONObject(before.value.toString()).put("approval",approval),before.serial);current();return inspect(id)
    }
    private fun verifyApproval(state:JSONObject):Triple<JSONObject,String,JSONObject> {
        check(!state.isNull("request")&&!state.isNull("approval")){"E2EE_DEVICE_APPROVAL_REQUIRED"}
        val target=E2eeDeviceAccessContract.target(ports.target(state.getJSONObject("target").getString("scopeId")));current();check(same(target,state.get("target"))){"E2EE_AUTHORITY_CHANGED"}
        val scopeId=target.getString("scopeId");val response=ports.directory(scopeId);current();val previous=account.device.savedDirectory(scopeId);current();val events=response.getJSONArray("events")
        val directory=E2eeDirectory.verify(target.getString("ownerId"),scopeId,target.getJSONObject("authority"),events,previous?.checkpoint);current()
        val packet=approvalShape(state.getJSONObject("approval"),state.getJSONObject("request"));val c=packet.getJSONObject("command");val hash=E2eeCommands.hash(c);val revision=E2eeCommands.integer(c.get("expectedRevision"))
        var granted=directory
        if(revision<events.length()){check(E2eeCommands.hash(events.getJSONObject(revision.toInt()).getJSONObject("command"))==hash){"E2EE_DIRECTORY_CONFLICT"}}
        else{check(directory.checkpoint.revision==revision&&directory.checkpoint.hash==c.get("checkpointHash")){"E2EE_DIRECTORY_CONFLICT"}
            granted=E2eeDirectory.verify(target.getString("ownerId"),scopeId,target.getJSONObject("authority"),JSONArray(events.toString()).put(packet),directory.checkpoint);current()}
        val own=granted.devices[account.device.deviceId];val keys=E2eeKeys.publicKeys(account.device.keys());current()
        check(granted.kind==target.get("kind")&&granted.resourceId==target.get("resourceId")&&own!=null&&!own.revoked&&own.userId==account.ownerId&&own.signingKey==keys.get("signingKey")&&own.receivingKey==keys.get("receivingKey")){"E2EE_REVOKED_DEVICE"}
        return Triple(packet,hash,target)
    }
    @Synchronized fun submit(id:String):JSONObject {
        online();val store=store(id);val before=store.load()?:invalid();current();if(before.value.get("mode")!="request")invalid();val(packet,hash,target)=verifyApproval(before.value);current()
        val result=ports.command(packet);current();E2eeKeys.exact(result,setOf("directoryRevision","checkpointHash"));val revision=E2eeCommands.integer(packet.getJSONObject("command").get("expectedRevision"))+1
        check(E2eeCommands.integer(result.get("directoryRevision"))==revision&&result.get("checkpointHash")==hash){"E2EE_INVALID_RECEIPT"}
        val response=ports.directory(target.getString("scopeId"));current();val directory=E2eeDirectory.verify(target.getString("ownerId"),target.getString("scopeId"),target.getJSONObject("authority"),response.getJSONArray("events"),E2eeDirectory.Checkpoint(revision,hash));current()
        val own=directory.devices[account.device.deviceId];check(own!=null&&!own.revoked&&own.userId==account.ownerId){"E2EE_REVOKED_DEVICE"};ports.open(target);current()
        val saved=store.load()?:error("E2EE_LOCAL_CONFLICT");check(same(saved.value.get("approval"),packet)){"E2EE_LOCAL_CONFLICT"}
        if(!saved.value.getBoolean("complete"))store.save(JSONObject(saved.value.toString()).put("complete",true),saved.serial);current();return inspect(id)
    }
    override fun toString()="E2eeDeviceAccess([redacted])"
}
