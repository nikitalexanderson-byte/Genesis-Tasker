package ru.genesis.calendar.security

import org.json.JSONObject

/** Original start/resolution packets remain inert evidence. Only the live
 * coordinator has the transport; this parser grants no resume/restore rights. */
internal object E2eeMigrationStartCancellation {
    private fun invalid(): Nothing = error("E2EE_MIGRATION_CANCELLATION_PENDING")
    private fun unplanned(state: JSONObject): Boolean =
        E2eeCommands.integer(state.get("protocol")) in setOf(1L,2L,4L) && state.isNull("lease") && state.isNull("resuming") &&
            state.getJSONArray("plan").length()==0 && state.getJSONArray("logical").length()==0 &&
            (state.optJSONArray("local")?.length()?:0)==0 && !state.optBoolean("planned",false) &&
            E2eeCommands.integer(state.get("uploaded"))==0L && state.isNull("manifestHash") && state.isNull("verifiedCheckpoint") &&
            state.get("phase") in setOf("preparing","uploading","cancelled")
    fun unresolved(state: JSONObject): Boolean {
        if(!unplanned(state)||state.isNull("sourceHash"))return false
        val command=state.optJSONObject("pending")?.optJSONObject("command")?:return false
        val payload=command.optJSONObject("payload")?:return false
        return command.get("action")=="migration-start" && payload.get("migrationId")==state.get("migrationId") && payload.get("sourceHash")==state.get("sourceHash")
    }
    fun validateShape(state: JSONObject) {
        if(!state.has("startCancellation"))return
        val saved=state.getJSONObject("startCancellation");E2eeKeys.exact(saved,setOf("packet","result"))
        if(!unplanned(state)||state.isNull("sourceHash"))invalid()
        val outer=saved.getJSONObject("packet").getJSONObject("command");val payload=outer.getJSONObject("payload")
        E2eeKeys.exact(payload,setOf("original"));val original=payload.getJSONObject("original");val start=original.getJSONObject("command")
        if(outer.get("action")!="migration-cancel-start"||start.get("action")!="migration-start")invalid()
        val source=start.getJSONObject("payload");E2eeKeys.exact(source,setOf("migrationId","sourceHash"))
        if(source.get("migrationId")!=state.get("migrationId")||source.get("sourceHash")!=state.get("sourceHash"))invalid()
        if(saved.isNull("result")){if(!unresolved(state)||!E2eeRetainedMigrationProof.same(state.getJSONObject("pending"),original))invalid()}
        else {
            val result=saved.getJSONObject("result");E2eeKeys.exact(result,setOf("migrationId","sourceHash","startOperationId","startHash","outcome"));E2eeEnvelope.decode(result.getString("startHash"),32)
            if(state.get("phase")!="cancelled"||!state.isNull("pending")||result.get("migrationId")!=state.get("migrationId")||result.get("sourceHash")!=state.get("sourceHash")||
                result.get("startOperationId")!=start.get("operationId")||result.get("outcome") !in setOf("not-started","cancelled","superseded"))invalid()
        }
    }
    fun authenticate(state: JSONObject, frame: E2eeDirectory.Verified, deviceId: String, current: () -> Unit): Boolean {
        validateShape(state);if(!state.has("startCancellation"))return false
        val saved=state.getJSONObject("startCancellation");val own=frame.devices[deviceId]?:invalid()
        if(own.revoked||own.role!="owner")invalid();val signer=E2eeDirectory.signingKey(own.signingKey)
        val packet=saved.getJSONObject("packet");val original=packet.getJSONObject("command").getJSONObject("payload").getJSONObject("original")
        val outer=E2eeCommands.verify(packet,signer);current();val start=E2eeCommands.verify(original,signer);current()
        for(command in listOf(outer,start))if(command.get("ownerId")!=frame.ownerId||command.get("scopeId")!=frame.scopeId||command.get("deviceId")!=deviceId||
            E2eeCommands.integer(command.get("expectedRevision"))!=frame.checkpoint.revision||command.get("checkpointHash")!=frame.checkpoint.hash||
            E2eeCommands.integer(command.get("securityEpoch"),1)!=frame.securityEpoch)invalid()
        if(outer.get("operationId")==start.get("operationId"))invalid()
        if(!saved.isNull("result")&&saved.getJSONObject("result").get("startHash")!=E2eeCommands.hash(start))invalid()
        current();return !saved.isNull("result")
    }
}
