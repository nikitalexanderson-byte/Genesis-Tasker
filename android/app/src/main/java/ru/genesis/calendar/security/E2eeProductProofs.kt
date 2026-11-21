package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** An untrusted index cannot turn an arbitrary upload into an active object,
 * replace an attestation or claim approvals for another encrypted version. */
internal object E2eeProductProofs{
    class Page(val entities:JSONArray,val proposals:JSONArray){override fun toString()="E2eeProductProofs.Page([redacted])"}
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun matches(operation:JSONObject,entity:JSONObject)=operation.getLong("expectedRevision")+1==entity.getLong("revision")&&listOf("kind","domain","objectId","payloadHash","parentId").all{operation.get(it)==entity.get(it)}
        &&(operation.getString("action")=="delete")==entity.getBoolean("deleted")&&E2eeProductJson.same(operation.get("metadata"),entity.get("metadata"))
    fun verifyPage(input:JSONObject,verify:(JSONObject)->JSONObject):Page{
        E2eeKeys.exact(input,setOf("entities","heads","proofs","proposals","attestations","checkpointHash","directoryRevision"))
        for(key in listOf("entities","heads","proofs","proposals","attestations"))check(input.getJSONArray(key).length()<=if(key in setOf("entities","heads"))50 else 10000){"E2EE_PRODUCT_PROOF_INVALID"}
        val entities=rows(input.getJSONArray("entities")).map(E2eeProductContract::entity).associateBy{it.getString("entityId")};val heads=rows(input.getJSONArray("heads"));check(entities.size==input.getJSONArray("entities").length()&&heads.size==entities.size){"E2EE_PRODUCT_PROOF_INVALID"}
        val proofs=mutableMapOf<String,JSONObject>();for(row in rows(input.getJSONArray("proofs"))){E2eeKeys.exact(row,setOf("proofHash","packet"));val hash=row.getString("proofHash");E2eeEnvelope.decode(hash,32);check(hash !in proofs){"E2EE_PRODUCT_PROOF_INVALID"}
            val bytes=row.getString("packet").toByteArray(Charsets.UTF_8);check(bytes.size<=4*1024*1024){"E2EE_PRODUCT_PROOF_INVALID"};val proof=try{verify(E2eeFileManifestJson.readPrivateDocument(bytes))}finally{bytes.fill(0)};check(proof.get("proofHash")==hash){"E2EE_PRODUCT_PROOF_INVALID"}
            val command=proof.getJSONObject("command");val payload=command.getJSONObject("payload")
            when(command.getString("action")){"product-commit"->{E2eeKeys.exact(payload,setOf("intentId","operations"));val ops=rows(payload.getJSONArray("operations")).map(E2eeProductContract::operation);check(ops.size in 1..100&&ops.map{it.getString("entityId")}.toSet().size==ops.size){"E2EE_PRODUCT_PROOF_INVALID"}}
                "product-approve"->{E2eeKeys.exact(payload,setOf("intentId","proposalId","entityId","baseRevision","payloadHash"));for(key in listOf("proposalId","entityId"))E2eeKeys.technical(payload.getString(key));E2eeCommands.integer(payload.get("baseRevision"),1);E2eeEnvelope.decode(payload.getString("payloadHash"),32)}
                else->error("E2EE_PRODUCT_PROOF_INVALID")};E2eeKeys.technical(payload.getString("intentId"));proofs[hash]=proof
        }
        val proposals=mutableMapOf<String,JSONObject>();for(row in rows(input.getJSONArray("proposals"))){
            E2eeKeys.exact(row,setOf("proposalId","entityId","baseRevision","objectId","payloadHash","metadataJson","actorId","createdAt","proofHash"));val id=E2eeKeys.technical(row.getString("proposalId"));check(id !in proposals){"E2EE_PRODUCT_PROOF_INVALID"};Instant.parse(row.getString("createdAt"))
            val proof=proofs[row.getString("proofHash")]?:error("E2EE_PRODUCT_PROOF_INVALID");val command=proof.getJSONObject("command");val entity=entities[row.getString("entityId")]?:error("E2EE_PRODUCT_PROOF_INVALID")
            check(command.get("action")=="product-commit"&&proof.get("actorId")==row.get("actorId")&&entity.get("kind")=="task"){"E2EE_PRODUCT_PROOF_INVALID"}
            val operation=rows(command.getJSONObject("payload").getJSONArray("operations")).singleOrNull{it.get("entityId")==row.get("entityId")&&it.get("proposalId")==id}?:error("E2EE_PRODUCT_PROOF_INVALID")
            val bytes=row.getString("metadataJson").toByteArray(Charsets.UTF_8);val metadata=try{E2eeProductContract.metadata("task",E2eeFileManifestJson.readPrivateDocument(bytes))}finally{bytes.fill(0)}
            check(operation.get("action")=="propose-complete"&&operation.getLong("expectedRevision")==row.getLong("baseRevision")&&operation.get("objectId")==row.get("objectId")&&operation.get("payloadHash")==row.get("payloadHash")
                &&operation.get("parentId")==entity.get("parentId")&&E2eeProductJson.same(operation.get("metadata"),metadata)){"E2EE_PRODUCT_PROOF_INVALID"}
            check(operation.getLong("expectedRevision")==entity.getLong("revision")||matches(operation,entity)){"E2EE_PRODUCT_PROOF_INVALID"}
            proposals[id]=JSONObject().put("proposalId",id).put("entityId",row.get("entityId")).put("baseRevision",row.get("baseRevision")).put("operation",operation).put("actorId",row.get("actorId")).put("createdAt",row.get("createdAt"))
        }
        val approvals=mutableMapOf<String,MutableSet<String>>();for(row in rows(input.getJSONArray("attestations"))){E2eeKeys.exact(row,setOf("proposalId","userId","deviceId","payloadHash","createdAt","proofHash"))
            val id=row.getString("proposalId");val proposal=proposals[id]?:error("E2EE_PRODUCT_PROOF_INVALID");val proof=proofs[row.getString("proofHash")]?:error("E2EE_PRODUCT_PROOF_INVALID");val command=proof.getJSONObject("command");val payload=command.getJSONObject("payload");val operation=proposal.getJSONObject("operation");val actor=proof.getString("actorId")
            check(command.get("action")=="product-approve"&&actor==row.get("userId")&&command.get("deviceId")==row.get("deviceId")&&payload.get("proposalId")==id&&payload.get("entityId")==proposal.get("entityId")
                &&payload.getLong("baseRevision")==proposal.getLong("baseRevision")&&payload.get("payloadHash")==operation.get("payloadHash")&&row.get("payloadHash")==operation.get("payloadHash")
                &&actor in E2eeProductContract.ids(operation.getJSONObject("metadata").getJSONArray("approverIds"))&&approvals.getOrPut(id){mutableSetOf()}.add(actor)){"E2EE_PRODUCT_PROOF_INVALID"}
        }
        val seen=mutableSetOf<String>();for(row in heads){E2eeKeys.exact(row,setOf("entityId","revision","proofHash"));val entity=entities[row.getString("entityId")]?:error("E2EE_PRODUCT_PROOF_INVALID");val proof=proofs[row.getString("proofHash")]?:error("E2EE_PRODUCT_PROOF_INVALID");val command=proof.getJSONObject("command")
            check(seen.add(row.getString("entityId"))&&row.getLong("revision")==entity.getLong("revision")){"E2EE_PRODUCT_PROOF_INVALID"}
            if(command.get("action")=="product-commit"){val operation=rows(command.getJSONObject("payload").getJSONArray("operations")).singleOrNull{it.get("entityId")==entity.get("entityId")}?:error("E2EE_PRODUCT_PROOF_INVALID")
                check(operation.get("action")!="propose-complete"&&matches(operation,entity)&&(operation.get("action")!="create"||entity.get("authorId")==proof.get("actorId"))){"E2EE_PRODUCT_PROOF_INVALID"}
            }else{val proposal=proposals[command.getJSONObject("payload").getString("proposalId")]?:error("E2EE_PRODUCT_PROOF_INVALID");val operation=proposal.getJSONObject("operation");val metadata=operation.getJSONObject("metadata");val required=E2eeProductContract.ids(metadata.getJSONArray("approverIds"))
                check(proposal.get("entityId")==entity.get("entityId")&&matches(operation,entity)&&metadata.getBoolean("completed")&&required.isNotEmpty()&&required.all{it in (approvals[proposal.getString("proposalId")]?:emptySet())}){"E2EE_PRODUCT_PROOF_INVALID"}}
        }
        return Page(JSONArray(entities.values),JSONArray(proposals.values))
    }
}
