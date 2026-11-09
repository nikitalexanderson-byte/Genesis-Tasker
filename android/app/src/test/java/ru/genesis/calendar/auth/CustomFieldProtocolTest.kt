package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun customFieldFile(name: String): String = requireNotNull(CustomFieldProtocolTest::class.java.getResourceAsStream("/custom-fields/$name.json")).bufferedReader().use { it.readText() }
internal fun customTask() = JSONObject(customFieldFile("task"))
internal fun customDefinitions(): List<JSONObject> {
    val fields = JSONArray(customFieldFile("fields")); val field = fields.getJSONObject(0)
    return CustomFieldProtocol.definitions(field.getString("spaceId"), field.getString("projectId"), fields)
}

class CustomFieldProtocolTest {
    private val fields = customDefinitions()
    private fun field(type: String) = fields.first { it.getString("type") == type && !it.getBoolean("archived") }
    private fun id(type: String) = field(type).getString("id")
    @Test fun realPhpValuesHaveAllSevenTypesAndKeepFalseAndArchivedHistory() {
        assertEquals(8, fields.size); val values = CustomFieldProtocol.fromTask(customTask())
        assertEquals(-12.5, values.getDouble(id("number")), 0.0); assertEquals(false, values.get(id("checkbox")))
        assertEquals("retired", values.getString(id("select")))
        assertEquals("Пользовательский текст 🌿", values.getString(id("text")))
        assertTrue(values.has(fields.first { it.getBoolean("archived") }.getString("id")))
        val draft = CustomFieldDraft.fromTask(customTask()); assertTrue(draft.errors(fields).isEmpty()); assertEquals(0, draft.patch(fields).length())
    }
    @Test fun dirtyTypedPatchPreservesUnmentionedFieldsAndDistinguishesZeroFalseAndExplicitNull() {
        val draft = CustomFieldDraft.fromTask(customTask()).change(id("number"), "0").change(id("checkbox"), false).change(id("text"), JSONObject.NULL)
        val patch = draft.patch(fields)
        assertEquals(2, patch.length()); assertEquals(0.0, patch.getDouble(id("number")), 0.0); assertTrue(patch.isNull(id("text")))
        assertFalse(patch.has(id("checkbox"))); assertFalse(patch.has(id("select")))
        val cleared = draft.change(id("checkbox"), null)
        assertEquals("CUSTOM_FIELD_REQUIRED", cleared.errors(fields)[id("checkbox")]); assertThrows(IllegalArgumentException::class.java) { cleared.patch(fields) }
    }
    @Test fun numericFormattingChangesAndOptionOrderDoNotBecomeMutations() {
        val original = CustomFieldDraft.fromTask(customTask())
        val draft = original.change(id("number"), "-12,500").change(id("multi"), JSONArray().put("retired").put("first").put("first"))
        assertTrue(draft.changedIds(fields).isEmpty()); assertEquals(0, draft.patch(fields).length())
        assertEquals("CUSTOM_FIELD_VALUE_INVALID", original.change(id("number"), "NaN").errors(fields)[id("number")])
        assertEquals("CUSTOM_FIELD_VALUE_INVALID", original.change(id("number"), "1e16").errors(fields)[id("number")])
    }
    @Test fun archivedSelectionsCanRemainButCannotBeNewlyAssignedToAnotherTask() {
        val original = customTask(); val values = original.getJSONObject("customFields")
        values.put(id("select"), "first").put(id("multi"), JSONArray().put("first"))
        val draft = CustomFieldDraft.fromTask(original).change(id("select"), "retired").change(id("multi"), JSONArray().put("retired"))
        assertEquals("CUSTOM_FIELD_OPTION_UNAVAILABLE", draft.errors(fields)[id("select")]); assertEquals("CUSTOM_FIELD_OPTION_UNAVAILABLE", draft.errors(fields)[id("multi")])
    }
    @Test fun aRemovedDefinitionOrArchivedFieldNeverSilentlyDropsEnteredValues() {
        val original = CustomFieldDraft.fromTask(customTask()); val hidden = fields.first { it.getBoolean("archived") }.getString("id")
        val draft = original.change(hidden, "Own changed input").change("future-field", "Saved choice")
        assertEquals("CUSTOM_FIELD_UNAVAILABLE", draft.errors(fields)[hidden]); assertEquals("CUSTOM_FIELD_UNAVAILABLE", draft.errors(fields)["future-field"])
        assertEquals("Own changed input", draft.value(hidden)); assertEquals("Saved choice", draft.value("future-field"))
        assertEquals(0, draft.reset(hidden).reset("future-field").patch(fields).length())
    }
    @Test fun explicitRebaseKeepsOwnChangesAndUsesFreshUnchangedValues() {
        val original = CustomFieldDraft.fromTask(customTask()).change(id("number"), "0")
        val current = customTask(); current.getJSONObject("customFields").put(id("number"), 7).put(id("text"), "Changed by another member")
        val next = original.rebase(current, fields)
        assertEquals("0", next.value(id("number"))); assertEquals("Changed by another member", next.value(id("text")))
        assertEquals(1, next.patch(fields).length()); assertEquals(0.0, next.patch(fields).getDouble(id("number")), 0.0)
        assertEquals(original.snapshot().toString(), CustomFieldDraft.restore(original.snapshot()).snapshot().toString())
    }
    @Test fun datesAndLinksAreCanonicalAndUnsafeOrMalformedTypesCannotBeSent() {
        val draft = CustomFieldDraft.fromTask(customTask()).change(id("date"), "2026-02-30").change(id("url"), "javascript:alert(1)")
        assertEquals("CUSTOM_FIELD_VALUE_INVALID", draft.errors(fields)[id("date")]); assertEquals("CUSTOM_FIELD_URL_INVALID", draft.errors(fields)[id("url")])
        val bad = CustomFieldDraft.fromTask(customTask()).change(id("checkbox"), "false")
        assertEquals("CUSTOM_FIELD_VALUE_INVALID", bad.errors(fields)[id("checkbox")])
        assertThrows(IllegalArgumentException::class.java) { CustomFieldProtocol.values(JSONArray().put("not-a-map")) }
        assertEquals(0, CustomFieldProtocol.values(JSONArray()).length())
    }
    @Test fun aTaskReceiptMustConfirmChangedValuesIncludingAnExplicitClear() {
        val draft = CustomFieldDraft.fromTask(customTask()).change(id("number"), 0).change(id("text"), null); val patch = draft.patch(fields)
        val response = customTask(); response.getJSONObject("customFields").put(id("number"), 0).remove(id("text"))
        CustomFieldProtocol.confirmPatch(patch, response)
        response.getJSONObject("customFields").put(id("number"), "0")
        assertEquals(AuthFailure.Kind.PROTOCOL, assertThrows(AuthFailure::class.java) { CustomFieldProtocol.confirmPatch(patch, response) }.kind)
        response.remove("customFields")
        assertThrows(AuthFailure::class.java) { CustomFieldProtocol.confirmPatch(patch, response) }
        val missing = JSONObject(patch.toString()).put(id("checkbox"), false)
        assertThrows(AuthFailure::class.java) { CustomFieldProtocol.confirmPatch(missing, JSONObject().put("customFields", JSONObject().put(id("number"), 0))) }
    }
    @Test fun unknownLegacySnapshotsDoNotBecomeAFalseEmptyAcknowledgedBase() {
        val old = customTask().apply { remove("customFields") }; val draft = CustomFieldDraft.fromTask(old)
        assertEquals("CUSTOM_FIELD_UNAVAILABLE", draft.errors(fields)["@snapshot"])
        assertTrue(draft.errors(emptyList()).isEmpty()); assertEquals(0, draft.patch(emptyList()).length())
    }
}
