package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

class E2eeNativeWorkspaceSourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private fun project(id: String,title: String = id) = JSONObject().put("id",id).put("title",title).put("description","")
    private fun base() = WorkspacePatch.emptyDocument()
    private fun structure(projects: JSONArray) = JSONObject().put("projects",projects).put("categories",JSONArray()).put("taskListLinks",JSONArray()).put("taskLists",JSONArray())
    private inner class Fixture(val remote: JSONObject = base(), val old: JSONObject = base(), val current: JSONObject? = null,
        val dirty: Boolean = true, val review: (suspend (E2eeWorkspaceReview) -> E2eeWorkspaceDecision)? = null) {
        var open=true; var reads=0; var protected=false; var keyAvailable=true; var rows=emptyList<DocumentRecord>(); var generation=0L; var pendingGeneration: Long? = null; val originals=mutableMapOf<String,String>()
        val rawKey=E2eeKeys.freshSecret(); val encrypted=WorkspaceCipher.encrypt(remote.toString().toByteArray(),rawKey)
        val response=JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId)
            .put("fence",lease.fence).put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32)))
            .put("directoryRevision",1).put("projects",JSONArray()).put("categories",JSONArray()).put("workspace",JSONObject().put("keyMode","account")
                .put("key",Base64.getEncoder().encodeToString(rawKey)).put("envelope",JSONObject().put("ciphertext",encrypted.ciphertext).put("iv",encrypted.iv)
                    .put("version",1).put("updatedAt",Instant.now().toString()).put("minimumWriterProtocol",9)))
        var pending=emptyList<OutboxRecord>()
        init {
            val documents=mutableListOf(DocumentRecord(account,"cloud-base","original-base-ciphertext",1)); originals["cloud-base"]=old.toString()
            if(current != null) { documents += DocumentRecord(account,"structure","original-structure-ciphertext",3); originals["structure"]=current.toString()
                if(dirty)pending=listOf(OutboxRecord(account,"workspace-structure",3,"operation")) }
            rows=documents
        }
        val source by lazy { E2eeNativeWorkspaceSource("owner",lease.scopeId,
            captureRows={ E2eeWorkspaceRows(rows,pending,generation,pendingGeneration) },decrypt={ row -> check(keyAvailable) { "KEYSTORE_INVALIDATED" }; requireNotNull(originals[row.kind]) },
            assertCurrent={check(open) { "ACCOUNT_CHANGED" }},legacyWorkspace={ context ->
                assertTrue("network before protected snapshot",protected); assertEquals(lease.migrationId,context.migrationId); reads++; JSONObject(response.toString())
            },review=review) }
        suspend fun capture() = source.captureLocal().also { protected=true }
        suspend fun run(previous: List<ByteArray> = emptyList()) = source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code: String, action: suspend () -> Unit) {
        try { action(); fail("Expected $code") } catch(error: Exception) { assertTrue("Unexpected redacted failure class: ${error.javaClass.simpleName}",error.message?.contains(code) == true) }
    }
    private fun main(result: E2eePathReconciliation) = JSONObject(result.content.first { it.objectId == "personal-workspace-v1" }.bytes.toString(Charsets.UTF_8))
    @Test fun actualRowCaptureRetainsOriginalsAndMergesQueuedWorkWithoutAcknowledgingIt() = runBlocking {
        val f=Fixture(current=structure(JSONArray().put(project("offline")))); val before=f.rows.toList(); val snapshot=f.capture()
        assertEquals(0,f.reads); assertTrue(snapshot.toString(Charsets.UTF_8).contains("original-structure-ciphertext"))
        val result=f.source.reconcile(snapshot,emptyList(),lease); assertTrue(result.complete); assertEquals("offline",main(result).getJSONArray("projects").getJSONObject(0).getString("id"))
        assertEquals(before,f.rows); assertEquals(1,f.pending.size)
        val content=result.content.joinToString { it.bytes.toString(Charsets.UTF_8) }
        assertFalse(content.contains("original-structure-ciphertext")); assertFalse(content.contains(Base64.getEncoder().encodeToString(f.rawKey))); assertFalse(content.contains("operationId"))
    }
    @Test fun deletionPreservesTombstoneAndRemoteEditNeedsAnExactReviewFingerprint() = runBlocking {
        val old=base().put("projects",JSONArray().put(project("deleted","old")))
        val deletion=Fixture(remote=old,old=old,current=structure(JSONArray())); val deleted=main(deletion.run())
        assertEquals(0,deleted.getJSONArray("projects").length()); assertEquals("deleted",deleted.getJSONObject("syncMetadata").getJSONArray("tombstones").getJSONObject(0).getString("id"))
        val edited=base().put("projects",JSONArray().put(project("deleted","remote edit")))
        rejects("CONFLICT_REVIEW_REQUIRED") { Fixture(edited,old,structure(JSONArray())).run() }
        val reviewed=Fixture(edited,old,structure(JSONArray()),review={ E2eeWorkspaceDecision(it.preview.fingerprint,WorkspacePatch.ConflictPolicy.KEEP_LOCAL) })
        assertEquals(0,main(reviewed.run()).getJSONArray("projects").length())
        rejects("CONFLICT_REVIEW_REQUIRED") { Fixture(edited,old,structure(JSONArray()),review={ E2eeWorkspaceDecision("stale",WorkspacePatch.ConflictPolicy.KEEP_LOCAL) }).run() }
    }
    @Test fun changedAttemptsOrLostQueueRequireReviewInsteadOfResurrectingOrDroppingRecords() = runBlocking {
        val f=Fixture(current=structure(JSONArray().put(project("prior")))); val old=f.capture(); f.originals["structure"]=structure(JSONArray()).toString()
        rejects("HISTORY_REVIEW_REQUIRED") { f.run(listOf(old)) }; assertEquals(0,f.reads)
        val orphan=Fixture(current=structure(JSONArray().put(project("orphan"))),dirty=false)
        rejects("LOCAL_WORK_REVIEW_REQUIRED") { orphan.run() }
        val mismatch=Fixture(current=structure(JSONArray().put(project("queued")))); mismatch.pending=listOf(OutboxRecord(account,"workspace-structure",2,"older"))
        rejects("QUEUE_REVIEW_REQUIRED") { mismatch.run() }
    }
    @Test fun invalidatedKeysAccountChangesFutureFormatsAndWrongSourceNeverProduceEmptyMigration() = runBlocking {
        val locked=Fixture(); locked.keyAvailable=false; rejects("KEYSTORE_INVALIDATED") { locked.capture() }; assertEquals(0,locked.reads)
        val switched=Fixture(); val snapshot=switched.capture(); switched.open=false; rejects("ACCOUNT_CHANGED") { switched.source.reconcile(snapshot,emptyList(),lease) }
        for(field in listOf("ownerId","scopeId","migrationId","sourceHash")) {
            val f=Fixture(); f.response.put(field,"foreign"); rejects("SCOPE_BINDING_MISMATCH") { f.run() }
        }
        val future=Fixture(); future.response.getJSONObject("workspace").getJSONObject("envelope").put("minimumWriterProtocol",10)
        rejects("FORMAT_UNSUPPORTED") { future.run() }
        val missing=Fixture(); missing.response.getJSONObject("workspace").put("keyMode","client").put("key",JSONObject.NULL)
        rejects("LEGACY_KEY_UNAVAILABLE") { missing.run() }
    }
    @Test fun staleRelationalRowsRemainSeparateFromTheCurrentWorkspace() = runBlocking {
        val f=Fixture(); f.response.getJSONArray("projects").put(JSONObject().put("id","historical").put("parent_id",JSONObject.NULL).put("category_id",JSONObject.NULL)
            .put("title","Historical").put("description","").put("tags_json","[]").put("status","active").put("position",0).put("created_at",Instant.now().toString()).put("updated_at",Instant.now().toString()))
        val result=f.run(); assertEquals(0,main(result).getJSONArray("projects").length())
        assertEquals("Historical",JSONObject(result.content[1].bytes.toString(Charsets.UTF_8)).getJSONArray("projects").getJSONObject(0).getString("title"))
    }
    @Test fun resetGenerationsAndRemoteRollbackCannotResurrectOldLocalContent() = runBlocking {
        val reset=Fixture(); reset.response.put("legacyGeneration",1); rejects("GENERATION_REVIEW_REQUIRED") { reset.run() }
        val pending=Fixture(); pending.pendingGeneration=1; rejects("GENERATION_REVIEW_REQUIRED") { pending.run() };assertEquals(0,pending.reads)
        val rollback=Fixture(); rollback.rows=rollback.rows.map { it.copy(revision=3) };rejects("REMOTE_ROLLBACK") { rollback.run() }
    }
    @Test fun aRemoteTombstoneUnknownToTheBaseCannotBeReclassifiedAsAnOfflineCreation() = runBlocking {
        val remote=base().put("syncMetadata",JSONObject().put("schemaVersion",1).put("entities",JSONObject()).put("fields",JSONObject())
            .put("tombstones",JSONArray().put(JSONObject().put("collection","projects").put("id","already-deleted").put("version",5)
                .put("updatedAt","2026-11-18T00:00:00Z").put("deviceId","other"))))
        val f=Fixture(remote=remote,current=structure(JSONArray().put(project("already-deleted"))))
        rejects("TOMBSTONE_REVIEW_REQUIRED") { f.run() };assertEquals(1,f.pending.size)
    }
    @Test fun nativeAchievementIdsAndClocksBecomeTheCanonicalWebIdentityWithoutDiscardingFields() = runBlocking {
        val f=Fixture(dirty=false)
        val habits=JSONObject().put("localSchema",1).put("achievementUnlocks",JSONArray().put(JSONObject().put("achievementId","first-step").put("unlockedAt","2026-11-18T00:00:00Z")))
        f.originals["habits"]=habits.toString(); f.rows=f.rows+DocumentRecord(account,"habits","original-achievement",2)
        f.pending=listOf(OutboxRecord(account,"habits",2,"achievement-operation"))
        val output=main(f.run());assertEquals("achievement:first-step",output.getJSONArray("achievementUnlocks").getJSONObject(0).getString("id"))
        val clocks=output.getJSONObject("syncMetadata").getJSONObject("entities").getJSONObject("achievementUnlocks")
        assertTrue(clocks.has("achievement:first-step"));assertFalse(clocks.has("first-step"))
    }
    @Test fun strictEventPreflightKeepsRealMeasurementsAndRejectsLossyOrMalformedJournals() = runBlocking {
        val event=JSONObject().put("id","measurement").put("createdAt","2026-11-18T00:00:00Z").put("updatedAt","2026-11-18T00:00:00Z")
            .put("version",1).put("syncState","local").put("habitId","habit").put("date","2026-11-18").put("entryId","measurement")
            .put("ruleId","rule").put("replaces",JSONArray()).put("value",1000).put("note","").put("source","manual").put("historical",false)
        val document=base().put("habitMeasurements",JSONArray().put(event));val f=Fixture(remote=document,old=document)
        assertEquals(workspaceConflictJson(event),workspaceConflictJson(main(f.run()).getJSONArray("habitMeasurements").getJSONObject(0)))
        val future=base().put("habitMeasurements",JSONArray().put(JSONObject(event.toString()).put("futurePrivateField","must survive")))
        rejects("EVENT_REVIEW_REQUIRED") { Fixture(remote=future).run() }
        for(name in listOf("habitMeasurements","habitTimers","habitHistory")) {
            rejects("EVENT_REVIEW_REQUIRED") { Fixture(remote=base().put(name,JSONArray().put(JSONObject().put("id","invalid")))).run() }
        }
    }
    @Test fun malformedPrivateJsonNeverAppearsInErrorMessagesOrCauses() = runBlocking {
        val f=Fixture(current=structure(JSONArray())); f.originals["structure"]="PRIVATE SYNTHETIC CONTENT MUST NOT REACH ERRORS"
        try{f.capture();fail("Malformed source accepted")}catch(error: Exception) {
            assertEquals("E2EE_WORKSPACE_SOURCE_INVALID",error.message);assertNull(error.cause);assertFalse(error.toString().contains("PRIVATE SYNTHETIC"))
        }
        val wrongType=Fixture(remote=base().put("projects","PRIVATE SYNTHETIC VALUE"))
        try{wrongType.run();fail("Invalid collection accepted")}catch(error: Exception) {
            assertEquals("E2EE_WORKSPACE_SOURCE_INVALID",error.message);assertNull(error.cause);assertFalse(error.toString().contains("PRIVATE SYNTHETIC"))
        }
    }
}
