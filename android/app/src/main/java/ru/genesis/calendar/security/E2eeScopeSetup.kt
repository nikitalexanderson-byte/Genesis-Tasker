package ru.genesis.calendar.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import javax.crypto.SecretKey

internal interface E2eeScopeSetupTransport{
    suspend fun bootstrap(packet:JSONObject):JSONObject
    suspend fun directory(scopeId:String):JSONObject
}
/** Initial owner-signed scope setup, separate from identity and subsequent
 * complete-source migration. All retries retain one independent random root
 * in one immutable signed packet; its raw bytes never enter storage or HTTP. */
internal class E2eeScopeSetup(private val device:UnlockedE2eeDevice,target:JSONObject,private val transport:E2eeScopeSetupTransport,private val current:()->Unit){
    private val target=JSONObject(target.toString());private val mutex=Mutex()
    init{E2eeKeys.exact(this.target,setOf("ownerId","scopeId","kind","resourceId"));for(name in listOf("ownerId","scopeId","resourceId"))E2eeKeys.technical(this.target.getString(name))
        check(this.target.getString("ownerId")==device.ownerId&&this.target.getString("kind") in setOf("personal","project","space")&&(this.target.getString("kind")!="personal"||this.target.getString("resourceId")==device.ownerId)){"E2EE_SCOPE_BINDING_MISMATCH"}}
    private fun check(){device.requireOpen();current()}
    private fun store()=E2eeDeviceDocument(device,"scope-bootstrap:${target.getString("scopeId")}",{value->E2eeKeys.exact(value,setOf("protocol","target","packet","complete"));check(value.getInt("protocol")==1&&E2eeProductJson.same(value.getJSONObject("target"),target)&&value.get("complete") is Boolean){"E2EE_SCOPE_SETUP_INVALID"};JSONObject(value.toString())},::check)
    private fun verify(packet:JSONObject):JSONObject{
        val command=E2eeCommands.verify(packet,E2eeDirectory.signingKey(device.authorityPin.getString("signingKey")));check();val payload=command.getJSONObject("payload")
        check(command.getString("action")=="bootstrap"&&command.getString("ownerId")==device.ownerId&&command.getString("scopeId")==target.getString("scopeId")&&command.getString("deviceId")==device.deviceId
            &&command.getLong("expectedRevision")==0L&&command.getString("checkpointHash")=="genesis"&&command.getLong("securityEpoch")==1L&&payload.getString("kind")==target.getString("kind")&&payload.getString("resourceId")==target.getString("resourceId")
            &&E2eeProductJson.same(payload.getJSONObject("deviceKeys"),E2eeKeys.publicKeys(device.keys()))&&E2eeProductJson.same(payload.getJSONObject("recoveryKit").getJSONObject("authority"),device.authorityPin)){"E2EE_SCOPE_SETUP_INVALID"}
        val self=JSONObject(command.toString());self.getJSONObject("payload").remove("selfProof");E2eeCommands.verify(JSONObject().put("command",self).put("signature",payload.getString("selfProof")),device.keys().signing.public);check();return command
    }
    suspend fun prepare(secret:ByteArray,savedKit:JSONObject,sourceGeneration:Long):JSONObject{
        val held=secret.copyOf();val kit=JSONObject(savedKit.toString())
        try{return withContext(Dispatchers.IO){mutex.withLock{
            check();val authority=E2eeKeys.recoverAuthority(device.ownerId,held,kit);check();check(E2eeProductJson.same(kit.getJSONObject("authority"),device.authorityPin)){"E2EE_AUTHORITY_CHANGED"}
            val document=store();val prior=document.load();if(prior!=null){val packet=prior.value.getJSONObject("packet");verify(packet);check(E2eeProductJson.same(packet.getJSONObject("command").getJSONObject("payload").getJSONObject("recoveryKit"),kit)){"E2EE_AUTHORITY_CHANGED"};return@withLock JSONObject(packet.toString())}
            check(sourceGeneration in 0 until 9_007_199_254_740_991L){"E2EE_INVALID_GENERATION"};device.ensureDurableKeys();check();val raw=E2eeKeys.freshSecret()
            try{val keys=E2eeKeys.publicKeys(device.keys());val keyId="root:${UUID.randomUUID()}";val scopeId=target.getString("scopeId")
                val payload=JSONObject().put("kind",target.get("kind")).put("resourceId",target.get("resourceId")).put("keyId",keyId).put("generation",sourceGeneration+1).put("recoveryKit",kit).put("deviceKeys",keys)
                    .put("deviceCapsule",E2eeKeys.sealRoot(raw,keys.getString("receivingKey"),E2eeKeys.RootRecipient(device.ownerId,scopeId,1,keyId,device.deviceId)))
                    .put("recoveryCapsule",E2eeKeys.sealRoot(raw,kit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient(device.ownerId,scopeId,1,keyId,"recovery")))
                val command=JSONObject().put("protocol",1).put("ownerId",device.ownerId).put("scopeId",scopeId).put("deviceId",device.deviceId).put("action","bootstrap").put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId",UUID.randomUUID().toString()).put("payload",payload)
                payload.put("selfProof",E2eeCommands.sign(command,device.keys().signing.private).getString("signature"));val packet=E2eeCommands.sign(command,authority.signing.private);verify(packet)
                val plan=JSONObject().put("protocol",1).put("target",target).put("packet",packet).put("complete",false);document.save(plan,null);check();check(E2eeProductJson.same(document.load()?.value,plan)){"E2EE_SCOPE_SETUP_UNVERIFIED"};JSONObject(packet.toString())
            }finally{raw.fill(0)}
        }}}finally{held.fill(0)}
    }
    suspend fun submit():E2eeDirectory.Verified=withContext(Dispatchers.IO){mutex.withLock{
        check();val document=store();val saved=document.load()?:error("E2EE_SCOPE_SETUP_REQUIRED");val packet=saved.value.getJSONObject("packet");verify(packet);var failure:Exception?=null
        if(!saved.value.getBoolean("complete"))try{transport.bootstrap(JSONObject(packet.toString()))}catch(cancel:kotlinx.coroutines.CancellationException){throw cancel}catch(error:Exception){failure=error};check()
        val response=try{transport.directory(target.getString("scopeId"))}catch(cancel:kotlinx.coroutines.CancellationException){throw cancel}catch(error:Exception){throw failure?:error};check();val events=response.getJSONArray("events");val directory=E2eeDirectory.verify(device.ownerId,target.getString("scopeId"),device.authorityPin,events);check()
        check(events.length()>0&&E2eeCommands.hash(events.getJSONObject(0).getJSONObject("command"))==E2eeCommands.hash(packet.getJSONObject("command"))&&directory.kind==target.getString("kind")&&directory.resourceId==target.getString("resourceId")){"E2EE_SCOPE_SETUP_UNVERIFIED"}
        val own=directory.devices[device.deviceId];check(own!=null&&!own.revoked&&own.userId==device.ownerId&&own.role=="owner"){"E2EE_REVOKED_DEVICE"}
        device.rememberDirectory(target.getString("scopeId"),device.authorityPin,events,device.ownerId);check();if(!saved.value.getBoolean("complete"))document.save(JSONObject(saved.value.toString()).put("complete",true),saved.serial);check();directory
    }}
    companion object{
        fun recoverRoot(directory:E2eeDirectory.Verified,secret:ByteArray,kit:JSONObject,current:()->Unit):SecretKey{
            val held=secret.copyOf();try{current();val authority=E2eeKeys.recoverAuthority(directory.ownerId,held,kit);current();check(E2eeProductJson.same(kit.getJSONObject("authority"),directory.recoveryKit.getJSONObject("authority"))){"E2EE_AUTHORITY_CHANGED"}
                return E2eeKeys.openRoot(directory.recoveryCapsule,authority.receiving,E2eeKeys.RootRecipient(directory.ownerId,directory.scopeId,directory.cryptoEpoch,directory.keyId,"recovery")).also{current()}
            }finally{held.fill(0)}
        }
        fun verifyRecovery(device:UnlockedE2eeDevice,directory:E2eeDirectory.Verified,root:SecretKey,secret:ByteArray,kit:JSONObject,current:()->Unit){
            val probe=E2eeKeys.freshSecret();var opened:ByteArray?=null
            try{device.requireOpen();current();val recovered=recoverRoot(directory,secret,kit,current);device.requireOpen();current()
                val context=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE)
                    .put("ownerId",directory.ownerId).put("scopeId",directory.scopeId).put("domain","key-check").put("objectId","recovery-probe:${UUID.randomUUID()}")
                    .put("schemaVersion",1).put("dataGeneration",directory.generation).put("writerProtocol",9).put("cryptoEpoch",directory.cryptoEpoch)
                    .put("securityEpoch",directory.securityEpoch).put("revision",1).put("keyId",directory.keyId).put("deviceId",device.deviceId).put("operationId",UUID.randomUUID().toString()))
                val envelope=E2eeEnvelope.seal(root,device.keys().signing.private,context,probe);device.requireOpen();current()
                opened=E2eeEnvelope.open(recovered,device.keys().signing.public,context,envelope);device.requireOpen();current()
                check(opened.contentEquals(probe)){"E2EE_RECOVERY_UNVERIFIED"}
            }finally{probe.fill(0);opened?.fill(0)}
        }
    }
    override fun toString()="E2eeScopeSetup([redacted])"
}
