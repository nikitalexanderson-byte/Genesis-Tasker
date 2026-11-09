package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences

class SharedAutomationEditorStateTest {
    private class Gateway : SharedWorkspaceGateway {
        val storage = MemoryPlanningStorage(); var source = automationRuleFixture()
        var canWrite = true; var offline = false; var lose = false; var sends = 0
        var projectGate: CompletableDeferred<JSONObject>? = null; var saveGate: CompletableDeferred<Unit>? = null
        val bodies = mutableListOf<String>(); val receipts = mutableMapOf<String, JSONObject>()
        fun snapshot(): JSONObject {
            if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK)
            return JSONObject().put("project", JSONObject().put("id", "project").put("spaceId", "space").put("title", "Own project title")
                .put("permissions", JSONObject().put("editTasks", canWrite).put("manageProjects", false)))
                .put("members", JSONArray().put(JSONObject().put("userId", "owner").put("displayName", "Own display name")))
                .put("statuses", JSONArray().put(JSONObject().put("id", "done").put("title", "Own status title"))).put("customFieldDefinitions", JSONArray())
        }
        private val access = object : SharedAutomationEditorAccess {
            override fun check() { }
            override fun project(project: String) = snapshot()
            override fun labels(project: String) = JSONArray()
            override fun template(space: String, template: String, language: String) = error("TEMPLATE_UNAVAILABLE")
            override fun rule(project: String, rule: String) = JSONObject(source.toString())
            override fun hasTaskQueue() = false
            override fun send(project: String, rule: String?, payload: JSONObject): JSONObject {
                if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK)
                if (!canWrite) throw AuthApiError("SHARED_PROJECT_FORBIDDEN")
                sends++; bodies += payload.toString()
                val receipt = receipts.getOrPut(payload.getString("operationId")) { automationRuleFixture(rule ?: "created-rule").put("revision", if (rule == null) 1 else payload.getInt("expectedRevision") + 1)
                    .put("title", payload.getString("title")).put("ownerId", payload.getString("ownerId")).put("enabled", payload.getBoolean("enabled")).put("definition", payload.getJSONObject("definition")) }
                if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
                return JSONObject().put("rule", JSONObject(receipt.toString()))
            }
            override fun preview(project: String, definition: JSONObject, owner: String, task: String?) = JSONObject().put("dryRun", true).put("matches", false)
                .put("ownerId", owner).put("taskId", task ?: JSONObject.NULL).put("taskRevision", if (task == null) JSONObject.NULL else 4).put("effects", JSONObject.NULL)
        }
        private fun service() = SharedAutomationEditorService(PlanningJournal(storage, contract = SharedAutomationEditorJournalContract), "owner", access)
        override suspend fun sharedProject(projectId: String) = projectGate?.await() ?: snapshot()
        override suspend fun sharedAutomation(projectId: String, ruleId: String) = JSONObject().put("rule", JSONObject(source.toString()).put("id", ruleId))
        override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?) = JSONObject().put("options", JSONArray()).put("hasMore", false).put("nextCursor", JSONObject.NULL)
        override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = JSONObject().put("tasks", JSONArray()).put("nextCursor", JSONObject.NULL)
        override suspend fun sharedAutomationEditor(project: String) = service().load(project)
        override suspend fun saveSharedAutomationEditor(project: String, stamp: String?, edit: JSONObject): JSONObject { val saved = service().save(project, stamp, edit); saveGate?.await(); return saved }
        override suspend fun prepareSharedAutomationEditor(project: String, stamp: String) = service().prepare(project, stamp)
        override suspend fun sendSharedAutomationEditor(project: String, stamp: String) = service().send(project, stamp)
        override suspend fun previewSharedAutomationEditor(project: String, stamp: String, task: String?) = service().preview(project, stamp, task)
        override suspend fun removeSharedAutomationEditor(project: String, stamp: String) = service().remove(project, stamp)
        override suspend fun sharedAutomationEditorCopies(project: String) = service().copies(project)
        override suspend fun saveSharedAutomationEditorCopy(project: String, id: String, stamp: String?, edit: JSONObject) = service().saveCopy(project, id, stamp, edit)
        override suspend fun useSharedAutomationEditorCopy(project: String, id: String, copyStamp: String, stamp: String?) = service().useCopy(project, id, copyStamp, stamp)
        override suspend fun removeSharedAutomationEditorCopy(project: String, id: String, stamp: String) = service().removeCopy(project, id, stamp)
    }
    private val calendar = SharedCustomCalendar.initial(UiPreferences())
    private fun state(gateway: Gateway) = SharedAutomationEditorState(gateway, "owner", "project", "ru")
    @Test fun aLostCommittedCreateRestoresAndRetriesItsExactRequestWithoutReplacingManagementCommands() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(null, false, calendar)
        state.mutate { it.put("title", "Owned rule") }; gateway.lose = true; state.submit()
        assertEquals("pending", state.phase); assertEquals(1, gateway.sends); val pending = gateway.sharedAutomationEditor("project")!!.toString()
        assertFalse(state.mutate { it.put("title", "Replacement") }); state.close()
        val restored = state(gateway); restored.load(null, false, calendar); assertEquals(pending, restored.record!!.toString())
        restored.submit(); assertEquals("received", restored.phase); assertEquals(gateway.bodies[0], gateway.bodies[1]); assertEquals(1, gateway.receipts.size)
        assertNull(PlanningJournal(gateway.storage, contract = SharedAutomationJournalContract).load("owner", "project"))
    }
    @Test fun currentCasRequiresAnExplicitNewCopyAndLeavesTheOldRevisionAndInputIntact() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load("rule", false, calendar)
        state.mutate { it.put("title", "Unsaved own title") }; state.saveLocal(); gateway.source.put("revision", 4); state.refresh()
        assertTrue(state.stale); assertFalse(state.canSubmit); state.submit(); assertEquals(0, gateway.sends)
        assertEquals(3, state.edit!!.getInt("revision")); assertEquals("Unsaved own title", state.edit!!.getString("title"))
        state.asNewCopy(); assertTrue(state.edit!!.isNull("ruleId")); assertFalse(state.edit!!.getBoolean("enabled")); assertFalse(state.stale)
        assertTrue(state.copies.any { !it.getJSONObject("edit").isNull("ruleId") }); state.submit(); assertEquals("received", state.phase)
    }
    @Test fun aWriteDowngradeRemovesLiveNamesAndPreservesTheSavedDraftPlusLastOwnedInput() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(null, false, calendar); val saved = gateway.sharedAutomationEditor("project")!!.toString()
        state.mutate { it.put("title", "Latest unsaved own title") }; gateway.canWrite = false; state.poll()
        assertTrue(state.lost); assertNull(state.context); assertNull(state.edit); assertTrue(state.labels.isEmpty()); assertEquals(saved, gateway.sharedAutomationEditor("project")!!.toString())
        assertEquals("Latest unsaved own title", gateway.sharedAutomationEditorCopies("project").single().getJSONObject("edit").getString("title"))
    }
    @Test fun invalidLocalCallbacksKeepThePreviousGraphInsteadOfThrowingFromComposition() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(null, false, calendar); val original = state.edit!!.toString()
        assertFalse(state.mutate { SharedAutomationEditorEdits.remove(it, true, 0) }); assertEquals(original, state.edit!!.toString())
        assertFalse(state.mutate { repeat(21) { _ -> SharedAutomationEditorEdits.append(it, false, SharedAutomationEditorEdits.condition("project", "project", null)) } })
        assertEquals(original, state.edit!!.toString()); assertTrue(state.editable)
    }
    @Test fun reorderKeepsPartialNumbersWithTheirStableActionKeys() = runBlocking {
        val state = state(Gateway()); state.load(null, false, calendar)
        state.mutate { SharedAutomationEditorEdits.append(it, true, JSONObject().put("type", "due").put("mode", "shift").put("offset", JSONObject().put("amount", 1).put("unit", "month")))
            SharedAutomationEditorEdits.number(it, true, 1, "-", "offset") }
        val key = SharedAutomationEditorEdits.rowKey(state.edit!!, true, 1); state.mutate { SharedAutomationEditorEdits.move(it, true, 1, 0) }
        assertEquals(key, SharedAutomationEditorEdits.rowKey(state.edit!!, true, 0)); assertEquals("-", state.edit!!.getJSONObject("inputs").getString("a:$key:offset"))
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.definition(state.edit!!) }
        Unit
    }
    @Test fun aCancelledQuietWriteStillAdoptsItsCommittedCasStampAndKeepsTheNextKeystroke() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(null, false, calendar)
        state.mutate { it.put("title", "First") }; val gate = CompletableDeferred<Unit>(); gateway.saveGate = gate
        val job = launch(start = CoroutineStart.UNDISPATCHED) { state.saveLocal() }; yield()
        state.mutate { it.put("title", "Next") }; job.cancel(); gate.complete(Unit); job.join(); gateway.saveGate = null
        assertTrue(state.dirty); assertEquals("Next", state.edit!!.getString("title")); state.saveLocal()
        assertEquals("Next", gateway.sharedAutomationEditor("project")!!.getJSONObject("edit").getString("title")); assertFalse(state.conflict)
    }
    @Test fun aClosedAccountSurfaceCannotAcceptALateCatalogResponse() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); val gate = CompletableDeferred<JSONObject>(); gateway.projectGate = gate
        val job = launch { state.load(null, false, calendar) }; yield(); state.close(); gate.complete(gateway.snapshot()); job.join()
        assertNull(state.context); assertNull(state.record); assertNull(state.edit); assertFalse(state.loaded)
    }
    @Test fun aNoOpAutosaveOrCatalogPollCannotEraseAnUnrepairedValidationMessage() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(null, false, calendar)
        state.mutate { it.put("title", "Project schedule"); SharedAutomationEditorEdits.trigger(it, "schedule"); it.getJSONObject("definition").getJSONObject("trigger").put("target", "project") }
        state.submit(); assertEquals("AUTOMATION_PROJECT_TARGET", state.error); assertEquals("editing", state.phase)
        state.saveLocal(); state.poll(); assertEquals("AUTOMATION_PROJECT_TARGET", state.error); assertEquals(0, gateway.sends)
    }
}
