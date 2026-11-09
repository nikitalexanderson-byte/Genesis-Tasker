package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import java.time.Instant

class SharedBulkStateTest {
    @Test fun historyDateUsesTheSelectedLocaleAndTheUsersZoneAtThatInstant() {
        val zone = java.time.ZoneId.of("America/New_York")
        val winter = bulkHistoryTimestamp("2026-01-01T02:00:00Z", "en", zone)
        assertTrue(winter.contains("Dec 31, 2025")); assertTrue(winter.contains("9:00"))
        assertTrue(winter.endsWith("America/New_York (UTC-05:00)"))
        val summer = bulkHistoryTimestamp("2026-07-01T02:00:00Z", "ru", zone)
        assertTrue(summer.contains("30 июн.")); assertTrue(summer.contains("22:00"))
        assertTrue(summer.endsWith("America/New_York (UTC-04:00)"))
    }
    private class Gateway : SharedWorkspaceGateway {
        val storage = MemoryPlanningStorage(); var previewCalls = 0; var confirms = 0; var reads = 0; var lost = false; var queue = false; var unavailable = false; var offline = false
        var reportGate: CompletableDeferred<JSONObject>? = null
        var reportFailure: String? = null
        var taskCount = 131; var revision = 1; var response = bulkReportFixture().put("expiresAt", "2099-10-20T12:00:00Z")
        val commands = mutableListOf<String>()
        private val access = object : SharedBulkAccess {
            override fun check() { }
            override fun hasTaskQueue() = queue
            override fun scope(selection: JSONObject): JSONObject {
                val size = if (selection.getString("mode") == "all") taskCount else selection.getJSONArray("items").length()
                return bulkScopeFixture().put("total", size).also { it.getJSONArray("projects").getJSONObject(0).put("taskCount", size) }
            }
            override fun preview(body: JSONObject): JSONObject {
                previewCalls++; val size = if (body.getJSONObject("selection").getString("mode") == "all") taskCount else body.getJSONObject("selection").getJSONArray("items").length()
                response = bulkReportFixture().put("expiresAt", "2099-10-20T12:00:00Z").put("action", body.getJSONObject("action")).put("mode", body.getJSONObject("selection").getString("mode"))
                response.getJSONObject("counts").put("selected", size).put("affected", size).put("pending", size)
                if (lost) { lost = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return response
            }
        }
        private fun service() = SharedBulkDraftService(PlanningJournal(storage, contract = SharedBulkJournalContract), "actor", access)
        override suspend fun sharedProject(projectId: String): JSONObject {
            if (unavailable) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK)
            return JSONObject().put("project", JSONObject().put("id", "project").put("title", "Private project").put("role", "owner"))
        }
        override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String): JSONObject {
            reads++; val offset = cursor?.toInt() ?: 0; val end = minOf(offset + 100, taskCount)
            return JSONObject().put("tasks", JSONArray((offset until end).map { JSONObject().put("id", "task-$it").put("projectId", "project").put("revision", revision).put("title", "Private task $it") }))
                .put("total", taskCount).put("hasMore", end < taskCount).put("nextCursor", if (end < taskCount) end.toString() else JSONObject.NULL).put("queryVersion", "version-$revision")
        }
        override suspend fun sharedBulkDraft(projectId: String) = service().load(projectId)
        override suspend fun saveSharedBulkDraft(projectId: String, stamp: String?, edit: JSONObject) = service().save(projectId, stamp, edit)
        override suspend fun prepareSharedBulkDraft(projectId: String, stamp: String) = service().prepare(projectId, stamp)
        override suspend fun sendSharedBulkDraft(projectId: String, stamp: String) = service().send(projectId, stamp)
        override suspend fun removeSharedBulkDraft(projectId: String, stamp: String) = service().remove(projectId, stamp)
        override suspend fun sharedBulkReport(id: String, after: Long): JSONObject { if (unavailable) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED); reportFailure?.let { throw AuthApiError(it) }; return reportGate?.await() ?: JSONObject(response.toString()) }
        override suspend fun sharedBulkCommand(id: String, command: String, after: Long): JSONObject {
            commands += command; if (command == "confirm" && queue) error("BULK_LOCAL_QUEUE")
            when (command) {
                "confirm" -> { confirms++; response.put("state", "running") }
                "advance" -> { response.put("state", "done"); response.getJSONObject("counts").put("succeeded", response.getJSONObject("counts").getInt("pending")).put("pending", 0) }
                "cancel" -> { response.put("state", "cancelled"); response.getJSONObject("counts").put("cancelled", response.getJSONObject("counts").getInt("pending")).put("pending", 0) }
            }
            return JSONObject(response.toString())
        }
        override suspend fun sharedBulkHistory(cursor: String?) = JSONObject().put("operations", JSONArray().put(JSONObject().put("id", response.getString("id"))
            .put("state", response.getString("state")).put("createdAt", "2026-10-20T05:00:00Z").put("errorCode", JSONObject.NULL)
            .put("action", response.getJSONObject("action")).put("mode", response.getString("mode")).put("counts", response.getJSONObject("counts"))))
            .put("hasMore", false).put("nextCursor", JSONObject.NULL)
    }
    private fun state(gateway: Gateway, saved: String = SharedBulkForm.initial().saved(), operation: String = "", lost: () -> Unit = {}) = SharedBulkState(gateway, "project",
        JSONObject().put("projectIds", JSONArray().put("project")).put("q", "literal"), "priority", saved, operation, {}, {}, lost, {})
    private suspend fun prepared(gateway: Gateway): SharedBulkState {
        val state = state(gateway); state.load(); state.change(state.form.toggle(state.tasks!!.getJSONArray("tasks").getJSONObject(0))); state.configure(); state.preview(); return state
    }
    @Test fun typedProjectAccessErrorsClearBulkNamesAndCloseTheRevokedScope() = runBlocking {
        for (code in listOf("SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED")) {
            val gateway = Gateway(); var lost = 0; val state = state(gateway, operation = bulkOperationFixture, lost = { lost++ })
            state.load(); assertNotNull(state.report); gateway.reportFailure = code; state.refresh()
            assertEquals(1, lost); assertNull(state.report); assertNull(state.project); assertNull(state.tasks); assertNull(state.history)
        }
        assertFalse(workflowAccessLost(AuthApiError("AUTOMATION_CONFLICT")))
        assertFalse(workflowAccessLost(AuthApiError("CUSTOM_FIELD_UNAVAILABLE")))
    }
    @Test fun selectingAllUsesFrozenQueryInsteadOfDownloadingTheOtherTaskPages() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(); state.selectAll(); state.configure(); state.preview()
        assertEquals(1, gateway.reads); assertEquals(1, gateway.previewCalls); assertEquals(0, gateway.confirms)
        assertEquals("operation", state.pane); assertEquals(131, state.report!!.getJSONObject("counts").getInt("selected"))
        val selection = state.record!!.getJSONObject("edit").getJSONObject("selection"); assertEquals("version-1", selection.getString("queryVersion"))
        assertEquals("priority", selection.getString("sort")); assertEquals("literal", selection.getJSONObject("filter").getString("q"))
        state.command("confirm"); assertEquals("running", state.report!!.getString("state")); state.command("advance"); assertEquals(131, state.report!!.getJSONObject("counts").getInt("succeeded"))
    }
    @Test fun selectingRowsDoesNotMutateTasksAndSavedInputRestoresExplicitRevisions() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); first.load()
        first.change(first.form.toggle(first.tasks!!.getJSONArray("tasks").getJSONObject(0)).change("kind", "due").change("dueMode", "shift").change("days", "-3"))
        val snapshot = first.form.saved(); assertTrue(gateway.commands.isEmpty()); assertEquals(0, gateway.previewCalls)
        val restored = state(gateway, snapshot); restored.load(); assertEquals(1, restored.form.selectionCount); assertEquals("-3", restored.form.text("days"))
        assertEquals(1, restored.form.items.single().getInt("revision")); restored.configure(); restored.preview(); assertEquals(-3, restored.report!!.getJSONObject("action").getInt("days"))
    }
    @Test fun lostPreviewReopensPendingStateWithoutSendingUntilExplicitRetry() = runBlocking {
        val gateway = Gateway().apply { lost = true }; val original = prepared(gateway)
        assertEquals("pending", original.phase); assertFalse(original.online); val command = original.record!!.getString("command")
        val restored = state(gateway); restored.load(); assertEquals("pending", restored.phase); assertEquals(1, gateway.previewCalls)
        restored.retry(); assertEquals("received", restored.phase); assertEquals(command, restored.record!!.getString("command")); assertEquals(2, gateway.previewCalls)
        assertEquals(0, gateway.confirms)
    }
    @Test fun failedConfirmKeepsOperationIdentityForRefreshAndDoesNotInventANewPreview() = runBlocking {
        val gateway = Gateway(); val state = prepared(gateway); gateway.queue = true; state.command("confirm")
        assertEquals("BULK_LOCAL_QUEUE", state.error); assertNull(state.report); assertEquals(bulkOperationFixture, state.operationId); assertEquals(1, gateway.previewCalls)
        gateway.queue = false; state.refresh(); state.command("confirm"); assertEquals(1, gateway.confirms); assertEquals(1, gateway.previewCalls)
    }
    @Test fun freshAclRedactionReplacesOldNamesAndOfflineDropsPrivateReportData() = runBlocking {
        val gateway = Gateway(); val state = prepared(gateway); assertTrue(state.report.toString().contains("Private task"))
        val item = gateway.response.getJSONArray("items").getJSONObject(0)
        for (key in listOf("id", "projectId", "title", "projectTitle", "available")) item.remove(key)
        state.refresh(); assertFalse(state.report.toString().contains("Private")); assertNull(state.tasks)
        gateway.offline = true; state.refresh(); assertFalse(state.online); assertNull(state.report); assertNull(state.project)
        assertEquals(bulkOperationFixture, state.operationId); assertFalse(state.form.saved().contains("Private"))
    }
    @Test fun closedOrPausedScreenCannotAcceptLateReportsAndPermissionLossClearsTheParent() = runBlocking {
        for (closed in listOf(false, true)) {
            val gateway = Gateway(); val state = prepared(gateway); gateway.reportGate = CompletableDeferred()
            val work = launch { state.refresh() }; yield(); assertTrue(state.busy)
            if (closed) state.close() else state.pause()
            gateway.reportGate!!.complete(gateway.response); work.join(); assertNull(state.report); assertNull(state.project)
        }
        val gateway = Gateway(); var lost = 0; val state = state(gateway, lost = { lost++ }); state.load(); gateway.unavailable = true; state.refresh()
        assertEquals(1, lost); assertNull(state.project); assertNull(state.tasks)
    }
    @Test fun expiredPreviewCannotBeConfirmedAndHistoryRecoversLiveServerOperation() = runBlocking {
        val gateway = Gateway(); val state = prepared(gateway); gateway.response.put("expiresAt", Instant.now().minusSeconds(1).toString()); state.refresh()
        assertTrue(state.expired); state.command("confirm"); assertEquals("BULK_PREVIEW_EXPIRED", state.error); assertEquals(0, gateway.confirms)
        state.showHistory(); assertEquals("history", state.pane); assertNotNull(state.history); state.openOperation(bulkOperationFixture)
        assertEquals("operation", state.pane); assertNotNull(state.report); assertEquals(1, gateway.previewCalls)
    }
    @Test fun changedTaskCursorCannotAppendStalePageOrSilentlyRebaseSelectedRevisions() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(); state.change(state.form.toggle(state.tasks!!.getJSONArray("tasks").getJSONObject(0)))
        gateway.revision = 2; state.moreTasks(); assertEquals("SHARED_QUERY_CHANGED", state.error); assertNull(state.tasks)
        assertEquals(1, state.form.items.single().getInt("revision")); assertEquals(0, gateway.previewCalls)
    }
    @Test fun formBoundariesRejectDamagedSavedInputAndDoNotLeakCalendarMetadataIntoActions() {
        val form = SharedBulkForm.initial().change("kind", "due").change("date", "2028-02-29"); assertEquals("2028-02-29", form.action("project").getString("date"))
        assertFalse(form.action("project").has("calendarMode")); assertEquals(form.saved(), SharedBulkForm.restore(form.saved()).saved())
        assertThrows(Exception::class.java) { SharedBulkForm.restore(JSONObject(form.saved()).put("extra", true).toString()) }
        assertThrows(Exception::class.java) { SharedBulkForm.restore(JSONObject(form.saved()).put("priority", "0").toString()) }
    }
}
