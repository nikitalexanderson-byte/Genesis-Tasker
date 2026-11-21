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
        E2eeKeys.exact(value,setOf("protocol","scopeId","entities"));check(value.get("protocol")==1&&value.get("scopeId")==scopeId){"E2EE_PRODUCT_INDEX_INVALID"};val rows=value.getJSONArray("entities");check(rows.length()<=10000){"E2EE_PRODUCT_INDEX_INVALID"};val ids=mutableSetOf<String>()
        for(at in 0 until rows.length()){val row=E2eeProductContract.entity(rows.getJSONObject(at));check(ids.add(row.getString("entityId"))){"E2EE_PRODUCT_INDEX_INVALID"}};JSONObject(value.toString())},::check)
    private fun transaction(id:String)=E2eeDeviceDocument(device,id,{value->
        E2eeKeys.exact(value,setOf("format","scopeId","intentId","drafts","acknowledged","receipt"));check(value.get("format")=="genesis-product-transaction-v1"&&value.get("scopeId")==scopeId&&value.get("acknowledged") is Boolean){"E2EE_PRODUCT_TRANSACTION_INVALID"};E2eeKeys.technical(value.getString("intentId"))
        val rows=value.getJSONArray("drafts");check(rows.length() in 1..100){"E2EE_PRODUCT_TRANSACTION_INVALID"};val ids=mutableSetOf<String>();val objects=mutableSetOf<String>()
        for(at in 0 until rows.length()){val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("operation","version","payloadHash"));val operation=row.getJSONObject("operation")
            E2eeKeys.exact(operation,setOf("action","entityId","kind","expectedRevision","domain","objectId","parentId","metadata","proposalId"));val id=E2eeKeys.technical(operation.getString("entityId"));val objectId=E2eeKeys.technical(operation.getString("objectId"))
            check(ids.add(id)&&objects.add(objectId)&&objectId.matches(Regex("product-version:[a-f0-9-]{36}"))&&operation.getString("action") in setOf("create","update","delete","restore","propose-complete")&&operation.get("domain")==E2eeProductContract.domain(operation.getString("kind"))){"E2EE_PRODUCT_TRANSACTION_INVALID"}
            E2eeCommands.integer(operation.get("expectedRevision"));E2eeProductContract.metadata(operation.getString("kind"),operation.getJSONObject("metadata"));if(!row.isNull("payloadHash"))E2eeEnvelope.decode(row.getString("payloadHash"),32)
        };JSONObject(value.toString())},::check)
    @Synchronized fun index(offline:Boolean=false):JSONArray{
        check();val prior=index.load();if(offline)return JSONArray((prior?.value?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE")).getJSONArray("entities").toString())
        client.refresh();check();val rows=JSONArray();val seen=mutableSetOf<String>();var after="";var eof=false;var limit=50;val reviewed=mutableMapOf<String,JSONObject>()
        for(page in 0..10032){val response=try{client.readProductIndex(after,limit)}catch(error:Exception){if(limit>1&&error.message=="E2EE_PRODUCT_PAGE_TOO_LARGE"){limit=maxOf(1,limit/2);continue};throw error}
            val verified=E2eeProductProofs.verifyPage(response,client::verifyServiceProof);check();val values=verified.entities;check(values.length()<=limit){"E2EE_PRODUCT_INDEX_INVALID"}
            for(at in 0 until values.length()){val value=E2eeProductContract.entity(values.getJSONObject(at));val id=value.getString("entityId");check(id>after&&seen.add(id)&&rows.length()<10000){"E2EE_PRODUCT_INDEX_INVALID"};rows.put(value)}
            for(at in 0 until verified.proposals.length()){val proposal=verified.proposals.getJSONObject(at);val id=proposal.getString("proposalId");check(id !in reviewed){"E2EE_PRODUCT_PROOF_INVALID"};reviewed[id]=proposal}
            if(values.length()<limit){eof=true;break};after=rows.getJSONObject(rows.length()-1).getString("entityId")};check(eof){"E2EE_PRODUCT_INDEX_INVALID"}
        val lookup=(0 until rows.length()).associate{rows.getJSONObject(it).let{row->row.getString("entityId") to row}};val old=prior?.value?.getJSONArray("entities")?:JSONArray()
        for(at in 0 until old.length()){val value=old.getJSONObject(at);val remote=lookup[value.getString("entityId")]?:error("E2EE_REMOTE_ROLLBACK");check(remote.getLong("revision")>=value.getLong("revision")&&(remote.getLong("revision")!=value.getLong("revision")||E2eeProductJson.same(remote,value))){"E2EE_REMOTE_ROLLBACK"}}
        if(!E2eeProductJson.same(old,rows))index.save(JSONObject().put("protocol",1).put("scopeId",scopeId).put("entities",rows),prior?.serial);check();proposals.clear();proposals.putAll(reviewed);return JSONArray(rows.toString())
    }
    @Synchronized fun read(input:JSONObject,offline:Boolean=false):JSONObject{
        check();val entity=E2eeProductContract.entity(input);val value=document(entity.getString("objectId"),entity.getString("kind")).load(offline);val body=version(value.value)
        check(!value.pending&&value.conflict==null&&value.remoteRevision==1L&&body.get("entityId")==entity.get("entityId")&&body.get("kind")==entity.get("kind")&&body.getLong("revision")==entity.getLong("revision")
            &&body.get("parentId")==entity.get("parentId")&&body.get("deleted")==entity.get("deleted")&&E2eeProductJson.same(body.get("metadata"),entity.get("metadata"))){"E2EE_PRODUCT_VERSION_INVALID"}
        if(!offline)client.assertObjectReference(entity.getString("domain"),entity.getString("objectId"),1,entity.getString("payloadHash"));check();return JSONObject(body.toString())
    }
    @Synchronized fun stage(edits:JSONArray,intentId:String=UUID.randomUUID().toString()):String{
        check();E2eeKeys.technical(intentId);check(edits.length() in 1..100){"E2EE_PRODUCT_BATCH_INVALID"};val drafts=JSONArray()
        for(at in 0 until edits.length()){val edit=edits.getJSONObject(at);val action=edit.getString("action");val kind=edit.getString("kind");val revision=E2eeCommands.integer(edit.get("expectedRevision"));check(revision<9_007_199_254_740_991L){"E2EE_INVALID_REVISION"}
            val header=version(JSONObject().put("protocol",1).put("scopeId",scopeId).put("entityId",edit.get("entityId")).put("kind",kind).put("revision",revision+1).put("parentId",edit.get("parentId")).put("deleted",action=="delete").put("metadata",edit.getJSONObject("metadata")).put("body",edit.get("body")))
            val operation=JSONObject().put("action",action).put("entityId",edit.get("entityId")).put("kind",kind).put("expectedRevision",revision).put("domain",E2eeProductContract.domain(kind)).put("objectId","product-version:${UUID.randomUUID()}")
                .put("parentId",edit.get("parentId")).put("metadata",header.get("metadata")).put("proposalId",if(action=="propose-complete")edit.optString("proposalId").ifEmpty{UUID.randomUUID().toString()}else JSONObject.NULL)
            drafts.put(JSONObject().put("operation",operation).put("version",header).put("payloadHash",JSONObject.NULL))
        }
        transaction(prefix+intentId).save(JSONObject().put("format","genesis-product-transaction-v1").put("scopeId",scopeId).put("intentId",intentId).put("drafts",drafts).put("acknowledged",false).put("receipt",JSONObject.NULL),null);check();return intentId
    }
    @Synchronized fun flush(intentId:String):JSONObject{
        check();E2eeKeys.technical(intentId);val store=transaction(prefix+intentId);var saved=store.load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");val state=JSONObject(saved.value.toString());if(state.getBoolean("acknowledged"))return state.getJSONObject("receipt")
        val drafts=state.getJSONArray("drafts");for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);val operation=draft.getJSONObject("operation");val header=version(draft.getJSONObject("version"))
            check(header.get("entityId")==operation.get("entityId")&&header.get("kind")==operation.get("kind")&&header.getLong("revision")==operation.getLong("expectedRevision")+1&&header.get("parentId")==operation.get("parentId")
                &&header.getBoolean("deleted")== (operation.getString("action")=="delete")&&E2eeProductJson.same(header.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_TRANSACTION_INVALID"}
            val doc=document(operation.getString("objectId"),operation.getString("kind"));val local=try{doc.load(true)}catch(error:IllegalStateException){if(error.message!="E2EE_OFFLINE_CONTENT_UNAVAILABLE")throw error;doc.save(header,null,0);doc.load(true)}
            check(local.conflict==null&&local.remoteRevision<=1&&E2eeProductJson.same(local.value,header)){"E2EE_PRODUCT_VERSION_IMMUTABLE"};if(local.pending)doc.flush()
            val reference=client.objectReference(operation.getString("domain"),operation.getString("objectId"));check();check(reference.getLong("revision")==1L&&(draft.isNull("payloadHash")||draft.get("payloadHash")==reference.get("payloadHash"))){"E2EE_OBJECT_REFERENCE_MISMATCH"}
            if(draft.isNull("payloadHash")){draft.put("payloadHash",reference.get("payloadHash"));saved=store.save(state,saved.serial)}
        }
        val operations=JSONArray();for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);operations.put(JSONObject(draft.getJSONObject("operation").toString()).put("payloadHash",draft.get("payloadHash")))}
        val receipt=client.executeService("product-commit",JSONObject().put("operations",operations),intentId);check();check(receipt.get("intentId")==intentId&&receipt.getJSONArray("results").length()==operations.length()){"E2EE_PRODUCT_RECEIPT_INVALID"}
        val results=receipt.getJSONArray("results");for(at in 0 until operations.length()){val operation=operations.getJSONObject(at);val result=(0 until results.length()).map{results.getJSONObject(it)}.singleOrNull{it.get("entityId")==operation.get("entityId")}?:error("E2EE_PRODUCT_RECEIPT_INVALID")
            check(result.getLong("revision")==operation.getLong("expectedRevision")+(if(operation.getString("action")=="propose-complete")0 else 1)&&result.get("payloadHash")==operation.get("payloadHash")){"E2EE_PRODUCT_RECEIPT_INVALID"}}
        store.save(state.put("acknowledged",true).put("receipt",receipt),saved.serial);check();return JSONObject(receipt.toString())
    }
    @Synchronized fun pending():List<String>{check();return device.vault.listLocal("draft",prefix).mapNotNull{id->val value=transaction(id).load()?:error("E2EE_PRODUCT_TRANSACTION_MISSING");if(value.value.getBoolean("acknowledged"))null else value.value.getString("intentId")}}
    @Synchronized fun proposal(id:String,expectedHash:String):JSONObject{
        check();E2eeKeys.technical(id);index();val proposal=proposals[id]?:error("E2EE_PRODUCT_PROPOSAL_STALE");val operation=proposal.getJSONObject("operation");check(operation.get("payloadHash")==expectedHash){"E2EE_PRODUCT_PROPOSAL_STALE"}
        val opened=document(operation.getString("objectId"),"task").load();val header=version(opened.value);check(!opened.pending&&opened.conflict==null&&opened.remoteRevision==1L&&header.get("entityId")==proposal.get("entityId")&&header.get("kind")=="task"
            &&header.getLong("revision")==proposal.getLong("baseRevision")+1&&!header.getBoolean("deleted")&&header.get("parentId")==operation.get("parentId")&&E2eeProductJson.same(header.get("metadata"),operation.get("metadata"))){"E2EE_PRODUCT_PROPOSAL_STALE"}
        client.assertObjectReference("shared-project",operation.getString("objectId"),1,expectedHash);check();return JSONObject().put("proposal",JSONObject(proposal.toString())).put("version",header)
    }
    @Synchronized fun approve(review:JSONObject,intentId:String=UUID.randomUUID().toString()):JSONObject{
        E2eeKeys.exact(review,setOf("proposalId","payloadHash","version"));E2eeKeys.technical(intentId);val held=JSONObject(review.toString());val current=proposal(held.getString("proposalId"),held.getString("payloadHash"))
        check(E2eeProductJson.same(version(held.getJSONObject("version")),current.getJSONObject("version"))){"E2EE_PRODUCT_PROPOSAL_STALE"};val proposal=current.getJSONObject("proposal");val operation=proposal.getJSONObject("operation");val values=checkNotNull(index.load()).value.getJSONArray("entities")
        val entity=(0 until values.length()).map{values.getJSONObject(it)}.singleOrNull{it.get("entityId")==proposal.get("entityId")}
        if(entity!=null&&entity.getLong("revision")==proposal.getLong("baseRevision")+1&&entity.get("objectId")==operation.get("objectId")&&entity.get("payloadHash")==held.get("payloadHash"))
            return JSONObject().put("intentId",intentId).put("proposalId",held.get("proposalId")).put("entityId",proposal.get("entityId")).put("completed",true).put("remaining",JSONArray())
        val result=client.executeService("product-approve",JSONObject().put("proposalId",held.get("proposalId")).put("entityId",proposal.get("entityId")).put("baseRevision",proposal.get("baseRevision")).put("payloadHash",held.get("payloadHash")),intentId);check()
        check(result.get("intentId")==intentId&&result.get("proposalId")==held.get("proposalId")&&result.get("entityId")==proposal.get("entityId")&&result.get("completed") is Boolean&&result.get("remaining") is JSONArray){"E2EE_PRODUCT_RECEIPT_INVALID"};return result
    }
    override fun toString()="E2eeSharedProduct([redacted])"
}
