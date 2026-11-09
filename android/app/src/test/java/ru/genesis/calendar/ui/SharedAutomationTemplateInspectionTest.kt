package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.time.Instant

class SharedAutomationTemplateInspectionTest {
    private class Gateway : SharedWorkspaceGateway {
        var options = JSONObject().put("title", "Своё название").put("include", JSONObject().put("assignees", false))
        var allowed = true; var unavailable = false; var previewRevision = 1; var previews = 0; var sends = 0; var loseReply = false
        var gate: CompletableDeferred<Unit>? = null
        var previewFailure: Exception? = null
        val fresh = automationRuleFixture().put("projectId", templateProject).put("enabled", false)
        val memory = MemoryPlanningStorage()
        val receipts = mutableMapOf<String, JSONObject>(); val sentBodies = mutableListOf<String>()
        private val access = object : SharedAutomationAccess {
            override fun check() { }
            override fun rule(project: String, rule: String) = JSONObject().put("rule", rule())
            override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
                sends++; sentBodies += PlanningLifecycle.canonical(body)
                val response = receipts.getOrPut(body.getString("operationId")) {
                    if (body.has("enabled")) fresh.put("enabled", body.getBoolean("enabled"))
                    fresh.put("revision", body.getInt("expectedRevision") + 1)
                    if (run == null) JSONObject().put("rule", rule()) else JSONObject().put("id", run).put("state", "pending").put("retryCount", 1)
                }
                if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
                return response
            }
        }
        private fun service() = SharedAutomationDraftService(PlanningJournal(memory, contract = SharedAutomationJournalContract), "actor", access)
        fun action() = JSONObject().put("type", "createTemplate").put("templateId", "system:publication").put("options", JSONObject(options.toString()))
        fun rule() = JSONObject(fresh.toString()).apply { getJSONObject("definition").put("actions", JSONArray().put(action())) }
        override suspend fun sharedProject(projectId: String) = JSONObject().put("project", JSONObject().put("id", templateProject).put("spaceId", templateSpace).put("title", "Команда"))
            .put("members", JSONArray().put(JSONObject().put("userId", "owner").put("displayName", "Владелец"))).put("statuses", JSONArray()).put("customFieldDefinitions", JSONArray())
        override suspend fun sharedAutomations(projectId: String, deleted: Boolean, cursor: String?) = JSONObject().put("rules", JSONArray().put(rule().apply { remove("definition") }))
            .put("nextCursor", JSONObject.NULL).put("canCreate", true).put("workerCompletedAt", JSONObject.NULL)
        override suspend fun sharedAutomation(projectId: String, ruleId: String) = JSONObject().put("rule", rule())
        override suspend fun sharedAutomationRuns(projectId: String, ruleId: String, cursor: String?) = JSONObject().put("runs", JSONArray()).put("nextCursor", JSONObject.NULL)
        override suspend fun sharedAutomationTemplate(templateId: String, language: String) = JSONObject().put("id", templateId).put("title", "Публикация")
        override suspend fun sharedTemplate(space: String, id: String, language: String, deleted: Boolean): JSONObject {
            if (unavailable) throw AuthApiError("TEMPLATE_UNAVAILABLE")
            return templateStarters(language).getJSONObject(1)
        }
        override suspend fun previewSharedTemplate(space: String, id: String, request: JSONObject): JSONObject {
            previews++; gate?.await()
            previewFailure?.let { throw it }
            val source = templateStarters(request.getString("language")).getJSONObject(1); val manifest = source.getJSONObject("manifest")
            return JSONObject().put("templateId", id).put("fingerprint", "a".repeat(64)).put("revision", previewRevision).put("canApply", allowed)
                .put("options", SharedTemplateProtocol.options(request)).put("kind", "task").put("calendarMode", manifest.getString("calendarMode")).put("calendarContext", manifest.getJSONObject("calendarContext"))
                .put("projects", manifest.getJSONArray("projects")).put("tasks", manifest.getJSONArray("tasks"))
                .apply { for (name in listOf("members", "statuses", "categories", "fields", "sourceFields", "newFields", "notices")) put(name, JSONArray()) }
                .put("blockers", if (allowed) JSONArray() else JSONArray().put(JSONObject().put("code", "TEMPLATE_APPROVERS_REQUIRED")))
        }
        override suspend fun sharedAutomationDraft(projectId: String) = service().load(projectId)
        override suspend fun saveSharedAutomationDraft(projectId: String, stamp: String?, edit: JSONObject) = service().save(projectId, stamp, edit)
        override suspend fun prepareSharedAutomationDraft(projectId: String, stamp: String) = service().prepare(projectId, stamp)
        override suspend fun sendSharedAutomationDraft(projectId: String, stamp: String) = service().send(projectId, stamp)
        override suspend fun removeSharedAutomationDraft(projectId: String, stamp: String) = service().remove(projectId, stamp)
    }
    private fun state(gateway: Gateway) = SharedAutomationsState(gateway, templateProject, "ru", "rule", false, { _, _ -> }, {}, {})

    @Test fun nonemptyOptionsBecomeReadableBeforeEnableAndTheManagementCommandKeepsItsJournal() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load()
        assertEquals(1, gateway.previews); assertTrue(automationCanReadParameters(state))
        val inspection = requireNotNull(state.templateInspection(gateway.action()))
        val form = inspection.form(SharedCustomCalendar.initial(UiPreferences()))
        assertFalse(form.editable); assertFalse(form.edit!!.getJSONObject("request").getJSONObject("include").getBoolean("assignees"))
        assertEquals("Своё название", form.edit.getJSONObject("request").getString("title"))
        state.apply("enabled", true, expectedRule = "rule", expectedRevision = 3)
        assertEquals(1, gateway.sends); assertEquals("received", state.phase)
    }
    @Test fun unsupportedAndForeignScopeOptionsNeverBecomeAnEnableOrRetryCommand() = runBlocking {
        for (options in listOf(JSONObject().put("futureOption", true), JSONObject().put("projectId", templateSpace))) {
            val gateway = Gateway().apply { this.options = options }; val state = state(gateway); state.load()
            assertNotNull(state.rule); assertFalse(automationCanReadParameters(state)); assertNull(state.templateInspection(gateway.action()))
            assertEquals(0, gateway.previews)
            state.apply("enabled", true, expectedRule = "rule", expectedRevision = 3)
            assertEquals(0, gateway.sends); assertNull(state.record)
        }
    }
    @Test fun aLostEnableReplyReplaysTheSameReviewedCommandAndDoesNotApplyATemplate() = runBlocking {
        val gateway = Gateway().apply { loseReply = true }; val state = state(gateway); state.load()
        state.apply("enabled", true, expectedRule = "rule", expectedRevision = 3)
        assertEquals("pending", state.phase); assertEquals(1, gateway.receipts.size)
        state.retry(); assertEquals("received", state.phase)
        assertEquals(2, gateway.sends); assertEquals(gateway.sentBodies[0], gateway.sentBodies[1]); assertEquals(1, gateway.receipts.size)
    }
    @Test fun aBlockedPreviewIsVisibleButCannotAuthorizeExecution() = runBlocking {
        val gateway = Gateway().apply { allowed = false }; val state = state(gateway); state.load()
        val inspection = requireNotNull(state.templateInspection(gateway.action()))
        assertFalse(inspection.canApply); assertEquals(1, inspection.form(SharedCustomCalendar.initial(UiPreferences())).preview!!.getJSONArray("blockers").length())
        assertFalse(automationCanReadParameters(state))
        state.apply("retry", runId = "run", expectedRule = "rule", expectedRevision = 3); assertEquals(0, gateway.sends)
    }
    @Test fun refreshingAnUnavailableSourceClearsItsPreviouslyReadableParametersAndName() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(); assertTrue(automationCanReadParameters(state))
        gateway.unavailable = true; state.refresh()
        assertNull(state.templateInspection(gateway.action())); assertFalse(automationCanReadParameters(state)); assertTrue(state.templates.isEmpty())
    }
    @Test fun aChangedTemplateMappingBlocksEnableButKeepsTheRuleAndDisableCommandAvailable() = runBlocking {
        for (code in listOf("TEMPLATE_FIELD_MAPPING_INVALID", "TEMPLATE_STATUS_MAPPING_INVALID", "TEMPLATE_REFERENCE_INVALID")) {
            val gateway = Gateway().apply { fresh.put("enabled", true); previewFailure = AuthApiError(code) }
            val state = state(gateway); state.load()
            assertNotNull(state.rule); assertTrue(state.canMutate); assertEquals("", state.error)
            assertFalse(automationCanReadParameters(state)); assertNull(state.templateInspection(gateway.action()))
            state.apply("enabled", false, expectedRule = "rule", expectedRevision = 3)
            assertEquals(1, gateway.sends); assertEquals("received", state.phase); assertFalse(state.rule!!.getBoolean("enabled"))
        }
    }
    @Test fun previewNetworkAndProjectAccessFailuresNeverLeaveAReadableCachedRule() = runBlocking {
        for (failure in listOf(AuthFailure(AuthFailure.Kind.NETWORK), AuthApiError("SHARED_PROJECT_FORBIDDEN"), AuthApiError("FUTURE_PREVIEW_FAILURE"))) {
            val gateway = Gateway(); var lost = false
            val state = SharedAutomationsState(gateway, templateProject, "ru", "rule", false, { _, _ -> }, { lost = true }, {})
            state.load(); assertTrue(automationCanReadParameters(state))
            gateway.previewFailure = failure; state.poll()
            assertNull(state.rule); assertNull(state.context); assertNull(state.templateInspection(gateway.action()))
            assertFalse(automationCanReadParameters(state)); assertEquals(0, gateway.sends)
            assertEquals(failure is AuthApiError && failure.code == "SHARED_PROJECT_FORBIDDEN", lost)
        }
    }
    @Test fun mismatchedSourceRevisionCannotReuseTheOldInspection() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(); assertTrue(automationCanReadParameters(state))
        gateway.previewRevision = 2; state.poll()
        assertNull(state.templateInspection(gateway.action())); assertFalse(automationCanReadParameters(state))
    }
    @Test fun aLatePreviewCannotResurrectAClosedOrPausedScreen() = runBlocking {
        for (close in listOf(true, false)) {
            val gateway = Gateway().apply { gate = CompletableDeferred() }; val state = state(gateway)
            val load = async { runCatching { state.load() } }; yield(); assertTrue(state.busy)
            if (close) state.close() else state.pause()
            gateway.gate!!.complete(Unit); load.await()
            assertNull(state.context); assertNull(state.rule); assertNull(state.templateInspection(gateway.action())); assertFalse(state.busy)
        }
    }
    @Test fun previewAnchorUsesTheRulesTimeZoneAndTheReadOnlyFormCannotChangeStoredOptions() = runBlocking {
        val gateway = Gateway(); val definition = gateway.rule().getJSONObject("definition")
        definition.getJSONObject("calendarContext").put("timeZone", "America/New_York")
        val action = gateway.action(); val inspection = SharedAutomationTemplateInspection.read(gateway, templateSpace, templateProject, definition, action, {}, Instant.parse("2026-10-22T00:30:00Z"))
        assertEquals("2026-10-21", inspection.anchorDate)
        val calendar = SharedCustomCalendar.initial(UiPreferences()); val form = inspection.form(calendar)
        assertFalse(form.change(form.edit!!)); form.changeTitle("Изменение"); form.edit.getJSONObject("request").put("title", "Испорченная копия")
        assertEquals("Своё название", inspection.form(calendar).edit!!.getJSONObject("request").getString("title"))
        action.getJSONObject("options").put("title", "Другое правило"); assertFalse(inspection.matches(action))
    }
    @Test fun zeroFalseAndExplicitNullRemainTypedInTheDisplayedOverrides() = runBlocking {
        val gateway = Gateway().apply { options.put("fieldValues", JSONObject().put("task:one", JSONObject().put("field:number", 0).put("field:checkbox", false).put("field:empty", JSONObject.NULL))) }
        val inspection = SharedAutomationTemplateInspection.read(gateway, templateSpace, templateProject, gateway.rule().getJSONObject("definition"), gateway.action(), {})
        val values = inspection.form(SharedCustomCalendar.initial(UiPreferences())).edit!!.getJSONObject("request").getJSONObject("fieldValues").getJSONObject("task:one")
        assertEquals(0, values.getInt("field:number")); assertEquals(false, values.get("field:checkbox")); assertTrue(values.has("field:empty") && values.isNull("field:empty"))
    }
}
