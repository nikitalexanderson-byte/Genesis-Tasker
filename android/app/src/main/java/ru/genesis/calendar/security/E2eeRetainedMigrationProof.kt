package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.security.MessageDigest
import java.security.PublicKey
import javax.crypto.SecretKey

/** Read-only original-actor evidence. No packet in this module is replayed,
 * and a readable source never authorizes discarding a preceding content plan. */
internal object E2eeRetainedMigrationProof {
    private fun invalid():Nothing=error("E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED")
    private fun number(value:JSONObject,key:String,min:Long=0)=E2eeCommands.integer(value.get(key),min)
    fun same(a:Any,b:Any):Boolean {val left=E2eeCommands.canonical(a);val right=E2eeCommands.canonical(b);return try{left.contentEquals(right)}finally{left.fill(0);right.fill(0)}}
    fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    fun rows(value:JSONArray):List<JSONObject>=(0 until value.length()).map{value.getJSONObject(it)}
    fun strings(value:JSONArray):List<String>=(0 until value.length()).map{value.getString(it)}
    fun anchor(state:JSONObject):E2eeDirectory.Checkpoint {
        val pin=if(number(state,"protocol")==5L)state.getJSONObject("adopted")else state
        return E2eeDirectory.Checkpoint(number(pin,"directoryRevision",1),pin.getString("checkpointHash"))
    }
    fun binding(state:JSONObject):JSONArray=JSONArray().put(state.get("migrationId")).put(state.get("ancestors")).put(
        if(number(state,"protocol")>=3L)state.get("source")else JSONObject().put("parts",state.get("snapshotParts")).put("size",state.get("snapshotSize")).put("hash",state.get("snapshotHash")))
    fun drain(input:InputStream,current:()->Unit){val buffer=ByteArray(E2eeFiles.CHUNK_BYTES);try{while(true){current();val count=input.read(buffer);if(count<0)break;buffer.fill(0,0,count)};current()}finally{buffer.fill(0)}}
    fun controls(state:JSONObject,frame:E2eeDirectory.Verified,actor:UnlockedE2eeVault.LocalIdentity,current:()->Unit):PublicKey {
        current();val own=frame.devices[actor.deviceId]?:invalid();if(own.revoked||own.role!="owner"||own.userId!=actor.ownerId)invalid()
        val signer=E2eeDirectory.signingKey(own.signingKey);val lease=if(state.isNull("lease"))null else state.getJSONObject("lease")
        if(!state.isNull("sourceHash"))E2eeEnvelope.decode(state.getString("sourceHash"),32)
        lease?.let{E2eeKeys.exact(it,setOf("fence","leaseUntil","generation"));listOf("fence","leaseUntil","generation").forEach{key->number(it,key,1)};if(state.isNull("sourceHash"))invalid()}
        for(name in listOf("pending","resuming","cancelReceipt")){
            val packet=if(name=="cancelReceipt"){if(!state.has(name))null else state.getJSONObject(name).getJSONObject("packet")}else {if(state.isNull(name))null else state.getJSONObject(name)}
            if(packet==null)continue
            val command=E2eeCommands.verify(packet,signer);current();val payload=command.getJSONObject("payload")
            if(command.get("ownerId")!=frame.ownerId||command.get("scopeId")!=frame.scopeId||command.get("deviceId")!=actor.deviceId
                ||number(command,"expectedRevision")!=frame.checkpoint.revision||command.get("checkpointHash")!=frame.checkpoint.hash||number(command,"securityEpoch",1)!=frame.securityEpoch
                ||payload.get("migrationId")!=state.get("migrationId"))invalid()
            val action=command.getString("action")
            if(name=="resuming"){
                E2eeKeys.exact(payload,setOf("migrationId","fence","sourceHash","pendingOperationId","pendingHash"));val pending=state.optJSONObject("pending")?.getJSONObject("command")
                if(action!="migration-resume"||lease==null||number(payload,"fence",1)!=number(lease,"fence",1)||payload.get("sourceHash")!=state.get("sourceHash")
                    ||(if(pending==null)!payload.isNull("pendingOperationId")||!payload.isNull("pendingHash")else payload.get("pendingOperationId")!=pending.get("operationId")||payload.get("pendingHash")!=E2eeCommands.hash(pending)))invalid()
            }else if(action=="migration-cancel"){
                E2eeKeys.exact(payload,setOf("migrationId","fence"));if(lease==null)invalid();val fence=number(payload,"fence",1);val active=number(lease,"fence",1)
                if(fence>active||fence<active-(if(name=="cancelReceipt")1 else 0))invalid()
            }else if(name=="cancelReceipt")invalid()
            else if(action=="migration-start"){
                E2eeKeys.exact(payload,setOf("migrationId","sourceHash"));if(lease!=null||payload.get("sourceHash")!=state.get("sourceHash"))invalid()
            }else if(action=="put"){
                E2eeKeys.exact(payload,setOf("envelope","expectedObjectRevision","migrationId","fence"));val plan=state.getJSONArray("plan");val index=number(state,"uploaded").toInt()
                if(lease==null||index>=plan.length()||number(payload,"fence",1)!=number(lease,"fence",1)||number(payload,"expectedObjectRevision")!=0L)invalid()
                val item=plan.getJSONObject(index);val envelope=E2eeEnvelope.Envelope.fromJson(payload.getJSONObject("envelope"));val context=envelope.context.toJson()
                if(context.get("operationId")!=command.get("operationId")||context.get("ownerId")!=frame.ownerId||context.get("scopeId")!=frame.scopeId||context.get("deviceId")!=actor.deviceId
                    ||context.get("domain")!=item.get("domain")||context.get("objectId")!=item.get("objectId")||E2eeEnvelope.payloadHash(envelope)!=item.get("hash"))invalid()
            }else if(action in setOf("migration-verify","migration-commit")){
                E2eeKeys.exact(payload,setOf("migrationId","fence","manifestHash","objectCount","verifiedCheckpoint")+(if(action=="migration-commit")setOf("generation")else emptySet()))
                if(lease==null||number(payload,"fence",1)!=number(lease,"fence",1)||payload.get("manifestHash")!=state.get("manifestHash")||number(payload,"objectCount")!=state.getJSONArray("plan").length().toLong()
                    ||state.isNull("verifiedCheckpoint")||payload.get("verifiedCheckpoint")!=state.get("verifiedCheckpoint")||action=="migration-commit"&&number(payload,"generation",1)!=number(lease,"generation",1))invalid()
            }else invalid()
            if(number(state,"protocol")==4L&&name=="pending"&&action !in setOf("migration-start","migration-cancel"))invalid()
        }
        if(lease==null&&(!state.isNull("resuming")||!state.isNull("sourceHash")&&state.isNull("pending"))
            ||state.get("phase") in setOf("active","cancelled")&&(!state.isNull("pending")||!state.isNull("resuming")))invalid()
        if(state.has("cancelReceipt")){val result=state.getJSONObject("cancelReceipt").getJSONObject("result");E2eeKeys.exact(result,setOf("state"));if(state.get("phase")!="cancelled"||result.get("state")!="preparing")invalid()}
        return signer
    }
    fun legacyPlan(vault:E2eeSourceReadVault,target:E2eeSourceStage.Target,state:JSONObject,frame:E2eeDirectory.Verified,root:SecretKey,inventory:E2eePrivatePaths,current:()->Unit){
        current();if(number(state,"protocol") !in setOf(1L,2L))invalid();val migration=state.getString("migrationId");val own=frame.devices[vault.localIdentity().deviceId]?:invalid()
        val signer=E2eeDirectory.signingKey(own.signingKey);val allowed=inventory.required(target.kind).flatMap{it.domains}.toSet()
        val plan=rows(state.getJSONArray("plan"));val logical=rows(state.getJSONArray("logical"));val local=if(number(state,"protocol")==1L)emptyList()else E2eeMigrationLocal.validate(state.getJSONArray("local"),migration,allowed)
        val planned=if(number(state,"protocol")==1L)plan.isNotEmpty()else state.getBoolean("planned")
        if(plan.size>8000||logical.size+local.size>10000||!planned&&(plan.isNotEmpty()||logical.isNotEmpty()||local.isNotEmpty())||planned&&state.isNull("lease"))invalid()
        val records=mutableMapOf<String,JSONObject>();val used=mutableSetOf<String>();val names=mutableSetOf<String>()
        for((index,item)in plan.withIndex()){
            E2eeKeys.exact(item,setOf("recordId","domain","objectId","hash"));E2eeKeys.technical(item.getString("objectId"));E2eeEnvelope.decode(item.getString("hash"),32)
            if(item.get("recordId")!="$migration:upload:$index"||item.get("domain") !in allowed||records.put(item.getString("domain")+"\u0000"+item.getString("objectId"),item)!=null)invalid()
        }
        fun load(item:JSONObject):E2eeEnvelope.Envelope {
            current();val row=vault.read("outbox",item.getString("recordId"))?:invalid()
            try{current();if(row.serial!=1L)invalid();val envelope=E2eeEnvelope.Envelope.fromJson(E2eeFileManifestJson.readMigrationHistory(row.bytes));val ctx=envelope.context.toJson()
                if(ctx.get("ownerId")!=target.ownerId||ctx.get("scopeId")!=target.scopeId||ctx.get("deviceId")!=own.deviceId||ctx.get("domain")!=item.get("domain")||ctx.get("objectId")!=item.get("objectId")
                    ||number(ctx,"schemaVersion",1)!=1L||number(ctx,"writerProtocol",1)!=9L||number(ctx,"dataGeneration",1)!=number(state.getJSONObject("lease"),"generation",1)
                    ||number(ctx,"cryptoEpoch",1)!=frame.cryptoEpoch||number(ctx,"securityEpoch",1)!=frame.securityEpoch||ctx.get("keyId")!=frame.keyId||number(ctx,"revision",1)!=1L||E2eeEnvelope.payloadHash(envelope)!=item.get("hash"))invalid();current();return envelope
            }finally{row.bytes.fill(0)}
        }
        for(item in logical){
            E2eeKeys.exact(item,setOf("domain","objectId","plaintextHash","size"));val domain=item.getString("domain");val id=E2eeKeys.technical(item.getString("objectId"));val size=number(item,"size");E2eeEnvelope.decode(item.getString("plaintextHash"),32)
            if(domain !in allowed||size>E2eeFiles.MAX_FILE_BYTES||domain=="shared-comment"&&size>65536||!names.add("$domain\u0000$id"))invalid()
            val descriptor=records["$domain\u0000$id"]?:invalid();val manifest=load(descriptor);val hash=MessageDigest.getInstance("SHA-256");var actual=0L
            if(domain=="shared-comment"){val bytes=E2eeEnvelope.open(root,signer,manifest.context,manifest);try{current();hash.update(bytes);actual=bytes.size.toLong()}finally{bytes.fill(0)}}
            else E2eeFiles.openStream(root,signer,manifest.context,manifest,{objectId->val chunk=records["attachment\u0000$objectId"]?:invalid();if(!used.add(chunk.getString("recordId")))invalid();load(chunk)},current){bytes->current();actual+=bytes.size;hash.update(bytes)}
            if(actual!=size||E2eeEnvelope.encode(hash.digest())!=item.get("plaintextHash")||!used.add(descriptor.getString("recordId")))invalid();current()
        }
        if(used.size!=plan.size)invalid()
        fun exact(domain:String,prefix:String,expected:List<String>){val actual=vault.listLocal(domain,prefix);current();if(actual.sorted()!=expected.sorted())invalid()}
        exact("outbox","$migration:",plan.map{it.getString("recordId")});exact("local-snapshot","$migration:private:",local.flatMap{item->(0 until item.parts).map{"${item.recordId}:$it"}})
        for(item in local){if(!names.add(item.domain+"\u0000"+item.objectId))invalid();val hash=MessageDigest.getInstance("SHA-256");var size=0
            for(at in 0 until item.parts){current();val row=vault.read("local-snapshot","${item.recordId}:$at")?:invalid();try{current();if(row.serial!=1L||row.bytes.size!=minOf(E2eeFiles.CHUNK_BYTES,item.size-size))invalid();size+=row.bytes.size;hash.update(row.bytes)}finally{row.bytes.fill(0)}}
            if(size!=item.size||E2eeEnvelope.encode(hash.digest())!=item.plaintextHash)invalid()
        }
        if(!state.isNull("manifestHash")){val heads=JSONArray();plan.forEach{item->heads.put(JSONObject().put("domain",item.get("domain")).put("objectId",item.get("objectId")).put("revision",1).put("payloadHash",item.get("hash")))};if(E2eeFiles.objectManifestHash(heads)!=state.get("manifestHash"))invalid()}
        if(!state.isNull("verifiedCheckpoint"))E2eeEnvelope.decode(state.getString("verifiedCheckpoint"),32)
    }
}
