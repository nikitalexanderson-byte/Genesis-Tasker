package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DataImportProtocolTest {
    @Test fun legacyArchivedChoiceMetadataAndMappingsRemainReadableInRestorePreview() {
        val raw = preview()
        val choices = JSONArray((0..200).map { index -> JSONObject().put("id", if (index == 0) "choice" else "option-$index").put("title", "Choice $index").put("archived", index == 0) })
        raw.getJSONObject("data").getJSONArray("fields").getJSONObject(0).put("options", choices)
        raw.getJSONArray("destinationFields").getJSONObject(0).put("options", JSONArray(choices.toString()))
        raw.getJSONObject("optionMap").put("source", JSONObject().apply { for (index in 0 until choices.length()) put(choices.getJSONObject(index).getString("id"), JSONObject.NULL) })
        val parsed = DataImportProtocol.preview(raw)
        assertEquals(201, parsed.getJSONArray("destinationFields").getJSONObject(0).getJSONArray("options").length())
        choices.getJSONObject(0).put("archived", false)
        assertThrows(Exception::class.java) { DataImportProtocol.preview(raw) }
    }

    private fun field(id: String, type: String, source: Boolean = false): JSONObject = JSONObject()
        .put(if (source) "key" else "id", id).put("title", "Field $id").put("type", type).put("required", true).put("archived", false)
        .put("projectKey", JSONObject.NULL).put("options", if (type in setOf("select", "multi")) JSONArray()
            .put(JSONObject().put("id", "choice").put("title", "Choice").put("archived", false)) else JSONArray())
    private fun preview(): JSONObject = importPreview().also { raw ->
        raw.getJSONObject("data").getJSONArray("members").put(JSONObject().put("key", "former").put("title", "Former member"))
        raw.getJSONObject("data").getJSONArray("fields").put(field("source", "select", true))
        raw.getJSONObject("memberMap").put("former", JSONObject.NULL); raw.getJSONObject("fieldMap").put("source", "target")
        raw.getJSONObject("optionMap").put("source", JSONObject().put("choice", JSONObject.NULL))
        raw.getJSONArray("destinationFields").put(field("target", "select"))
        raw.getJSONArray("destinationMembers").put(JSONObject().put("id", IMPORT_SPACE).put("title", "Current member"))
        raw.getJSONArray("destinationStatuses").put(JSONObject().put("id", "current-open").put("title", "Open").put("isDone", 0))
        raw.getJSONArray("destinationLabels").put(JSONObject().put("id", "current-label").put("title", "Label"))
    }
    private fun rejects(change: (JSONObject) -> Unit) {
        val raw = preview(); change(raw)
        val failure = assertThrows(IllegalArgumentException::class.java) { DataImportProtocol.preview(raw) }
        assertEquals("DATA_IMPORT_INVALID", failure.message)
    }
    @Test fun legacyCustomFieldKeysPreserveRequiredZeroFalseAndOptionDefaults() {
        val selection = importSelection().put("fieldDefaults", JSONObject()
            .put("effort:legacy_1", 0).put("approved", false).put("due-date", "2026-10-20")
            .put("team", "option:one").put("labels", JSONArray().put("option:one").put("option_two")))
        val edit = JSONObject().put("kind", "data-import").put("selection", selection).put("review", JSONObject.NULL)
            .put("source", JSONObject().put("id", IMPORT_PROJECT).put("name", "legacy.json").put("bytes", 2).put("sha256", "b".repeat(64)))
        val restored = DataImportProtocol.edit(JSONObject(edit.toString())).getJSONObject("selection").getJSONObject("fieldDefaults")
        assertEquals(0, restored.getInt("effort:legacy_1")); assertFalse(restored.getBoolean("approved"))
        assertEquals("2026-10-20", restored.getString("due-date")); assertEquals("option:one", restored.getString("team"))
        assertEquals(listOf("option:one", "option_two"), (0 until restored.getJSONArray("labels").length()).map(restored.getJSONArray("labels")::getString))
        for (invalid in listOf("", "field/escape", "field with spaces", "x".repeat(101))) {
            val changed = JSONObject(selection.toString()).put("fieldDefaults", JSONObject().put(invalid, 0))
            assertThrows(IllegalArgumentException::class.java) { DataImportProtocol.selection(changed) }
        }
    }
    @Test fun nullableComputedOptionsAndPhpEmptyMapsAreNormalizedWithoutChangingTheResponse() {
        val raw = preview(); raw.put("issueTitles", JSONArray()); raw.getJSONObject("optionMap").put("source", JSONArray())
        val original = raw.toString(); val valid = DataImportProtocol.preview(raw)
        assertTrue(valid.getJSONObject("optionMap").get("source") is JSONObject); assertTrue(valid.get("issueTitles") is JSONObject)
        assertEquals(original, raw.toString())
        val nullable = DataImportProtocol.preview(preview()); assertTrue(nullable.getJSONObject("optionMap").getJSONObject("source").isNull("choice"))
    }
    @Test fun malformedCalendarContextsAreRejectedBeforeRenderingThePreview() {
        for (value in listOf(JSONObject.NULL, JSONArray(), JSONObject().put("version", 2),
            JSONObject().put("version", 2).put("timeZone", "Bad/Zone").put("gregorianYearStart", "january"),
            JSONObject().put("version", 2).put("timeZone", "UTC").put("gregorianYearStart", "autumn"))) {
            rejects { it.getJSONObject("data").put("calendarContext", value) }
        }
    }
    @Test fun sourceStatusesMustBeTypedUniqueAndHaveBothOpenAndDoneColumns() {
        rejects { it.getJSONObject("data").getJSONArray("projects").getJSONObject(0).put("statuses", JSONObject()) }
        rejects { it.getJSONObject("data").getJSONArray("projects").getJSONObject(0).getJSONArray("statuses").getJSONObject(0).put("isDone", "false") }
        rejects { it.getJSONObject("data").getJSONArray("projects").getJSONObject(0).getJSONArray("statuses").getJSONObject(1).put("key", "open") }
        rejects { it.getJSONObject("data").getJSONArray("projects").getJSONObject(0).getJSONArray("statuses").getJSONObject(1).put("isDone", false) }
        rejects { it.getJSONArray("destinationStatuses").getJSONObject(0).put("isDone", 2) }
    }
    @Test fun destinationCatalogsAndNestedFieldOptionsCannotCrashTheForm() {
        for (name in listOf("destinationMembers", "destinationStatuses", "destinationLabels", "destinationFields")) {
            rejects { it.getJSONArray(name).put("bad-row") }
            rejects { it.getJSONArray(name).getJSONObject(0).put("title", JSONArray()) }
            rejects { val rows = it.getJSONArray(name); rows.put(JSONObject(rows.getJSONObject(0).toString())) }
        }
        rejects { it.getJSONArray("destinationFields").getJSONObject(0).put("required", "true") }
        rejects { it.getJSONArray("destinationFields").getJSONObject(0).getJSONArray("options").getJSONObject(0).put("archived", 1) }
        rejects { it.getJSONArray("destinationFields").getJSONObject(0).getJSONArray("options").getJSONObject(0).remove("title") }
        rejects { it.getJSONObject("data").getJSONArray("fields").getJSONObject(0).put("options", JSONObject()) }
    }
    @Test fun invalidSourceRelationsTaskDatesAndDuplicateKeysAreRejected() {
        rejects { it.getJSONObject("data").getJSONArray("projects").getJSONObject(0).put("parentKey", "root") }
        rejects { it.getJSONObject("data").getJSONArray("fields").getJSONObject(0).put("projectKey", "missing") }
        rejects { it.getJSONObject("data").getJSONArray("tasks").getJSONObject(0).put("projectKey", "missing") }
        for (date in listOf("2026-02-30", "1899-12-31", "2101-01-01", "2026-2-01", "not-a-date"))
            rejects { it.getJSONObject("data").getJSONArray("tasks").getJSONObject(0).put("dueDate", date) }
        rejects { val members = it.getJSONObject("data").getJSONArray("members"); members.put(JSONObject(members.getJSONObject(0).toString())) }
    }
    @Test fun mapsMustCoverTheSourceAndContainOnlyKnownNestedOptionKeys() {
        rejects { it.getJSONObject("memberMap").remove("former") }
        rejects { it.getJSONObject("statusMap").put("missing", "open") }
        rejects { it.getJSONObject("fieldMap").put("source", JSONObject.NULL) }
        rejects { it.getJSONObject("optionMap").put("missing-field", JSONObject()) }
        rejects { it.getJSONObject("optionMap").getJSONObject("source").put("missing-choice", "choice") }
        rejects { it.getJSONObject("optionMap").getJSONObject("source").put("choice", JSONArray()) }
        rejects { it.getJSONObject("issueTitles").put("task", JSONObject()) }
    }
    @Test fun unavailableMappingTargetsRemainRepairableWithTheirServerBlockers() {
        val raw = preview().put("canApply", false)
        raw.getJSONArray("blockers").put(JSONObject().put("code", "DATA_MEMBER_UNAVAILABLE").put("field", "former"))
        raw.getJSONObject("memberMap").put("former", "deleted-member"); raw.getJSONObject("fieldMap").put("source", "deleted-field")
        val parsed = DataImportProtocol.preview(raw)
        assertFalse(parsed.getBoolean("canApply")); assertEquals("deleted-member", parsed.getJSONObject("memberMap").getString("former"))
        assertEquals(1, parsed.getJSONArray("blockers").length())
    }
    @Test fun fullCountsSampleAndTheApplyDecisionMustAgree() {
        rejects { it.getJSONObject("sourceCounts").put("tasks", 2) }
        rejects { it.put("projectCount", 2) }
        rejects { it.getJSONObject("data").put("tasks", JSONArray()) }
        rejects { it.getJSONArray("blockers").put(JSONObject().put("code", "DATA_APPLY_BLOCKED").put("field", "")) }
        val large = preview().put("taskCount", 100_000).put("canApply", false)
        large.getJSONObject("sourceCounts").put("tasks", 100_000)
        large.getJSONArray("blockers").put(JSONObject().put("code", "DATA_RESOURCE_LIMIT").put("field", ""))
        val tasks = large.getJSONObject("data").getJSONArray("tasks")
        for (index in 1..99) tasks.put(JSONObject(tasks.getJSONObject(0).toString()).put("key", "task-$index"))
        assertEquals(100_000, DataImportProtocol.preview(large).getInt("taskCount"))
    }
}
