package ru.genesis.calendar.security

import org.json.JSONObject

/** Shared exact state decoder. Cross-scope custody supplies its independently
 * verified target; parsing never invents a scope or a replay capability. */
internal object E2eeMigrationStateCodec {
    private fun number(value:JSONObject,key:String,minimum:Long=0)=E2eeCommands.integer(value.get(key),minimum)
    private fun nullable(value:JSONObject,key:String)=if(value.isNull(key))null else value.getJSONObject(key)
    fun read(bytes:ByteArray,vault:E2eeSourceReadVault,target:E2eeSourceStage.Target,required:List<String>,allowed:Set<String>):JSONObject {
        val state = E2eeFileManifestJson.readMigrationHistory(bytes)
        val phases = setOf("preparing", "uploading", "verified", "active", "cancelled")
        val protocol=number(state,"protocol")
        check(protocol in setOf(1L,2L,3L,4L,5L) && state.getString("phase") in phases) { "E2EE_CORRUPT_MIGRATION" }
        E2eeKeys.exact(state,setOf("protocol","migrationId","phase","ancestors","sourceHash","lease","plan","logical","uploaded","manifestHash","verifiedCheckpoint","pending","resuming","checkpointHash","directoryRevision")+
            (if(protocol>=3L)setOf("source")else setOf("snapshotParts","snapshotSize","snapshotHash"))+(if(protocol in setOf(4L,5L))setOf("ownership")else emptySet())+(if(protocol==5L)setOf("adopted")else emptySet())+(if(protocol==4L&&state.has("cancelReceipt"))setOf("cancelReceipt")else emptySet())+(if(state.has("startCancellation"))setOf("startCancellation")else emptySet())+(if(protocol!=1L)setOf("local","planned")else emptySet()))
        E2eeKeys.technical(state.getString("migrationId"))
        val plan = state.getJSONArray("plan"); val logical = state.getJSONArray("logical"); val ancestors = state.getJSONArray("ancestors")
        check(plan.length() <= 10000 && logical.length() <= 10000 && number(state,"uploaded") <= plan.length()
            && (protocol>=3L||number(state,"snapshotParts") <= 256 && number(state,"snapshotSize") <= E2eeFiles.MAX_FILE_BYTES)
            && ancestors.length() <= 32) { "E2EE_CORRUPT_MIGRATION" }
        val seen = mutableSetOf<String>()
        for (index in 0 until ancestors.length()) check(seen.add(E2eeKeys.technical(ancestors.getString(index)))) { "E2EE_CORRUPT_MIGRATION" }
        if(protocol!=1L){
            check(state.get("planned") is Boolean){"E2EE_CORRUPT_MIGRATION"}
            val local=E2eeMigrationLocal.validate(state.getJSONArray("local"),if(protocol==5L)state.getJSONObject("adopted").getJSONObject("reference").getString("attemptId")else state.getString("migrationId"),allowed)
            check(state.getBoolean("planned")||local.isEmpty()&&plan.length()==0&&logical.length()==0&&state.getString("phase") !in setOf("verified","active")){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol>=3L)E2eeMigrationStage.validate(state.getJSONObject("source"),vault,target,required)
        E2eeMigrationStartCancellation.validateShape(state)
        if(protocol==3L){
            check(state.get("phase") in setOf("preparing","cancelled")&&!state.getBoolean("planned")&&number(state,"uploaded")==0L
                &&listOf("sourceHash","lease","pending","resuming","manifestHash","verifiedCheckpoint").all{state.isNull(it)}){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol==5L){
            val adopted=state.getJSONObject("adopted");E2eeKeys.exact(adopted,setOf("reference","checkpointHash","directoryRevision","stateId","stateHash"));val reference=adopted.getJSONObject("reference");E2eeKeys.exact(reference,setOf("attemptId","manifestHash"))
            E2eeKeys.technical(reference.getString("attemptId"));E2eeKeys.technical(adopted.getString("stateId"));E2eeEnvelope.decode(reference.getString("manifestHash"),32);E2eeEnvelope.decode(adopted.getString("checkpointHash"),32);E2eeEnvelope.decode(adopted.getString("stateHash"),32);number(adopted,"directoryRevision",1)
            check(state.getBoolean("planned")&&state.get("phase")!="preparing"&&!state.isNull("sourceHash")&&!state.isNull("lease")&&number(state.getJSONObject("ownership"),"protocol")==3L){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol==4L){
            check(state.get("phase") in setOf("preparing","cancelled")&&!state.getBoolean("planned")&&plan.length()==0&&logical.length()==0&&state.getJSONArray("local").length()==0
                &&number(state,"uploaded")==0L&&state.isNull("manifestHash")&&state.isNull("verifiedCheckpoint")
                &&(state.isNull("pending")||state.getJSONObject("pending").getJSONObject("command").get("action") in setOf("migration-start","migration-cancel"))
                &&(state.isNull("resuming")||state.getJSONObject("resuming").getJSONObject("command").get("action")=="migration-resume")){"E2EE_CORRUPT_MIGRATION"}
            if(state.get("phase")=="cancelled")check(state.isNull("pending")&&state.isNull("resuming")&&(state.isNull("lease")||state.has("cancelReceipt"))){"E2EE_CORRUPT_MIGRATION"}
            else check(!state.has("cancelReceipt")){"E2EE_CORRUPT_MIGRATION"}
            if(state.has("cancelReceipt")){
                check(!state.isNull("cancelReceipt")&&!state.isNull("lease")){"E2EE_CORRUPT_MIGRATION"};val saved=state.getJSONObject("cancelReceipt")
                E2eeKeys.exact(saved,setOf("packet","result"));val result=saved.getJSONObject("result");E2eeKeys.exact(result,setOf("state"));check(result.get("state")=="preparing"){"E2EE_CORRUPT_MIGRATION"}
            }
        }
        if(protocol in setOf(4L,5L)){
            val pin=if(protocol==5L)state.getJSONObject("adopted")else state
            E2eeMigrationOwnership.validate(state.getJSONObject("ownership"),E2eeMigrationOwnership.Expected(state.getString("migrationId"),
                target,vault.localIdentity(),state.get("sourceHash") as? String,nullable(state,"lease"),pin.getString("checkpointHash"),number(pin,"directoryRevision",1)))
        }
        return state
    }
}
