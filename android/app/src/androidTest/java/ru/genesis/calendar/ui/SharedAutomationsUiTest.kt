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
import ru.genesis.calendar.auth.*
import java.io.File
import java.time.Instant

internal const val automationUiProject = "automation-project"
internal fun automationUiRule(id: String = "auto-rule-0") = JSONObject().put("id", id).put("projectId", automationUiProject).put("ownerId", "owner")
    .put("title", "Подготовить команду к запуску нового проекта").put("enabled", true).put("deleted", false).put("canManage", true).put("revision", 3)
    .put("createdAt", "2026-10-20T09:00:00Z").put("updatedAt", "2026-10-20T09:00:00Z").put("definition", JSONObject().put("schemaVersion", 1)
        .put("trigger", JSONObject().put("type", "created")).put("conditions", JSONArray()).put("calendarMode", "lunar")
        .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
        .put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0))))

private class AutomationUiFixture : SharedWorkspaceGateway {
    private val memory = object : PlanningJournalStorage {
        val values = mutableMapOf<String, String>()
        override fun <T> locked(block: () -> T): T = synchronized(this, block)
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
    }
    var fresh = automationUiRule(); var count = 7; var runCount = 7; var lose = false; var offline = false; var forbidden = false
    var sends = 0; var taskReads = 0; var workerAt: String? = Instant.now().toString()
    var delayedProjectRead = false
    var delayedListRead = false
    val sent = mutableListOf<String>(); private val receipts = mutableMapOf<String, JSONObject>(); private val retried = mutableSetOf<String>()
    private fun checkAccess() { if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK); if (forbidden) throw AuthApiError("SHARED_PROJECT_FORBIDDEN") }
    private val access = object : SharedAutomationAccess {
        override fun check() { }
        override fun rule(project: String, rule: String): JSONObject { checkAccess(); return JSONObject().put("rule", JSONObject(fresh.toString()).put("id", rule)) }
        override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
            checkAccess(); sends++; sent += body.toString()
            val receipt = receipts.getOrPut(body.getString("operationId")) {
                if (run != null) { retried += run; JSONObject().put("id", run).put("state", "pending").put("retryCount", 1) }
                else {
                    fresh.put("id", rule).put("revision", fresh.getInt("revision") + 1)
                    for (key in listOf("enabled", "deleted")) if (body.has(key)) fresh.put(key, body.getBoolean(key))
                    JSONObject().put("rule", JSONObject(fresh.toString()))
                }
            }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return JSONObject(receipt.toString())
        }
    }
    private fun service() = SharedAutomationDraftService(PlanningJournal(memory, contract = SharedAutomationJournalContract), "automation-ui", access)
    override suspend fun sharedAutomationDraft(projectId: String) = service().load(projectId)
    override suspend fun saveSharedAutomationDraft(projectId: String, stamp: String?, edit: JSONObject) = service().save(projectId, stamp, edit)
    override suspend fun prepareSharedAutomationDraft(projectId: String, stamp: String) = service().prepare(projectId, stamp)
    override suspend fun sendSharedAutomationDraft(projectId: String, stamp: String) = service().send(projectId, stamp)
    override suspend fun removeSharedAutomationDraft(projectId: String, stamp: String) = service().remove(projectId, stamp)
    override suspend fun sharedProject(projectId: String): JSONObject {
        if (delayedProjectRead) kotlinx.coroutines.delay(100)
        checkAccess(); return JSONObject().put("project", JSONObject().put("id", automationUiProject).put("spaceId", "automation-space").put("title", "План команды"))
            .put("members", JSONArray().put(JSONObject().put("userId", "owner").put("displayName", "Александр")))
            .put("statuses", JSONArray().put(JSONObject().put("id", "done").put("title", "Готово")))
            .put("customFieldDefinitions", JSONArray().put(JSONObject().put("id", "flag").put("spaceId", "automation-space").put("projectId", automationUiProject)
                .put("title", "Проверено").put("type", "checkbox").put("position", 0).put("revision", 1).put("required", false).put("showCard", true).put("showList", true)
                .put("archived", false).put("predecessorId", JSONObject.NULL).put("options", JSONArray())))
    }
    override suspend fun sharedAutomations(projectId: String, deleted: Boolean, cursor: String?): JSONObject {
        if (delayedListRead) kotlinx.coroutines.delay(100)
        checkAccess(); val start = cursor?.substringAfterLast('-')?.toInt()?.plus(1) ?: 0; val end = minOf(count, start + 50)
        return JSONObject().put("rules", JSONArray((start until end).map { index -> JSONObject(fresh.toString()).apply { remove("definition") }
            .put("id", "auto-rule-$index").put("title", if (index == 0) fresh.getString("title") else "Правило команды ${index + 1}")
            .put("deleted", deleted).apply { if (deleted) put("enabled", false) } }))
            .put("nextCursor", if (end < count) "auto-rule-${end - 1}" else JSONObject.NULL).put("canCreate", true).put("workerCompletedAt", workerAt ?: JSONObject.NULL)
    }
    override suspend fun sharedAutomation(projectId: String, ruleId: String): JSONObject { checkAccess(); return JSONObject().put("rule", JSONObject(fresh.toString()).put("id", ruleId)) }
    override suspend fun sharedAutomationRuns(projectId: String, ruleId: String, cursor: String?): JSONObject {
        checkAccess(); val start = cursor?.substringAfterLast('-')?.toInt()?.plus(1) ?: 0; val end = minOf(runCount, start + 50)
        return JSONObject().put("runs", JSONArray((start until end).map { index ->
            val id = "auto-run-$index"; JSONObject().put("id", id).put("ruleId", ruleId).put("revision", 3).put("taskId", "auto-task-$index")
                .put("taskTitle", "Согласовать следующий шаг команды").put("state", if (id in retried) "pending" else "failed").put("attempts", 5)
                .put("retryCount", if (id in retried) 1 else 0).put("errorCode", if (id in retried) JSONObject.NULL else "BACKGROUND_LEASE_EXPIRED")
                .put("result", JSONObject.NULL).put("createdAt", "2026-10-20T09:00:00Z").put("finishedAt", if (id in retried) JSONObject.NULL else "2026-10-20T09:00:01Z")
        })).put("nextCursor", if (end < runCount) "auto-run-${end - 1}" else JSONObject.NULL)
    }
    override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?) = JSONObject().put("options", JSONArray().put(JSONObject().put("id", "label").put("title", "Важно"))).put("hasMore", false).put("nextCursor", JSONObject.NULL)
    override suspend fun sharedAutomationTemplate(templateId: String, language: String) = JSONObject().put("id", templateId).put("title", "Начало проекта")
    override suspend fun sharedTask(projectId: String, taskId: String): JSONObject { checkAccess(); taskReads++; return JSONObject().put("task", JSONObject().put("id", taskId).put("projectId", automationUiProject)) }
    fun allActions() {
        fresh.getJSONObject("definition").put("conditions", JSONArray().put(JSONObject().put("field", "custom").put("fieldId", "flag").put("operator", "eq").put("value", false)))
            .put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0))
                .put(JSONObject().put("type", "status").put("value", "done")).put(JSONObject().put("type", "assignee").put("value", "owner"))
                .put(JSONObject().put("type", "addLabels").put("value", JSONArray().put("label"))).put(JSONObject().put("type", "removeLabels").put("value", JSONArray().put("label")))
                .put(JSONObject().put("type", "custom").put("fieldId", "flag").put("value", false))
                .put(JSONObject().put("type", "due").put("mode", "set").put("date", "2026-10-21"))
                .put(JSONObject().put("type", "createTemplate").put("templateId", "builtin:task").put("options", JSONObject()))
                .put(JSONObject().put("type", "notify").put("recipientIds", JSONArray().put("owner")).put("message", "Напомнить про встречу")))
    }
}

class SharedAutomationsUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private fun open(fixture: AutomationUiFixture, restore: StateRestorationTester? = null, onLost: () -> Unit = {}, onTask: (String) -> Unit = {}) {
        val content: @Composable () -> Unit = { CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = standart) { SharedAutomationsScreen(fixture, automationUiProject, {}, onLost, {}, onTask) }
        } }
        if (restore == null) compose.setContent(content) else restore.setContent(content)
        compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-filter").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun choose() { compose.onNodeWithTag("automation-rule-auto-rule-0").performScrollTo().performClick(); compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-enabled").fetchSemanticsNodes().isNotEmpty() } }
    private fun expand(tag: String) { compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag(tag))).performScrollTo().performClick() }
    private fun confirm(fixture: AutomationUiFixture, expected: Int = 1) { compose.onNodeWithTag("automation-confirm-command").performClick(); compose.waitUntil(10000) { fixture.sends == expected && compose.onAllNodesWithTag("automation-working").fetchSemanticsNodes().isEmpty() } }
    @Test fun selectingARuleKeepsLoadingAfterTheLibraryLeavesComposition() {
        val fixture = AutomationUiFixture(); open(fixture); fixture.delayedProjectRead = true
        choose(); compose.onNodeWithTag("automation-enabled").assertIsOn().assertIsEnabled()
    }
    @Test fun asynchronouslyLoadedLibrarySurvivesChangingTheInterfaceLanguage() {
        val fixture = AutomationUiFixture().apply { delayedProjectRead = true; delayedListRead = true }
        var locale by mutableStateOf("ru"); var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch, locale) { CompositionLocalProvider(LocalGenesisLanguage provides locale) {
            MaterialTheme(colorScheme = standart) { SharedAutomationsScreen(fixture, automationUiProject, {}, {}, {}, {}) }
        } } }
        for (next in listOf("ru", "en", "de")) {
            compose.runOnIdle { locale = next; epoch++ }
            compose.waitForIdle()
            compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-0").fetchSemanticsNodes().isNotEmpty() }
            choose()
        }
        assertEquals(0, fixture.sends)
    }
    @Test fun libraryAndRunsDiscloseFiveRowsAtATimeAndServerPagingCanGoBack() {
        val fixture = AutomationUiFixture().apply { count = 51; runCount = 51 }; open(fixture)
        compose.onNodeWithTag("automation-rule-auto-rule-5").assertDoesNotExist(); compose.onNodeWithTag("automation-more-rules").performScrollTo().performClick()
        compose.onNodeWithTag("automation-rule-auto-rule-5").assertExists()
        compose.runOnIdle { fixture.delayedProjectRead = true; fixture.delayedListRead = true }
        compose.onNodeWithTag("automation-rules-next").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-50").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("automation-rules-previous").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-0").fetchSemanticsNodes().isNotEmpty() }
        choose(); expand("automation-runs")
        compose.onNodeWithTag("automation-run-auto-run-5").assertDoesNotExist(); compose.onNodeWithTag("automation-more-runs").performScrollTo().performClick()
        compose.onNodeWithTag("automation-run-auto-run-5").assertExists(); assertEquals(0, fixture.sends)
    }
    @Test fun switchingNeedsExplicitConfirmationAndOnlyTheFinalAcknowledgementUnlocksAnotherCommand() {
        val fixture = AutomationUiFixture(); open(fixture); choose(); compose.onNodeWithTag("automation-enabled").performClick(); assertEquals(0, fixture.sends)
        confirm(fixture); compose.onNodeWithTag("automation-enabled").assertIsOff().assertIsNotEnabled()
        compose.onNodeWithTag("automation-done").performClick(); compose.onNodeWithTag("automation-enabled").assertIsEnabled(); assertEquals(1, fixture.sends)
    }
    @Test fun lostReplyRestoresTheSameCommandAcrossUiRecreation() {
        val fixture = AutomationUiFixture().apply { lose = true }; val restore = StateRestorationTester(compose); open(fixture, restore); choose()
        compose.onNodeWithTag("automation-enabled").performClick(); confirm(fixture); compose.onNodeWithTag("automation-retry-command").assertIsEnabled()
        restore.emulateSavedInstanceStateRestore(); compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-retry-command").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("automation-retry-command").performClick(); compose.waitUntil(10000) { fixture.sends == 2 && compose.onAllNodesWithTag("automation-done").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(fixture.sent[0], fixture.sent[1]); assertEquals(4, fixture.fresh.getInt("revision"))
    }
    @Test fun readableActionsPreserveFalseUserNamesAndTheIndependentCalendar() {
        val fixture = AutomationUiFixture().apply { allActions() }; open(fixture); choose(); expand("automation-actions")
        compose.onNode(hasText("Показать ещё") and hasAnyAncestor(hasTestTag("automation-actions"))).performScrollTo().performClick()
        compose.onNodeWithText("Проверено: Нет").assertExists(); compose.onNodeWithText("Начало проекта").assertExists(); compose.onNodeWithText("Александр\nНапомнить про встречу").assertExists()
        assertEquals("lunar", fixture.fresh.getJSONObject("definition").getString("calendarMode")); assertEquals(0, fixture.sends)
    }
    @Test fun readOnlyRulesKeepHistoryAndSourceTaskLinksWithoutMutationControls() {
        val fixture = AutomationUiFixture().apply { fresh.put("canManage", false) }; var opened = ""; open(fixture, onTask = { opened = it }); choose()
        compose.onNodeWithTag("automation-enabled").assertIsNotEnabled(); compose.onNodeWithTag("automation-delete-restore").assertDoesNotExist()
        expand("automation-runs"); compose.onNodeWithTag("automation-run-task-auto-run-0").performScrollTo().performClick()
        compose.waitUntil(10000) { opened == "auto-task-0" }; assertEquals(1, fixture.taskReads); assertEquals(0, fixture.sends)
    }
    @Test fun unsupportedTemplateParametersExplainAndBlockEnableAndRunRetryButKeepDisable() {
        val fixture = AutomationUiFixture().apply { allActions(); fresh.getJSONObject("definition").getJSONArray("actions").getJSONObject(7)
            .put("options", JSONObject().put("include", JSONObject().put("assignees", false))) }
        open(fixture); choose()
        compose.onNodeWithText("Не все параметры доступны. Включение и повторный запуск здесь заблокированы.").assertExists()
        compose.onNodeWithTag("automation-enabled").assertIsOn().assertIsEnabled()
        expand("automation-actions"); compose.onNode(hasText("Показать ещё") and hasAnyAncestor(hasTestTag("automation-actions"))).performScrollTo().performClick()
        compose.onNodeWithText("Параметры применения шаблона доступны в редакторе правила.", substring = true).assertExists()
        expand("automation-runs"); compose.onNodeWithTag("automation-retry-run-auto-run-0").performScrollTo().assertIsNotEnabled()
        assertEquals(0, fixture.sends)
        compose.onNodeWithTag("automation-enabled").performScrollTo().performClick(); confirm(fixture)
        compose.onNodeWithTag("automation-done").performClick(); compose.onNodeWithTag("automation-enabled").assertIsOff().assertIsNotEnabled()
        assertEquals(1, fixture.sends)
    }
    @Test fun deletedRulesRestorePausedAndFailedRunsUseTheSameVersionAndBoundedRetry() {
        val fixture = AutomationUiFixture().apply { fresh.put("deleted", true).put("enabled", false); delayedProjectRead = true; delayedListRead = true }; open(fixture)
        compose.onNodeWithTag("automation-filter").performClick(); compose.onNodeWithTag("automation-filter-true").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-0").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("automation-rule-auto-rule-0").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-delete-restore").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("automation-delete-restore").performClick(); confirm(fixture)
        assertFalse(JSONObject(fixture.sent.single()).getBoolean("enabled")); assertFalse(fixture.fresh.getBoolean("enabled"))
    }
    @Test fun failedRunRetryIsExplicitAndDoesNotMutateTheRuleRevision() {
        val fixture = AutomationUiFixture(); open(fixture); choose(); expand("automation-runs")
        compose.onNodeWithTag("automation-retry-run-auto-run-0").performScrollTo().performClick(); assertEquals(0, fixture.sends); confirm(fixture)
        assertEquals(3, fixture.fresh.getInt("revision")); assertTrue(JSONObject(fixture.sent.single()).has("expectedRevision"))
        compose.onNodeWithTag("automation-retry-run-auto-run-0").assertDoesNotExist()
    }
    @Test fun typedAccessLossRemovesNamesAndClosesTheRevokedProject() {
        val fixture = AutomationUiFixture(); var lost = 0; open(fixture, onLost = { lost++ }); choose()
        compose.runOnIdle { fixture.forbidden = true }; compose.onNodeWithTag("automation-refresh").performClick()
        compose.waitUntil(10000) { lost == 1 }; compose.onNodeWithText("Подготовить команду к запуску нового проекта").assertDoesNotExist()
        compose.onNodeWithText("Александр").assertDoesNotExist(); assertEquals(0, fixture.sends)
    }
    @Test fun emptyRulesAndMissingWorkerConfirmationStayReadableWithoutDisabledFakeActions() {
        val fixture = AutomationUiFixture().apply { count = 0; workerAt = null }; open(fixture)
        compose.onNodeWithText("Правил пока нет.").assertExists(); expand("automation-worker")
        compose.onNodeWithText("Нет свежего подтверждения фоновой обработки. Запуски могут задерживаться.").assertExists()
        compose.onNodeWithTag("automation-enabled").assertDoesNotExist(); assertEquals(0, fixture.sends)
    }
    @Test fun scheduleShowsItsOwnLunarDaysRangeAndTimezoneWithoutChangingTheRule() {
        val fixture = AutomationUiFixture(); val definition = fixture.fresh.getJSONObject("definition")
        val recurrence = JSONObject().put("enabled", true).put("mode", "lunar").put("pattern", "lunar-decade-days").put("interval", 2)
            .put("days", JSONArray().put(1).put(10)).put("months", JSONArray()).put("pyatas", JSONArray().put(1).put(3))
            .put("rangeStart", "2026-10-20").put("rangeEnd", "2027-10-20").put("invalidDayPolicy", "skip").put("calendarContext", definition.getJSONObject("calendarContext"))
        definition.put("trigger", JSONObject().put("type", "schedule").put("target", "tasks").put("time", "09:30").put("recurrence", recurrence))
        open(fixture); choose(); expand("automation-schedule")
        compose.onNodeWithText("Дни лунной декады").assertExists(); compose.onNodeWithText("1, 10").assertExists(); compose.onNodeWithText("1, 3").assertExists()
        assertEquals("America/New_York", definition.getJSONObject("calendarContext").getString("timeZone")); assertEquals(0, fixture.sends)
    }
    @Test fun captureNativeAutomations() {
        val args = InstrumentationRegistry.getArguments(); org.junit.Assume.assumeTrue(args.getString("genesisAutomationCapture") == "true")
        var fixture by mutableStateOf(AutomationUiFixture()); var dark by mutableStateOf(false); var language by mutableStateOf("ru")
        val locales = args.getString("genesisAutomationLanguages", "ru").split(','); val only = args.getString("genesisAutomationLocaleOnly", "false") == "true"
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                key(fixture, dark, language) { SharedAutomationsScreen(fixture, automationUiProject, {}, {}, {}, {}) }
            } }
        } }
        fun capture(name: String) {
            compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(350, 5000)
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,
                "automations-${args.getString("genesisAutomationPass", "initial")}-${args.getString("genesisAutomationWidth")}-${args.getString("genesisAutomationFont", "1.0")}-${if (dark) "dark" else "light"}-$language-$name.png")
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(file))
        }
        for (locale in locales) for (night in listOf(false, true)) {
            compose.runOnIdle { fixture = AutomationUiFixture().apply { allActions() }; dark = night; language = locale }
            compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-0").fetchSemanticsNodes().isNotEmpty() }
            if (!only) capture("library")
            choose(); if (!only) {
                capture("detail")
                expand("automation-actions")
                compose.onNode(hasText("Показать ещё") and hasAnyAncestor(hasTestTag("automation-actions"))).performScrollTo()
                capture("actions")
                expand("automation-runs")
                compose.onNodeWithTag("automation-retry-run-auto-run-0").performScrollTo().assertIsDisplayed()
                capture("history")
            }
            compose.runOnIdle { fixture.lose = true }; compose.onNodeWithTag("automation-enabled").performScrollTo().performClick(); confirm(fixture)
            compose.onNodeWithTag("automation-error").assertExists(); capture("pending")
        }
    }
    @Test fun captureUnsupportedTemplateParameters() {
        val args = InstrumentationRegistry.getArguments(); org.junit.Assume.assumeTrue(args.getString("genesisTemplateCapture") == "true")
        var fixture by mutableStateOf(AutomationUiFixture()); var dark by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                key(fixture, dark) { SharedAutomationsScreen(fixture, automationUiProject, {}, {}, {}, {}) }
            } }
        } }
        fun capture(name: String) {
            compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(350, 5000)
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,
                "automations-options-${args.getString("genesisAutomationWidth")}-${if (dark) "dark" else "light"}-$name.png")
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(file))
        }
        for (night in listOf(false, true)) {
            compose.runOnIdle { fixture = AutomationUiFixture().apply { allActions(); fresh.getJSONObject("definition").getJSONArray("actions").getJSONObject(7)
                .put("options", JSONObject().put("include", JSONObject().put("assignees", false))) }; dark = night }
            compose.waitUntil(10000) { compose.onAllNodesWithTag("automation-rule-auto-rule-0").fetchSemanticsNodes().isNotEmpty() }
            choose(); compose.onNodeWithTag("automation-enabled").assertIsOn().assertIsEnabled()
            capture("detail")
            expand("automation-actions"); compose.onNode(hasText("Показать ещё") and hasAnyAncestor(hasTestTag("automation-actions"))).performScrollTo().performClick()
            compose.onNodeWithText("Параметры применения шаблона доступны на сайте.", substring = true).performScrollTo().assertIsDisplayed()
            capture("actions")
            expand("automation-runs"); compose.onNodeWithTag("automation-retry-run-auto-run-0").performScrollTo().assertIsNotEnabled().assertIsDisplayed()
            capture("history")
        }
    }
}
