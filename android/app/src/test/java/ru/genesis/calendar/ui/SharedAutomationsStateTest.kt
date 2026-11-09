package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import java.time.Instant

class SharedAutomationsStateTest {
    private class Gateway : SharedWorkspaceGateway {
        val storage = MemoryPlanningStorage(); var fresh = automationRuleFixture(); var count = 51; var runCount = 51
        var lose = false; var offline = false; var forbidden = false; var labelsPages = 0; var sends = 0; var templateUnavailable = false
        var fields = JSONArray(); var gate: CompletableDeferred<JSONObject>? = null
        val commands = mutableListOf<String>(); val receipts = mutableMapOf<String, JSONObject>()
        val ruleCursors = mutableListOf<String?>(); val runCursors = mutableListOf<String?>()
        private val access = object : SharedAutomationAccess {
            override fun check() { }
            override fun rule(project: String, rule: String): JSONObject { checkAccess(); return JSONObject().put("rule", JSONObject(fresh.toString())) }
            override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
                checkAccess(); sends++; commands += body.toString()
                val result = receipts.getOrPut(body.getString("operationId")) {
                    if (run != null) JSONObject().put("id", run).put("state", "pending").put("retryCount", 1)
                    else { for (key in listOf("enabled", "deleted")) if (body.has(key)) fresh.put(key, body.getBoolean(key))
                        fresh.put("revision", fresh.getInt("revision") + 1); JSONObject().put("rule", JSONObject(fresh.toString())) }
                }
                if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return JSONObject(result.toString())
            }
        }
        private fun checkAccess() { if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK); if (forbidden) throw AuthApiError("SHARED_PROJECT_FORBIDDEN") }
        private fun service() = SharedAutomationDraftService(PlanningJournal(storage, contract = SharedAutomationJournalContract), "actor", access)
        override suspend fun sharedAutomationDraft(projectId: String) = service().load(projectId)
        override suspend fun saveSharedAutomationDraft(projectId: String, stamp: String?, edit: JSONObject) = service().save(projectId, stamp, edit)
        override suspend fun prepareSharedAutomationDraft(projectId: String, stamp: String) = service().prepare(projectId, stamp)
        override suspend fun sendSharedAutomationDraft(projectId: String, stamp: String) = service().send(projectId, stamp)
        override suspend fun removeSharedAutomationDraft(projectId: String, stamp: String) = service().remove(projectId, stamp)
        override suspend fun sharedProject(projectId: String): JSONObject {
            checkAccess(); return JSONObject().put("project", JSONObject().put("id", "project").put("spaceId", "space").put("title", "Закрытый проект"))
                .put("members", JSONArray().put(JSONObject().put("userId", "owner").put("displayName", "Участник проекта")))
                .put("statuses", JSONArray().put(JSONObject().put("id", "done").put("title", "Готово"))).put("customFieldDefinitions", fields)
        }
        override suspend fun sharedAutomations(projectId: String, deleted: Boolean, cursor: String?): JSONObject {
            checkAccess(); ruleCursors += cursor
            val start = cursor?.substringAfterLast('-')?.toInt()?.plus(1) ?: 0; val end = minOf(count, start + 50)
            return JSONObject().put("rules", JSONArray((start until end).map { index ->
                JSONObject(fresh.toString()).apply { remove("definition") }.put("id", if (index == 0) "rule" else "rule-$index").put("deleted", deleted)
                    .apply { if (deleted) put("enabled", false) }
            })).put("nextCursor", if (end < count) "rule-${end - 1}" else JSONObject.NULL).put("canCreate", true).put("workerCompletedAt", Instant.now().toString())
        }
        override suspend fun sharedAutomation(projectId: String, ruleId: String): JSONObject {
            checkAccess(); return gate?.await() ?: JSONObject().put("rule", JSONObject(fresh.toString()).put("id", ruleId))
        }
        override suspend fun sharedAutomationRuns(projectId: String, ruleId: String, cursor: String?): JSONObject {
            checkAccess(); runCursors += cursor; val start = cursor?.substringAfterLast('-')?.toInt()?.plus(1) ?: 0; val end = minOf(runCount, start + 50)
            return JSONObject().put("runs", JSONArray((start until end).map { automationRunFixture("run-$it").put("ruleId", ruleId) }))
                .put("nextCursor", if (end < runCount) "run-${end - 1}" else JSONObject.NULL)
        }
        override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?): JSONObject {
            checkAccess(); labelsPages++; val start = cursor?.toInt() ?: 0; val end = minOf(131, start + 100)
            return JSONObject().put("options", JSONArray((start until end).map { JSONObject().put("id", "label-$it").put("title", "Метка $it") }))
                .put("hasMore", end < 131).put("nextCursor", if (end < 131) end.toString() else JSONObject.NULL)
        }
        override suspend fun sharedAutomationTemplate(templateId: String, language: String): JSONObject {
            checkAccess(); if (templateUnavailable) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED, 403)
            return JSONObject().put("id", templateId).put("title", "Шаблон команды")
        }
    }
    private fun state(gateway: Gateway, selected: String = "", lost: () -> Unit = {}) = SharedAutomationsState(gateway, "project", "ru", selected, false, { _, _ -> }, lost, {})
    @Test fun fiftyPlusOneRulesAndRunsUseBoundedPagesWithAWorkingBackPath() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.load(); assertEquals(50, state.page!!.getJSONArray("rules").length()); assertTrue(state.workerFresh)
        state.page(false, true); assertEquals(1, state.page!!.getJSONArray("rules").length()); assertEquals("rule-49", gateway.ruleCursors.last())
        state.page(false, false); assertNull(state.cursor); assertEquals(50, state.page!!.getJSONArray("rules").length())
        state.choose("rule"); state.page(true, true); assertEquals(1, state.runs!!.getJSONArray("runs").length()); assertEquals("run-49", gateway.runCursors.last())
        state.page(true, false); assertNull(state.runCursor); assertEquals(50, state.runs!!.getJSONArray("runs").length())
    }
    @Test fun pendingCommandRestoresItsRuleAndReplaysTheSameBodyBeforeAcknowledgement() = runBlocking {
        val gateway = Gateway().apply { lose = true }; val state = state(gateway, "rule"); state.load()
        state.apply("enabled", false, expectedRule = "rule", expectedRevision = 3)
        assertEquals("pending", state.phase); assertNull(state.rule); assertEquals("NETWORK", state.error)
        val restored = state(gateway); restored.load(); assertEquals("rule", restored.ruleId); assertEquals("pending", restored.phase)
        restored.retry(); assertEquals("received", restored.phase); assertEquals(1, gateway.receipts.size); assertEquals(gateway.commands[0], gateway.commands[1])
        assertFalse(restored.rule!!.getBoolean("enabled")); restored.finish(); assertNull(restored.record)
    }
    @Test fun anOldConfirmationCannotApplyAfterTheRuleChangesDuringPolling() = runBlocking {
        val gateway = Gateway(); val state = state(gateway, "rule"); state.load(); gateway.fresh.put("revision", 4); state.poll()
        state.apply("enabled", false, expectedRule = "rule", expectedRevision = 3)
        assertEquals("AUTOMATION_CONFLICT", state.error); assertEquals(0, gateway.sends); assertNull(state.record)
    }
    @Test fun onlineMetadataResolvesPagedLabelsButNeverInheritsUnavailableTemplateNames() = runBlocking {
        val gateway = Gateway(); gateway.fresh.getJSONObject("definition").put("actions", JSONArray()
            .put(JSONObject().put("type", "addLabels").put("value", JSONArray().put("label-130")))
            .put(JSONObject().put("type", "createTemplate").put("templateId", "builtin:task").put("options", JSONObject())))
        val state = state(gateway, "rule"); state.load(); assertEquals(2, gateway.labelsPages); assertEquals("Метка 130", state.labels["label-130"])
        assertEquals("Шаблон команды", state.templates["builtin:task"]); assertTrue(automationCanReadParameters(state))
        gateway.templateUnavailable = true; state.refresh(); assertTrue(state.templates.isEmpty()); assertFalse(automationCanReadParameters(state)); assertNotNull(state.rule)
    }
    @Test fun typedAccessLossClearsNamesAndClosesTheProjectWhileOfflineClearsWithoutClosing() = runBlocking {
        val gateway = Gateway(); var lost = 0; val state = state(gateway, "rule") { lost++ }; state.load(); assertNotNull(state.rule)
        gateway.offline = true; state.refresh(); assertNull(state.context); assertNull(state.rule); assertNull(state.runs); assertEquals(0, lost)
        gateway.offline = false; state.load(); gateway.forbidden = true; state.refresh(); assertEquals(1, lost); assertNull(state.context); assertNull(state.page)
    }
    @Test fun storedTemplateOptionsCannotEnableOrRetryAnUndisclosedDefinition() = runBlocking {
        val options = JSONObject().put("spaceId", "space").put("projectId", "project").put("parentProjectId", JSONObject.NULL)
            .put("boardStatusId", JSONObject.NULL).put("language", "ru").put("title", JSONObject.NULL)
            .put("include", JSONObject().put("descriptions", true).put("tags", true).put("labels", true).put("customFields", true)
                .put("assignees", true).put("checklists", true).put("subtasks", true).put("dependencies", true).put("dates", true).put("approvals", true))
        for (map in listOf("statusMap", "categoryMap", "fieldMap", "optionMap", "memberMap", "fieldValues")) options.put(map, JSONObject())
        for (kind in listOf("enabled", "retry")) {
            val gateway = Gateway(); gateway.fresh.put("enabled", kind == "retry").getJSONObject("definition").put("actions", JSONArray()
                .put(JSONObject().put("type", "createTemplate").put("templateId", "builtin:task").put("options", options)))
            val state = state(gateway, "rule"); state.load()
            assertFalse(automationCanReadParameters(state))
            val value = automationActionValue(state, state.rule!!.getJSONObject("definition").getJSONArray("actions").getJSONObject(0)) { it }
            assertFalse(value.available); assertTrue(value.text.startsWith("Шаблон команды\n")); assertTrue(value.text.contains("доступны в редакторе правила"))
            state.apply(kind, if (kind == "enabled") true else null, if (kind == "retry") "run-0" else null, "rule", 3)
            assertEquals("AUTOMATION_STALE", state.error); assertEquals(0, gateway.sends); assertNull(state.record)
        }
    }
    @Test fun undisclosedOptionsKeepDisableDeleteAndPausedRestoreAvailable() = runBlocking {
        for ((kind, value) in listOf("enabled" to false, "deleted" to true, "deleted" to false)) {
            val gateway = Gateway(); gateway.fresh.put("deleted", kind == "deleted" && !value).put("enabled", kind == "enabled")
                .getJSONObject("definition").put("actions", JSONArray().put(JSONObject().put("type", "createTemplate")
                    .put("templateId", "builtin:task").put("options", JSONObject().put("memberMap", JSONObject().put("source", "owner")))))
            val state = state(gateway, "rule"); state.load(); assertFalse(automationCanReadParameters(state))
            state.apply(kind, value, expectedRule = "rule", expectedRevision = 3)
            assertEquals(1, gateway.sends); assertEquals("received", state.phase)
            if (kind == "deleted" && !value) assertFalse(gateway.fresh.getBoolean("enabled"))
        }
    }
    @Test fun aRefreshToUnsupportedParametersBlocksANewRetryEvenWithTheSameRuleRevision() = runBlocking {
        val gateway = Gateway(); val state = state(gateway, "rule"); state.load(); assertTrue(automationCanReadParameters(state))
        gateway.fresh.getJSONObject("definition").put("actions", JSONArray().put(JSONObject().put("type", "createTemplate")
            .put("templateId", "builtin:task").put("options", JSONObject().put("futureOption", true))))
        state.poll(); assertFalse(automationCanReadParameters(state))
        state.apply("retry", runId = "run-0", expectedRule = "rule", expectedRevision = 3)
        assertEquals(0, gateway.sends); assertNull(state.record)
    }
    @Test fun pausedOrClosedScreensRejectLateRuleNamesAndCannotResetANewerBusyState() = runBlocking {
        for (close in listOf(false, true)) {
            val gateway = Gateway(); val state = state(gateway); state.load(); val gate = CompletableDeferred<JSONObject>(); gateway.gate = gate
            val pending = async { runCatching { state.choose("rule") } }; yield(); assertTrue(state.busy)
            if (close) state.close() else state.pause()
            gate.complete(JSONObject().put("rule", automationRuleFixture())); pending.await(); assertNull(state.rule); assertNull(state.context); assertFalse(state.busy)
        }
    }
    @Test fun explicitReadOnlyAuthorityOverridesAProjectsRoleAndCannotSendACommand() = runBlocking {
        val gateway = Gateway().apply { fresh.put("canManage", false) }; val state = state(gateway, "rule"); state.load(); assertFalse(state.canMutate)
        state.apply("enabled", false, expectedRule = "rule", expectedRevision = 3); assertEquals(0, gateway.sends); assertNull(state.record)
    }
    @Test fun customZeroFalseAndUserTextStayReadableWithoutTranslationOrTypeCoercion() = runBlocking {
        val gateway = Gateway(); gateway.fields = JSONArray(customDefinitions().map { JSONObject(it.toString()).put("spaceId", "space").put("projectId", "project") })
        val state = state(gateway, "rule"); state.load()
        val fields = importRows(gateway.fields).filter { !it.getBoolean("archived") }
        val number = fields.first { it.getString("type") == "number" }; val flag = fields.first { it.getString("type") == "checkbox" }; val text = fields.first { it.getString("type") == "text" }
        assertEquals("0", automationReference(state, "custom", 0, number.getString("id")) { "translated:$it" }.text)
        assertEquals("translated:Нет", automationReference(state, "custom", false, flag.getString("id")) { "translated:$it" }.text)
        assertEquals("Новый проект", automationReference(state, "custom", "Новый проект", text.getString("id")) { "translated:$it" }.text)
        assertFalse(automationReference(state, "custom", "false", flag.getString("id")) { it }.available)
    }
}
