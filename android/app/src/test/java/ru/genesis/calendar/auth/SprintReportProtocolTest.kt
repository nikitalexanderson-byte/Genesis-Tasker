package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun sprintMetric(tasks: Int = 10, value: Any = 30): JSONObject = JSONObject().put("tasks", tasks).put("unestimated", 0).put("knownValue", value).put("value", value)
internal fun sprintReportFixture(unit: String = "points"): JSONObject {
    val context = JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march")
    fun period() = JSONObject().put("startDate", "2026-10-19").put("endDate", "2026-10-25").put("calendarMode", "sacred").put("calendarContext", JSONObject(context.toString()))
    val summary = JSONObject()
    for (key in listOf("plan", "alreadyDone", "committed", "scope", "remaining", "done", "delivered", "carried")) summary.put(key, sprintMetric())
    for (key in listOf("added", "removed")) summary.put(key, sprintMetric(0, 0).apply { remove("value") })
    summary.put("scopeChangeCoverage", "observed").put("estimateDelta", -2).put("unestimatedDelta", -1)
        .put("completionTransitions", 4).put("completedTasksCount", 4).put("reopenedTasksCount", 0)
    val series = JSONArray()
    for (day in 19..20) series.put(JSONObject().put("at", "2026-10-${day}T06:00:00Z").put("date", "2026-10-$day")
        .put("sequence", day - 18).put("firstSequence", day - 18).put("sourceCount", 1).put("sourceKind", "event")
        .put("sourceId", "PRIVATE_AUDIT_ID").put("connectPrevious", day > 19).put("coverage", "observed").put("unknownTasks", 0)
        .put("scope", sprintMetric()).put("remaining", sprintMetric()).put("done", sprintMetric()).put("wip", sprintMetric())
        .put("statuses", JSONObject().put("open", sprintMetric())).put("wipStatuses", JSONObject().put("open", sprintMetric())))
    return JSONObject().put("asOf", "2026-10-20T08:00:00Z").put("projectId", "project")
        .put("sprint", period().put("id", "sprint").put("projectId", "project").put("title", "План команды").put("state", "active").put("privateMember", "PRIVATE_MEMBER"))
        .put("launch", period().put("estimateUnit", "hours"))
        .put("token", "PRIVATE_REPORT_TOKEN")
        .put("statuses", JSONArray().put(JSONObject().put("id", "open").put("title", "В работе").put("color", "#255b59").put("position", 0).put("revision", 1).put("isDone", 0)))
        .put("flow", JSONObject().put("available", true).put("unit", unit).put("resolution", "day").put("timeZone", "Europe/Moscow")
            .put("from", "2026-10-19T06:00:00Z").put("to", "2026-10-20T08:00:00Z").put("terminal", false).put("historyComplete", true)
            .put("scopeChangeCount", 0).put("summary", summary).put("series", series)
            .put("gaps", JSONArray().put(JSONObject().put("reason", "unknown").put("taskId", "PRIVATE_TASK").put("sourceId", "PRIVATE_EVENT"))))
}

