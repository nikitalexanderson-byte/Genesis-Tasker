package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

private fun automationWriterEdit(rule: JSONObject? = null) = SharedAutomationEditorProtocol.newEdit("space", "project", "owner", automationDefinitionFixture(), rule)
    .put("title", "Recoverable rule")

class SharedAutomationEditorProtocolTest {
    @Test fun partialNumericInputSurvivesButNoInvalidOrLocalMetadataEntersTheCommand() {
        val edit = automationWriterEdit().put("title", "")
        val key = "a:${edit.getJSONArray("actionKeys").getString(0)}:value"
        edit.getJSONObject("inputs").put(key, "-")
        assertEquals("-", SharedAutomationEditorProtocol.edit(edit).getJSONObject("inputs").getString(key))
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.command(edit, UUID.randomUUID().toString()) }
        edit.put("title", "  Entered title  ").getJSONObject("inputs").put(key, "0")
        val payload = SharedAutomationEditorProtocol.command(edit, UUID.randomUUID().toString()).getJSONObject("body").getJSONObject("payload")
        assertEquals("Entered title", payload.getString("title")); assertEquals(0, payload.getJSONObject("definition").getJSONArray("actions").getJSONObject(0).getInt("value"))
        assertEquals(setOf("operationId", "title", "ownerId", "enabled", "deleted", "definition"), payload.keys().asSequence().toSet())
        assertEquals("  Entered title  ", edit.getString("title")); assertEquals("0", edit.getJSONObject("inputs").getString(key))
    }
    @Test fun customNumberCommaZeroFalseAndClearRemainDistinctWithoutTouchingTheInputCalendar() {
        val edit = automationWriterEdit(); val definition = edit.getJSONObject("definition")
        definition.put("actions", JSONArray().put(JSONObject().put("type", "custom").put("fieldId", "number").put("value", JSONObject.NULL)))
        val key = "a:${edit.getJSONArray("actionKeys").getString(0)}:value"
        val input = edit.getJSONObject("inputs"); input.put(key, "1,25")
        fun value() = SharedAutomationEditorProtocol.definition(edit).getJSONArray("actions").getJSONObject(0).get("value")
        assertEquals(1.25, (value() as Number).toDouble(), 0.0); input.put(key, "0"); assertEquals(0.0, (value() as Number).toDouble(), 0.0)
        input.put(key, ""); assertEquals(JSONObject.NULL, value()); input.remove(key)
        definition.getJSONArray("actions").getJSONObject(0).put("fieldId", "checkbox").put("value", false)
        assertEquals(false, value()); assertEquals("lunar", SharedAutomationEditorProtocol.edit(edit).getJSONObject("dateInput").getString("mode"))
    }
    @Test fun projectScheduleNeverSilentlyDropsIncompatibleTaskActions() {
        val edit = automationWriterEdit(); val definition = edit.getJSONObject("definition")
        definition.put("trigger", JSONObject().put("type", "schedule").put("target", "project").put("time", "09:00").put("recurrence", automationScheduleFixture()))
        val before = edit.toString()
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.command(edit, UUID.randomUUID().toString()) }
        assertEquals(before, edit.toString()); assertEquals("priority", definition.getJSONArray("actions").getJSONObject(0).getString("type"))
        definition.put("actions", JSONArray().put(JSONObject().put("type", "notify").put("recipientIds", JSONArray().put("owner")).put("message", "Own message")))
        assertEquals("project", SharedAutomationEditorProtocol.definition(edit).getJSONObject("trigger").getString("target"))
    }
    @Test fun unknownDraftFieldsAndChangedLocalKeysCannotBecomeRecoverableCommands() {
        val edit = automationWriterEdit()
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.edit(JSONObject(edit.toString()).put("expression", "arbitrary")) }
        edit.getJSONArray("actionKeys").put(0, "not-a-local-uuid")
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.edit(edit) }
    }
    @Test fun editingAnOldOwnerOrCalendarNeverBorrowsTheDefaultOwnerOrDisplayCalendar() {
        val source = automationRuleFixture().put("ownerId", JSONObject.NULL)
        val edit = SharedAutomationEditorProtocol.newEdit("space", "project", "actor", automationDefinitionFixture().put("calendarMode", "profane"), source)
        assertTrue(edit.isNull("ownerId")); assertEquals("lunar", edit.getJSONObject("dateInput").getString("mode"))
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.command(edit, UUID.randomUUID().toString()) }
        edit.put("ownerId", "owner"); edit.getJSONObject("inputs").put("calendar.timeZone", "America/")
        assertEquals("America/", SharedAutomationEditorProtocol.edit(edit).getJSONObject("inputs").getString("calendar.timeZone"))
        assertEquals("INVALID_CALENDAR_CONTEXT", assertThrows(IllegalArgumentException::class.java) { SharedAutomationEditorProtocol.definition(edit) }.message)
        edit.getJSONObject("inputs").put("calendar.timeZone", "UTC")
        assertEquals("UTC", SharedAutomationEditorProtocol.definition(edit).getJSONObject("calendarContext").getString("timeZone"))
        assertEquals("America/New_York", edit.getJSONObject("dateInput").getString("timeZone"))
    }
    @Test fun templateOptionsFixScopeAndNeverRetainAnApplyIdOrAnAnchorDate() {
        val space = UUID.randomUUID().toString(); val project = UUID.randomUUID().toString()
        val safe = SharedAutomationEditorProtocol.templateOptions(space, project, JSONObject())
        assertEquals(project, safe.getString("projectId")); assertFalse(safe.has("anchorDate")); assertFalse(safe.has("operationId"))
        for (bad in listOf(JSONObject().put("projectId", "other"), JSONObject().put("anchorDate", "2026-10-20"), JSONObject().put("operationId", "id"),
            JSONObject().put("parentProjectId", "parent"), JSONObject().put("boardStatusId", "status"),
            JSONObject().put("fieldValues", JSONObject().put("task", JSONObject().put("field", JSONObject().put("untyped", "object")))))) {
            assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.templateOptions(space, project, bad) }
        }
    }
    @Test fun previewsAreStrictScopedAndCannotInventEffectsOrTaskRevisions() {
        val safe = JSONObject().put("matches", false).put("dryRun", true).put("ownerId", "owner").put("taskId", "task").put("taskRevision", 2).put("effects", JSONObject.NULL)
        assertFalse(SharedAutomationProtocol.preview(safe, "owner", "task").getBoolean("matches"))
        for (bad in listOf(JSONObject(safe.toString()).put("ownerId", "other"), JSONObject(safe.toString()).put("taskId", "other"),
            JSONObject(safe.toString()).put("taskRevision", 0), JSONObject(safe.toString()).put("dryRun", false), JSONObject(safe.toString()).put("matches", true))) {
            assertThrows(Exception::class.java) { SharedAutomationProtocol.preview(bad, "owner", "task") }
        }
    }
    @Test fun currentTypedCatalogAcceptsSevenTypesAndRejectsArchivedOrInvalidValues() {
        val types = listOf("text", "number", "date", "select", "multi", "checkbox", "url")
        val values = listOf("Own input", 0, "2026-10-20", "option", JSONArray().put("option"), false, "https://example.invalid/path")
        val fields = JSONArray(types.map { type -> JSONObject().put("id", type).put("spaceId", "space").put("projectId", "project").put("title", type)
            .put("type", type).put("position", 0).put("revision", 1).put("required", false).put("showCard", true).put("showList", true).put("archived", false)
            .put("predecessorId", JSONObject.NULL).put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "option").put("title", "Own option").put("archived", false)) else JSONArray()) })
        val data = JSONObject().put("project", JSONObject().put("id", "project")).put("members", JSONArray().put(JSONObject().put("userId", "owner")))
            .put("statuses", JSONArray()).put("labels", JSONArray()).put("customFieldDefinitions", fields).put("templates", JSONArray())
        val edit = automationWriterEdit(); edit.getJSONObject("definition").put("actions", JSONArray(types.mapIndexed { index, type -> JSONObject().put("type", "custom").put("fieldId", type).put("value", values[index]) }))
        edit.put("actionKeys", JSONArray(types.map { UUID.randomUUID().toString() }))
        SharedAutomationEditorProtocol.validateCatalog(edit, data)
        fields.getJSONObject(1).put("archived", true)
        assertThrows(Exception::class.java) { SharedAutomationEditorProtocol.validateCatalog(edit, data) }; fields.getJSONObject(1).put("archived", false)
        edit.getJSONObject("definition").getJSONArray("actions").getJSONObject(6).put("value", "javascript:alert(1)")
        assertEquals("CUSTOM_FIELD_URL_INVALID", assertThrows(IllegalArgumentException::class.java) { SharedAutomationEditorProtocol.validateCatalog(edit, data) }.message)
    }
}

