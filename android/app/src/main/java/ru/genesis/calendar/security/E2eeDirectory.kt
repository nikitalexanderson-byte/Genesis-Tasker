package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/** Verifies signed directory history from an independently pinned authority/checkpoint.
 * Does not grant trust to server-supplied booleans, devices arrays or fresh account login.
 */
object E2eeDirectory {
    data class Checkpoint(val revision: Long, val hash: String)
    data class SealedHeads(val cryptoEpoch:Long,val hash:String,val count:Int)
    class HistoricalRoot(val cryptoEpoch:Long,val keyId:String,val capsule:JSONObject)
    class Device(val deviceId: String, val userId: String, var role: String, val signingKey: String, val receivingKey: String,
        var revoked: Boolean, var capsule: JSONObject,val historyCapsules:MutableList<HistoricalRoot> = mutableListOf()) {
        override fun toString() = "E2eeDirectory.Device([redacted])"
    }
    class Verified(val ownerId: String, val scopeId: String, val resourceId: String, val kind: String,
        var cryptoEpoch: Long, var securityEpoch: Long, var keyId: String, var generation: Long, var state: String,
        var checkpoint: Checkpoint, val recoveryKit: JSONObject, var recoveryCapsule: JSONObject, val devices: MutableMap<String,Device>,var sealedHeads:SealedHeads?=null) {
        override fun toString() = "E2eeDirectory.Verified([redacted])"
    }
    private fun trust(condition: Boolean) { if (!condition) throw IllegalStateException("E2EE_UNTRUSTED_DIRECTORY") }
    private fun technical(source: JSONObject, field: String): String = (source.get(field) as? String)?.let(E2eeKeys::technical)
        ?: throw IllegalStateException("E2EE_UNTRUSTED_DIRECTORY")
    private fun detachedFrame(value:Verified):Verified = Verified(value.ownerId,value.scopeId,value.resourceId,value.kind,value.cryptoEpoch,value.securityEpoch,
        value.keyId,value.generation,value.state,value.checkpoint,JSONObject(value.recoveryKit.toString()),JSONObject(value.recoveryCapsule.toString()),
        value.devices.mapValues{(_,device)->Device(device.deviceId,device.userId,device.role,device.signingKey,device.receivingKey,device.revoked,
            JSONObject(device.capsule.toString()),device.historyCapsules.map{grant->HistoricalRoot(grant.cryptoEpoch,grant.keyId,JSONObject(grant.capsule.toString()))}.toMutableList())}.toMutableMap(),value.sealedHeads)
    fun signingKey(spki: String): PublicKey = KeyFactory.getInstance("EC")
        .generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(spki,91))).also(E2eeEnvelope::assertP256)
    fun contentSigningKey(directory:Verified,context:JSONObject):PublicKey {
        trust(context.get("domain")!="shared-comment"||E2eeCommands.integer(context.get("revision"),1)==1L)
        trust(context.get("ownerId")==directory.ownerId&&context.get("scopeId")==directory.scopeId
            &&E2eeCommands.integer(context.get("cryptoEpoch"),1)==directory.cryptoEpoch
            &&E2eeCommands.integer(context.get("securityEpoch"),1)==directory.securityEpoch
            &&context.get("keyId")==directory.keyId&&E2eeCommands.integer(context.get("dataGeneration"),1)==directory.generation)
        val device=directory.devices[context.getString("deviceId")];val domain=context.getString("domain")
        trust(device!=null&&!device.revoked&&(device.role in setOf("owner","writer")||device.role=="commenter"&&domain=="shared-comment"))
        trust(if(directory.kind=="personal")domain !in setOf("shared-project","shared-comment")
            else domain in setOf("shared-project","shared-comment","mindmap","attachment","key-check"))
        return signingKey(requireNotNull(device).signingKey)
    }
    /** Old keys authenticate only heads sealed by the most recent owner rotation.
     * Verify the envelope signature separately with its historical signed roster. */
    fun verifyHistoricalHead(current:Verified,envelope:E2eeEnvelope.Envelope,heads:JSONArray) {
        val ctx=envelope.context.toJson();trust(ctx.get("ownerId")==current.ownerId&&ctx.get("scopeId")==current.scopeId)
        val epoch=E2eeCommands.integer(ctx.get("cryptoEpoch"),1);if(epoch==current.cryptoEpoch)return
        val sealed=current.sealedHeads;trust(sealed!=null&&epoch<=sealed.cryptoEpoch)
        trust(heads.length()==sealed!!.count&&E2eeFiles.objectManifestHash(heads)==sealed.hash)
        val hash=E2eeEnvelope.payloadHash(envelope)
        trust((0 until heads.length()).any{heads.getJSONObject(it).let{head->head.get("domain")==ctx.get("domain")&&head.get("objectId")==ctx.get("objectId")
            &&E2eeCommands.integer(head.get("revision"),1)==E2eeCommands.integer(ctx.get("revision"),1)&&head.get("payloadHash")==hash}})
    }
    fun verify(ownerId: String, scopeId: String, pinnedAuthority: JSONObject, sourceEvents: JSONArray, previous: Checkpoint? = null,
        onVerified:((Verified)->Unit)?=null): Verified {
        E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId);E2eeKeys.exact(pinnedAuthority,setOf("signingKey","receivingKey"))
        trust(sourceEvents.length() in 1..2048)
        val events=JSONArray(sourceEvents.toString());val pin=JSONObject(pinnedAuthority.toString());val authority=signingKey(pin.getString("signingKey"))
        var directory: Verified?=null;var checkedPrevious=previous==null
        val epochs=mutableMapOf<Long,String>()
        for(index in 0 until events.length()) {
            val packet=events.getJSONObject(index);val command=packet.getJSONObject("command");E2eeCommands.commandBytes(command)
            trust(command.get("ownerId")==ownerId && command.get("scopeId")==scopeId)
            val payload=command.getJSONObject("payload")
            val current=directory
            if(current==null) {
                trust(command.get("action")=="bootstrap" && E2eeCommands.integer(command.get("expectedRevision"))==0L
                    && command.get("checkpointHash")=="genesis" && E2eeCommands.integer(command.get("securityEpoch"))==1L)
                E2eeCommands.verify(packet,authority)
                val kit=payload.getJSONObject("recoveryKit");val kitAuthority=kit.getJSONObject("authority")
                trust(kit.get("ownerId")==ownerId && E2eeCommands.integer(kit.get("protocol"))==1L
                    && kitAuthority.get("signingKey")==pin.get("signingKey") && kitAuthority.get("receivingKey")==pin.get("receivingKey"))
                val keys=payload.getJSONObject("deviceKeys");val self=JSONObject(command.toString());self.getJSONObject("payload").remove("selfProof")
                E2eeCommands.verify(JSONObject().put("command",self).put("signature",payload.get("selfProof")),signingKey(keys.getString("signingKey")))
                val kind=payload.getString("kind");trust(kind in setOf("personal","project","space"))
                val deviceId=technical(command,"deviceId")
                directory=Verified(ownerId,scopeId,technical(payload,"resourceId"),kind,1,1,technical(payload,"keyId"),
                    E2eeCommands.integer(payload.get("generation"),1),"preparing",Checkpoint(1,E2eeCommands.hash(command)),kit,payload.getJSONObject("recoveryCapsule"),
                    mutableMapOf(deviceId to Device(deviceId,ownerId,"owner",keys.getString("signingKey"),keys.getString("receivingKey"),false,payload.getJSONObject("deviceCapsule"))))
                epochs[1L]=technical(payload,"keyId")
            } else {
                trust(E2eeCommands.integer(command.get("expectedRevision"))==current.checkpoint.revision && command.get("checkpointHash")==current.checkpoint.hash
                    && E2eeCommands.integer(command.get("securityEpoch"))==current.securityEpoch)
                val signerId=command.getString("deviceId");val device=current.devices[signerId]
                trust(signerId=="recovery" || device!=null&&!device.revoked&&device.userId==ownerId&&device.role=="owner")
                E2eeCommands.verify(packet,if(signerId=="recovery")authority else signingKey(requireNotNull(device).signingKey))
                when(command.getString("action")) {
                    "enroll" -> {
                        val challenge=payload.getJSONObject("challenge");val deviceId=technical(challenge,"deviceId");val userId=technical(challenge,"userId")
                        trust(challenge.get("scopeId")==scopeId && !current.devices.containsKey(deviceId) && (current.kind!="personal" || userId==ownerId))
                        val role=challenge.getString("role");trust(role in setOf("owner","writer","commenter","reader") && (role=="owner")== (userId==ownerId))
                        val grants=payload.getJSONArray("historyCapsules");trust(grants.length()==epochs.size-1);val known=mutableSetOf<Long>()
                        val history=mutableListOf<HistoricalRoot>()
                        for(position in 0 until grants.length()) {
                            val grant=grants.getJSONObject(position);val epoch=E2eeCommands.integer(grant.get("cryptoEpoch"),1);val keyId=technical(grant,"keyId")
                            trust(epoch<current.cryptoEpoch&&known.add(epoch)&&epochs[epoch]==keyId);history.add(HistoricalRoot(epoch,keyId,grant.getJSONObject("capsule")))
                        }
                        val signing=challenge.getString("signingKey");val receiving=challenge.getString("receivingKey");E2eeEnvelope.decode(receiving,65)
                        val proof="GENESIS-E2EE-ENROLLMENT\u0000v1\u0000".toByteArray()+E2eeCommands.canonical(challenge)
                        trust(Signature.getInstance("SHA256withECDSA").run {initVerify(signingKey(signing));update(proof);verify(E2eeEnvelope.p1363ToDer(E2eeEnvelope.decode(payload.getString("selfProof"),64)))})
                        current.devices[deviceId]=Device(deviceId,userId,role,signing,receiving,false,payload.getJSONObject("capsule"),history)
                    }
                    "rotate", "rotate-membership" -> {
                        val retiredHash=payload.getString("retiredManifestHash");E2eeEnvelope.decode(retiredHash,32)
                        val retiredCount=E2eeCommands.integer(payload.get("retiredObjectCount"));trust(retiredCount<=10000)
                        current.sealedHeads=SealedHeads(current.cryptoEpoch,retiredHash,retiredCount.toInt())
                        val cryptoEpoch=E2eeCommands.integer(payload.get("cryptoEpoch"),1);val securityEpoch=E2eeCommands.integer(payload.get("securityEpoch"),1)
                        val keyId=technical(payload,"keyId");trust(cryptoEpoch==current.cryptoEpoch+1 && securityEpoch==current.securityEpoch+1 && !epochs.containsValue(keyId))
                        val revoked=payload.getJSONArray("revokedDeviceIds")
                        for(position in 0 until revoked.length()) {val id=revoked.getString(position);val target=current.devices[id];trust(target!=null&&!target.revoked);target!!.revoked=true}
                        val capsules=payload.getJSONArray("capsules");val updated=mutableSetOf<String>()
                        for(position in 0 until capsules.length()) {
                            val entry=capsules.getJSONObject(position);val id=technical(entry,"deviceId");val target=current.devices[id]
                            trust(target!=null&&!target.revoked&&updated.add(id));target!!.historyCapsules.add(HistoricalRoot(current.cryptoEpoch,current.keyId,target.capsule));target.capsule=entry.getJSONObject("capsule")
                        }
                        trust(current.devices.values.all {it.revoked || it.deviceId in updated})
                        if(command.getString("action")=="rotate-membership"){
                            E2eeEnvelope.decode(payload.getString("membershipHash"),32);val changes=payload.getJSONArray("roleChanges");trust(changes.length()==updated.size);val changed=mutableSetOf<String>()
                            for(at in 0 until changes.length()){val row=changes.getJSONObject(at);E2eeKeys.exact(row,setOf("deviceId","role"));val id=technical(row,"deviceId");val target=current.devices[id];val role=row.getString("role")
                                trust(id in updated&&changed.add(id)&&target!=null&&role in setOf("owner","writer","commenter","reader")&&(role=="owner")== (target!!.userId==ownerId));target!!.role=role}
                        }
                        current.cryptoEpoch=cryptoEpoch;current.securityEpoch=securityEpoch;current.keyId=keyId;current.recoveryCapsule=payload.getJSONObject("recoveryCapsule")
                        epochs[cryptoEpoch]=keyId
                    }
                    "migration-commit" -> {trust(current.state=="preparing");val generation=E2eeCommands.integer(payload.get("generation"),1);trust(generation>=current.generation)
                        val hash=payload.getString("manifestHash");E2eeEnvelope.decode(hash,32);val count=E2eeCommands.integer(payload.get("objectCount"));trust(count<=10000)
                        current.sealedHeads=SealedHeads(0,hash,count.toInt());current.state="active";current.generation=generation}
                    else -> trust(false)
                }
                val digest=MessageDigest.getInstance("SHA-256").digest((current.checkpoint.hash+"\u0000"+E2eeCommands.hash(command)).toByteArray())
                current.checkpoint=Checkpoint(current.checkpoint.revision+1,E2eeEnvelope.encode(digest))
            }
            val checkpoint=requireNotNull(directory).checkpoint
            if(previous?.revision==checkpoint.revision){trust(previous.hash==checkpoint.hash);checkedPrevious=true}
            // Detached provisional history frame. Final chain verification,
            // the saved checkpoint and durable CAS still must succeed.
            onVerified?.invoke(detachedFrame(requireNotNull(directory)))
        }
        trust(checkedPrevious);return requireNotNull(directory)
    }
}
