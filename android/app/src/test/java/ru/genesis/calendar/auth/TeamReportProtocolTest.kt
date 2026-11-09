package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Captured from the isolated PHP contract fixture; no real account data or live tokens. */
internal fun teamReportFixture(name: String) = JSONObject(requireNotNull(TeamReportProtocolTest::class.java.getResourceAsStream("/team-report/$name.json")).bufferedReader().use { it.readText() })
internal fun teamReportSnapshot() = TeamReportProtocol.snapshot(teamReportFixture("options"), teamReportFixture("report"))

class TeamReportProtocolTest {
    private fun rejects(change: (JSONObject) -> Unit) {
        val report = teamReportFixture("report"); change(report)
        assertEquals("REPORT_INVALID", assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.snapshot(teamReportFixture("options"), report) }.message)
    }
    @Test fun realPhpSnapshotKeepsZeroEstimatesUnknownHistoryAndIndependentCalendarContext() {
        val raw = teamReportFixture("report"); val report = TeamReportProtocol.snapshot(teamReportFixture("options"), raw)
        assertFalse(raw.has("nativeMetrics")); assertEquals(121, report.getJSONObject("nativeMetrics").getInt("all"))
        val context = report.getJSONObject("period").getJSONObject("calendarContext")
        assertEquals("sacred", report.getJSONObject("period").getString("calendarMode")); assertEquals("America/New_York", context.getString("timeZone"))
        assertEquals("march", context.getString("gregorianYearStart")); assertTrue(report.getJSONObject("cycle").isNull("meanSeconds"))
        val estimates = report.getJSONObject("estimates"); assertTrue(estimates.isNull("points")); assertTrue(estimates.isNull("hours"))
        val project = estimates.getJSONArray("projects").getJSONObject(0)
        assertEquals(120.0, project.getJSONObject("points").getDouble("value"), 0.0)
        assertEquals(121, project.getJSONObject("points").getJSONObject("estimated").getInt("count"))
        assertEquals(61, project.getJSONObject("hours").getJSONObject("unestimated").getInt("count"))
    }
    @Test fun allOneHundredTwentyOneSourcesRequireTwoPagesWithNoOverlaps() {
        val report = teamReportSnapshot(); val first = TeamReportProtocol.sources(report, "all", teamReportFixture("first"))
        assertEquals(100, first.getJSONArray("tasks").length()); assertEquals(121, first.getInt("total"))
        assertEquals("synthetic-page-2", TeamReportProtocol.taskQuery(report, "all", first.getString("nextCursor")).getString("cursor"))
        val last = TeamReportProtocol.sources(report, "all", teamReportFixture("last"), first)
        assertEquals(121, last.getJSONArray("tasks").length()); assertTrue(last.isNull("nextCursor"))
        val duplicate = teamReportFixture("last"); duplicate.getJSONArray("tasks").put(0, first.getJSONArray("tasks").getJSONObject(0))
        assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.sources(report, "all", duplicate, first) }
        assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.taskQuery(report, "hidden-project:all", null) }
    }
    @Test fun aMeasuredZeroSecondCycleIsDistinctFromMissingHistoryAndHasAnExactSource() {
        val raw = teamReportFixture("report")
        raw.getJSONObject("summary").getJSONObject("open").put("count", 120)
        raw.getJSONObject("summary").getJSONObject("completed").put("count", 1)
        raw.getJSONArray("members").getJSONObject(0).getJSONObject("open").put("count", 120)
        raw.getJSONArray("members").getJSONObject(0).getJSONObject("completed").put("count", 1)
        raw.getJSONArray("ages").getJSONObject(0).getJSONObject("tasks").put("count", 120)
        raw.getJSONObject("cycle").put("eligible", 1).put("meanSeconds", 0).put("medianSeconds", 0).getJSONObject("known").put("count", 1)
        val report = TeamReportProtocol.snapshot(teamReportFixture("options"), raw)
        assertEquals(0.0, report.getJSONObject("cycle").getDouble("meanSeconds"), 0.0)
        val page = teamReportFixture("first").put("total", 1).put("nextCursor", JSONObject.NULL)
        page.put("tasks", JSONArray().put(page.getJSONArray("tasks").getJSONObject(0)))
        assertEquals(1, TeamReportProtocol.sources(report, "cycle:known", page).getJSONArray("tasks").length())
    }
    @Test fun independentProjectScalesRemainSeparateAndNeverBecomeAGlobalPointsTotal() {
        val raw = teamReportFixture("report"); val original = raw.getJSONObject("catalog").getJSONArray("projects").getJSONObject(0)
        val secondId = "22222222-2222-4222-8222-222222222222"
        raw.getJSONObject("catalog").getJSONArray("projects").put(JSONObject(original.toString()).put("id", secondId).put("title", "Independent scale"))
        fun metric(key: String, count: Int) = JSONObject().put("key", key).put("count", count)
        fun group(prefix: String) = JSONObject().put("all", metric("$prefix:all", 1))
            .put("points", JSONObject().put("value", 7).put("estimated", metric("$prefix:points:known", 1)).put("unestimated", metric("$prefix:points:missing", 0)))
            .put("hours", JSONObject().put("value", 0).put("estimated", metric("$prefix:hours:known", 0)).put("unestimated", metric("$prefix:hours:missing", 1)))
        raw.getJSONObject("estimates").getJSONArray("projects").put(group("estimate:$secondId").put("projectId", secondId)
            .put("members", JSONArray().put(group("estimate:$secondId:member:unassigned").put("id", "unassigned"))))
        for (key in listOf("all", "open", "unassigned")) raw.getJSONObject("summary").getJSONObject(key).put("count", 122)
        for (key in listOf("all", "open")) raw.getJSONArray("members").getJSONObject(0).getJSONObject(key).put("count", 122)
        raw.getJSONArray("ages").getJSONObject(0).getJSONObject("tasks").put("count", 122)
        val report = TeamReportProtocol.snapshot(teamReportFixture("options"), raw)
        val estimates = report.getJSONObject("estimates"); assertTrue(estimates.isNull("points"))
        assertEquals(120.0, estimates.getJSONArray("projects").getJSONObject(0).getJSONObject("points").getDouble("value"), 0.0)
        assertEquals(7.0, estimates.getJSONArray("projects").getJSONObject(1).getJSONObject("points").getDouble("value"), 0.0)
    }
    @Test fun sourceCountsAsOfProjectAndCursorCannotBeSubstituted() {
        val report = teamReportSnapshot()
        for (change in listOf<(JSONObject) -> Unit>(
            { it.put("total", 100) }, { it.put("asOf", "2026-10-01T00:00:00Z") }, { it.put("nextCursor", JSONObject.NULL) },
            { it.put("nextCursor", "") }, { it.put("offlineCache", true) },
            { it.getJSONArray("tasks").getJSONObject(0).put("projectId", "hidden-project") },
            { it.getJSONArray("tasks").getJSONObject(0).put("revision", 1.5) })) {
            val value = teamReportFixture("first"); change(value)
            assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.sources(report, "all", value) }
        }
    }
    @Test fun optionsPreserveSavedViewsTypedZeroFalseAndDoNotAliasCallerObjects() {
        val options = teamReportFixture("options")
        options.getJSONObject("filter").put("viewDefinition", JSONObject().put("filter", JSONObject().put("customFields", JSONArray()
            .put(JSONObject().put("fieldId", "effort").put("operator", "eq").put("value", 0))
            .put(JSONObject().put("fieldId", "approved").put("operator", "eq").put("value", false)))))
        val validated = TeamReportProtocol.options(options); val original = options.toString()
        validated.getJSONObject("filter").put("q", "New query"); assertEquals(original, options.toString())
        assertTrue(original.contains("\"value\":0")); assertTrue(original.contains("\"value\":false"))
    }
    @Test fun anEmptyPhpFilterMapIsNormalizedWithoutAcceptingPopulatedArrays() {
        val options = teamReportFixture("options").put("filter", JSONObject())
        val raw = teamReportFixture("report").put("filter", JSONArray())
        val normalized = TeamReportProtocol.snapshot(options, raw)
        assertTrue(normalized.get("filter") is JSONObject); assertTrue(raw.get("filter") is JSONArray)
        raw.getJSONArray("filter").put(JSONObject().put("q", "ambiguous"))
        assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.snapshot(options, raw) }
    }
    @Test fun invalidCalendarPeriodsAndMalformedNestedPayloadsAreRejectedBeforeRendering() {
        for (key in listOf("projects", "statuses", "members", "customFieldDefinitions")) rejects { it.getJSONObject("catalog").put(key, JSONObject()) }
        rejects { it.getJSONObject("period").put("from", "2026-02-30") }
        rejects { it.getJSONObject("period").getJSONObject("calendarContext").put("timeZone", "GMT+03:00") }
        rejects { it.getJSONObject("catalog").getJSONArray("statuses").getJSONObject(0).put("isDone", "false") }
        rejects { it.getJSONObject("summary").getJSONObject("all").put("count", 121.0) }
        rejects { it.getJSONObject("summary").getJSONObject("open").put("count", -1) }
        rejects { it.getJSONArray("members").getJSONObject(0).put("title", JSONObject()) }
        rejects { it.getJSONArray("daily").put(1, it.getJSONArray("daily").getJSONObject(0)) }
        rejects { it.getJSONObject("cycle").put("meanSeconds", 0) }
        rejects { it.getJSONObject("estimates").put("points", 120) }
        rejects { it.getJSONObject("estimates").getJSONArray("projects").getJSONObject(0).getJSONObject("hours").put("value", "NaN") }
        rejects { it.getJSONObject("estimates").getJSONArray("projects").getJSONObject(0).getJSONObject("points").getJSONObject("estimated").put("key", "all") }
    }
    @Test fun sourceCountersAndEstimateScalesMustAgreeWithEveryDisplayedGroup() {
        rejects { it.getJSONObject("summary").getJSONObject("completed").put("count", 1) }
        rejects { it.getJSONArray("members").getJSONObject(0).getJSONObject("open").put("count", 120) }
        rejects { it.getJSONArray("ages").getJSONObject(0).getJSONObject("tasks").put("count", 120) }
        rejects { it.getJSONObject("estimates").getJSONArray("projects").getJSONObject(0).getJSONObject("hours").getJSONObject("estimated").put("count", 1) }
        rejects { it.getJSONObject("estimates").getJSONArray("projects").put(it.getJSONObject("estimates").getJSONArray("projects").getJSONObject(0)) }
        val options = teamReportFixture("options").put("from", "2010-01-01")
        assertEquals("REPORT_PERIOD_INVALID", assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.options(options) }.message)
        val invalidZone = teamReportFixture("options"); invalidZone.getJSONObject("calendarContext").put("timeZone", "invalid")
        assertEquals("REPORT_CONTEXT_INVALID", assertThrows(IllegalArgumentException::class.java) { TeamReportProtocol.options(invalidZone) }.message)
    }
}
