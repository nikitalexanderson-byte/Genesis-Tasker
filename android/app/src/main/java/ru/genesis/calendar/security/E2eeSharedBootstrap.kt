package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Native counterpart of the durable owner baseline. Every part is protected
 * before network mutation; partial staging cannot become an empty live index. */
internal class E2eeSharedBootstrap(private val account:E2eeProductAccount,private val records:E2eeSharedRecords){
    private val binding=records.domain
    private val key="product-bootstrap:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(binding.scopeId.toByteArray(Charsets.UTF_8)))
    private fun current(){account.requireOpen()}
    private fun scope()=account.sharedScope(binding.scopeId,binding.scopeKind,binding.resourceId)
    private val journal=E2eeDeviceDocument(account.device,key,{value->
        E2eeKeys.exact(value,setOf("protocol","scopeId","bootstrapId","sourceManifestHash","expectedCount","startIntentId","completeIntentId","parts","phase"));check(value.getInt("protocol")==1&&value.getString("scopeId")==binding.scopeId&&value.getInt("expectedCount") in 1..10000&&value.getString("phase") in setOf("preparing","ready","active")){"E2EE_PRODUCT_BOOTSTRAP_INVALID"}
        for(name in listOf("bootstrapId","startIntentId","completeIntentId"))E2eeKeys.technical(value.getString(name));E2eeEnvelope.decode(value.getString("sourceManifestHash"),32);val parts=value.getJSONArray("parts");check(parts.length() in 1..256);val seen=mutableSetOf<String>();var count=0
        for(at in 0 until parts.length()){val part=parts.getJSONObject(at);E2eeKeys.exact(part,setOf("id","count"));check(seen.add(E2eeKeys.technical(part.getString("id")))&&part.getInt("count") in 1..100){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};count+=part.getInt("count")};check(count==value.getInt("expectedCount")){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};value},::current)
    private fun version(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","scopeId","entityId","kind","revision","parentId","deleted","metadata","body"));check(value.getInt("protocol")==1&&value.getString("scopeId")==binding.scopeId&&value.getLong("revision")==1L&&value.get("deleted") is Boolean){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};E2eeKeys.technical(value.getString("entityId"))
        if(value.getBoolean("deleted"))check(value.isNull("body")){"E2EE_PRODUCT_BOOTSTRAP_INVALID"}else binding.validate(value.getString("kind"),value.get("body"),value)
        return JSONObject(value.toString())
    }
    private fun part(plan:JSONObject,index:Int):E2eeDeviceDocument{val descriptor=plan.getJSONArray("parts").getJSONObject(index)
        return E2eeDeviceDocument(account.device,descriptor.getString("id"),{value->
            E2eeKeys.exact(value,setOf("protocol","scopeId","bootstrapId","partIndex","intentId","items","proofHash"));check(value.getInt("protocol")==1&&value.getString("scopeId")==binding.scopeId&&value.getString("bootstrapId")==plan.getString("bootstrapId")&&value.getInt("partIndex")==index){"E2EE_PRODUCT_BOOTSTRAP_INVALID"}
            E2eeKeys.technical(value.getString("intentId"));if(!value.isNull("proofHash"))E2eeEnvelope.decode(value.getString("proofHash"),32);val items=value.getJSONArray("items");check(items.length()==descriptor.getInt("count"))
            for(at in 0 until items.length()){val item=items.getJSONObject(at);E2eeKeys.exact(item,setOf("version","operation","authorId","payloadHash"));val version=version(item.getJSONObject("version"));E2eeKeys.technical(item.getString("authorId"));if(!item.isNull("payloadHash"))E2eeEnvelope.decode(item.getString("payloadHash"),32)
                val operation=E2eeProductContract.operation(JSONObject(item.getJSONObject("operation").toString()).put("payloadHash",if(item.isNull("payloadHash"))E2eeEnvelope.encode(ByteArray(32))else item.getString("payloadHash")))
                check(operation.getString("action") in setOf("create","delete")&&operation.getLong("expectedRevision")==0L&&version.get("entityId")==operation.get("entityId")&&version.get("kind")==operation.get("kind")&&version.getBoolean("deleted")== (operation.getString("action")=="delete")&&version.get("parentId")==operation.get("parentId")&&E2eeProductJson.same(version.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_BOOTSTRAP_INVALID"}}
            value},::current)
    }
    private fun document(item:JSONObject):E2eePrivateDocument{val operation=item.getJSONObject("operation");return E2eePrivateDocument(account.device,scope().client,binding.scopeId,operation.getString("domain"),operation.getString("objectId"),::version,::current,::current)}
    private class Recovery(val state:JSONObject?,val parts:List<JSONObject>,val groups:List<JSONArray>,val remaining:JSONArray)
    private fun recoverParts(source:JSONArray,manifestHash:String):Recovery{
        val client=scope().client;val remaining=linkedMapOf<String,JSONObject>();for(at in 0 until source.length()){val item=source.getJSONObject(at);check(remaining.put(item.getJSONObject("edit").getString("entityId"),item)==null){"E2EE_PRODUCT_BOOTSTRAP_DUPLICATE"}}
        val parts=mutableListOf<JSONObject>();val groups=mutableListOf<JSONArray>();var state:JSONObject?=null;var after=-1
        for(page in 0..256){val response=client.readBootstrapState(after);current();E2eeKeys.exact(response,setOf("bootstrap","part","checkpointHash","directoryRevision"))
            if(response.isNull("bootstrap")){check(page==0&&response.isNull("part")){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};return Recovery(null,parts,groups,JSONArray(remaining.values.toList()))}
            val header=response.getJSONObject("bootstrap");E2eeKeys.exact(header,setOf("bootstrapId","sourceManifestHash","expectedCount","state","partCount"));E2eeKeys.technical(header.getString("bootstrapId"));E2eeEnvelope.decode(header.getString("sourceManifestHash"),32)
            check(header.getString("sourceManifestHash")==manifestHash&&header.getInt("expectedCount")==source.length()&&header.getString("state") in setOf("staging","active")&&E2eeCommands.integer(header.get("partCount"))<=256){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"}
            check(state==null||E2eeProductJson.same(state,header)){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"};state=JSONObject(header.toString())
            if(response.isNull("part")){check(parts.size==header.getInt("partCount")){"E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE"};break}
            check(page<256){"E2EE_PRODUCT_BOOTSTRAP_TOO_LARGE"};val remote=response.getJSONObject("part");E2eeKeys.exact(remote,setOf("partIndex","proofHash","packet"));check(remote.getInt("partIndex")==after+1){"E2EE_PRODUCT_BOOTSTRAP_REVIEW_REQUIRED"};E2eeEnvelope.decode(remote.getString("proofHash"),32)
            val raw=remote.getString("packet").toByteArray(Charsets.UTF_8);val proof=try{client.verifyServiceProof(E2eeFileManifestJson.readPrivateDocument(raw))}finally{raw.fill(0)};current()
            val command=proof.getJSONObject("command");val payload=command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("intentId","bootstrapId","partIndex","items"));E2eeKeys.technical(payload.getString("intentId"));val items=payload.getJSONArray("items")
            check(command.getString("action")=="product-bootstrap-stage"&&proof.getString("actorId")==account.ownerId&&proof.get("proofHash")==remote.get("proofHash")&&payload.get("bootstrapId")==header.get("bootstrapId")&&payload.getInt("partIndex")==remote.getInt("partIndex")&&items.length() in 1..100){"E2EE_PRODUCT_PROOF_INVALID"}
            val recovered=JSONArray();val group=JSONArray()
            for(at in 0 until items.length()){val item=items.getJSONObject(at);E2eeKeys.exact(item,setOf("operation","authorId"));val operation=E2eeProductContract.operation(item.getJSONObject("operation"));val original=remaining[operation.getString("entityId")]?:error("E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED");val edit=original.getJSONObject("edit")
                check(item.get("authorId")==original.get("authorId")&&operation.get("action")==edit.get("action")&&operation.get("kind")==edit.get("kind")&&operation.getLong("expectedRevision")==0L&&operation.isNull("proposalId")&&operation.get("parentId")==edit.get("parentId")&&E2eeProductJson.same(operation.get("metadata"),edit.get("metadata"))){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"}
                val content=version(JSONObject().put("protocol",1).put("scopeId",binding.scopeId).put("entityId",edit.get("entityId")).put("kind",edit.get("kind")).put("revision",1).put("parentId",edit.get("parentId")).put("deleted",edit.getString("action")=="delete").put("metadata",edit.get("metadata")).put("body",edit.get("body")))
                val base=JSONObject(operation.toString()).apply{remove("payloadHash")};val held=JSONObject().put("operation",base).put("version",content).put("authorId",original.get("authorId")).put("payloadHash",operation.get("payloadHash"))
                val opened=document(held).load();current();check(!opened.pending&&opened.conflict==null&&opened.remoteRevision==1L&&E2eeProductJson.same(opened.value,content)){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"}
                client.assertObjectReference(operation.getString("domain"),operation.getString("objectId"),1,operation.getString("payloadHash"));current();recovered.put(held);group.put(original);remaining.remove(operation.getString("entityId"))
            }
            parts+=JSONObject().put("protocol",1).put("scopeId",binding.scopeId).put("bootstrapId",header.get("bootstrapId")).put("partIndex",remote.get("partIndex")).put("intentId",payload.get("intentId")).put("items",recovered).put("proofHash",remote.get("proofHash"));groups+=group;after=remote.getInt("partIndex")
        }
        check(state?.getString("state")!="active"||remaining.isEmpty()){"E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE"};return Recovery(state,parts,groups,JSONArray(remaining.values.toList()))
    }
    @Synchronized fun prepare():JSONObject{
        current();check(!account.offline&&scope().directory.ownerId==account.ownerId){"E2EE_OWNER_REQUIRED"};var old=journal.load();if(old!=null&&old.value.getString("phase")!="preparing")return JSONObject(old.value.toString())
        val input=records.collectBootstrap();check(input.length() in 1..10000){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};val original=scope().client.originalMigrationManifest();val recovery=recoverParts(input,original.getString("manifestHash"))
        check(old==null||recovery.state==null||old.value.get("bootstrapId")==recovery.state.get("bootstrapId")){"E2EE_PRODUCT_BOOTSTRAP_CONFLICT"}
        val batches=recovery.groups.toMutableList();var batch=JSONArray();var bytes=0
        for(at in 0 until recovery.remaining.length()){val item=recovery.remaining.getJSONObject(at);val size=item.toString().toByteArray(Charsets.UTF_8).size;if(batch.length()>0&&(batch.length()==100||bytes+size>8*1024*1024)){batches+=batch;batch=JSONArray();bytes=0};batch.put(item);bytes+=size};if(batch.length()>0)batches+=batch;check(batches.size<=256){"E2EE_PRODUCT_BOOTSTRAP_TOO_LARGE"}
        if(old==null){val id=recovery.state?.getString("bootstrapId")?:UUID.randomUUID().toString();val parts=JSONArray();for((index,rows)in batches.withIndex())parts.put(JSONObject().put("id","bootstrap-part:$id:$index").put("count",rows.length()))
            old=journal.save(JSONObject().put("protocol",1).put("scopeId",binding.scopeId).put("bootstrapId",id).put("sourceManifestHash",original.get("manifestHash")).put("expectedCount",input.length())
                .put("startIntentId",UUID.randomUUID().toString()).put("completeIntentId",UUID.randomUUID().toString()).put("parts",parts).put("phase","preparing"),null)}
        val saved=checkNotNull(old);val plan=saved.value;check(plan.getInt("expectedCount")==input.length()&&plan.getJSONArray("parts").length()==batches.size){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"}
        for((index,rows)in batches.withIndex()){val store=part(plan,index);val prior=store.load()
            if(prior!=null){val held=prior.value.getJSONArray("items");for(at in 0 until rows.length()){val row=rows.getJSONObject(at);val edit=row.getJSONObject("edit");val item=held.getJSONObject(at);val version=item.getJSONObject("version");val operation=item.getJSONObject("operation")
                    check(item.get("authorId")==row.get("authorId")&&operation.get("entityId")==edit.get("entityId")&&operation.get("action")==edit.get("action")&&version.get("parentId")==edit.get("parentId")&&E2eeProductJson.same(version.get("body"),edit.get("body"))&&E2eeProductJson.same(version.get("metadata"),edit.get("metadata"))){"E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED"}};continue}
            val recovered=recovery.parts.getOrNull(index);if(recovered!=null){store.save(recovered,null);continue}
            val output=JSONArray();for(at in 0 until rows.length()){val row=rows.getJSONObject(at);val edit=row.getJSONObject("edit");val kind=edit.getString("kind");val version=version(JSONObject().put("protocol",1).put("scopeId",binding.scopeId).put("entityId",edit.get("entityId")).put("kind",kind).put("revision",1).put("parentId",edit.get("parentId")).put("deleted",edit.getString("action")=="delete").put("metadata",edit.get("metadata")).put("body",edit.get("body")))
                val operation=JSONObject().put("action",edit.get("action")).put("entityId",edit.get("entityId")).put("kind",kind).put("expectedRevision",0).put("domain",E2eeProductContract.domain(kind)).put("objectId","product-version:${UUID.randomUUID()}").put("parentId",edit.get("parentId")).put("metadata",edit.get("metadata")).put("proposalId",JSONObject.NULL)
                output.put(JSONObject().put("version",version).put("operation",operation).put("authorId",row.get("authorId")).put("payloadHash",JSONObject.NULL))}
            store.save(JSONObject().put("protocol",1).put("scopeId",binding.scopeId).put("bootstrapId",plan.get("bootstrapId")).put("partIndex",index).put("intentId",UUID.randomUUID().toString()).put("items",output).put("proofHash",JSONObject.NULL),null)
        }
        if(recovery.state?.getString("state")=="active"){
            val page=E2eeProductProofs.verifyPage(scope().client.readProductIndex("",1),scope().client::verifyServiceProof);val proofs=JSONArray();for(part in recovery.parts)proofs.put(JSONObject().put("partIndex",part.get("partIndex")).put("proofHash",part.get("proofHash")))
            check(page.bootstrap.get("bootstrapId")==plan.get("bootstrapId")&&page.bootstrap.getInt("expectedCount")==input.length()&&E2eeProductJson.same(page.bootstrap.get("parts"),proofs)){"E2EE_PRODUCT_PROOF_INVALID"}
        }
        return journal.save(JSONObject(plan.toString()).put("phase",if(recovery.state?.getString("state")=="active")"active"else"ready"),saved.serial).value
    }
    @Synchronized fun flush():JSONObject{
        current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val saved=journal.load()?:error("E2EE_PRODUCT_BOOTSTRAP_PREPARE_REQUIRED");val plan=saved.value;check(plan.getString("phase")!="preparing"){"E2EE_PRODUCT_BOOTSTRAP_PREPARE_REQUIRED"};val scope=scope();scope.client.refresh();current();if(plan.getString("phase")=="active")return JSONObject(plan.toString())
        val parts=plan.getJSONArray("parts");for(index in 0 until parts.length())check(part(plan,index).load()!=null){"E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE"}
        scope.client.executeService("product-bootstrap-start",JSONObject().put("bootstrapId",plan.get("bootstrapId")).put("sourceManifestHash",plan.get("sourceManifestHash")).put("expectedCount",plan.get("expectedCount")),plan.getString("startIntentId"));val proofs=JSONArray()
        for(index in 0 until parts.length()){val store=part(plan,index);var savedPart=store.load()?:error("E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE");val state=JSONObject(savedPart.value.toString());val items=state.getJSONArray("items")
            for(at in 0 until items.length()){val item=items.getJSONObject(at);val operation=item.getJSONObject("operation");val document=document(item);val view=try{document.load()}catch(error:IllegalStateException){if(error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error;document.save(item.getJSONObject("version"),null,0);document.load(true)}
                check(view.conflict==null&&view.remoteRevision<=1&&E2eeProductJson.same(view.value,item.get("version"))){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};if(view.pending)document.flush();val ref=scope.client.objectReference(operation.getString("domain"),operation.getString("objectId"))
                check(ref.getLong("revision")==1L&&(item.isNull("payloadHash")||item.get("payloadHash")==ref.get("payloadHash"))){"E2EE_OBJECT_REFERENCE_MISMATCH"};if(item.isNull("payloadHash")){item.put("payloadHash",ref.get("payloadHash"));savedPart=store.save(state,savedPart.serial)}}
            val metadata=JSONArray();for(at in 0 until items.length()){val item=items.getJSONObject(at);metadata.put(JSONObject().put("operation",JSONObject(item.getJSONObject("operation").toString()).put("payloadHash",item.get("payloadHash"))).put("authorId",item.get("authorId")))}
            val payload=JSONObject().put("bootstrapId",plan.get("bootstrapId")).put("partIndex",index).put("items",metadata);val result=scope.client.executeService("product-bootstrap-stage",payload,state.getString("intentId"));current()
            check(result.get("bootstrapId")==plan.get("bootstrapId")&&result.getInt("partIndex")==index){"E2EE_PRODUCT_BOOTSTRAP_INVALID"};val raw=result.getString("proofPacket").toByteArray(Charsets.UTF_8);val proof=try{scope.client.verifyServiceProof(E2eeFileManifestJson.readPrivateDocument(raw))}finally{raw.fill(0)}
            val command=proof.getJSONObject("command");val expected=JSONObject(payload.toString()).put("intentId",state.get("intentId"));check(command.getString("action")=="product-bootstrap-stage"&&proof.get("proofHash")==result.get("proofHash")&&proof.getString("actorId")==account.ownerId&&E2eeProductJson.same(command.getJSONObject("payload"),expected)&&(state.isNull("proofHash")||state.get("proofHash")==proof.get("proofHash"))){"E2EE_PRODUCT_PROOF_INVALID"}
            if(state.isNull("proofHash")){state.put("proofHash",proof.get("proofHash"));store.save(state,savedPart.serial)};proofs.put(JSONObject().put("partIndex",index).put("proofHash",proof.get("proofHash")))
        }
        val result=scope.client.executeService("product-bootstrap-complete",JSONObject().put("bootstrapId",plan.get("bootstrapId")).put("parts",proofs).put("expectedCount",plan.get("expectedCount")),plan.getString("completeIntentId"));current()
        check(result.get("bootstrapId")==plan.get("bootstrapId")&&result.getString("state")=="active"&&result.getInt("count")==plan.getInt("expectedCount")){"E2EE_PRODUCT_BOOTSTRAP_INVALID"}
        val page=E2eeProductProofs.verifyPage(scope.client.readProductIndex("",1),scope.client::verifyServiceProof);check(page.bootstrap.get("bootstrapId")==plan.get("bootstrapId")&&page.bootstrap.getInt("expectedCount")==plan.getInt("expectedCount")&&E2eeProductJson.same(page.bootstrap.get("parts"),proofs)){"E2EE_PRODUCT_PROOF_INVALID"}
        return journal.save(JSONObject(plan.toString()).put("phase","active"),saved.serial).value
    }
    @Synchronized fun inspect():JSONObject?=journal.load()?.value
    override fun toString()="E2eeSharedBootstrap([redacted])"
}