class SharedAutomationEditorServiceTest {
    private val storage = MemoryPlanningStorage()
    private var current = true; private var lost = false; private var queued = false; private var cancelledAfterSend = false
    private var badReceipt = false; private var writable = true; private var source = automationRuleFixture()
    private val bodies = mutableListOf<String>(); private val receipts = mutableMapOf<String, JSONObject>()
    private var previews = 0
    private val access = object : SharedAutomationEditorAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun project(project: String) = JSONObject().put("project", JSONObject().put("id", project).put("spaceId", "space").put("permissions", JSONObject().put("editTasks", writable).put("manageProjects", false)))
            .put("members", JSONArray().put(JSONObject().put("userId", "owner"))).put("statuses", JSONArray()).put("customFieldDefinitions", JSONArray())
        override fun labels(project: String) = JSONArray()
        override fun template(space: String, template: String, language: String) = error("TEMPLATE_UNAVAILABLE")
        override fun rule(project: String, rule: String) = JSONObject(source.toString())
        override fun hasTaskQueue() = queued
        override fun send(project: String, rule: String?, payload: JSONObject): JSONObject {
            bodies += payload.toString()
            val response = receipts.getOrPut(payload.getString("operationId")) {
                automationRuleFixture(rule ?: "new-rule").put("revision", if (rule == null) 1 else payload.getInt("expectedRevision") + 1)
                    .put("title", payload.getString("title")).put("ownerId", payload.getString("ownerId"))
                    .put("enabled", payload.getBoolean("enabled")).put("definition", JSONObject(payload.getJSONObject("definition").toString()))
            }
            if (lost) { lost = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (cancelledAfterSend) current = false
            return JSONObject(response.toString()).apply { if (badReceipt) put("projectId", "other-project") }
        }
        override fun preview(project: String, definition: JSONObject, owner: String, task: String?): JSONObject {
            previews++; return JSONObject().put("dryRun", true).put("matches", false).put("ownerId", owner).put("taskId", task).put("taskRevision", 1).put("effects", JSONObject.NULL)
        }
    }
    private fun service(account: String = "owner") = SharedAutomationEditorService(PlanningJournal(storage, contract = SharedAutomationEditorJournalContract), account, access)
    private fun prepared(edit: JSONObject = automationWriterEdit()): JSONObject {
        val saved = service().save("project", null, edit); return service().prepare("project", saved.getString("stamp"))
    }
    @Test fun aCommittedLostCreateReplaysOneRequestAfterReopeningAndKeepsAMinimalReceipt() {
        val pending = prepared(); lost = true
        assertThrows(AuthFailure::class.java) { service().send("project", pending.getString("stamp")) }
        val attempted = service().load("project")!!; assertEquals("pending", attempted.getString("phase")); assertNull(service("other").load("project"))
        assertThrows(Exception::class.java) { service().remove("project", attempted.getString("stamp")) }
        assertThrows(Exception::class.java) { service().save("project", attempted.getString("stamp"), automationWriterEdit()) }
        val received = service().send("project", attempted.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(bodies[0], bodies[1]); assertEquals(1, receipts.size)
        assertEquals(setOf("ruleId", "revision", "enabled", "deleted"), received.getJSONObject("receipt").keys().asSequence().toSet())
        assertEquals(1, service().load("project")!!.getJSONObject("receipt").getInt("revision"))
    }
    @Test fun currentPermissionCasAndUnsentTaskQueuePreventAnUnattemptedWrite() {
        val saved = service().save("project", null, automationWriterEdit(source)); writable = false
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }; writable = true
        source.put("revision", 4)
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }; source.put("revision", 3); queued = true
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }; assertTrue(bodies.isEmpty())
        assertEquals("Recoverable rule", service().load("project")!!.getJSONObject("edit").getString("title"))
    }
    @Test fun cancelledAccountOrMalformedReceiptCannotReleaseThePendingCommand() {
        val pending = prepared(); cancelledAfterSend = true
        assertThrows(CancellationException::class.java) { service().send("project", pending.getString("stamp")) }
        current = true; cancelledAfterSend = false; val attempted = service().load("project")!!; badReceipt = true
        assertThrows(Exception::class.java) { service().send("project", attempted.getString("stamp")) }
        val ambiguous = service().load("project")!!; assertEquals("pending", ambiguous.getString("phase")); assertTrue(ambiguous.isNull("receipt")); badReceipt = false
        assertEquals("received", service().send("project", ambiguous.getString("stamp")).getString("phase")); assertEquals(1, receipts.size)
        assertEquals(1, bodies.toSet().size)
    }
    @Test fun aDryRunNeedsATaskAndDoesNotPrepareOrSendACommand() {
        val saved = service().save("project", null, automationWriterEdit().put("title", "")); val before = saved.toString()
        assertThrows(Exception::class.java) { service().preview("project", saved.getString("stamp"), null) }
        assertTrue(service().preview("project", saved.getString("stamp"), "task").getBoolean("dryRun"))
        assertEquals(before, service().load("project")!!.toString()); assertTrue(bodies.isEmpty()); assertTrue(receipts.isEmpty()); assertEquals(1, previews)
    }
}
