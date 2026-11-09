package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

class SharedTaskListReaderTest {
    @Test fun datesUseTheDisplayLocaleWhileThePredicateKeepsItsIsoDate() {
        val field = customDefinitions().first { it.getString("type") == "date" }
        val display = SharedCustomCalendar.initial(UiPreferences(display = CalendarMode.PROFANE, input = CalendarMode.LUNAR)).copy(mode = CalendarMode.PROFANE)
        val english = sharedTaskFieldValueText(field, "2026-10-21", "en-US", display, "unavailable")
        val german = sharedTaskFieldValueText(field, "2026-10-21", "de", display, "unavailable")
        assertNotEquals("2026-10-21", english); assertNotEquals(english, german); assertTrue(english.contains("2026"))
        assertEquals("2026-10-21", CustomFieldQueryProtocol.criterion(field, "eq", "2026-10-21").getString("value"))
    }
    private fun filter(q: String = "") = JSONObject().put("projectIds", JSONArray().put("project")).put("q", q)
    private fun page(version: String, vararg ids: String, more: Boolean = false) = JSONObject().put("queryVersion", version).put("total", 3)
        .put("hasMore", more).put("nextCursor", if (more) "cursor" else JSONObject.NULL).put("dateCounts", JSONObject().put("2026-10-21", 3))
        .put("tasks", JSONArray(ids.map { JSONObject().put("id", it).put("projectId", "project") }))
    private class Gateway(val read: suspend (JSONObject, String?, String) -> JSONObject) : SharedWorkspaceGateway {
        override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String) = read(filter, cursor, sort)
    }
    @Test fun typedFiltersOrderCountsAndContinuationUseTheSameQuery() = runBlocking {
        val calls = mutableListOf<String>()
        val raw = filter("needle").put("customFields", JSONArray().put(JSONObject().put("fieldId", "check").put("op", "eq").put("value", false)))
        val reader = SharedTaskListReader(Gateway { f, cursor, sort ->
            calls += "$f:$sort:$cursor"; if (cursor == null) page("v1", "a", "b", more = true) else page("v1", "c")
        })
        reader.configure(raw, "custom:number:asc", "fields-v1"); reader.refresh(); reader.more()
        assertEquals(3, reader.pageState.value!!.getJSONArray("tasks").length()); assertEquals(3, reader.pageState.value!!.getJSONObject("dateCounts").getInt("2026-10-21"))
        assertTrue(calls.all { it.startsWith("$raw:custom:number:asc:") }); assertTrue(calls.last().endsWith(":cursor"))
    }
    @Test fun changesOfConditionsOrderAndDefinitionMetadataDiscardRowsAndCursors() = runBlocking {
        val reader = SharedTaskListReader(Gateway { _, _, _ -> page("v1", "a", more = true) })
        reader.configure(filter(), "position", "fields-v1"); reader.refresh()
        reader.configure(filter("new"), "position", "fields-v1"); assertNull(reader.pageState.value); reader.refresh()
        reader.configure(filter("new"), "custom:number:desc", "fields-v1"); assertNull(reader.pageState.value); reader.refresh()
        reader.configure(filter("new"), "custom:number:desc", "fields-v2"); assertNull(reader.pageState.value)
    }
    @Test fun aLateSuccessfulResponseCannotRepopulateAnotherQueryOrAPausedScreen() = runBlocking {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val reader = SharedTaskListReader(Gateway { _, _, _ -> entered.complete(Unit); release.await(); page("old", "old") })
        reader.configure(filter("old"), "position", "v1")
        val loading = async { runCatching { reader.refresh() } }; entered.await()
        reader.configure(filter("new"), "position", "v2"); release.complete(Unit)
        assertTrue(loading.await().exceptionOrNull() is CancellationException); assertNull(reader.pageState.value)
        reader.pause(); assertNull(reader.pageState.value)
    }
    @Test fun aChangedServerGenerationRestartsInsteadOfAppendingAnotherSnapshot() = runBlocking {
        var reads = 0
        val reader = SharedTaskListReader(Gateway { _, cursor, _ ->
            reads++; if (cursor != null) throw AuthApiError("SHARED_QUERY_CHANGED")
            if (reads == 1) page("v1", "old", more = true) else page("v2", "fresh")
        })
        reader.configure(filter(), "position", "v1"); reader.refresh(); reader.more()
        assertEquals(3, reads); assertEquals("fresh", reader.pageState.value!!.getJSONArray("tasks").getJSONObject(0).getString("id")); assertEquals("v2", reader.pageState.value!!.getString("queryVersion"))
    }
    @Test fun revocationAndMalformedCrossProjectRepliesClearRowsAndCounters() = runBlocking {
        var denied = false
        val reader = SharedTaskListReader(Gateway { _, _, _ -> if (denied) throw AuthApiError("SHARED_PROJECT_FORBIDDEN") else page("v1", "a") })
        reader.configure(filter(), "position", "v1"); reader.refresh(); denied = true; reader.refresh()
        assertTrue(reader.lost); assertNull(reader.pageState.value)
        val wrong = SharedTaskListReader(Gateway { _, _, _ -> page("v1", "a").apply { getJSONArray("tasks").getJSONObject(0).put("projectId", "private") } })
        wrong.configure(filter(), "position", "v1"); wrong.refresh(); assertNull(wrong.pageState.value); assertEquals("SHARED_QUERY_PROTOCOL", wrong.error)
    }
    @Test fun listPresentationHonorsScopeVisibilityHistoryZeroFalseAndIndependentCalendars() {
        val task = customTask(); val fields = customDefinitions().map { JSONObject(it.toString()).put("showList", true) }
        val number = fields.first { it.getString("type") == "number" }; val check = fields.first { it.getString("type") == "checkbox" }
        task.put("spaceId", fields.first().getString("spaceId")); task.getJSONObject("customFields").put(number.getString("id"), 0).put(check.getString("id"), false)
        val values = sharedTaskListFieldValues(task, fields).associate { it.first.getString("id") to it.second }
        assertEquals(0.0, (values[number.getString("id")] as Number).toDouble(), 0.0); assertEquals(false, values[check.getString("id")])
        assertFalse(fields.filter { it.getBoolean("archived") }.any { it.getString("id") in values })
        number.put("showList", false); assertFalse(sharedTaskListFieldValues(task, fields).any { it.first.getString("id") == number.getString("id") })
        assertTrue(sharedTaskListFieldValues(JSONObject(task.toString()).put("spaceId", "other"), fields).isEmpty())
        val calendar = SharedCustomCalendar.initial(UiPreferences(display = CalendarMode.SACRED, input = CalendarMode.LUNAR))
        val query = SharedTaskFieldQuery(JSONObject().put("criteria", JSONArray()).put("sort", "").put("calendar", calendar.saved()))
        val restored = SharedTaskFieldQuery(query.saved()); assertEquals(CalendarMode.LUNAR, restored.calendar.mode)
        val selected = fields.first { it.getString("type") == "select" }
        assertEquals(selected.getJSONArray("options").let { rows -> (0 until rows.length()).map(rows::getJSONObject).first { it.getString("id") == "retired" }.getString("title") },
            sharedTaskFieldValueText(selected, "retired", "en", calendar, "unavailable"))
    }
}
