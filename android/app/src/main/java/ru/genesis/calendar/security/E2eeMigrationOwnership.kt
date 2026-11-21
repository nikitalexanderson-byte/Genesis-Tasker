package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest

/** Local preparation/request ownership only. Saved packets are original
 * material, never replay grants, response EOF proofs or activation receipts. */
internal object E2eeMigrationOwnership {
    class Expected(val migrationId:String,val target:E2eeSourceStage.Target,val actor:UnlockedE2eeVault.LocalIdentity,
        val sourceHash:String?,val lease:JSONObject?,val checkpointHash:String,val directoryRevision:Long)
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private val actions=setOf("legacy-workspace","legacy-aurora","legacy-stoicheion","legacy-advice","legacy-tasks",
        "legacy-diary","legacy-mindmaps","legacy-physis","legacy-reminders","legacy-archives")
    private fun invalid():Nothing=error("E2EE_CORRUPT_STREAMED_OWNERSHIP")
    private fun positive(value:Any)=E2eeCommands.integer(value,1)
    private fun fields(value:JSONObject,expected:Map<String,Any>){
        E2eeKeys.exact(value,expected.keys)
        if(expected.any{(key,item)->value.get(key)!=item})invalid()
    }
    fun validate(source:JSONObject,expected:Expected):JSONObject {
        val value=JSONObject(source.toString())
        E2eeKeys.exact(value,setOf("protocol","attemptId","sourceState","signer","securityEpoch","originals"))
        val protocol=E2eeCommands.integer(value.get("protocol"),1)
        if(protocol !in 1L..2L||!uuid.matches(value.getString("attemptId"))||!uuid.matches(expected.migrationId))invalid()
        val original=value.getJSONObject("sourceState");E2eeKeys.exact(original,setOf("objectId","hash","originalSerial"))
        if(original.get("objectId")!="${expected.migrationId}:preparation:3")invalid()
        E2eeEnvelope.decode(original.getString("hash"),32);positive(original.get("originalSerial"))
        E2eeEnvelope.decode(value.getString("signer"),91);positive(value.get("securityEpoch"))
        positive(expected.directoryRevision);E2eeEnvelope.decode(expected.checkpointHash,32)
        expected.sourceHash?.let{E2eeEnvelope.decode(it,32)}
        expected.lease?.let{lease->
            E2eeKeys.exact(lease,setOf("fence","generation","leaseUntil"));lease.keys().forEach{positive(lease.get(it))}
            if(expected.sourceHash==null)invalid()
        }
        val originals=value.getJSONArray("originals");if(originals.length()>1000||originals.length()>0&&(expected.lease==null||expected.sourceHash==null))invalid()
        val seen=mutableSetOf<String>()
        for(index in 0 until originals.length()){
            val owned=originals.getJSONObject(index);E2eeKeys.exact(owned,setOf("registration","packet")+(if(protocol==2L)setOf("completion")else emptySet()))
            val reg=owned.getJSONObject("registration");E2eeKeys.exact(reg,setOf("protocol","purpose","id","context","binding"))
            if(reg.get("protocol")!=1||reg.get("purpose")!="remote-original/v1"||!uuid.matches(reg.getString("id"))||!seen.add(reg.getString("id")))invalid()
            fields(reg.getJSONObject("context"),mapOf("ownerId" to expected.target.ownerId,"scopeId" to expected.target.scopeId,"kind" to expected.target.kind,
                "actorId" to expected.actor.ownerId,"actorScopeId" to expected.actor.scopeId,"deviceId" to expected.actor.deviceId))
            if(protocol==2L&&!owned.isNull("completion")){
                val ref=owned.getJSONObject("completion");E2eeKeys.exact(ref,setOf("id","manifestHash","rawHash","size"))
                if(ref.get("id")!=reg.get("id")||E2eeCommands.integer(ref.get("size"))>128L*1024*1024)invalid()
                E2eeEnvelope.decode(ref.getString("manifestHash"),32);E2eeEnvelope.decode(ref.getString("rawHash"),32)
            }
            val binding=reg.getJSONObject("binding");E2eeKeys.exact(binding,setOf("packetHash","signer","generation","migrationId","fence","sourceHash","action","directoryRevision","checkpointHash","securityEpoch"))
            val lease=expected.lease?:invalid()
            if(binding.get("signer")!=value.get("signer")||positive(binding.get("generation"))!=positive(lease.get("generation"))
                ||binding.get("migrationId")!=expected.migrationId||binding.get("sourceHash")!=expected.sourceHash
                ||positive(binding.get("directoryRevision"))!=expected.directoryRevision||binding.get("checkpointHash")!=expected.checkpointHash
                ||positive(binding.get("securityEpoch"))!=positive(value.get("securityEpoch"))||binding.get("action") !in actions)invalid()
            if(positive(binding.get("fence"))>positive(lease.get("fence")))invalid();E2eeEnvelope.decode(binding.getString("packetHash"),32)
            val packet=owned.getJSONObject("packet");E2eeKeys.exact(packet,setOf("command","signature"))
            val command=packet.getJSONObject("command");E2eeCommands.commandBytes(command).fill(0);E2eeEnvelope.decode(packet.getString("signature"),64)
            val payload=command.getJSONObject("payload")
            if(command.get("ownerId")!=expected.target.ownerId||command.get("scopeId")!=expected.target.scopeId||command.get("deviceId")!=expected.actor.deviceId
                ||command.get("action")!=binding.get("action")||E2eeCommands.integer(command.get("expectedRevision"))!=positive(binding.get("directoryRevision"))
                ||command.get("checkpointHash")!=binding.get("checkpointHash")||positive(command.get("securityEpoch"))!=positive(binding.get("securityEpoch"))
                ||payload.get("migrationId")!=binding.get("migrationId")||positive(payload.get("fence"))!=positive(binding.get("fence"))||payload.get("sourceHash")!=binding.get("sourceHash"))invalid()
            val bytes=E2eeCommands.canonical(packet)
            try{if(bytes.size>128*1024||E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))!=binding.get("packetHash"))invalid()}finally{bytes.fill(0)}
        }
        return value
    }
}
