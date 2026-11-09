package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkflowDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private val journal = PlanningJournal(storage, contract = WorkflowJournalContract)
    private val account = "one"
    private var fresh = workflowFixture()
    private var queue = false
    private var current = true
    private var lose = false
    private var reject = false
    private var switchOnRead = false
    private var switchOnSend = false
    private val sent = mutableListOf<String>()
    private val receipts = mutableMapOf<String, JSONObject>()
    private val access = object : WorkflowDraftAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun workflow(project: String): JSONObject { if (switchOnRead) current = false; return JSONObject(fresh.toString()) }
        override fun hasTaskQueue(project: String) = queue
        override fun send(project: String, body: JSONObject): JSONObject {
            sent.add(body.toString())
            if (reject) throw WorkflowFailure("WORKFLOW_WIP_LIMIT", JSONObject(), 409)
            val result = receipts.getOrPut(body.getString("requestId")) {
                val config = if (body.has("statuses")) WorkflowLifecycle.definition(body) else JSONObject(fresh.getJSONObject("config").toString()).put("enabled", false)
                config.put("revision", body.getLong("expectedRevision") + 1)
                fresh.put("config", config)
                JSONObject().put("config", config).put("counts", fresh.get("counts"))
            }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (switchOnSend) current = false
            return JSONObject(result.toString())
        }
    }
    private fun service() = WorkflowDraftService(PlanningJournal(storage, contract = WorkflowJournalContract), account, access)
    private fun draft(): JSONObject = service().save("project", null, WorkflowLifecycle.newEdit(WorkflowLifecycle.snapshot("project", fresh)))
    private fun prepared(): JSONObject { val old = draft(); return service().prepare("project", old.getString("stamp")) }
    @Test fun coldReopenRestoresInputAndUnknownAnswerReplaysTheExactOriginalBodyAndId() {
        val prepared = prepared(); lose = true
        assertTrue(runCatching { service().send("project", prepared.getString("stamp")) }.isFailure)
        val pending = service().load("project")!!
        assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts"))
        assertEquals(prepared.getString("command"), pending.getString("command"))
        val result = service().send("project", pending.getString("stamp"))
        assertEquals("received", result.getString("phase")); assertEquals(2, sent.size); assertEquals(sent[0], sent[1]); assertEquals(1, receipts.size)
    }
    @Test fun firstDefiniteRejectionAllowsExplicitRebaseButReplayRejectionNeverReleasesUnknownCommand() {
        val prepared = prepared(); reject = true
        runCatching { service().send("project", prepared.getString("stamp")) }
        var saved = service().load("project")!!; assertEquals("rejected", saved.getString("phase"))
        saved = service().rebase("project", saved.getString("stamp")).getJSONObject("record")
        assertEquals("editing", saved.getString("phase")); reject = false
        saved = service().prepare("project", saved.getString("stamp")); lose = true
        runCatching { service().send("project", saved.getString("stamp")) }
        saved = service().load("project")!!; reject = true
        runCatching { service().send("project", saved.getString("stamp")) }
        val unknown = service().load("project")!!
        assertEquals("pending", unknown.getString("phase")); assertEquals(2, unknown.getInt("attempts"))
        assertEquals(saved.getString("command"), unknown.getString("command"))
        assertTrue(runCatching { service().remove("project", unknown.getString("stamp")) }.isFailure)
        assertTrue(runCatching { service().rebase("project", unknown.getString("stamp")) }.isFailure)
    }
    @Test fun permissionRevocationAndOldTaskQueueBlockPreparedCommandsWithoutSending() {
        val prepared = prepared()
        queue = true; assertTrue(runCatching { service().send("project", prepared.getString("stamp")) }.isFailure)
        queue = false; fresh.getJSONObject("context").getJSONObject("project").getJSONObject("permissions").put("manageProjects", false)
        assertTrue(runCatching { service().send("project", prepared.getString("stamp")) }.isFailure)
        assertTrue(sent.isEmpty()); assertEquals(0, service().load("project")!!.getInt("attempts"))
    }
    @Test fun freshCatalogChangesRequireExplicitRebaseAndKeepOwnInput() {
        val old = draft()
        val changed = old.getJSONObject("edit").apply { getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("wipLimit", "7") }
        val edited = service().save("project", old.getString("stamp"), changed)
        fresh.getJSONObject("context").getJSONArray("statuses").getJSONObject(0).put("revision", 2)
        assertEquals("WORKFLOW_CONFLICT", runCatching { service().prepare("project", edited.getString("stamp")) }.exceptionOrNull()?.message)
        val rebased = service().rebase("project", edited.getString("stamp")).getJSONObject("record")
        assertEquals("7", rebased.getJSONObject("edit").getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).getString("wipLimit"))
        assertEquals("pending", service().prepare("project", rebased.getString("stamp")).getString("phase"))
    }
    @Test fun failedDiskCommitBeforeAttemptPreventsTheHttpWriteAndDoesNotDeleteInput() {
        val prepared = prepared(); storage.fail = true
        assertTrue(runCatching { service().send("project", prepared.getString("stamp")) }.isFailure); assertTrue(sent.isEmpty())
        storage.fail = false; assertEquals(prepared.toString(), service().load("project")!!.toString())
    }
    @Test fun accountGenerationChangeDuringFreshReadAndAfterSendCannotPublishAReply() {
        val draft = draft(); switchOnRead = true
        assertTrue(runCatching { service().prepare("project", draft.getString("stamp")) }.exceptionOrNull() is CancellationException)
        current = true; switchOnRead = false
        val prepared = service().prepare("project", draft.getString("stamp")); switchOnSend = true
        assertTrue(runCatching { service().send("project", prepared.getString("stamp")) }.exceptionOrNull() is CancellationException)
        current = true; val pending = service().load("project")!!
        assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts"))
        assertEquals(prepared.getString("command"), pending.getString("command"))
    }
    @Test fun competingEditorsPreserveTheirCopiesAndAnExplicitSelectionArchivesTheOtherInput() {
        val a = draft(); val b = JSONObject(a.getJSONObject("edit").toString()).apply { getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("wipLimit", "5") }
        val newer = service().save("project", a.getString("stamp"), b)
        assertTrue(runCatching { service().save("project", a.getString("stamp"), a.getJSONObject("edit")) }.isFailure)
        val version = service().saveCopy("project", java.util.UUID.randomUUID().toString(), null, a.getJSONObject("edit"))
        service().useCopy("project", version.getString("id"), version.getString("stamp"), newer.getString("stamp"))
        assertEquals(2, service().copies("project").size)
        assertTrue(service().copies("project").any { it.getJSONObject("edit").getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).optString("wipLimit") == "5" })
    }
    @Test fun corruptedJournalDoesNotBecomeAnEmptyDraft() {
        draft(); val key = storage.records.keys.single(); storage.records[key] = "{damaged"
        assertTrue(runCatching { service().load("project") }.isFailure)
        assertEquals("{damaged", storage.records[key])
    }
}
