package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

class SharedTaskCustomDraftTest {
    private fun resource(name: String) = requireNotNull(javaClass.getResourceAsStream("/custom-fields/$name.json")).bufferedReader().use { it.readText() }
    private fun task() = JSONObject(resource("task"))
    private fun fields() = JSONArray(resource("fields")).let { raw -> CustomFieldProtocol.definitions(raw.getJSONObject(0).getString("spaceId"), task().getString("projectId"), raw) }
    private fun field(type: String) = fields().first { it.getString("type") == type && !it.getBoolean("archived") }.getString("id")
    private fun snapshot(raw: JSONArray = JSONArray(resource("fields"))) = JSONObject()
        .put("project", JSONObject().put("id", task().getString("projectId")).put("spaceId", raw.getJSONObject(0).getString("spaceId")))
        .put("customFieldDefinitions", raw)

    @Test fun taskCardPatchKeepsOtherFieldsArchiveEstimatesAndPriorityIndependent() {
        val task = task(); task.getJSONObject("customFields").put("future-unknown", "leave-as-is")
        val details = sharedTaskDetailDraft(task)
        assertFalse(sharedTaskDetailsChanged(task, details, fields()))
        val custom = sharedTaskCustomDraft(task, details).change(field("number"), "0,0").change(field("checkbox"), false).change(field("text"), null)
        val edited = sharedTaskWithCustomFields(task, details, custom).put("priority", 3)
        val body = sharedTaskDetailChanges(task, edited, true, fields())
        val patch = body.getJSONObject("customFields")
        assertEquals(setOf(field("number"), field("text")), patch.keys().asSequence().toSet())
        assertEquals(0.0, patch.getDouble(field("number")), 0.0); assertTrue(patch.isNull(field("text")))
        assertEquals(3, body.getInt("priority")); assertFalse(body.has("storyPoints")); assertFalse(body.has("estimateHours"))
        assertFalse(body.has(SHARED_CUSTOM_DRAFT_KEY)); assertFalse(body.has(SHARED_CUSTOM_CALENDAR_KEY))
        assertEquals("leave-as-is", task.getJSONObject("customFields").getString("future-unknown"))
        assertTrue(sharedTaskDetailsChanged(task, edited, fields()))
    }

    @Test fun requiredFalseAndZeroAreValuesButClearingIsAnError() {
        val source = task(); val details = sharedTaskDetailDraft(source)
        val changed = sharedTaskWithCustomFields(source, details, sharedTaskCustomDraft(source, details).change(field("number"), "0"))
        assertTrue(bindSharedTaskCustom(source, changed, snapshot()).valid)
        val cleared = sharedTaskWithCustomFields(source, changed, sharedTaskCustomDraft(source, changed).change(field("checkbox"), null))
        val bound = bindSharedTaskCustom(source, cleared, snapshot())
        assertFalse(bound.valid); assertEquals("CUSTOM_FIELD_REQUIRED", bound.errors[field("checkbox")])
        assertThrows(IllegalArgumentException::class.java) { sharedTaskDetailChanges(source, cleared, true, fields()) }
    }

    @Test fun explicitRebaseKeepsOwnChangedFieldAndAdoptsUntouchedServerValues() {
        val source = task(); val details = sharedTaskDetailDraft(source)
        val changed = sharedTaskWithCustomFields(source, details, sharedTaskCustomDraft(source, details).change(field("number"), "17"))
        val fresh = JSONObject(source.toString()).put("revision", 2)
        fresh.getJSONObject("customFields").put(field("number"), 12).put(field("text"), "Another editor")
        val rebased = rebaseSharedTaskDetailDraft(fresh, changed, fields())
        assertEquals("17", sharedTaskCustomDraft(fresh, rebased).value(field("number")))
        assertEquals("Another editor", sharedTaskCustomDraft(fresh, rebased).value(field("text")))
        assertEquals(setOf(field("number")), sharedTaskDetailChanges(fresh, rebased, true, fields()).getJSONObject("customFields").keys().asSequence().toSet())
    }

    @Test fun fieldsArchivedDuringEditingRequireExplicitResetOfOwnValue() {
        val source = task(); val details = sharedTaskDetailDraft(source)
        val changed = sharedTaskWithCustomFields(source, details, sharedTaskCustomDraft(source, details).change(field("text"), "my unsaved input"))
        val raw = JSONArray(resource("fields")); (0 until raw.length()).map(raw::getJSONObject).first { it.getString("id") == field("text") }.put("archived", true)
        val bound = bindSharedTaskCustom(source, changed, snapshot(raw))
        assertEquals("CUSTOM_FIELD_UNAVAILABLE", bound.errors[field("text")]); assertFalse(bound.valid)
        val reset = sharedTaskWithCustomFields(source, changed, requireNotNull(bound.draft).reset(field("text")))
        assertTrue(bindSharedTaskCustom(source, reset, snapshot(raw)).valid)
        assertFalse(sharedTaskDetailsChanged(source, reset, fields()))
    }

