package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun automationDefinitionFixture() = JSONObject().put("schemaVersion", 1).put("trigger", JSONObject().put("type", "created"))
    .put("conditions", JSONArray()).put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0)))
    .put("calendarMode", "lunar").put("calendarContext", JSONObject().put("version", 2).put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
internal fun automationScheduleFixture() = JSONObject().put("enabled", true).put("mode", "lunar").put("pattern", "lunar-days").put("interval", 1)
    .put("rangeStart", "2026-10-20").put("rangeEnd", "").put("invalidDayPolicy", "skip").put("calendarContext", automationDefinitionFixture().getJSONObject("calendarContext"))
    .put("days", JSONArray().put(1)).put("months", JSONArray()).put("pyatas", JSONArray())
internal fun automationRuleFixture(id: String = "rule") = JSONObject().put("id", id).put("projectId", "project").put("ownerId", "owner")
    .put("title", "Личное правило команды").put("enabled", true).put("revision", 3).put("deleted", false).put("canManage", true)
    .put("createdAt", "2026-10-20T09:00:00Z").put("updatedAt", "2026-10-20T09:00:00Z").put("definition", automationDefinitionFixture())
internal fun automationRunFixture(id: String = "run") = JSONObject().put("id", id).put("ruleId", "rule").put("revision", 3)
    .put("taskId", "task").put("taskTitle", "Название задачи").put("state", "failed").put("attempts", 5).put("retryCount", 0)
    .put("errorCode", "BACKGROUND_LEASE_EXPIRED").put("result", JSONObject.NULL).put("createdAt", "2026-10-20T09:00:00Z").put("finishedAt", "2026-10-20T09:00:01Z")
internal fun automationListFixture() = JSONObject().put("rules", JSONArray().put(automationRuleFixture().apply { remove("definition") }))
    .put("nextCursor", JSONObject.NULL).put("canCreate", true).put("workerCompletedAt", "2026-10-20T09:00:00Z")
internal fun automationEditFixture(kind: String = "enabled") = JSONObject().put("projectId", "project").put("ruleId", "rule").put("revision", 3).put("kind", kind)
    .apply { if (kind == "retry") put("runId", "run") else put("value", false) }

class SharedAutomationProtocolTest {
    @Test fun allTypedActionsAndConditionsKeepZeroFalseAndIndependentCalendarMetadata() {
        val definition = automationDefinitionFixture()
        definition.getJSONArray("conditions").put(JSONObject().put("field", "custom").put("fieldId", "flag").put("operator", "eq").put("value", false))
        definition.put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0))
            .put(JSONObject().put("type", "assignee").put("value", JSONObject.NULL)).put(JSONObject().put("type", "status").put("value", "done"))
            .put(JSONObject().put("type", "addLabels").put("value", JSONArray().put("label"))).put(JSONObject().put("type", "removeLabels").put("value", JSONArray()))
            .put(JSONObject().put("type", "due").put("mode", "shift").put("offset", JSONObject().put("amount", -1).put("unit", "month")))
            .put(JSONObject().put("type", "custom").put("fieldId", "flag").put("value", false))
            .put(JSONObject().put("type", "createTemplate").put("templateId", "template").put("options", JSONObject()))
            .put(JSONObject().put("type", "notify").put("recipientIds", JSONArray().put("owner")).put("message", "Сообщение")))
        val safe = SharedAutomationProtocol.definition(definition)
        assertEquals(PlanningLifecycle.canonical(definition), PlanningLifecycle.canonical(safe))
        assertEquals(0, safe.getJSONArray("actions").getJSONObject(0).getInt("value")); assertFalse(safe.getJSONArray("conditions").getJSONObject(0).getBoolean("value"))
        safe.put("calendarMode", "profane"); assertEquals("lunar", definition.getString("calendarMode"))
    }
    @Test fun sevenTriggersAcceptTheirNormalizedScheduleWithoutReinterpretingIt() {
        SharedAutomationProtocol.triggers.forEach { type ->
            val trigger = JSONObject().put("type", type)
            if (type == "dueSoon") trigger.put("leadDays", 2)
            if (type in setOf("dueSoon", "due", "schedule")) trigger.put("time", "09:30")
            if (type == "schedule") trigger.put("target", "tasks").put("recurrence", automationScheduleFixture())
            assertEquals(type, SharedAutomationProtocol.definition(automationDefinitionFixture().put("trigger", trigger)).getJSONObject("trigger").getString("type"))
        }
        assertThrows(Exception::class.java) { SharedAutomationProtocol.definition(automationDefinitionFixture().put("trigger", JSONObject().put("type", "due").put("time", "25:00"))) }
        assertThrows(Exception::class.java) { SharedAutomationProtocol.definition(automationDefinitionFixture().put("trigger", JSONObject().put("type", "schedule").put("time", "09:00").put("target", "tasks").put("recurrence", JSONObject()))) }
    }
    @Test fun malformedOrUnboundedDefinitionsCannotBeDisplayedAsAValidRule() {
        for (bad in listOf(automationDefinitionFixture().put("schemaVersion", 2), automationDefinitionFixture().put("calendarMode", "unknown"),
            automationDefinitionFixture().put("conditions", JSONArray((0..20).map { JSONObject() })), automationDefinitionFixture().put("actions", JSONArray()),
            automationDefinitionFixture().put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", "0"))),
            automationDefinitionFixture().put("eval", "arbitrary expression"))) {
            assertThrows(Exception::class.java) { SharedAutomationProtocol.definition(bad) }
        }
    }
    @Test fun unavailableTemplatePlaceholderRemainsRedactedAndCannotBecomeAnEditableReference() {
        val definition = automationDefinitionFixture().put("actions", JSONArray().put(JSONObject().put("type", "createTemplate").put("templateId", "").put("options", JSONArray()).put("unavailable", true)))
        val safe = SharedAutomationProtocol.definition(definition).getJSONArray("actions").getJSONObject(0)
        assertTrue(safe.getBoolean("unavailable")); assertEquals("", safe.getString("templateId"))
        safe.put("templateId", "hidden-template"); assertThrows(Exception::class.java) { SharedAutomationProtocol.definition(definition.put("actions", JSONArray().put(safe))) }
    }
    @Test fun listsAndRunsAreBoundedScopedAndDoNotInventNamesForMissingTasks() {
        assertEquals(1, SharedAutomationProtocol.list(automationListFixture(), "project").getJSONArray("rules").length())
        assertThrows(Exception::class.java) { SharedAutomationProtocol.list(automationListFixture(), "other") }
        assertThrows(Exception::class.java) { SharedAutomationProtocol.list(automationListFixture().put("rules", JSONArray((0..50).map { automationRuleFixture("rule-$it").apply { remove("definition") } })), "project") }
        val run = automationRunFixture().put("taskId", JSONObject.NULL).put("taskTitle", JSONObject.NULL)
        val page = JSONObject().put("runs", JSONArray().put(run)).put("nextCursor", JSONObject.NULL)
        assertTrue(SharedAutomationProtocol.runs(page, "rule").getJSONArray("runs").getJSONObject(0).isNull("taskTitle"))
        run.put("taskTitle", "Old private title"); assertThrows(Exception::class.java) { SharedAutomationProtocol.runs(page, "rule") }
    }
    @Test fun transportAcceptsOnlyTheExactLibraryHistoryAndManagementRoutes() {
        val id = "01234567-89ab-cdef-0123-456789abcdef"; val root = "/shared/projects/$id/automations"
        for (path in listOf("$root?deleted=false", "$root?deleted=true&cursor=$id", "$root/$id", "$root/$id/runs", "$root/$id/runs?cursor=$id")) {
            assertTrue(path, allowedSharedRoute("GET", path)); assertFalse(allowedSharedRoute("POST", path))
        }
        assertTrue(allowedSharedRoute("PATCH", "$root/$id")); assertTrue(allowedSharedRoute("POST", "$root/$id/runs/$id/retry"))
        assertTrue(allowedSharedRoute("POST", root)); assertTrue(allowedSharedRoute("POST", "$root/preview"))
        assertFalse(allowedSharedRoute("GET", "$root/preview")); assertFalse(allowedSharedRoute("PATCH", "$root/preview"))
        assertTrue(allowedSharedRoute("GET", "/shared/templates/builtin%3Atask?language=en"))
        assertFalse(allowedSharedRoute("POST", "/shared/templates/builtin%3Atask?language=en"))
        for (path in listOf("$root?deleted=false&untrusted=1", "$root/../../other", "$root/$id/runs?cursor=bad&other=1", "$root/$id/runs/$id/erase", "$root/preview?untrusted=1")) {
            for (method in listOf("GET", "POST", "PATCH", "DELETE")) assertFalse("$method $path", allowedSharedRoute(method, path))
        }
    }
}
