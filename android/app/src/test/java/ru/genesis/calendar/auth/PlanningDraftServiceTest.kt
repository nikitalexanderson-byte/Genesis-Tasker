package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

private class PlanningAccessFixture : PlanningDraftAccess {
    var current = true
    var queued = false
    var loseReply = false
    var replayRejection = false
    var changeAccountOnSend = false
    var cache = false
    var pageMode = "valid"
    var sent = 0
    var pages = 0
    var afterSend: (() -> Unit)? = null
    val commands = mutableListOf<String>()
    val receipts = mutableMapOf<String, JSONObject>()
    val snapshot = JSONObject().put("config", JSONObject().put("enabled", true).put("estimateUnit", "points").put("revision", 1))
        .put("context", JSONObject().put("permissions", JSONObject().put("manageProjects", true).put("organizeTasks", true).put("editTasks", true)))
        .put("sprints", JSONArray().put(JSONObject().put("id", "source").put("projectId", "project").put("state", "active").put("revision", 1))
            .put(JSONObject().put("id", "next").put("projectId", "project").put("state", "planning").put("revision", 1)))
        .put("fingerprint", "a".repeat(64))
    val records = (0 until 131).map { JSONObject().put("id", "task-$it").put("projectId", "project").put("sprintId", "source")
        .put("revision", 1).put("title", "Only the live task response contains this title · $it") }
    override fun check() { if (!current) throw CancellationException("Account generation changed") }
    override fun planning(projectId: String) = JSONObject(snapshot.toString()).put("offlineCache", cache)
    override fun hasTaskQueue(projectId: String) = queued
    override fun tasks(filter: JSONObject, cursor: String?): JSONObject {
        pages++; assertEquals("open", filter.getString("completion")); assertEquals("source", filter.getString("sprintId"))
        val from = cursor?.toInt() ?: 0; val end = minOf(from + 100, records.size)
        return JSONObject().put("tasks", JSONArray(records.subList(from, end))).put("total", records.size)
            .put("queryVersion", if (pageMode == "changed" && cursor != null) "changed" else "query-1")
            .put("offlineCache", pageMode == "cached").put("nextCursor", when {
                pageMode == "loop" -> "100"
                end < records.size -> end.toString()
                else -> JSONObject.NULL
            })
    }
    override fun send(projectId: String, command: JSONObject): JSONObject {
        check(); sent++; commands.add(command.toString())
        val body = command.getJSONObject("body"); val request = body.getString("requestId")
        if (replayRejection && receipts.containsKey(request)) throw AuthApiError("PLANNING_CONFLICT")
        val result = receipts.getOrPut(request) {
            JSONObject().put("config", JSONObject().put("enabled", body.getBoolean("enabled"))
                .put("estimateUnit", body.getString("estimateUnit")).put("revision", body.getInt("expectedRevision") + 1)).also {
                snapshot.put("config", JSONObject(it.getJSONObject("config").toString()))
            }
        }
        afterSend?.invoke()
        if (changeAccountOnSend) current = false
        if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        return JSONObject(result.toString())
    }
}

class PlanningDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private val journal = PlanningJournal(storage)
    private val access = PlanningAccessFixture()
    private val service = PlanningDraftService(journal, "account", access)
    private fun edit() = JSONObject().put("kind", "settings").put("enabled", true).put("estimateUnit", "hours").put("expectedRevision", 1)
    private fun prepared(): JSONObject {
        val saved = service.save("project", null, edit())
        return service.prepare("project", saved.getString("stamp"))
    }
    private fun rejected(block: () -> Unit) { assertTrue(runCatching(block).isFailure) }
    @Test fun lostReplyReopensAndReplaysTheExactStoredCommandAfterTheServerChanged() {
        val prepared = prepared(); access.loseReply = true
        rejected { service.send("project", prepared.getString("stamp")) }
        val reopened = PlanningDraftService(PlanningJournal(storage), "account", access)
        val pending = reopened.load("project")!!
        assertEquals("pending", pending.getString("phase"))
        // A receipt still needs to be retrievable after another manager disables planning.
        access.snapshot.getJSONObject("config").put("enabled", false).put("revision", 3)
        val result = reopened.send("project", pending.getString("stamp"))
        assertEquals("received", result.getString("phase")); assertEquals(2, access.sent)
        assertEquals(access.commands[0], access.commands[1])
        assertEquals(prepared.getString("command"), result.getString("command"))
        assertEquals(1, access.receipts.size)
    }
    @Test fun storageMustCommitTheAttemptMarkerBeforeAnyNetworkWrite() {
        val prepared = prepared(); storage.fail = true
        rejected { service.send("project", prepared.getString("stamp")) }
        assertEquals(0, access.sent); assertEquals(0, service.load("project")!!.getInt("attempts"))
    }
    @Test fun receivedReplyWithFailedLocalPersistenceCanStillRecoverItsReceipt() {
        val prepared = prepared(); access.afterSend = { storage.fail = true }
        rejected { service.send("project", prepared.getString("stamp")) }
        storage.fail = false; access.afterSend = null
        val pending = service.load("project")!!
        assertEquals("pending", pending.getString("phase"))
        val done = service.send("project", pending.getString("stamp"))
        assertEquals("received", done.getString("phase")); assertEquals(1, access.receipts.size)
        assertEquals(access.commands[0], access.commands[1])
    }
    @Test fun queueCachedPermissionsAndCurrentManagerRightsBlockNewCommands() {
        val saved = service.save("project", null, edit())
        for (case in listOf("queue", "cache", "rights")) {
            access.queued = case == "queue"; access.cache = case == "cache"
            access.snapshot.getJSONObject("context").getJSONObject("permissions").put("manageProjects", case != "rights")
            rejected { service.prepare("project", saved.getString("stamp")) }
            assertEquals("editing", service.load("project")!!.getString("phase"))
            assertEquals(0, access.sent)
        }
    }
    @Test fun rejectedReplayCannotBeDiscardedOrRebasedIntoADuplicateOperation() {
        val prepared = prepared(); access.loseReply = true
        rejected { service.send("project", prepared.getString("stamp")) }
        access.replayRejection = true
        val first = service.load("project")!!; rejected { service.send("project", first.getString("stamp")) }
        val ambiguous = service.load("project")!!
        assertEquals("pending", ambiguous.getString("phase")); assertEquals(2, ambiguous.getInt("attempts"))
        rejected { service.remove("project", ambiguous.getString("stamp")) }
        rejected { service.rebase("project", ambiguous.getString("stamp")) }
        assertEquals(prepared.getString("command"), service.load("project")!!.getString("command"))
    }
    @Test fun accountSwitchAfterDispatchDoesNotPublishTheOldResponseIntoTheNewAccount() {
        val prepared = prepared(); access.changeAccountOnSend = true
        rejected { service.send("project", prepared.getString("stamp")) }
        rejected { service.load("project") }
        assertEquals("pending", journal.load("account", "project")!!.getString("phase"))
        val another = PlanningDraftService(journal, "another-account", PlanningAccessFixture())
        assertNull(another.load("project"))
    }
    @Test fun completionFetches100Plus31AndPersistsReferencesWithoutTaskTitles() {
        val result = service.completion("project", "source", null)
        assertEquals(2, access.pages); assertEquals(131, result.getJSONArray("tasks").length())
        val record = result.getJSONObject("record")
        assertEquals(131, record.getJSONObject("edit").getJSONArray("tasks").length())
        assertEquals(0, record.getJSONObject("edit").getJSONObject("choices").length())
        assertFalse(storage.records.values.single().contains("Only the live task response"))
        rejected { service.prepare("project", record.getString("stamp")) }
        val edit = JSONObject(record.getJSONObject("edit").toString()).apply {
            val choices = getJSONObject("choices")
            access.records.forEach { choices.put(it.getString("id"), "backlog") }
        }
        val changed = service.save("project", record.getString("stamp"), edit)
        val prepared = service.prepare("project", changed.getString("stamp"))
        assertEquals("pending", prepared.getString("phase"))
        assertEquals(131, JSONObject(prepared.getString("command")).getJSONObject("body").getJSONArray("outcomes").length())
    }
    @Test fun incompleteChangedOrRepeatedPagesNeverBecomeACompletionDraft() {
        for (mode in listOf("changed", "loop", "cached")) {
            access.pageMode = mode
            rejected { service.completion("project", "source", null) }
            assertNull(service.load("project")); assertEquals(0, access.sent)
        }
    }
}
