package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

internal fun workflowFixture(manage: Boolean = true, revision: Int = 0): JSONObject {
    val statuses = JSONArray().put(JSONObject().put("id", "open").put("title", "В работе").put("isDone", 0).put("revision", 1))
        .put(JSONObject().put("id", "done").put("title", "Готово").put("isDone", 1).put("revision", 1))
    return JSONObject().put("config", JSONObject().put("enabled", false).put("revision", revision).put("statuses", JSONArray()).put("transitions", JSONArray()))
        .put("counts", JSONArray()).put("context", JSONObject().put("project", JSONObject().put("id", "project").put("title", "Команда")
            .put("role", if (manage) "owner" else "viewer").put("permissions", JSONObject().put("manageProjects", manage).put("editTasks", manage)))
            .put("statuses", statuses).put("customFieldDefinitions", JSONArray().put(JSONObject().put("id", "zero").put("title", "Оценка")
                .put("type", "number").put("archived", false).put("options", JSONArray().put("private-option")).put("default", "private-default"))))
}

class WorkflowLifecycleTest {
    private fun data() = WorkflowLifecycle.snapshot("project", workflowFixture())
    private fun rejected(code: String? = null, action: () -> Unit) {
        val failure = runCatching(action).exceptionOrNull(); assertNotNull(failure)
        if (code != null) assertEquals(code, failure!!.message)
    }
    @Test fun snapshotAcceptsOnlyEmptyPhpArrayAndMinimizesTheProtectedProjection() {
        val safe = data(); assertEquals(0, safe.getJSONObject("counts").length())
        assertFalse(safe.toString().contains("private-")); assertFalse(safe.toString().contains("editTasks"))
        assertFalse(safe.getJSONObject("context").getJSONArray("statuses").getJSONObject(0).getBoolean("isDone"))
        assertTrue(safe.getJSONObject("context").getJSONArray("statuses").getJSONObject(1).getBoolean("isDone"))
        rejected { WorkflowLifecycle.snapshot("project", workflowFixture().put("counts", JSONArray().put(0))) }
        rejected { WorkflowLifecycle.snapshot("other", workflowFixture()) }
        rejected { WorkflowLifecycle.snapshot("project", workflowFixture().put("counts", JSONObject().put("open", -1))) }
    }
    @Test fun nullAndZeroLimitsStayDistinctAndDoneStatusesNeverReceiveALimit() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data)
        WorkflowLifecycle.verify(edit, data, "project", false)
        val rule = edit.getJSONObject("draft").getJSONArray("statuses").getJSONObject(0)
        rule.put("wipLimit", "0"); WorkflowLifecycle.verify(edit, data, "project", false)
        val body = WorkflowLifecycle.command(edit, UUID.randomUUID().toString()).getJSONObject("body")
        assertEquals(0, body.getJSONArray("statuses").getJSONObject(0).getInt("wipLimit"))
        assertTrue(body.getJSONArray("statuses").getJSONObject(1).isNull("wipLimit"))
        data.getJSONObject("counts").put("open", 1)
        rejected("WORKFLOW_WIP_LIMIT") { WorkflowLifecycle.verify(edit, data, "project", false) }
        rule.put("wipLimit", JSONObject.NULL); WorkflowLifecycle.verify(edit, data, "project", false)
        edit.getJSONObject("draft").getJSONArray("statuses").getJSONObject(1).put("wipLimit", 0)
        rejected("WORKFLOW_INVALID") { WorkflowLifecycle.verify(edit, data, "project", false) }
    }
    @Test fun incompleteNumericTextAndRolesAreDurableButNotSendable() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data)
        edit.getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("wipLimit", "-")
        edit.getJSONObject("draft").getJSONArray("transitions").getJSONObject(0).put("roles", JSONArray())
        assertEquals("-", WorkflowLifecycle.validateEdit(edit).getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).getString("wipLimit"))
        rejected { WorkflowLifecycle.command(edit, UUID.randomUUID().toString()) }
    }
    @Test fun ownerMustHaveEntryAndEveryStatusMustReachCompletion() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data)
        val edges = WorkflowLifecycle.rows(edit.getJSONObject("draft").getJSONArray("transitions"))
        edit.getJSONObject("draft").put("transitions", JSONArray(edges.filterNot { it.isNull("fromStatusId") }))
        rejected("WORKFLOW_NO_SAFE_ENTRY") { WorkflowLifecycle.verify(edit, data, "project", false) }
        edit.getJSONObject("draft").put("transitions", JSONArray(edges.filterNot { it.optString("fromStatusId") == "open" && it.getString("toStatusId") == "done" }))
        rejected("WORKFLOW_NO_SAFE_EXIT") { WorkflowLifecycle.verify(edit, data, "project", false) }
    }
    @Test fun newCommandsRequireCurrentManagePermissionCatalogRevisionAndEmptyTaskQueue() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data)
        rejected("WORKFLOW_LOCAL_QUEUE") { WorkflowLifecycle.verify(edit, data, "project", true) }
        data.getJSONObject("context").getJSONObject("project").getJSONObject("permissions").put("manageProjects", false)
        rejected("WORKFLOW_PERMISSION_CHANGED") { WorkflowLifecycle.verify(edit, data, "project", false) }
        val viewer = WorkflowLifecycle.snapshot("project", workflowFixture(false))
        rejected("WORKFLOW_PERMISSION_CHANGED") { WorkflowLifecycle.verify(WorkflowLifecycle.newEdit(viewer), viewer, "project", false) }
        val fresh = data(); fresh.getJSONObject("context").getJSONArray("statuses").getJSONObject(0).put("revision", 2)
        rejected("WORKFLOW_CONFLICT") { WorkflowLifecycle.verify(edit, fresh, "project", false) }
        rejected("WORKFLOW_PERMISSION_CHANGED") { WorkflowLifecycle.verify(edit, data().put("offlineCache", true), "project", false) }
    }
    @Test fun rebasePreservesRemovedReferencesUntilTheAuthorExplicitlyRemovesThem() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data)
        edit.getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("requiredFields", JSONArray().put("custom:zero").put("storyPoints"))
        WorkflowLifecycle.verify(edit, data, "project", false)
        val changed = data(); changed.getJSONObject("context").getJSONArray("customFieldDefinitions").getJSONObject(0).put("archived", true)
        val rebased = WorkflowLifecycle.rebase(edit, changed, "project")
        assertTrue(rebased.toString().contains("custom:zero"))
        rejected("WORKFLOW_FIELD_UNAVAILABLE") { WorkflowLifecycle.verify(rebased, changed, "project", false) }
        changed.getJSONObject("context").put("statuses", JSONArray().put(changed.getJSONObject("context").getJSONArray("statuses").getJSONObject(1)))
        val removed = WorkflowLifecycle.rebase(edit, changed, "project")
        assertEquals(2, removed.getJSONObject("draft").getJSONArray("statuses").length())
        rejected("WORKFLOW_STATUS_UNCONFIGURED") { WorkflowLifecycle.verify(removed, changed, "project", false) }
    }
    @Test fun disableOnlyCanRepairBrokenRulesWithoutInventingTransitionsOrTaskRights() {
        val data = data(); val edit = WorkflowLifecycle.newEdit(data, true)
        edit.getJSONObject("draft").put("transitions", JSONArray())
        WorkflowLifecycle.verify(edit, data, "project", false)
        val body = WorkflowLifecycle.command(edit, UUID.randomUUID().toString()).getJSONObject("body")
        assertFalse(body.getBoolean("enabled")); assertFalse(body.has("statuses")); assertFalse(body.has("transitions"))
    }
    private fun page(from: Int, count: Int, more: Boolean): JSONObject = JSONObject().put("versions", JSONArray((from downTo from - count + 1).map {
        JSONObject().put("enabled", false).put("revision", it).put("statuses", JSONArray()).put("transitions", JSONArray())
            .put("createdAt", "2026-10-19T12:00:00Z").put("actorId", "do-not-cache")
    })).put("nextCursor", if (more) from - count + 1 else JSONObject.NULL)
    @Test fun historyLoadsZeroFiftyFiftyOneAndOneHundredThirtyOneWithoutActorData() {
        for (total in listOf(0, 50, 51, 131)) {
            var loaded: JSONObject? = null; var remaining = total
            do {
                val count = minOf(50, remaining); val before = loaded?.getLong("nextCursor")
                loaded = WorkflowLifecycle.history(loaded, page(remaining, count, remaining > count), before, total.toLong())
                remaining -= count
            } while (!loaded!!.isNull("nextCursor"))
            assertEquals(total, loaded.getJSONArray("versions").length()); assertFalse(loaded.toString().contains("do-not-cache"))
        }
    }
    @Test fun historyRejectsReorderedDuplicateMalformedAndLatePages() {
        val first = WorkflowLifecycle.history(null, page(131, 50, true), null, 131)
        rejected { WorkflowLifecycle.history(first, page(131, 50, true), 82, 131) }
        rejected { WorkflowLifecycle.history(first, page(81, 50, true), 99, 131) }
        rejected { WorkflowLifecycle.history(null, page(132, 50, true), null, 131) }
        val bad = page(50, 50, false); bad.getJSONArray("versions").getJSONObject(1).put("revision", 50)
        rejected { WorkflowLifecycle.history(null, bad, null, 50) }
        rejected { WorkflowLifecycle.history(null, page(50, 2, true), null, 50) }
    }
    @Test fun workflowFailuresRetainLegacyOutboxClassificationAndOnlySafeDetails() {
        val failure = workflowFailure(409, JSONObject().put("error", "WORKFLOW_REQUIRED_FIELDS").put("details", JSONObject()
            .put("statusId", "open").put("fields", JSONArray().put("storyPoints").put("custom:zero").put("<script>"))
            .put("values", "private")))!!
        assertTrue(definiteSharedRejection(failure)); assertEquals("WORKFLOW_REQUIRED_FIELDS", sharedFailureCode(failure))
        assertFalse(failure.details.toString().contains("private")); assertFalse(failure.details.toString().contains("script"))
        assertEquals(2, failure.details.getJSONArray("fields").length())
        assertNull(workflowFailure(500, JSONObject().put("error", "WORKFLOW_WIP_LIMIT")))
    }
    @Test fun workflowJournalCannotReadOrOverwritePlanningOrAnotherAccount() {
        val storage = MemoryPlanningStorage(); val workflow = PlanningJournal(storage, contract = WorkflowJournalContract)
        val record = workflow.save("one", "project", null, WorkflowLifecycle.newEdit(data()))
        assertNull(PlanningJournal(storage).load("one", "project")); assertNull(workflow.load("two", "project"))
        assertEquals(record.toString(), PlanningJournal(storage, contract = WorkflowJournalContract).load("one", "project")!!.toString())
        rejected { workflow.save("one", "project", null, record.getJSONObject("edit")) }
    }
}
