package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File

/** Synthetic gateway evidence; this does not exercise Google login or native HTTP. */
internal class ReportUiFixture : SharedWorkspaceGateway {
    var denied = false; var offline = false; var changed = false; var partial = false; var missing = false; var planned = false
    var reports = 0; var pages = 0; var tasks = 0; var unit = "points"
    var reportTitle = "Осенний план команды"; var gate: CompletableDeferred<Unit>? = null
    var terminalMissing = false; var stress = false
    private fun check() { if (denied) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED); if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK); if (changed) throw AuthApiError("REPORT_CHANGED") }
    fun metric(tasks: Int = 8, value: Any = 26) = JSONObject().put("tasks", tasks).put("value", value).put("knownValue", value).put("unestimated", 0)
    fun record(index: Int) = JSONObject().put("id", "task-$index").put("projectId", "moved-project").put("title", "Подготовить материалы для команды · $index").put("archived", true).put("revision", 3)
    override suspend fun sharedSprintReport(projectId: String, sprintId: String, unit: String): JSONObject {
        reports++; this.unit = unit; check()
        val title = reportTitle; val waiting = gate; gate = null
        waiting?.let { withContext(NonCancellable) { it.await() } }
        val context = JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march")
        fun period() = JSONObject().put("startDate", "2026-10-19").put("endDate", "2026-10-25").put("calendarMode", "profane").put("calendarContext", JSONObject(context.toString()))
        val summary = JSONObject()
        for (key in listOf("plan", "alreadyDone", "committed", "scope", "remaining", "done", "delivered", "carried")) summary.put(key, metric(value = if (unit == "tasks") 8 else 26))
        summary.put("alreadyDone", metric(0, 0)).put("carried", metric(0, 0))
        for (key in listOf("added", "removed")) summary.put(key, metric(0, 0).apply { remove("value") })
        summary.put("scopeChangeCoverage", if (partial) "partial" else "observed").put("estimateDelta", -2).put("unestimatedDelta", -1)
            .put("completionTransitions", 3).put("completedTasksCount", 3).put("reopenedTasksCount", 0)
        val series = JSONArray((19..25).map { day ->
            val gap = partial && day == 21
            JSONObject().put("at", "2026-10-${day}T09:00:00Z").put("date", "2026-10-$day").put("sequence", day - 18).put("firstSequence", day - 18)
                .put("sourceCount", 1).put("sourceKind", "event").put("connectPrevious", day != 19 && day !in listOf(21, 22)).put("coverage", if (gap) "partial" else "observed")
                .put("unknownTasks", if (gap) 1 else 0).put("gapWithinBucket", gap)
                .put("scope", metric(value = if (gap) JSONObject.NULL else 26)).put("remaining", metric(value = if (gap) JSONObject.NULL else 26 - (day - 19) * 3))
                .put("done", metric(value = (day - 19) * 3)).put("wip", metric(value = if (gap) JSONObject.NULL else 18 - (day - 19) * 2))
                .put("statuses", JSONObject().put("open", metric(value = 18 - (day - 19) * 2)).put("review", metric(value = 8 + (day - 19) * 2)))
                .put("wipStatuses", JSONObject().put("open", metric(value = 18 - (day - 19) * 2)))
        })
        val flow = if (missing || planned || terminalMissing) JSONObject().put("available", false).put("unit", unit).put("reason", if (terminalMissing) "terminal-observation-missing" else "start-observation-missing") else
            JSONObject().put("available", true).put("unit", unit).put("resolution", "day").put("timeZone", "Europe/Moscow").put("from", "2026-10-19T09:00:00Z")
                .put("to", "2026-10-25T09:00:00Z").put("terminal", false).put("historyComplete", !partial).put("scopeChangeCount", 2).put("summary", summary)
                .put("series", series).put("gaps", JSONArray())
        return JSONObject().put("projectId", projectId).put("asOf", "2026-10-25T09:00:00Z").put("token", "QA_ONLY_NEVER_PERSIST")
            .put("sprint", period().put("id", sprintId).put("projectId", projectId).put("title", title).put("state", if (planned) "planning" else if (terminalMissing) "completed" else "active"))
            .put("launch", period().put("estimateUnit", "points"))
            .put("statuses", JSONArray(listOf("open" to "В работе", "review" to "Проверка результата").mapIndexed { index, (id, title) ->
                JSONObject().put("id", id).put("title", title).put("color", JSONObject.NULL).put("position", index).put("revision", 1).put("isDone", false)
            })).put("flow", flow).apply {
                if (stress) {
                    put("statuses", JSONArray((0 until 30).map { index -> JSONObject().put("id", "stage-$index").put("title", "Этап проверки результата · $index")
                        .put("color", JSONObject.NULL).put("position", index).put("revision", 1).put("isDone", false) }))
                    for (row in SprintReportProtocol.rows(series)) {
                        val values = JSONObject().apply { repeat(30) { put("stage-$it", metric(1, 1000000)) } }
                        row.put("statuses", values).put("wipStatuses", JSONObject(values.toString())).put("scope", metric(30, 30000000))
                            .put("remaining", metric(30, 30000000)).put("wip", metric(30, 30000000))
                    }
                    for (key in listOf("plan", "committed", "scope", "remaining")) summary.put(key, metric(30, 30000000))
                }
            }
    }
    override suspend fun checkSharedSprintReport(projectId: String, sprintId: String, token: String): JSONObject { check(); return JSONObject().put("unchanged", true) }
    override suspend fun sharedSprintReportSources(projectId: String, sprintId: String, token: String, query: JSONObject, cursor: String?): JSONObject {
        check(); pages++; val from = if (cursor == null) 0 else 100; val to = if (cursor == null) 100 else 131
        return JSONObject().put("asOf", "2026-10-25T09:00:00Z").put("items", JSONArray((from until to).map { index ->
            val observation = JSONObject().put("taskId", "task-$index").put("revision", 1).put("statusId", "open").put("sprintId", sprintId)
                .put("done", false).put("active", true).put("storyPoints", 0).put("estimateHours", 2.5)
            if (query.getString("kind") == "tasks") record(index).put("observed", observation) else
                JSONObject().put("id", "event-$index").put("sourceId", "event-$index").put("kind", "estimate").put("task", record(index))
                    .put("at", "2026-10-20T09:00:00Z").put("before", observation).put("after", JSONObject(observation.toString()).put("storyPoints", 5))
        })).put("total", 131).put("unavailable", 0).put("nextCursor", if (to < 131) "next" else JSONObject.NULL)
    }
    override suspend fun sharedSprintSourceTask(projectId: String, taskId: String, archived: Boolean): JSONObject {
        check(); tasks++; assertEquals("moved-project", projectId); assertTrue(archived)
        return JSONObject().put("task", record(taskId.removePrefix("task-").toInt()).put("title", "Актуальная задача из архива")
            .put("description", "Текущее содержание задачи отличается от исторической оценки.").put("archivedAt", "2026-10-21T09:00:00Z").put("storyPoints", 5).put("estimateHours", 4))
    }
}

class SharedSprintReportUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var fixture by mutableStateOf<ReportUiFixture?>(null); private var epoch by mutableIntStateOf(0)
    private var language by mutableStateOf("ru"); private var dark by mutableStateOf(false); private var installed = false
    private var account by mutableStateOf("account-a")
    private var closed = false; private var lost = false
    private fun show(value: ReportUiFixture) {
        if (!installed) {
            compose.setContent {
                fixture?.let { current -> key(epoch) { CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark, LocalGenesisUserId provides account) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                        SharedSprintReportScreen(current, "project", "sprint", "points", { closed = true }, { lost = true })
                    } }
                } } }
            }; installed = true
        }
        compose.runOnIdle { fixture = value; epoch++; closed = false; lost = false }
        compose.waitUntil(10000) { value.reports > 0 && compose.onAllNodesWithTag("report-loading").fetchSemanticsNodes().isEmpty() }; compose.waitForIdle()
    }
    private fun click(tag: String) {
        if (compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
            compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag(tag))
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.performClick(); compose.waitForIdle()
    }
    @Test fun overviewPreservesZeroAndUnitCanChangeWithoutEditingAnything() {
        val f = ReportUiFixture(); show(f)
        compose.onNodeWithTag("report-overview").assertExists(); compose.onNodeWithTag("report-open-alreadyDone").assertTextContains("0")
        click("report-unit"); click("report-unit-hours"); assertEquals("hours", f.unit); assertEquals(2, f.reports)
    }
    @Test fun partialHistoryHasChartsStatusChoiceAndAccessibleDailyData() {
        show(ReportUiFixture().apply { partial = true }); compose.onNodeWithTag("report-partial").assertExists()
        click("report-pane-charts"); click("report-wip"); click("report-wip-open")
        compose.onNodeWithText("В работе").assertExists(); click("report-pane-data"); click("report-day-sources-0")
        compose.onNodeWithTag("report-source-count").assertTextContains("100 / 131")
    }
    @Test fun all131SourcesLoadAndHistoricalEstimateDoesNotBecomeTheActualEstimate() {
        val f = ReportUiFixture(); show(f); click("report-open-plan")
        compose.onAllNodesWithTag("shared-estimate-points-value").onFirst().assertTextContains("0")
        click("report-more-sources"); compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-source-count"))
        compose.onNodeWithTag("report-source-count").assertTextContains("131 / 131")
        click("report-source-open-task-130"); compose.onNodeWithTag("report-actual-task").assertExists()
        compose.onNodeWithText("Актуальная задача из архива").assertExists(); compose.onNodeWithTag("shared-estimate-points-value").assertTextContains("5")
        assertEquals(2, f.pages); assertEquals(1, f.tasks)
    }
    @Test fun revokedAccessHidesSprintSourcesAndNotifiesParent() {
        val f = ReportUiFixture(); show(f); f.denied = true; click("report-refresh")
        compose.onNodeWithText("Осенний план команды").assertDoesNotExist(); compose.onNodeWithTag("report-overview").assertDoesNotExist(); assertTrue(lost)
    }
    @Test fun disconnectionLeavesOnlyAnExplicitlyStaleAggregateUntilRefresh() {
        val f = ReportUiFixture(); show(f); f.offline = true; click("report-refresh")
        compose.onNodeWithTag("report-offline").assertExists()
        compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-open-plan"))
        compose.onNodeWithTag("report-open-plan").assertIsNotEnabled()
        f.offline = false; click("report-refresh"); compose.onNodeWithTag("report-offline").assertDoesNotExist()
        compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-open-plan"))
        compose.onNodeWithTag("report-open-plan").assertIsEnabled()
    }
    @Test fun changedReportCannotOpenAnOldSource() {
        val f = ReportUiFixture(); show(f); f.changed = true; click("report-open-plan")
        compose.onNodeWithTag("report-overview").assertDoesNotExist(); compose.onNodeWithTag("report-source-count").assertDoesNotExist(); assertEquals(0, f.tasks)
    }
    @Test fun accountSwitchDisposesThePreviousReportBeforeALateReply() {
        val f = ReportUiFixture(); show(f); val waiting = CompletableDeferred<Unit>(); f.gate = waiting
        click("report-refresh"); compose.waitUntil(10000) { f.reports == 2 }
        compose.runOnIdle { f.reportTitle = "План другого аккаунта"; account = "account-b" }
        compose.waitUntil(10000) { f.reports == 3 && compose.onAllNodesWithText("План другого аккаунта").fetchSemanticsNodes().isNotEmpty() }
        waiting.complete(Unit); compose.waitForIdle()
        compose.onNodeWithText("Осенний план команды").assertDoesNotExist(); compose.onNodeWithText("План другого аккаунта").assertExists()
    }
    @Test fun languageSwitchRetainsUnitAndSelectionAndUserNames() {
        val f = ReportUiFixture(); show(f); click("report-unit"); click("report-unit-hours"); click("report-open-plan")
        compose.runOnIdle { language = "de" }; compose.waitForIdle()
        compose.onNodeWithTag("report-source-count").assertTextContains("100 / 131"); compose.onNodeWithTag("report-source-open-task-0").assertTextContains("Подготовить материалы для команды · 0")
        assertEquals("hours", f.unit); assertEquals(2, f.reports); assertEquals(1, f.pages)
    }
    @Test fun notStartedAndMissingHistoryHaveDifferentRecoveryMessages() {
        show(ReportUiFixture().apply { planned = true }); compose.onNodeWithTag("report-unavailable").assertTextContains("Отчёт появится после запуска спринта.")
        show(ReportUiFixture().apply { missing = true }); compose.onNodeWithTag("report-unavailable").assertTextContains("Достоверный снимок запуска недоступен. Исторический план неизвестен.")
        show(ReportUiFixture().apply { terminalMissing = true }); compose.onNodeWithTag("report-unavailable").assertTextContains("Достоверный снимок закрытия недоступен. Итоговый остаток неизвестен.")
    }
    @Test fun allThirtyStatusesAndLargeValuesRemainSelectableAndReadable() {
        show(ReportUiFixture().apply { stress = true }); compose.onNodeWithTag("report-open-plan").assertTextContains("30 000 000")
        click("report-pane-charts"); click("report-wip"); compose.onNodeWithTag("report-wip-stage-29").performScrollTo().performClick()
        compose.onNodeWithTag("report-wip").assertTextContains("Этап проверки результата · 29")
        compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-chart-flow")); compose.onNodeWithTag("report-chart-flow").assertExists()
    }
    @Test fun systemBackReturnsTaskThenSourcesThenPlanning() {
        show(ReportUiFixture()); click("report-open-plan"); click("report-source-open-task-0")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()); device.pressBack(); compose.waitForIdle()
        compose.onNodeWithTag("report-source-count").assertExists(); device.pressBack(); compose.waitForIdle()
        compose.onNodeWithTag("report-overview").assertExists(); device.pressBack(); compose.waitForIdle(); assertTrue(closed)
    }
    @Test fun captureReports() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisReportCapture") == "true")
        val all = args.getString("genesisReportLanguages") == "true"; val width = args.getString("genesisReportWidth")!!
        val langs = if (all) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun capture(state: String) {
            compose.waitForIdle()
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText("Осенний план команды", useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
            val actualDensity = layouts.single().layoutInput.density
            // The tag is inside the screen's 16dp horizontal gutters.
            val actual = compose.onNodeWithTag("shared-sprint-report").fetchSemanticsNode().boundsInRoot.width / actualDensity.density + 32f
            val expectedFont = args.getString("genesisReportFontScale")!!.toFloat()
            assertTrue("Report viewport $actual does not match $width", actual in (width.toFloat() - 1)..(width.toFloat() + 1))
            assertEquals("Dialog font scale", expectedFont, actualDensity.fontScale, .01f)
            println("QA report viewport=$actual density=${actualDensity.density} fontScale=${actualDensity.fontScale} language=$language state=$state")
            val target = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "report-${if (all) "font130-" else ""}${if (dark) "dark" else "light"}-$width-$language-$state.png")
            assertTrue(device.takeScreenshot(target))
        }
        for (lang in langs) for (theme in listOf(false, true)) {
            compose.runOnIdle { language = lang; dark = theme }; show(ReportUiFixture().apply { partial = true })
            capture("overview"); click("report-pane-charts"); compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-chart-burndown")); capture("charts")
            if (!all) {
                compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-chart-flow")); capture("flow")
                click("report-pane-data"); capture("data"); click("report-day-sources-0"); capture("sources")
                click("report-source-open-task-0"); capture("task")
                show(ReportUiFixture().apply { stress = true }); capture("stress-overview")
                click("report-pane-charts"); compose.onNodeWithTag("report-content").performScrollToNode(hasTestTag("report-chart-flow")); capture("stress-flow")
            }
        }
    }
}
