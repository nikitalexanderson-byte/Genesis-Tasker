package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

class SharedTaskCustomCreationTest {
    private fun raw() = JSONArray(requireNotNull(javaClass.getResourceAsStream("/custom-fields/fields.json")).bufferedReader().use { it.readText() })
    private val project = raw().getJSONObject(0).getString("projectId")
    private val space = raw().getJSONObject(0).getString("spaceId")
    private fun snapshot(fields: JSONArray = raw()) = JSONObject().put("project", JSONObject().put("id", project).put("spaceId", space)).put("customFieldDefinitions", fields)
    private fun id(type: String) = importRows(raw()).first { it.getString("type") == type && !it.getBoolean("archived") }.getString("id")
    private fun set(state: SharedTaskCustomCreation, type: String, value: Any?) = state.change(sharedTaskWithCustomFields(state.source, state.details,
        sharedTaskCustomDraft(state.source, state.details).change(id(type), value)))
    private fun bind(state: SharedTaskCustomCreation, fields: JSONArray = raw()) = bindSharedTaskCustom(state.source, state.details, snapshot(fields))
    private fun valid(): SharedTaskCustomCreation = SharedTaskCustomCreation.initial(project, UiPreferences()).also { set(it, "number", "0"); set(it, "checkbox", false) }

    @Test fun newTaskRequiresExplicitZeroAndFalseAndSendsOnlyCustomValues() {
        val state = SharedTaskCustomCreation.initial(project, UiPreferences())
        assertFalse(bind(state).valid); assertEquals(2, bind(state).errors.size)
        set(state, "number", "0,00"); set(state, "checkbox", false); set(state, "text", "")
        val body = state.fields(bind(state))
        assertEquals(setOf("customFields"), body.keys().asSequence().toSet())
        val values = body.getJSONObject("customFields")
        assertEquals(setOf(id("number"), id("checkbox")), values.keys().asSequence().toSet())
        assertEquals(0.0, values.getDouble(id("number")), 0.0); assertEquals(false, values.get(id("checkbox")))
        assertFalse(body.toString().contains("new-task")); assertFalse(body.has(SHARED_CUSTOM_CALENDAR_KEY))
    }

    @Test fun restorationKeepsAllInputAndCalendarContextUntilAnExplicitReset() {
        val prefs = UiPreferences(input = CalendarMode.LUNAR, display = CalendarMode.SACRED, gregorianYearStartsInMarch = true)
        val state = SharedTaskCustomCreation.initial(project, prefs)
        set(state, "number", "0"); set(state, "checkbox", false); set(state, "date", "2026-10-21"); set(state, "text", "My task field")
        val restored = SharedTaskCustomCreation.restore(project, state.saved())
        assertEquals(state.fields(bind(state)).toString(), restored.fields(bind(restored)).toString())
        assertEquals(CalendarMode.LUNAR, sharedCustomCalendar(restored.details).mode)
        assertEquals("march", sharedCustomCalendar(restored.details).context.gregorianYearStart)
        restored.reset(UiPreferences(input = CalendarMode.PROFANE))
        assertFalse(bind(restored).valid); assertEquals(CalendarMode.PROFANE, sharedCustomCalendar(restored.details).mode)
        assertNull(sharedTaskCustomDraft(restored.source, restored.details).value(id("text")))
        assertEquals("My task field", sharedTaskCustomDraft(state.source, state.details).value(id("text")))
    }

    @Test fun wrongScopeOrMalformedSavedDataCannotBecomeAnEmptyValidCreate() {
        val first = valid(); set(first, "text", "Keep local input")
        val crossed = SharedTaskCustomCreation.restore("other-project", first.saved())
        val target = snapshot().apply { getJSONObject("project").put("id", "other-project") }
        assertFalse(bindSharedTaskCustom(crossed.source, crossed.details, target).valid)
        val broken = SharedTaskCustomCreation.restore(project, "broken-json")
        assertFalse(bind(broken).valid); assertTrue(broken.saved().contains("broken-json"))
        assertThrows(IllegalArgumentException::class.java) { broken.fields(bind(broken)) }
        broken.reset(UiPreferences()); assertEquals(2, bind(broken).errors.size)
    }

    @Test fun newlyRequiredAndArchivedDefinitionsBlockCreateWithoutLosingInput() {
        val state = valid(); set(state, "text", "Keep this input")
        val changed = raw(); importRows(changed).first { it.getString("id") == id("url") }.put("required", true)
        assertEquals("CUSTOM_FIELD_REQUIRED", bind(state, changed).errors[id("url")])
        assertThrows(IllegalArgumentException::class.java) { state.fields(bind(state, changed)) }
        set(state, "select", "retired")
        assertEquals("CUSTOM_FIELD_OPTION_UNAVAILABLE", bind(state).errors[id("select")])
        assertEquals("Keep this input", sharedTaskCustomDraft(state.source, state.details).value(id("text")))
        state.change(sharedTaskWithCustomFields(state.source, state.details, sharedTaskCustomDraft(state.source, state.details).reset(id("select"))))
        assertTrue(bind(state).valid)
    }

    @Test fun staleRenderedInputCannotSilentlyReplaceTheLatestKeystrokeInCreateBody() {
        val state = valid(); val previous = bind(state)
        set(state, "text", "Last keystroke")
        assertEquals("CUSTOM_FIELD_CONFLICT", assertThrows(IllegalArgumentException::class.java) { state.fields(previous) }.message)
        assertEquals("Last keystroke", state.fields(bind(state)).getJSONObject("customFields").getString(id("text")))
    }

    @Test fun projectsWithoutDefinitionsKeepTheLegacyCreateBodyUnchanged() {
        val state = SharedTaskCustomCreation.initial(project, UiPreferences())
        val empty = bind(state, JSONArray())
        assertTrue(empty.valid); assertEquals(0, state.fields(empty).length())
        val legacy = snapshot(JSONArray()).apply { remove("customFieldDefinitions") }
        assertTrue(bindSharedTaskCustom(state.source, state.details, legacy).valid)
    }
}