class SprintReportProtocolTest {
    @Test fun exportedServerResponsesParseForEveryUnitAndAllSourceKinds() {
        val corpus = javaClass.getResourceAsStream("/sprint-report-server-corpus.json")!!.bufferedReader(Charsets.UTF_8).use { JSONArray(it.readText()) }
        assertEquals(9, corpus.length())
        for (entry in SprintReportProtocol.rows(corpus)) {
            val raw = entry.getJSONObject("report"); val project = raw.getString("projectId"); val sprint = raw.getJSONObject("sprint").getString("id"); val unit = raw.getJSONObject("flow").getString("unit")
            val parsed = SprintReportProtocol.snapshot(project, sprint, unit, raw)
            assertEquals(raw.getJSONObject("flow").getBoolean("available"), parsed.getJSONObject("flow").getBoolean("available"))
            for (kind in listOf("tasks", "events", "changes")) {
                val source = entry.getJSONObject("sources").getJSONObject(kind)
                val page = SprintReportProtocol.sources(parsed, SprintReportProtocol.query(kind, "plan"), source)
                assertEquals(source.getLong("total"), page.getLong("total")); assertEquals(source.getJSONArray("items").length(), page.getJSONArray("items").length())
            }
            assertFalse(SprintReportProtocol.offline(parsed).has("token"))
        }
    }
    private fun report(value: JSONObject = sprintReportFixture(), unit: String = "points") = SprintReportProtocol.snapshot("project", "sprint", unit, value)
    private fun rejected(action: () -> Unit) = assertTrue(runCatching(action).isFailure)
    private fun task(index: Int) = JSONObject().put("id", "task-$index").put("projectId", "current-project").put("title", "Текущая задача $index").put("archived", index % 2 == 0).put("revision", 3)
    private fun page(start: Int, end: Int, total: Int = 131) = JSONObject().put("asOf", "2026-10-20T08:00:00Z")
        .put("items", JSONArray((start until end).map(::task))).put("total", total).put("unavailable", 0).put("nextCursor", if (end < total) "opaque-cursor-$end" else JSONObject.NULL)
    private fun hiddenStatus(id: String, position: Any, done: Boolean) = JSONObject().put("id", id).put("title", "Хаос-бокс")
        .put("color", JSONObject.NULL).put("position", position).put("revision", 1).put("isDone", if (done) 1 else 0)
    private fun reportWithHiddenStatuses(unit: String): JSONObject = sprintReportFixture(unit).apply {
        val ordinary = getJSONArray("statuses").getJSONObject(0)
        put("statuses", JSONArray((0 until 30).map { index -> JSONObject(ordinary.toString())
            .put("id", if (index == 0) "open" else "status-$index").put("position", index) })
            .put(hiddenStatus("chaos-open:project", -2, false)).put(hiddenStatus("chaos-done:project", -1, true)))
        for (point in SprintReportProtocol.rows(getJSONObject("flow").getJSONArray("series"))) {
            point.getJSONObject("statuses").put("chaos-open:project", sprintMetric(2, 6)).put("chaos-done:project", sprintMetric(1, 3))
            point.getJSONObject("wipStatuses").put("chaos-open:project", sprintMetric(2, 6))
        }
    }
    private fun invalidReport(action: () -> Unit) {
        val failure = runCatching(action).exceptionOrNull()
        assertTrue("Expected a protocol validation failure, got $failure", failure is IllegalArgumentException)
        assertEquals("SPRINT_REPORT_INVALID", failure?.message)
    }
    @Test fun thirtyBoardStatusesAndTwoScopedInboxStatusesParseOnlineAndOfflineForEveryUnit() {
        for (unit in SprintReportProtocol.units) {
            val online = report(reportWithHiddenStatuses(unit), unit)
            for (parsed in listOf(online, SprintReportProtocol.offline(online))) {
                val statuses = SprintReportProtocol.rows(parsed.getJSONArray("statuses"))
                assertEquals(32, statuses.size)
                assertEquals(-2, statuses.first { it.getString("id") == "chaos-open:project" }.getInt("position"))
                assertEquals(-1, statuses.first { it.getString("id") == "chaos-done:project" }.getInt("position"))
                assertTrue(statuses.first { it.getString("id") == "chaos-done:project" }.getBoolean("isDone"))
                assertEquals(unit, parsed.getJSONObject("flow").getString("unit"))
                for (point in SprintReportProtocol.rows(parsed.getJSONObject("flow").getJSONArray("series"))) {
                    assertEquals(2, point.getJSONObject("statuses").getJSONObject("chaos-open:project").getInt("tasks"))
                    assertEquals(3, point.getJSONObject("statuses").getJSONObject("chaos-done:project").getInt("value"))
                    assertEquals(6, point.getJSONObject("wipStatuses").getJSONObject("chaos-open:project").getInt("value"))
                }
            }
            assertTrue(online.has("token")); assertFalse(SprintReportProtocol.offline(online).has("token"))
        }
    }
    @Test fun hiddenStatusesNeverAllowOtherNamespacesOrCrossProjectReferences() {
        for (identifier in listOf("chaos-open:other", "chaos-done:other", "chaos-open:", "chaos-other:project",
            "other:project", "chaos-open:project:extra", "chaos-open:project\n", "x".repeat(201))) {
            invalidReport { report(sprintReportFixture().apply { getJSONArray("statuses").getJSONObject(0).put("id", identifier) }) }
            for (key in listOf("statuses", "wipStatuses")) invalidReport {
                report(sprintReportFixture().apply { getJSONObject("flow").getJSONArray("series").getJSONObject(0)
                    .put(key, JSONObject().put(identifier, sprintMetric())) })
            }
        }
    }
    @Test fun statusTypesPositionsDuplicatesAndCountsStayBounded() {
        for (position in listOf<Any>(-1, Int.MAX_VALUE.toLong() + 1, 0.5, "0", false)) invalidReport {
            report(sprintReportFixture().apply { getJSONArray("statuses").getJSONObject(0).put("position", position) })
        }
        for (position in listOf<Any>(0, -3, -2.0, "-2", false, JSONObject.NULL)) invalidReport {
            report(sprintReportFixture().apply { getJSONArray("statuses").put(hiddenStatus("chaos-open:project", position, false)) })
        }
        invalidReport { report(sprintReportFixture().apply { getJSONArray("statuses").put(hiddenStatus("chaos-done:project", -2, true)) }) }
        invalidReport { report(sprintReportFixture().apply {
            val statuses = getJSONArray("statuses"); statuses.put(JSONObject(statuses.getJSONObject(0).toString()))
        }) }
        invalidReport { report(sprintReportFixture().apply {
            val hidden = hiddenStatus("chaos-open:project", -2, false)
            getJSONArray("statuses").put(hidden).put(JSONObject(hidden.toString()))
        }) }
        invalidReport { report(reportWithHiddenStatuses("points").apply {
            val ordinary = SprintReportProtocol.rows(getJSONArray("statuses")).take(30)
            put("statuses", JSONArray(ordinary).put(JSONObject(ordinary.first().toString()).put("id", "status-30").put("position", 30)))
        }) }
        invalidReport { report(reportWithHiddenStatuses("points").apply {
            getJSONArray("statuses").put(JSONObject(getJSONArray("statuses").getJSONObject(0).toString()).put("id", "status-30").put("position", 30))
        }) }
    }
    @Test fun hiddenStatusCompatibilityDoesNotBroadenProjectSprintOrTaskIds() {
        val hidden = "chaos-open:project"
        assertFalse(PlanningLifecycle.id(hidden))
        invalidReport {
            val raw = sprintReportFixture().put("projectId", hidden).apply { getJSONObject("sprint").put("projectId", hidden) }
            SprintReportProtocol.snapshot(hidden, "sprint", "points", raw)
        }
        invalidReport {
            val raw = sprintReportFixture().apply { getJSONObject("sprint").put("id", hidden) }
            SprintReportProtocol.snapshot("project", hidden, "points", raw)
        }
        for (key in listOf("id", "projectId")) invalidReport {
            val raw = page(0, 1, 1).apply { getJSONArray("items").getJSONObject(0).put(key, hidden) }
            SprintReportProtocol.sources(report(), SprintReportProtocol.query("tasks", "plan"), raw)
        }
    }
    @Test fun zeroNullAndIndependentUnitsKeepTheirMeanings() {
        val raw = sprintReportFixture("hours")
        raw.getJSONObject("flow").getJSONObject("summary").put("delivered", sprintMetric(1, 0))
        raw.getJSONObject("flow").getJSONObject("summary").put("remaining", sprintMetric().put("tasks", JSONObject.NULL).put("value", JSONObject.NULL).put("unknownTasks", 2))
        val result = report(raw, "hours")
        assertEquals("hours", result.getJSONObject("flow").getString("unit"))
        assertEquals(0.0, result.getJSONObject("flow").getJSONObject("summary").getJSONObject("delivered").getDouble("value"), 0.0)
        assertTrue(result.getJSONObject("flow").getJSONObject("summary").getJSONObject("remaining").isNull("value"))
        assertEquals(-2.0, result.getJSONObject("flow").getJSONObject("summary").getDouble("estimateDelta"), 0.0)
    }
    @Test fun projectionDropsPrivateFieldsAndOfflineHasNoTokenOrSourceIdentities() {
        val fresh = report(); assertEquals("PRIVATE_REPORT_TOKEN", fresh.getString("token"))
        assertFalse(fresh.getJSONObject("sprint").has("privateMember"))
        val offline = SprintReportProtocol.offline(fresh)
        assertTrue(offline.getBoolean("offlineCache")); assertFalse(offline.has("token")); assertFalse(offline.toString().contains("PRIVATE_"))
        assertEquals("march", offline.getJSONObject("launch").getJSONObject("calendarContext").getString("gregorianYearStart"))
        assertEquals("sacred", offline.getJSONObject("launch").getString("calendarMode"))
    }
    @Test fun wrongScopeUnitMalformedNumbersAndReversedHistoryAreRejected() {
        rejected { report(sprintReportFixture().put("projectId", "other")) }
        rejected { report(sprintReportFixture("hours")) }
        rejected { report(sprintReportFixture().apply { getJSONObject("sprint").put("id", "other") }) }
        rejected { report(sprintReportFixture().apply { getJSONObject("flow").getJSONObject("summary").getJSONObject("plan").put("tasks", "10") }) }
        rejected { report(sprintReportFixture().apply { getJSONObject("flow").getJSONArray("series").getJSONObject(1).put("at", "2026-10-18T00:00:00Z") }) }
        rejected { SprintReportProtocol.metric(sprintMetric().put("value", -1)) }
        assertEquals(0, SprintReportProtocol.instant("2026-10-19 00:00:00").nano)
    }
    @Test fun partialHistoryAndEmptyPhpMapsNeverInventObservedZeroes() {
        val raw = sprintReportFixture()
        val point = raw.getJSONObject("flow").getJSONArray("series").getJSONObject(1)
        point.put("coverage", "partial").put("unknownTasks", 2).put("connectPrevious", false).put("historyGap", true)
            .put("statuses", JSONArray()).put("wipStatuses", JSONArray())
        val clean = report(raw).getJSONObject("flow").getJSONArray("series").getJSONObject(1)
        assertFalse(clean.getBoolean("connectPrevious")); assertTrue(clean.getBoolean("historyGap")); assertEquals(0, clean.getJSONObject("statuses").length())
        assertTrue(SprintReportProtocol.emptyMetric(false).isNull("value")); assertEquals(0, SprintReportProtocol.emptyMetric(true).getInt("value"))
        rejected { report(raw.apply { point.put("statuses", JSONArray().put(0)) }) }
    }
    @Test fun notStartedAndMissingEvidenceStayUnavailable() {
        val raw = sprintReportFixture().put("flow", JSONObject().put("available", false).put("unit", "points").put("reason", "start-observation-missing"))
        raw.getJSONObject("sprint").put("state", "planning")
        val flow = report(raw).getJSONObject("flow")
        assertFalse(flow.getBoolean("available")); assertTrue(flow.isNull("summary")); assertEquals(0, flow.getJSONArray("series").length())
    }
    @Test fun all131SourcesAppendExactlyAndKeepCurrentProjectAndArchiveFlag() {
        val query = SprintReportProtocol.query("tasks", "plan")
        val first = SprintReportProtocol.sources(report(), query, page(0, 100))
        val complete = SprintReportProtocol.sources(report(), query, page(100, 131), first)
        assertEquals(131, complete.getJSONArray("items").length()); assertTrue(complete.isNull("nextCursor"))
        assertEquals("current-project", complete.getJSONArray("items").getJSONObject(130).getString("projectId"))
        assertTrue(complete.getJSONArray("items").getJSONObject(130).getBoolean("archived"))
    }
    @Test fun repeatedPagesWrongSelectionChangedDateAndPrematureEndAreRejected() {
        val query = SprintReportProtocol.query("tasks", "plan"); val first = SprintReportProtocol.sources(report(), query, page(0, 100))
        rejected { SprintReportProtocol.sources(report(), query, page(0, 31), first) }
        rejected { SprintReportProtocol.sources(report(), SprintReportProtocol.query("tasks", "remaining"), page(100, 131), first) }
        rejected { SprintReportProtocol.sources(report(), query, page(100, 131).put("asOf", "2026-10-20T09:00:00Z"), first) }
        rejected { SprintReportProtocol.sources(report(), query, page(0, 100).put("nextCursor", JSONObject.NULL)) }
        rejected { SprintReportProtocol.sources(SprintReportProtocol.offline(report()), query, page(0, 100)) }
    }
    @Test fun oneEventMayHaveDifferentScopeAndEstimateChangesWithoutLosingEither() {
        val items = JSONArray(listOf("removed", "estimate").map { kind -> JSONObject().put("sourceId", "one-event").put("kind", kind).put("task", task(1)) })
        val page = JSONObject().put("items", items).put("total", 2).put("unavailable", 0).put("asOf", "2026-10-20T08:00:00Z").put("nextCursor", JSONObject.NULL)
        val rows = SprintReportProtocol.sources(report(), SprintReportProtocol.query("changes"), page).getJSONArray("items")
        assertEquals(2, rows.length()); assertNotEquals(rows.getJSONObject(0).getString("id"), rows.getJSONObject(1).getString("id"))
    }
    @Test fun unavailableSourcesCannotCarryPrivateTaskNames() {
        val item = JSONObject().put("id", "event").put("sequence", 1).put("at", "2026-10-19T06:00:00Z").put("action", "task.updated")
            .put("unavailable", true).put("task", task(1).put("title", "PRIVATE_TITLE"))
        val page = JSONObject().put("items", JSONArray().put(item)).put("total", 1).put("unavailable", 1).put("asOf", "2026-10-20T08:00:00Z").put("nextCursor", JSONObject.NULL)
        val clean = SprintReportProtocol.sources(report(), SprintReportProtocol.query("events"), page)
        assertFalse(clean.toString().contains("PRIVATE_TITLE")); assertFalse(clean.getJSONArray("items").getJSONObject(0).has("task"))
    }
    @Test fun sourceSelectionsUseOnlySupportedMetricsAndCivilDates() {
        rejected { SprintReportProtocol.query("tasks", "plan", "2026-10-19") }
        rejected { SprintReportProtocol.query("tasks", "arbitrary") }
        rejected { SprintReportProtocol.query("events", date = "2026-02-30") }
        assertEquals("2026-10-19", SprintReportProtocol.query("events", date = "2026-10-19").getString("date"))
    }
    @Test fun nativeRoutesAllowOnlyTheExactReadOperationsAndArchivedSourceFlag() {
        val project = "11111111-1111-4111-8111-111111111111"; val sprint = "22222222-2222-4222-8222-222222222222"
        val root = "/shared/projects/$project/planning/sprints/$sprint/report"
        for (suffix in listOf("", "/check", "/sources")) {
            assertTrue(allowedSharedRoute("POST", root + suffix))
            for (method in listOf("GET", "PUT", "PATCH", "DELETE")) assertFalse(allowedSharedRoute(method, root + suffix))
        }
        val task = "/shared/projects/$project/tasks/$sprint?archived=true"
        assertTrue(allowedSharedRoute("GET", task)); assertFalse(allowedSharedRoute("POST", task))
        assertFalse(allowedSharedRoute("GET", task + "&token=opaque")); assertFalse(allowedSharedRoute("POST", root + "/other"))
    }
}
