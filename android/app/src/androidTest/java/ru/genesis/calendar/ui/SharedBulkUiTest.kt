package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private const val bulkProject = "bulk-project"
private const val bulkOp = "10000000-0000-4000-8000-000000000099"
private class BulkUiFixture : SharedWorkspaceGateway {
    private val gatewayCalls = ConcurrentHashMap<String, AtomicInteger>()
    @Volatile private var lastGatewayCall = "created"
    private fun <T> tracked(name: String, action: () -> T): T {
        gatewayCalls.getOrPut(name) { AtomicInteger() }.incrementAndGet()
        lastGatewayCall = "$name:start"
        try { return action().also { lastGatewayCall = "$name:returned" } }
        catch (failure: Throwable) { lastGatewayCall = "$name:threw:${failure.javaClass.simpleName}"; throw failure }
    }
    private val storage = object : PlanningJournalStorage {
        val values = mutableMapOf<String, String>()
        override fun <T> locked(block: () -> T): T = synchronized(this, block)
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
    }
    var selected = 0; var taskCount = 12; var previews = 0; var confirms = 0; var taskPages = 0; var queue = false; var lose = false
    var expired = false; var canWrite = true; var redacted = false; var revision = 1; var unavailableDestination = false
    var failure: String? = null; var itemFailure: String? = null; var reportState = "preview"; val sent = mutableListOf<String>()
    var previewAction = JSONObject().put("kind", "priority").put("priority", 0); var mode = "page"
    private val access = object : SharedBulkAccess {
        override fun check() { }
        override fun hasTaskQueue() = queue
        override fun scope(selection: JSONObject): JSONObject {
            gatewayCalls.getOrPut("scope") { AtomicInteger() }.incrementAndGet()
            selected = if (selection.getString("mode") == "all") taskCount else selection.getJSONArray("items").length()
            return JSONObject().put("total", selected).put("hasMore", false).put("nextCursor", JSONObject.NULL).put("projects", JSONArray().put(
                JSONObject().put("id", bulkProject).put("spaceId", "bulk-space").put("title", "План команды").put("taskCount", selected)
                    .put("statuses", JSONArray().put(JSONObject().put("id", "open").put("title", "Открыто").put("isDone", false)))))
        }
        override fun preview(body: JSONObject): JSONObject {
            gatewayCalls.getOrPut("preview") { AtomicInteger() }.incrementAndGet()
            previews++; reportState = "preview"; sent += body.toString(); previewAction = body.getJSONObject("action"); mode = body.getJSONObject("selection").getString("mode")
            failure?.let { throw AuthApiError(it) }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return report()
        }
    }
    private fun service() = SharedBulkDraftService(PlanningJournal(storage, contract = SharedBulkJournalContract), "bulk-ui", access)
    override suspend fun sharedBulkDraft(projectId: String) = tracked("loadDraft") { service().load(projectId) }
    override suspend fun saveSharedBulkDraft(projectId: String, stamp: String?, edit: JSONObject) = tracked("saveDraft") { service().save(projectId, stamp, edit) }
    override suspend fun prepareSharedBulkDraft(projectId: String, stamp: String) = tracked("prepareDraft") { service().prepare(projectId, stamp) }
    override suspend fun sendSharedBulkDraft(projectId: String, stamp: String) = tracked("sendDraft") { service().send(projectId, stamp) }
    override suspend fun removeSharedBulkDraft(projectId: String, stamp: String) = tracked("removeDraft") { service().remove(projectId, stamp) }
    override suspend fun sharedProject(projectId: String) = JSONObject().put("project", JSONObject().put("id", bulkProject).put("spaceId", "bulk-space")
        .put("title", "План команды").put("role", "owner").put("permissions", JSONObject().put("editTasks", canWrite)))
    override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String): JSONObject {
        taskPages++; val offset = cursor?.toInt() ?: 0; val end = minOf(taskCount, offset + 100)
        return JSONObject().put("tasks", JSONArray((offset until end).map { JSONObject().put("id", "bulk-task-$it").put("projectId", bulkProject)
            .put("revision", revision).put("title", if (it == 0) "Согласовать план команды на следующую неделю" else "Задача команды ${it + 1}")
            .put("dueDate", "2026-10-20").put("completedAt", JSONObject.NULL) }))
            .put("total", taskCount).put("queryVersion", "bulk-fixture-$revision").put("hasMore", end < taskCount).put("nextCursor", if (end < taskCount) end.toString() else JSONObject.NULL)
    }
    fun report(after: Long = 0): JSONObject {
        val counts = JSONObject().put("selected", selected).put("affected", selected).put("pending", if (reportState in setOf("preview", "running")) selected else 0)
            .put("succeeded", if (reportState == "done" && itemFailure == null) selected else 0).put("skipped", if (reportState == "done" && itemFailure != null) selected else 0)
            .put("failed", 0).put("cancelled", if (reportState == "cancelled") selected else 0)
        val end = minOf(selected.toLong(), after + 100)
        val info = JSONObject().put("unavailable", unavailableDestination)
        when (previewAction.getString("kind")) {
            "move" -> if (!unavailableDestination) info.put("projectTitle", "Другой проект").put("statusTitle", "Открыто")
            "assignee" -> if (!previewAction.isNull("assigneeId")) info.put("assigneeName", "Участник команды")
            "labels" -> info.put("labels", JSONArray().put(JSONObject().put("id", "label").put("title", "Метка команды").put("spaceTitle", "Команда")))
            "status" -> info.put("statuses", JSONArray().put(JSONObject().put("id", "done").put("projectId", bulkProject).put("projectTitle", "План команды").put("statusTitle", "Готово")))
        }
        return JSONObject().put("id", bulkOp).put("state", reportState).put("mode", mode).put("action", previewAction)
            .put("expiresAt", (if (expired) Instant.parse("2000-01-01T00:00:00Z") else Instant.now().plusSeconds(600)).toString())
            .put("errorCode", JSONObject.NULL).put("retryAt", JSONObject.NULL).put("actionInfo", info).put("counts", counts)
            .put("items", JSONArray((after until end).map { index -> JSONObject().put("cursor", index + 1).put("selected", true)
                .put("state", if (reportState == "done") if (itemFailure == null) "succeeded" else "skipped" else if (reportState == "cancelled") "cancelled" else "pending")
                .put("code", itemFailure ?: JSONObject.NULL).apply { if (!redacted) put("id", "bulk-task-$index").put("projectId", bulkProject).put("projectTitle", "План команды")
                    .put("title", "Результат задачи ${index + 1}").put("available", true) } }))
            .put("hasMore", end < selected).put("nextCursor", if (end < selected) end else JSONObject.NULL)
    }
    override suspend fun sharedBulkReport(id: String, after: Long) = tracked("readReport") { report(after) }
    override suspend fun sharedBulkCommand(id: String, command: String, after: Long): JSONObject {
        gatewayCalls.getOrPut("command:$command") { AtomicInteger() }.incrementAndGet()
        if (command == "confirm") { if (queue) error("BULK_LOCAL_QUEUE"); confirms++; reportState = "running" }
        if (command == "cancel") reportState = "cancelled"
        if (command in setOf("advance", "resume")) reportState = "done"
        return report(after)
    }
    fun diagnostic(): JSONObject = JSONObject().put("ownedProjectId", bulkProject).put("ownedOperationId", bulkOp)
        .put("lastGatewayCall", lastGatewayCall).put("gatewayCalls", JSONObject(gatewayCalls.mapValues { it.value.get() }))
        .put("selected", selected).put("taskCount", taskCount).put("previews", previews).put("confirms", confirms)
        .put("taskPages", taskPages).put("queue", queue).put("reportState", reportState).put("mode", mode)
        .put("reportAction", JSONObject(previewAction.toString()))
        .put("draftPhase", service().load(bulkProject)?.optString("phase") ?: "none")
    override suspend fun sharedBulkHistory(cursor: String?) = JSONObject().put("operations", JSONArray().put(JSONObject().put("id", bulkOp)
        .put("state", reportState).put("createdAt", "2026-10-20T09:00:00Z").put("errorCode", JSONObject.NULL).put("action", previewAction).put("mode", mode).put("counts", report().getJSONObject("counts"))))
        .put("hasMore", false).put("nextCursor", JSONObject.NULL)
    override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?): JSONObject {
        val options = when (kind) { "projects" -> listOf("other-project" to "Другой проект"); "statuses" -> listOf("open" to "Открыто", "done" to "Готово")
            "assignees" -> listOf("person" to "Участник команды"); else -> listOf("label" to "Метка команды") }
        return JSONObject().put("options", JSONArray(options.map { JSONObject().put("id", it.first).put("title", it.second) })).put("hasMore", false).put("nextCursor", JSONObject.NULL)
    }
}

class SharedBulkUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private fun captureFailure(fixture: BulkUiFixture, phase: String, failure: Throwable) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = context.getExternalFilesDir(null) ?: context.cacheDir
        val name = "bulk313-$phase-${System.currentTimeMillis()}"
        fun diagnostic(action: () -> Unit) {
            try { action() } catch (captureFailure: Throwable) { failure.addSuppressed(captureFailure) }
        }
        // These reads never re-enter Compose/Espresso after its original idle timeout.
        diagnostic {
            val traces = Thread.getAllStackTraces().entries.sortedBy { it.key.id }.joinToString("\n\n") { (thread, frames) ->
                "Thread ${thread.id} ${thread.name} ${thread.state}\n" + frames.joinToString("\n") { "  at $it" }
            }
            File(directory, "$name-threads.txt").writeText(traces)
        }
        diagnostic { File(directory, "$name.json").writeText(fixture.diagnostic().put("testPhase", phase).put("failure", failure.stackTraceToString()).toString(2)) }
        diagnostic { captureNativeWindow(File(directory, "$name.png")) }
    }
    private fun open(fixture: BulkUiFixture = BulkUiFixture(), prefs: UiPreferences = UiPreferences(), restore: StateRestorationTester? = null,
        sacred: Boolean = true, onTask: (String, String) -> Unit = { _, _ -> }) {
        val content: @Composable () -> Unit = { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalSacredFeaturesEnabled provides sacred) {
            MaterialTheme(colorScheme = standart) { SharedBulkScreen(fixture, bulkProject, JSONObject().put("projectIds", JSONArray().put(bulkProject)), "priority", prefs, {}, {}, {}, onTask) }
        } }
        if (restore == null) compose.setContent(content) else restore.setContent(content)
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-task-bulk-task-0").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun select(fixture: BulkUiFixture, all: Boolean = false) {
        if (all) compose.onNodeWithTag("bulk-select-all").performClick() else compose.onNodeWithTag("bulk-task-bulk-task-0").performScrollTo().performClick()
        compose.onNodeWithTag("bulk-configure").performClick(); compose.onNodeWithTag("bulk-kind").assertExists()
    }
    private fun preview() {
        compose.onNodeWithTag("bulk-preview").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-confirm").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun chooseKind(kind: String) { compose.onNodeWithTag("bulk-kind").performScrollTo().performClick(); compose.onNodeWithTag("bulk-kind-$kind").performScrollTo().performClick() }
    @Test fun choosingTasksNeverCompletesThemAndPreviewNeedsAnExplicitApply() {
        val fixture = BulkUiFixture()
        var phase = "open"
        try {
            open(fixture)
            val pageBounds = compose.onNodeWithTag("bulk-select-page").getUnclippedBoundsInRoot()
            val allBounds = compose.onNodeWithTag("bulk-select-all").getUnclippedBoundsInRoot()
            val pageHeight = pageBounds.bottom - pageBounds.top
            val allHeight = allBounds.bottom - allBounds.top
            assertEquals(pageHeight, allHeight); assertTrue(pageHeight.value >= 48f)
            phase = "select"; select(fixture); assertEquals(0, fixture.confirms)
            phase = "preview"; preview()
            assertEquals(1, fixture.selected); assertEquals(1, fixture.previews); assertEquals(0, fixture.confirms)
            phase = "confirm"
            compose.onNodeWithTag("bulk-confirm").performClick(); compose.waitUntil(10000) { fixture.confirms == 1 }; assertEquals(1, fixture.previews)
        } catch (failure: Throwable) {
            try { captureFailure(fixture, phase, failure) } catch (diagnosticFailure: Throwable) { failure.addSuppressed(diagnosticFailure) }
            throw failure
        }
    }
    @Test fun allResultsDoesNotFetchAllPagesAndReportHasBoundedPaging() {
        val fixture = BulkUiFixture().apply { taskCount = 131 }; open(fixture); select(fixture, true); preview()
        assertEquals(131, fixture.selected); assertEquals(1, fixture.taskPages)
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-results"))).performScrollTo().performClick()
        compose.onNodeWithTag("bulk-next-report").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-result-101").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bulk-previous-report").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-result-1").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun savedSelectionAndPrioritySurviveRecreationBeforeAnyRequest() {
        val fixture = BulkUiFixture(); val restoration = StateRestorationTester(compose); open(fixture, restore = restoration); select(fixture)
        compose.onNodeWithTag("bulk-priority").performClick(); compose.onNodeWithTag("bulk-priority-3").performClick()
        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-task-bulk-task-0").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bulk-task-bulk-task-0").assertIsOn(); compose.onNodeWithTag("bulk-configure").performClick()
        preview(); assertEquals(3, fixture.previewAction.getInt("priority")); assertEquals(1, fixture.selected)
    }
    @Test fun lostPreviewRestoresFrozenCommandAndRequiresExplicitRetry() {
        val fixture = BulkUiFixture().apply { lose = true }; val restoration = StateRestorationTester(compose); open(fixture, restore = restoration); select(fixture)
        compose.onNodeWithTag("bulk-preview").performClick(); compose.waitUntil(10000) { fixture.previews == 1 && compose.onAllNodesWithTag("bulk-error").fetchSemanticsNodes().isNotEmpty() }
        restoration.emulateSavedInstanceStateRestore(); compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("bulk-retry").assertIsEnabled() }.isSuccess }
        assertEquals(1, fixture.previews); compose.onNodeWithTag("bulk-retry").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-confirm").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(2, fixture.previews); assertEquals(fixture.sent[0], fixture.sent[1]); assertEquals(0, fixture.confirms)
    }
    @Test fun oldTaskQueuePreventsPreviewAndCanBeRetriedWithoutLosingSelection() {
        val fixture = BulkUiFixture().apply { queue = true }; open(fixture); select(fixture)
        compose.onNodeWithTag("bulk-preview").performClick(); compose.onNodeWithTag("bulk-error").assertTextEquals("Сначала синхронизируйте изменения задач."); assertEquals(0, fixture.previews)
        compose.runOnIdle { fixture.queue = false }; preview(); assertEquals(1, fixture.selected)
    }
    @Test fun expiredPreviewOffersNewSelectionAndNeverApplies() {
        val fixture = BulkUiFixture().apply { expired = true }; open(fixture); select(fixture)
        compose.onNodeWithTag("bulk-preview").performClick(); compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-new").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("bulk-confirm").assertDoesNotExist(); assertEquals(0, fixture.confirms)
        compose.onNodeWithTag("bulk-new").performClick(); compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-select-all").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun cancelAndHistoryRecoverTheSameOperation() {
        val fixture = BulkUiFixture(); open(fixture); select(fixture); preview(); compose.onNodeWithTag("bulk-cancel").performClick()
        compose.onNodeWithTag("bulk-cancel-confirm").performClick(); compose.waitUntil(10000) { fixture.reportState == "cancelled" }
        compose.onNodeWithTag("bulk-history").performClick(); compose.onNodeWithTag("bulk-history-$bulkOp").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-new").fetchSemanticsNodes().isNotEmpty() }; assertEquals(1, fixture.previews); assertEquals(0, fixture.confirms)
    }
    @Test fun reportRefreshDropsRevokedTaskTitlesAndOpenControls() {
        val fixture = BulkUiFixture(); open(fixture); select(fixture); preview()
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-results"))).performScrollTo().performClick()
        compose.onNodeWithTag("bulk-open-1").performScrollTo().assertExists()
        compose.runOnIdle { fixture.redacted = true }; compose.onNodeWithTag("bulk-refresh").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Задача недоступна").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Результат задачи 1").assertDoesNotExist(); compose.onNodeWithTag("bulk-open-1").assertDoesNotExist()
    }
    @Test fun openingAReportTaskUsesTheExistingProjectAndTaskIdentity() {
        val fixture = BulkUiFixture(); var opened: Pair<String, String>? = null; open(fixture, onTask = { project, task -> opened = project to task }); select(fixture); preview()
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-results"))).performScrollTo().performClick(); compose.onNodeWithTag("bulk-open-1").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(bulkProject to "bulk-task-0", opened) }
    }
    @Test fun allActionControlsProduceTheExistingTypedWireShapes() {
        val fixture = BulkUiFixture(); open(fixture); select(fixture)
        chooseKind("assignee"); compose.onNodeWithTag("bulk-assignee").performClick(); compose.onNodeWithTag("bulk-assignee-person").performClick()
        chooseKind("status"); compose.onNodeWithTag("bulk-status").performClick(); compose.onNodeWithTag("bulk-status-done").performClick()
        chooseKind("move"); compose.onNodeWithTag("bulk-destination").performClick(); compose.onNodeWithTag("bulk-destination-other-project").performClick()
        compose.onNodeWithTag("bulk-destination-status").performClick(); compose.onNodeWithTag("bulk-destination-status-open").performClick()
        preview(); assertEquals("other-project", fixture.previewAction.getString("projectId")); assertEquals("open", fixture.previewAction.getString("statusId")); assertEquals(0, fixture.confirms)
    }
    @Test fun signedDayShiftAndIndependentCalendarRemainInputChoices() {
        val fixture = BulkUiFixture(); open(fixture, UiPreferences(input = CalendarMode.LUNAR)); select(fixture); chooseKind("due")
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-calendar"))).performScrollTo().performClick()
        compose.onNodeWithTag("bulk-input-mode-lunar").assertExists()
        compose.onNodeWithTag("bulk-due-mode").performScrollTo().performClick(); compose.onNodeWithTag("bulk-due-mode-shift").performClick()
        compose.onNodeWithTag("bulk-days").performTextReplacement("-2"); compose.activityRule.scenario.onActivity { activity ->
            (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
        }
        preview(); assertEquals(-2, fixture.previewAction.getInt("days")); assertFalse(fixture.previewAction.has("calendarMode"))
    }
    @Test fun sacredOffHidesCalendarDisclosureWithoutPreventingDateOrClearActions() {
        val fixture = BulkUiFixture(); open(fixture, UiPreferences(input = CalendarMode.LUNAR), sacred = false); select(fixture); chooseKind("due")
        compose.onNodeWithTag("bulk-date").assertExists(); compose.onNodeWithTag("bulk-calendar").assertDoesNotExist()
        compose.onNodeWithTag("bulk-due-mode").performClick(); compose.onNodeWithTag("bulk-due-mode-clear").performClick(); preview()
        assertEquals("clear", fixture.previewAction.getString("mode")); assertFalse(fixture.previewAction.has("calendarMode"))
    }
    @Test fun threeInputCalendarsKeepOneCanonicalDateRegardlessOfDisplayCalendar() {
        val fixture = BulkUiFixture(); open(fixture, UiPreferences(input = CalendarMode.SACRED, display = CalendarMode.LUNAR, gregorianYearStartsInMarch = true))
        select(fixture); chooseKind("due")
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-calendar"))).performScrollTo().performClick()
        val target = java.time.LocalDate.now().plusDays(1); val calendar = ru.genesis.calendar.domain.GenesisCalendar(gregorianYearStart = "march")
        for (mode in CalendarMode.entries) {
            compose.onNodeWithTag("bulk-input-mode-${mode.wireValue}").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithTag("bulk-date").performScrollTo().performClick()
            compose.onNodeWithContentDescription(calendar.formatDate(target, mode)).performScrollTo().performClick()
        }
        preview(); assertEquals(target.toString(), fixture.previewAction.getString("date")); assertFalse(fixture.previewAction.has("calendarMode")); assertFalse(fixture.previewAction.has("calendarContext"))
    }
    @Test fun labelsAndTrashRetentionUseExplicitChoicesAndTheSamePreviewGate() {
        val fixture = BulkUiFixture(); open(fixture); select(fixture); chooseKind("labels")
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-labels"))).performScrollTo().performClick()
        compose.onNodeWithText("Метка команды").performScrollTo().performClick(); preview()
        assertEquals("label", fixture.previewAction.getJSONArray("labelIds").getString(0)); assertEquals(0, fixture.confirms)
        compose.onNodeWithTag("bulk-cancel").performClick(); compose.onNodeWithTag("bulk-cancel-confirm").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-new").fetchSemanticsNodes().isNotEmpty() }; compose.onNodeWithTag("bulk-new").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-task-bulk-task-0").fetchSemanticsNodes().isNotEmpty() }
        select(fixture); chooseKind("trash"); compose.onNodeWithTag("bulk-retention").performClick(); compose.onNodeWithTag("bulk-retention-7").performClick()
        compose.onNodeWithTag("bulk-preview").assertIsEnabled(); preview(); assertEquals(7, fixture.previewAction.getInt("retentionDays")); assertEquals(0, fixture.confirms)
    }
    @Test fun readOnlyRoleCannotConfigureOrApplyButCanReadHistory() {
        val fixture = BulkUiFixture().apply { canWrite = false }; open(fixture); compose.onNodeWithTag("bulk-select-all").performClick()
        compose.onNodeWithTag("bulk-configure").assertIsNotEnabled(); compose.onNodeWithTag("bulk-history").performClick(); compose.onNodeWithTag("bulk-history-$bulkOp").assertExists()
        assertEquals(0, fixture.previews); assertEquals(0, fixture.confirms)
    }
    @Test fun revokedDestinationCannotBeAppliedFromAnOldPreview() {
        val fixture = BulkUiFixture(); open(fixture); select(fixture); preview()
        compose.runOnIdle { fixture.unavailableDestination = true }; compose.onNodeWithTag("bulk-refresh").performClick()
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("bulk-confirm").assertIsNotEnabled() }.isSuccess }; assertEquals(0, fixture.confirms)
    }

    @Test fun captureNativeBulk() {
        val args = InstrumentationRegistry.getArguments(); org.junit.Assume.assumeTrue(args.getString("genesisBulkCapture") == "true")
        var dark by mutableStateOf(false); var language by mutableStateOf("ru"); var fixture by mutableStateOf(BulkUiFixture())
        val localeOnly = args.getString("genesisBulkLocaleOnly") == "true"; val locales = args.getString("genesisBulkLanguages", "ru").split(',')
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                key(fixture, dark, language) { SharedBulkScreen(fixture, bulkProject, JSONObject().put("projectIds", JSONArray().put(bulkProject)), "priority", UiPreferences(), {}, {}, {}, { _, _ -> }) }
            } }
        } }
        fun capture(name: String) {
            compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(350, 5000)
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,
                "bulk-${args.getString("genesisBulkPass", "initial")}-${args.getString("genesisBulkWidth")}-${args.getString("genesisBulkFont", "1.0")}-${if (dark) "dark" else "light"}-$language-$name.png")
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(file))
        }
        for (locale in locales) for (night in listOf(false, true)) {
            compose.runOnIdle { fixture = BulkUiFixture().apply { taskCount = 131 }; language = locale; dark = night }
            compose.waitUntil(10000) { compose.onAllNodesWithTag("bulk-task-bulk-task-0").fetchSemanticsNodes().isNotEmpty() }
            if (!localeOnly) capture("selection")
            select(fixture, true)
            if (!localeOnly) {
                chooseKind("move"); compose.onNodeWithTag("bulk-destination").performClick(); compose.onNodeWithTag("bulk-destination-other-project").performClick()
                compose.onNodeWithTag("bulk-destination-status").performClick(); compose.onNodeWithTag("bulk-destination-status-open").performClick(); capture("action")
            }
            if (localeOnly) { fixture.queue = true; compose.onNodeWithTag("bulk-preview").performClick(); compose.onNodeWithTag("bulk-error").assertExists(); capture("queue-error") }
            else {
                preview(); capture("preview")
                compose.onNodeWithTag("bulk-confirm").performClick(); compose.waitUntil(10000) { fixture.confirms == 1 }
                compose.runOnIdle { fixture.reportState = "done"; fixture.itemFailure = "CUSTOM_FIELD_MOVE_REQUIRES_MAPPING" }; compose.onNodeWithTag("bulk-refresh").performClick()
                compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-results"))).performScrollTo().performClick()
                compose.onNodeWithTag("bulk-result-1").performScrollTo(); capture("result")
                compose.onNodeWithTag("bulk-history").performClick(); compose.onNodeWithTag("bulk-history-$bulkOp").performScrollTo(); capture("history")
            }
        }
    }
}
