package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Same immutable version/transaction protocol as web. A real domain parser is
 * mandatory; this store has no permissive JSON/legacy fallback or ACL import. */
internal class E2eeSharedProduct(private val device:E2eeScopeDevice,private val client:E2eeScopeClient,private val scopeId:String,
    private val assertCurrent:()->Unit,private val validateBody:(String,Any,JSONObject)->Any){
    private val prefix="product-tx:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(scopeId.toByteArray(Charsets.UTF_8)))+":"
    private val proposals=mutableMapOf<String,JSONObject>()
    private val headProofs=mutableMapOf<String,String>()
    init{E2eeKeys.technical(scopeId);client.assertBinding(device,scopeId)}
    private fun check(){device.requireOpen();assertCurrent()}
    private fun version(input:JSONObject):JSONObject{
        E2eeKeys.exact(input,setOf("protocol","scopeId","entityId","kind","revision","parentId","deleted","metadata","body"));check(input.get("protocol")==1&&input.get("scopeId")==scopeId&&input.get("deleted") is Boolean){"E2EE_PRODUCT_VERSION_INVALID"}
        E2eeKeys.technical(input.getString("entityId"));E2eeCommands.integer(input.get("revision"),1);if(!input.isNull("parentId"))E2eeKeys.technical(input.getString("parentId"));val kind=input.getString("kind");E2eeProductContract.domain(kind);E2eeProductContract.metadata(kind,input.getJSONObject("metadata"))
        if(input.getBoolean("deleted")){check(input.isNull("body")){"E2EE_PRODUCT_VERSION_INVALID"};return JSONObject(input.toString())}
        val header=JSONObject(input.toString()).apply{remove("body")};val body=validateBody(kind,input.get("body"),header);check();return JSONObject(input.toString()).put("body",body)
    }
    private fun document(id:String,kind:String)=E2eePrivateDocument(device,client,scopeId,E2eeProductContract.domain(kind),id,::version,::check,::check)
    private val index=E2eeDeviceDocument(device,"product-index:$scopeId",{value->
        E2eeKeys.exact(value,setOf("protocol","scopeId","entities"));check(value.get("protocol")==1&&value.get("scopeId")==scopeId){"E2EE_PRODUCT_INDEX_INVALID"};val rows=value.getJSONArray("entities");check(rows.length()<=100000){"E2EE_PRODUCT_INDEX_INVALID"};val ids=mutableSetOf<String>()
        for(at in 0 until rows.length()){val row=E2eeProductContract.entity(rows.getJSONObject(at));check(ids.add(row.getString("entityId"))){"E2EE_PRODUCT_INDEX_INVALID"}};JSONObject(value.toString())},::check)
    private fun transaction(id:String)=E2eeDeviceDocument(device,id,{value->
        E2eeKeys.exact(value,setOf("format","scopeId","intentId","drafts","acknowledged","receipt")+(if(value.has("membershipIntentId"))setOf("membershipIntentId")else emptySet()));check(value.get("format")=="genesis-product-transaction-v1"&&value.get("scopeId")==scopeId&&value.get("acknowledged") is Boolean){"E2EE_PRODUCT_TRANSACTION_INVALID"};E2eeKeys.technical(value.getString("intentId"));if(value.has("membershipIntentId"))E2eeKeys.technical(value.getString("membershipIntentId"))
        val rows=value.getJSONArray("drafts");check(rows.length() in 1..100){"E2EE_PRODUCT_TRANSACTION_INVALID"};val ids=mutableSetOf<String>();val objects=mutableSetOf<String>()
        for(at in 0 until rows.length()){val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("operation","version","payloadHash"));val operation=row.getJSONObject("operation")
            E2eeKeys.exact(operation,setOf("action","entityId","kind","expectedRevision","domain","objectId","parentId","metadata","proposalId"));val id=E2eeKeys.technical(operation.getString("entityId"));val objectId=E2eeKeys.technical(operation.getString("objectId"))
            check(ids.add(id)&&objects.add(objectId)&&objectId.matches(Regex("product-version:[a-f0-9-]{36}"))&&operation.getString("action") in setOf("create","update","delete","restore","propose-complete")&&operation.get("domain")==E2eeProductContract.domain(operation.getString("kind"))){"E2EE_PRODUCT_TRANSACTION_INVALID"}
            E2eeCommands.integer(operation.get("expectedRevision"));E2eeProductContract.metadata(operation.getString("kind"),operation.getJSONObject("metadata"));if(!row.isNull("payloadHash"))E2eeEnvelope.decode(row.getString("payloadHash"),32)
        };JSONObject(value.toString())},::check)
    @Synchronized fun index(offline:Boolean=false):JSONArray{
        check();val prior=index.load();if(offline)return JSONArray((prior?.value?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE")).getJSONArray("entities").toString())
        client.refresh();check();val rows=JSONArray();val seen=mutableSetOf<String>();var after="";var eof=false;var limit=50;var baseline:JSONObject?=null;val reviewed=mutableMapOf<String,JSONObject>();val currentProofs=mutableMapOf<String,String>()
        for(page in 0..100032){val response=try{client.readProductIndex(after,limit)}catch(error:Exception){if(limit>1&&error.message=="E2EE_PRODUCT_PAGE_TOO_LARGE"){limit=maxOf(1,limit/2);continue};throw error}
            val verified=E2eeProductProofs.verifyPage(response,client::verifyServiceProof);check();val values=verified.entities;check(values.length()<=limit){"E2EE_PRODUCT_INDEX_INVALID"}
            check(baseline==null||baseline!!.get("proofHash")==verified.bootstrap.get("proofHash")){"E2EE_PRODUCT_PROOF_INVALID"};baseline=verified.bootstrap
            val heads=response.getJSONArray("heads");for(at in 0 until heads.length()){val head=heads.getJSONObject(at);E2eeKeys.exact(head,setOf("entityId","revision","proofHash"));currentProofs[head.getString("entityId")]=head.getString("proofHash")}
            for(at in 0 until values.length()){val value=E2eeProductContract.entity(values.getJSONObject(at));val id=value.getString("entityId");check(id>after&&seen.add(id)&&rows.length()<100000){"E2EE_PRODUCT_INDEX_INVALID"};rows.put(value)}
            for(at in 0 until verified.proposals.length()){val proposal=verified.proposals.getJSONObject(at);val id=proposal.getString("proposalId");check(id !in reviewed){"E2EE_PRODUCT_PROOF_INVALID"};reviewed[id]=proposal}
            if(values.length()<limit){eof=true;break};after=rows.getJSONObject(rows.length()-1).getString("entityId")};check(eof){"E2EE_PRODUCT_INDEX_INVALID"}
        check(baseline!=null&&rows.length()>=baseline!!.getInt("expectedCount")){"E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE"}
        val lookup=(0 until rows.length()).associate{rows.getJSONObject(it).let{row->row.getString("entityId") to row}};val old=prior?.value?.getJSONArray("entities")?:JSONArray()
        for(at in 0 until old.length()){val value=old.getJSONObject(at);val remote=lookup[value.getString("entityId")]?:error("E2EE_REMOTE_ROLLBACK");check(remote.getLong("revision")>=value.getLong("revision")&&(remote.getLong("revision")!=value.getLong("revision")||E2eeProductJson.same(remote,value))){"E2EE_REMOTE_ROLLBACK"}}
        if(!E2eeProductJson.same(old,rows))index.save(JSONObject().put("protocol",1).put("scopeId",scopeId).put("entities",rows),prior?.serial);check();proposals.clear();proposals.putAll(reviewed);headProofs.clear();headProofs.putAll(currentProofs);return JSONArray(rows.toString())
    }
    @Synchronized fun read(input:JSONObject,offline:Boolean=false):JSONObject{
        check();val entity=E2eeProductContract.entity(input);val value=document(entity.getString("objectId"),entity.getString("kind")).load(offline);val body=version(value.value)
        check(!value.pending&&value.conflict==null&&value.remoteRevision==1L&&body.get("entityId")==entity.get("entityId")&&body.get("kind")==entity.get("kind")&&body.getLong("revision")==entity.getLong("revision")
            &&body.get("parentId")==entity.get("parentId")&&body.get("deleted")==entity.get("deleted")&&E2eeProductJson.same(body.get("metadata"),entity.get("metadata"))){"E2EE_PRODUCT_VERSION_INVALID"}
        if(!offline)client.assertObjectReference(entity.getString("domain"),entity.getString("objectId"),1,entity.getString("payloadHash"));check();return JSONObject(body.toString())
    }
    @Synchronized fun stage(edits:JSONArray,intentId:String=UUID.randomUUID().toString(),membershipIntentId:String?=null):String{
        check();E2eeKeys.technical(intentId);membershipIntentId?.let(E2eeKeys::technical);check(edits.length() in 1..100){"E2EE_PRODUCT_BATCH_INVALID"};val drafts=JSONArray()
        val previous=transaction(prefix+intentId).load()
        if(previous!=null){val held=previous.value.getJSONArray("drafts");check(held.length()==edits.length()&&(if(previous.value.has("membershipIntentId"))previous.value.getString("membershipIntentId")else null)==membershipIntentId){"E2EE_IDEMPOTENCY_CONFLICT"}
            for(at in 0 until edits.length()){val edit=edits.getJSONObject(at);val prior=held.getJSONObject(at);val operation=prior.getJSONObject("operation");val content=version(prior.getJSONObject("version"))
                check(operation.get("action")==edit.get("action")&&operation.get("entityId")==edit.get("entityId")&&operation.get("kind")==edit.get("kind")&&operation.getLong("expectedRevision")==edit.getLong("expectedRevision")&&operation.get("parentId")==edit.get("parentId")
                    &&(!edit.has("proposalId")||edit.get("proposalId")==operation.get("proposalId"))&&E2eeProductJson.same(operation.get("metadata"),edit.get("metadata"))&&E2eeProductJson.same(content.get("body"),edit.get("body"))){"E2EE_IDEMPOTENCY_CONFLICT"}}
            return intentId
        }
        for(at in 0 until edits.length()){val edit=edits.getJSONObject(at);val action=edit.getString("action");val kind=edit.getString("kind");val revision=E2eeCommands.integer(edit.get("expectedRevision"));check(revision<9_007_199_254_740_991L){"E2EE_INVALID_REVISION"}
            val header=version(JSONObject().put("protocol",1).put("scopeId",scopeId).put("entityId",edit.get("entityId")).put("kind",kind).put("revision",revision+1).put("parentId",edit.get("parentId")).put("deleted",action=="delete").put("metadata",edit.getJSONObject("metadata")).put("body",edit.get("body")))
            val operation=JSONObject().put("action",action).put("entityId",edit.get("entityId")).put("kind",kind).put("expectedRevision",revision).put("domain",E2eeProductContract.domain(kind)).put("objectId","product-version:${UUID.randomUUID()}")
                .put("parentId",edit.get("parentId")).put("metadata",header.get("metadata")).put("proposalId",if(action=="propose-complete")edit.optString("proposalId").ifEmpty{UUID.randomUUID().toString()}else JSONObject.NULL)
            drafts.put(JSONObject().put("operation",operation).put("version",header).put("payloadHash",JSONObject.NULL))
        }
        val state=JSONObject().put("format","genesis-product-transaction-v1").put("scopeId",scopeId).put("intentId",intentId).put("drafts",drafts).put("acknowledged",false).put("receipt",JSONObject.NULL)
        if(membershipIntentId!=null)state.put("membershipIntentId",membershipIntentId)
        transaction(prefix+intentId).save(state,null);check();return intentId
    }
    @Synchronized fun prepare(intentId:String):JSONArray{
        check();E2eeKeys.technical(intentId);val store=transaction(prefix+intentId);var saved=store.load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");val state=JSONObject(saved.value.toString())
        val drafts=state.getJSONArray("drafts");for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);val operation=draft.getJSONObject("operation");val header=version(draft.getJSONObject("version"))
            check(header.get("entityId")==operation.get("entityId")&&header.get("kind")==operation.get("kind")&&header.getLong("revision")==operation.getLong("expectedRevision")+1&&header.get("parentId")==operation.get("parentId")
                &&header.getBoolean("deleted")== (operation.getString("action")=="delete")&&E2eeProductJson.same(header.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_TRANSACTION_INVALID"}
            val doc=document(operation.getString("objectId"),operation.getString("kind"));val local=try{doc.load(true)}catch(error:IllegalStateException){if(error.message!="E2EE_OFFLINE_CONTENT_UNAVAILABLE")throw error;doc.save(header,null,0);doc.load(true)}
            check(local.conflict==null&&local.remoteRevision<=1&&E2eeProductJson.same(local.value,header)){"E2EE_PRODUCT_VERSION_IMMUTABLE"};if(local.pending)doc.flush()
            val reference=client.objectReference(operation.getString("domain"),operation.getString("objectId"));check();check(reference.getLong("revision")==1L&&(draft.isNull("payloadHash")||draft.get("payloadHash")==reference.get("payloadHash"))){"E2EE_OBJECT_REFERENCE_MISMATCH"}
            if(draft.isNull("payloadHash")){draft.put("payloadHash",reference.get("payloadHash"));saved=store.save(state,saved.serial)}
        }
        val operations=JSONArray();for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);operations.put(JSONObject(draft.getJSONObject("operation").toString()).put("payloadHash",draft.get("payloadHash")))}
        return operations
    }
    private fun acknowledge(intentId:String,operations:JSONArray,receipt:JSONObject):JSONObject{
        check();val store=transaction(prefix+intentId);val saved=store.load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");val state=JSONObject(saved.value.toString())
        check(receipt.get("intentId")==intentId&&receipt.getJSONArray("results").length()==operations.length()){"E2EE_PRODUCT_RECEIPT_INVALID"}
        val results=receipt.getJSONArray("results");for(at in 0 until operations.length()){val operation=operations.getJSONObject(at);val result=(0 until results.length()).map{results.getJSONObject(it)}.singleOrNull{it.get("entityId")==operation.get("entityId")}?:error("E2EE_PRODUCT_RECEIPT_INVALID")
            check(result.getLong("revision")==operation.getLong("expectedRevision")+(if(operation.getString("action")=="propose-complete")0 else 1)&&result.get("payloadHash")==operation.get("payloadHash")){"E2EE_PRODUCT_RECEIPT_INVALID"}}
        val expected=JSONArray();val drafts=state.getJSONArray("drafts");for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);expected.put(JSONObject(draft.getJSONObject("operation").toString()).put("payloadHash",draft.get("payloadHash")))}
        check(E2eeProductJson.same(expected,operations)){"E2EE_PRODUCT_RECEIPT_INVALID"}
        if(state.getBoolean("acknowledged")){check(E2eeProductJson.same(state.getJSONObject("receipt"),receipt)){"E2EE_PRODUCT_RECEIPT_INVALID"};return JSONObject(receipt.toString())}
        store.save(state.put("acknowledged",true).put("receipt",receipt),saved.serial);check();return JSONObject(receipt.toString())
    }
    @Synchronized fun flush(intentId:String):JSONObject{
        check();E2eeKeys.technical(intentId);val saved=transaction(prefix+intentId).load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING")
        if(saved.value.getBoolean("acknowledged"))return JSONObject(saved.value.getJSONObject("receipt").toString())
        check(!saved.value.has("membershipIntentId")){"E2EE_BOUND_TRANSACTION_REQUIRED"}
        val operations=prepare(intentId);val receipt=client.executeService("product-commit",JSONObject().put("operations",operations),intentId);check();return acknowledge(intentId,operations,receipt)
    }
    /** A containing atomic membership transaction already applied these heads.
     * Verify signed index and decrypted versions; no network mutation here. */
    @Synchronized fun confirmPrepared(intentId:String,receipt:JSONObject,expectedPacket:JSONObject):JSONObject{
        check();E2eeKeys.technical(intentId);val packet=JSONObject(expectedPacket.toString());val saved=transaction(prefix+intentId).load();val proof=client.verifyServiceProof(packet);check();val command=proof.getJSONObject("command");val payload=command.getJSONObject("payload")
        check(command.get("action")=="product-commit-bound"&&payload.get("intentId")==intentId){"E2EE_PRODUCT_RECEIPT_INVALID"};val own=command.get("deviceId")==device.deviceId
        if(own&&saved==null)error("E2EE_PRODUCT_TRANSACTION_MISSING");check(saved==null||own&&saved.value.has("membershipIntentId")){"E2EE_PRODUCT_RECEIPT_INVALID"}
        val drafts=saved?.value?.getJSONArray("drafts");val operations=JSONArray(payload.getJSONArray("operations").toString());val ids=mutableSetOf<String>();check(operations.length() in 1..100){"E2EE_PRODUCT_RECEIPT_INVALID"}
        for(at in 0 until operations.length()){val operation=E2eeProductContract.operation(operations.getJSONObject(at));check(ids.add(operation.getString("entityId"))&&operation.get("action")!="propose-complete"){"E2EE_PRODUCT_RECEIPT_INVALID"}}
        if(drafts!=null){val expected=JSONArray();for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);check(!draft.isNull("payloadHash")){"E2EE_PRODUCT_TRANSACTION_MISSING"};expected.put(JSONObject(draft.getJSONObject("operation").toString()).put("payloadHash",draft.get("payloadHash")))};check(E2eeProductJson.same(expected,operations)){"E2EE_PRODUCT_RECEIPT_INVALID"}}
        check(receipt.get("intentId")==intentId){"E2EE_PRODUCT_RECEIPT_INVALID"};val results=receipt.getJSONArray("results");check(results.length()==operations.length()){"E2EE_PRODUCT_RECEIPT_INVALID"};val entities=index()
        for(at in 0 until operations.length()){val operation=operations.getJSONObject(at);val matched=(0 until results.length()).map{results.getJSONObject(it)}.filter{it.get("entityId")==operation.get("entityId")};val revision=operation.getLong("expectedRevision")+1
            check(matched.size==1&&matched.single().getLong("revision")==revision&&matched.single().get("payloadHash")==operation.get("payloadHash")){"E2EE_PRODUCT_RECEIPT_INVALID"}
            var entity=(0 until entities.length()).map{entities.getJSONObject(it)}.singleOrNull{it.get("entityId")==operation.get("entityId")}?:error("E2EE_PRODUCT_RECEIPT_INVALID")
            check(entity.getLong("revision")>=revision){"E2EE_PRODUCT_RECEIPT_INVALID"}
            if(entity.getLong("revision")==revision)check(headProofs[entity.getString("entityId")]==proof.get("proofHash")){"E2EE_PRODUCT_RECEIPT_INVALID"}
            else{val response=client.readProductHistory(operation.getString("entityId"),revision+1,1);check();E2eeKeys.exact(response,setOf("pages","checkpointHash","directoryRevision"));val pages=response.getJSONArray("pages");check(pages.length()==1){"E2EE_PRODUCT_RECEIPT_INVALID"}
                val raw=pages.getJSONObject(0);val historical=E2eeProductProofs.verifyPage(raw,client::verifyServiceProof);check();check(historical.entities.length()==1){"E2EE_PRODUCT_RECEIPT_INVALID"};entity=historical.entities.getJSONObject(0);val heads=raw.getJSONArray("heads");check(heads.length()==1&&heads.getJSONObject(0).get("proofHash")==proof.get("proofHash")){"E2EE_PRODUCT_RECEIPT_INVALID"}}
            check(entity.get("entityId")==operation.get("entityId")&&entity.getLong("revision")==revision&&listOf("kind","domain","objectId","payloadHash","parentId","metadata").all{E2eeProductJson.same(entity.get(it),operation.get(it))}&&entity.getBoolean("deleted")== (operation.getString("action")=="delete")){"E2EE_PRODUCT_RECEIPT_INVALID"}
            val value=read(entity);if(drafts!=null){val draft=(0 until drafts.length()).map{drafts.getJSONObject(it)}.single{it.getJSONObject("operation").get("entityId")==operation.get("entityId")};check(E2eeProductJson.same(value,version(draft.getJSONObject("version")))){"E2EE_PRODUCT_RECEIPT_INVALID"}}
        };return if(saved!=null)acknowledge(intentId,operations,JSONObject(receipt.toString()))else JSONObject(receipt.toString())
    }
    @Synchronized fun pending():List<String>{check();return device.vault.listLocal("draft",prefix).mapNotNull{id->val value=transaction(id).load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");if(value.value.getBoolean("acknowledged")||value.value.has("membershipIntentId"))null else value.value.getString("intentId")}}
    @Synchronized fun history(entityId:String,before:Long=9_007_199_254_740_991L,requestedLimit:Int=5):JSONObject{
        check();E2eeKeys.technical(entityId);client.refresh();check();var limit=requestedLimit
        var response:JSONObject?=null;while(response==null){try{response=client.readProductHistory(entityId,before,limit)}catch(error:Exception){if(error.message!="E2EE_PRODUCT_PAGE_TOO_LARGE"||limit<=1)throw error;limit=(limit/2).coerceAtLeast(1)}}
        val accepted=checkNotNull(response);E2eeKeys.exact(accepted,setOf("pages","checkpointHash","directoryRevision"));val pages=accepted.getJSONArray("pages");check(pages.length()<=limit){"E2EE_PRODUCT_HISTORY_INVALID"};val versions=JSONArray();val origins=JSONArray();var previous=before
        for(at in 0 until pages.length()){
            val verified=E2eeProductProofs.verifyPage(pages.getJSONObject(at),client::verifyServiceProof);check();check(verified.entities.length()==1){"E2EE_PRODUCT_HISTORY_INVALID"};val entity=verified.entities.getJSONObject(0)
            check(entity.getString("entityId")==entityId&&entity.getLong("revision")<previous){"E2EE_PRODUCT_HISTORY_INVALID"};previous=entity.getLong("revision");versions.put(read(entity));origins.put(verified.origins.getJSONObject(0))
        };return JSONObject().put("versions",versions).put("origins",origins).put("nextBefore",if(versions.length()==limit)previous else JSONObject.NULL)
    }
    @Synchronized fun localVersions():JSONArray{
        check();val result=JSONArray()
        for(id in device.vault.listLocal("draft",prefix)){
            val saved=transaction(id).load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");if(saved.value.getBoolean("acknowledged"))continue
            val drafts=saved.value.getJSONArray("drafts")
            for(at in 0 until drafts.length()){
                val draft=drafts.getJSONObject(at);val header=version(draft.getJSONObject("version"));val operation=draft.getJSONObject("operation")
                check(header.get("entityId")==operation.get("entityId")&&header.get("kind")==operation.get("kind")&&header.getLong("revision")==operation.getLong("expectedRevision")+1&&header.get("parentId")==operation.get("parentId")&&header.getBoolean("deleted")== (operation.getString("action")=="delete")&&E2eeProductJson.same(header.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_TRANSACTION_INVALID"}
                result.put(JSONObject().put("intentId",saved.value.get("intentId")).put("action",operation.get("action")).put("expectedRevision",operation.get("expectedRevision")).put("version",header))
                check(result.length()<=100000){"E2EE_SCOPE_OBJECT_LIMIT"}
            }
        };return result
    }
    @Synchronized fun proposal(id:String,expectedHash:String):JSONObject{
        check();E2eeKeys.technical(id);index();val proposal=proposals[id]?:error("E2EE_PRODUCT_PROPOSAL_STALE");val operation=proposal.getJSONObject("operation");check(operation.get("payloadHash")==expectedHash){"E2EE_PRODUCT_PROPOSAL_STALE"}
        val opened=document(operation.getString("objectId"),"task").load();val header=version(opened.value);check(!opened.pending&&opened.conflict==null&&opened.remoteRevision==1L&&header.get("entityId")==proposal.get("entityId")&&header.get("kind")=="task"
            &&header.getLong("revision")==proposal.getLong("baseRevision")+1&&!header.getBoolean("deleted")&&header.get("parentId")==operation.get("parentId")&&E2eeProductJson.same(header.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_PROPOSAL_STALE"}
        client.assertObjectReference("shared-project",operation.getString("objectId"),1,expectedHash);check();return JSONObject().put("proposal",JSONObject(proposal.toString())).put("version",header)
    }
    @Synchronized fun approve(review:JSONObject,intentId:String=UUID.randomUUID().toString()):JSONObject{
        E2eeKeys.exact(review,setOf("proposalId","payloadHash","version"));E2eeKeys.technical(intentId);val held=JSONObject(review.toString())
        val decision=E2eeDeviceDocument(device,prefix.replace("product-tx:","product-approval:")+intentId,{value->E2eeKeys.exact(value,setOf("scopeId","intentId","review"));check(value.getString("scopeId")==scopeId&&value.getString("intentId")==intentId&&E2eeProductJson.same(value.getJSONObject("review"),held)){"E2EE_IDEMPOTENCY_CONFLICT"};value},::check)
        if(decision.load()==null)decision.save(JSONObject().put("scopeId",scopeId).put("intentId",intentId).put("review",held),null);check();val current=proposal(held.getString("proposalId"),held.getString("payloadHash"))
        check(E2eeProductJson.same(version(held.getJSONObject("version")),current.getJSONObject("version"))){"E2EE_PRODUCT_PROPOSAL_STALE"};val proposal=current.getJSONObject("proposal");val operation=proposal.getJSONObject("operation");val values=checkNotNull(index.load()).value.getJSONArray("entities")
        val entity=(0 until values.length()).map{values.getJSONObject(it)}.singleOrNull{it.get("entityId")==proposal.get("entityId")}
        if(entity!=null&&entity.getLong("revision")==proposal.getLong("baseRevision")+1&&entity.get("objectId")==operation.get("objectId")&&entity.get("payloadHash")==held.get("payloadHash"))
            return JSONObject().put("intentId",intentId).put("proposalId",held.get("proposalId")).put("entityId",proposal.get("entityId")).put("completed",true).put("remaining",JSONArray())
        val result=client.executeService("product-approve",JSONObject().put("proposalId",held.get("proposalId")).put("entityId",proposal.get("entityId")).put("baseRevision",proposal.get("baseRevision")).put("payloadHash",held.get("payloadHash")),intentId);check()
        check(result.get("intentId")==intentId&&result.get("proposalId")==held.get("proposalId")&&result.get("entityId")==proposal.get("entityId")&&result.get("completed") is Boolean&&result.get("remaining") is JSONArray){"E2EE_PRODUCT_RECEIPT_INVALID"};return result
    }
    override fun toString()="E2eeSharedProduct([redacted])"
    @Synchronized fun completionProposals():JSONArray{check();return JSONArray(proposals.values)}
    @Synchronized fun approvalPreview(entityId:String):JSONArray{
        check();E2eeKeys.technical(entityId);val entities=index();val entity=(0 until entities.length()).map{entities.getJSONObject(it)}.singleOrNull{it.getString("entityId")==entityId&&it.getString("kind")=="task"&&!it.getBoolean("deleted")}?:error("E2EE_PRODUCT_ENTITY_MISSING")
        val candidates=proposals.values.map{JSONObject(it.toString())}.filter{it.getString("entityId")==entityId&&it.getLong("baseRevision")==entity.getLong("revision")&&E2eeProductContract.ids(it.getJSONObject("operation").getJSONObject("metadata").getJSONArray("approverIds")).contains(device.ownerId)}
        val result=JSONArray();for(candidate in candidates){val id=candidate.getString("proposalId");val hash=candidate.getJSONObject("operation").getString("payloadHash");val opened=proposal(id,hash);result.put(JSONObject().put("proposalId",id).put("payloadHash",hash).put("version",opened.getJSONObject("version")))};return result
    }
}