    @Test fun inputCalendarPersistsSeparatelyAcrossRebaseAndNeverEntersTaskPatch() {
        val source = task(); val prefs = UiPreferences(input = CalendarMode.LUNAR, display = CalendarMode.SACRED, gregorianYearStartsInMarch = true)
        val initial = sharedTaskDetailDraft(source, prefs)
        val context = sharedCustomCalendar(initial)
        assertEquals(CalendarMode.LUNAR, context.mode); assertEquals("march", context.context.gregorianYearStart)
        for (mode in CalendarMode.entries) {
            val presented = JSONObject(initial.toString()).put(SHARED_CUSTOM_CALENDAR_KEY, context.copy(mode = mode).saved())
            assertFalse(sharedTaskDetailsChanged(source, presented, fields()))
            val restored = JSONObject(presented.toString())
            val rebound = bindSharedTaskCustom(source, restored, snapshot(), UiPreferences(input = CalendarMode.PROFANE))
            assertTrue(rebound.valid); assertEquals(mode, rebound.calendar!!.mode)
            assertEquals("2026-10-20", rebound.draft!!.value(field("date")))
            val rebased = rebaseSharedTaskDetailDraft(source, restored, fields())
            assertEquals(context.copy(mode = mode), sharedCustomCalendar(rebased))
            val body = sharedTaskDetailChanges(source, rebased, true, fields())
            assertFalse(body.has("customFields")); assertFalse(body.has(SHARED_CUSTOM_CALENDAR_KEY))
        }
    }

    @Test fun malformedOrWrongScopeMetadataDoesNotCrashOrSilentlyResetUserInput() {
        val source = task(); val initial = sharedTaskDetailDraft(source)
        val malformed = JSONObject(initial.toString()).put(SHARED_CUSTOM_DRAFT_KEY, JSONObject().put("raw", "keep this local"))
        assertFalse(bindSharedTaskCustom(source, malformed, snapshot()).valid)
        val rebased = rebaseSharedTaskDetailDraft(source, malformed, fields())
        assertEquals("keep this local", rebased.getJSONObject(SHARED_CUSTOM_DRAFT_KEY).getString("raw"))
        val wrongScope = JSONObject(initial.toString())
        wrongScope.getJSONObject(SHARED_CUSTOM_DRAFT_KEY).put("taskId", "another-task")
        assertFalse(bindSharedTaskCustom(source, wrongScope, snapshot()).valid)
        val invalidServer = JSONObject(source.toString()).put("customFields", "invalid-value-map")
        assertFalse(bindSharedTaskCustom(invalidServer, sharedTaskDetailDraft(invalidServer), snapshot()).valid)
    }

    @Test fun missingOrMalformedCatalogCannotMasqueradeAsAnEmptyKnownCatalog() {
        val source = task(); val details = sharedTaskDetailDraft(source)
        val missing = snapshot().apply { remove("customFieldDefinitions") }
        assertFalse(bindSharedTaskCustom(source, details, missing).valid)
        assertFalse(bindSharedTaskCustom(source, details, snapshot().put("customFieldDefinitions", JSONObject())).valid)
        val wrong = snapshot(); wrong.getJSONObject("project").put("id", "wrong-project")
        assertFalse(bindSharedTaskCustom(source, details, wrong).valid)
    }

    @Test fun pendingIdentityReplyMergesCustomPatchWithoutDroppingUntouchedArchiveOrUnknownValues() {
        val source = task(); source.getJSONObject("customFields").put("future-unknown", false)
        val body = JSONObject().put("customFields", JSONObject().put(field("number"), 0).put(field("text"), JSONObject.NULL))
        val reply = JSONObject().put("id", source.getString("id")).put("projectId", source.getString("projectId")).put("pending", true)
        val merged = sharedPendingTask(source, reply, body).getJSONObject("customFields")
        assertEquals(0, merged.getInt(field("number"))); assertTrue(merged.isNull(field("text")))
        assertEquals(false, merged.get("future-unknown")); assertEquals(false, merged.get(field("checkbox")))
        assertEquals(source.getJSONObject("customFields").getString(field("date")), merged.getString(field("date")))
        assertEquals(source.getJSONObject("customFields").length(), merged.length())
    }
}
