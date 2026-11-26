package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class E2eeLegacyCaptureResponseTest {
    private val context=E2eeMigrationSourceContext("owner","project:owner","migration",1,E2eeEnvelope.encode(ByteArray(32)),2)
    private fun packet(fence:Long=2)=JSONObject().put("command",JSONObject().put("payload",JSONObject()
        .put("migrationId",context.migrationId).put("sourceHash",context.sourceHash).put("fence",fence).put("maxFragments",50)))
    private fun response():JSONObject {
        val header=JSONObject().put("protocol",1).put("ownerId",context.ownerId).put("scopeId",context.scopeId)
            .put("kind","project").put("resourceId","owner").put("migrationId",context.migrationId).put("fence",2)
            .put("sourceHash",context.sourceHash).put("checkpointHash",context.sourceHash).put("directoryRevision",1)
        return JSONObject(header.toString()).put("fragments",JSONArray().put(JSONObject(header.toString()).put("chunk","unchanged")))
    }
    @Test fun renewedFenceIsProjectedWithoutRewritingTheOriginalResponse(){
        val original=response();val retained=original.toString()
        val projected=projectLegacyCaptureResponse(original,packet(),context)
        assertEquals(1L,projected.getLong("fence"));assertEquals(1L,projected.getJSONArray("fragments").getJSONObject(0).getLong("fence"))
        assertEquals("unchanged",projected.getJSONArray("fragments").getJSONObject(0).getString("chunk"));assertEquals(retained,original.toString())
    }
    @Test fun foreignOrInventedResponseFencesCannotBeProjected(){
        for(field in listOf("ownerId","scopeId","migrationId","sourceHash","fence")){
            val original=response().put(field,if(field=="fence")3 else "foreign")
            val error=runCatching{projectLegacyCaptureResponse(original,packet(),context)}.exceptionOrNull()
            assertNotNull(field,error);assertEquals("E2EE_SCOPE_BINDING_MISMATCH",error?.message)
        }
    }
    @Test fun foreignBatchPartsOrMissingSignedBatchAdmissionCannotBeProjected(){
        val original=response();original.getJSONArray("fragments").getJSONObject(0).put("fence",1)
        assertEquals("E2EE_SCOPE_BINDING_MISMATCH",runCatching{projectLegacyCaptureResponse(original,packet(),context)}.exceptionOrNull()?.message)
        val unsignedBatch=packet();unsignedBatch.getJSONObject("command").getJSONObject("payload").remove("maxFragments")
        assertNotNull(runCatching{projectLegacyCaptureResponse(response(),unsignedBatch,context)}.exceptionOrNull())
    }
}
