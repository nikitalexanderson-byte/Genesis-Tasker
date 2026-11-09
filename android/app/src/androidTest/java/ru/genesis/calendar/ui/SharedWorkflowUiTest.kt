package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File
import java.util.UUID

internal class WorkflowUiFixture : SharedWorkspaceGateway, WorkflowDraftAccess {
    val context = InstrumentationRegistry.getInstrumentation().targetContext.also { check(it.packageName in setOf("ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.debug", "ru.genesis.calendar.v313.debug", "ru.genesis.calendar.ui316.debug", "ru.genesis.calendar.qa1103.debug", "ru.genesis.calendar.qa327.debug")) }
    val account = "qa-workflow-${UUID.randomUUID()}"
    val store = PlanningDraftStore(context, "workflow")
    val journal = PlanningJournal(store, contract = WorkflowJournalContract)
    val service = WorkflowDraftService(journal, account, this)
    var manage = true; var deny = false; var cached = false; var lose = false; var queue = false
    var config = JSONObject().put("enabled", false).put("revision", 0).put("statuses", JSONArray()).put("transitions", JSONArray())
    val commands = mutableListOf<String>(); val receipts = mutableMapOf<String, JSONObject>(); val historyCalls = mutableListOf<Long?>()
    var historyCount = 0
    override fun check() = Unit
    override fun hasTaskQueue(project: String) = queue
    override fun workflow(project: String): JSONObject {
        if (deny) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        return JSONObject().put("config", JSONObject(config.toString())).put("counts", JSONObject().put("open", 0).put("done", 0))
            .put("context", JSONObject().put("project", JSONObject().put("id", "project").put("title", "План команды")
                .put("role", if (manage) "owner" else "viewer").put("permissions", JSONObject().put("manageProjects", manage)))
                .put("statuses", JSONArray().put(JSONObject().put("id", "open").put("title", "В работе").put("isDone", 0).put("revision", 1))
                    .put(JSONObject().put("id", "done").put("title", "Готово").put("isDone", 1).put("revision", 1)))
                .put("customFieldDefinitions", JSONArray().put(JSONObject().put("id", "custom").put("title", "Результат проверки").put("archived", false).put("type", "boolean"))))
            .put("offlineCache", cached)
    }
    override fun send(project: String, body: JSONObject): JSONObject {
        commands.add(body.toString())
        val result = receipts.getOrPut(body.getString("requestId")) {
            config = (if (body.has("statuses")) WorkflowLifecycle.definition(body) else JSONObject(config.toString()).put("enabled", false))
                .put("revision", body.getLong("expectedRevision") + 1)
            JSONObject().put("config", JSONObject(config.toString())).put("counts", JSONObject().put("open", 0))
        }
        if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        return JSONObject(result.toString())
    }
    override suspend fun sharedWorkflow(projectId: String) = withContext(Dispatchers.IO) { workflow(projectId) }
    override suspend fun sharedWorkflowHistory(projectId: String, before: Long?): JSONObject {
        historyCalls.add(before); val from = minOf((before?.toInt() ?: (historyCount + 1)) - 1, historyCount); val count = minOf(50, from)
        return JSONObject().put("versions", JSONArray((from downTo from - count + 1).map { revision ->
            JSONObject().put("enabled", false).put("revision", revision).put("statuses", JSONArray()).put("transitions", JSONArray()).put("createdAt", "2026-10-19T12:00:00Z")
        })).put("nextCursor", if (from > count) from - count + 1 else JSONObject.NULL)
    }
    override suspend fun sharedWorkflowDraft(projectId: String) = withContext(Dispatchers.IO) { service.load(projectId) }
    override suspend fun sharedWorkflowCopies(projectId: String) = withContext(Dispatchers.IO) { service.copies(projectId) }
    override suspend fun saveSharedWorkflowDraft(projectId: String, stamp: String?, edit: JSONObject) = withContext(Dispatchers.IO) { service.save(projectId, stamp, edit) }
    override suspend fun prepareSharedWorkflowDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.prepare(projectId, stamp) }
    override suspend fun sendSharedWorkflowDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.send(projectId, stamp) }
    override suspend fun rebaseSharedWorkflowDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.rebase(projectId, stamp) }
    override suspend fun removeSharedWorkflowDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.remove(projectId, stamp) }
    override suspend fun saveSharedWorkflowCopy(projectId: String, id: String, stamp: String?, edit: JSONObject) = withContext(Dispatchers.IO) { service.saveCopy(projectId, id, stamp, edit) }
    override suspend fun useSharedWorkflowCopy(projectId: String, id: String, copyStamp: String, stamp: String?) = withContext(Dispatchers.IO) { service.useCopy(projectId, id, copyStamp, stamp) }
    override suspend fun removeSharedWorkflowCopy(projectId: String, id: String, stamp: String) = withContext(Dispatchers.IO) { service.removeCopy(projectId, id, stamp) }
    fun clean() {
        val prefs = context.getSharedPreferences("genesis.shared.workflow.v1", 0)
        prefs.edit().also { editor -> prefs.all.keys.filter { it.contains(account) }.forEach(editor::remove) }.commit()
    }
}

class SharedWorkflowUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var fixture by mutableStateOf<WorkflowUiFixture?>(null); private var generation by mutableIntStateOf(0)
    private var language by mutableStateOf("ru"); private var dark by mutableStateOf(false)
    private val fixtures = mutableListOf<WorkflowUiFixture>(); private var installed = false
    private fun show(value: WorkflowUiFixture) {
        if (value !in fixtures) fixtures.add(value)
        if (!installed) {
            compose.setContent {
                fixture?.let { current -> key(generation) { CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) { SharedWorkflowScreen(current, "project", {}, {}) } }
            } } } }; installed = true
        }
        compose.runOnIdle { fixture = value; generation++ }
        compose.waitUntil(10000) { compose.onAllNodesWithTag("workflow-summary").fetchSemanticsNodes().isNotEmpty() }; compose.waitForIdle()
    }
    private fun click(tag: String) {
        if (compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
            compose.onNodeWithTag("workflow-content").performScrollToNode(hasTestTag(tag))
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.performClick()
    }
    private fun open(tag: String) {
        val node = compose.onNodeWithTag(tag)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.onChildren().filter(hasClickAction()).onFirst().performClick()
    }
    private fun settle() {
        compose.waitUntil(10000) { compose.onAllNodesWithTag("workflow-editor-busy").fetchSemanticsNodes().isEmpty() }; compose.waitForIdle()
    }
    private fun hideKeyboard() = compose.dismissValidationKeyboard()
    @After fun clean() { if (installed) compose.runOnIdle { fixture = null }; fixtures.forEach { it.clean() } }
    @Test fun viewerReadsCountsAndRulesWithoutManagementActions() {
        val f = WorkflowUiFixture().apply { manage = false }; show(f)
        compose.onNodeWithTag("workflow-configure").assertDoesNotExist(); open("workflow-status-open")
        compose.onNodeWithTag("workflow-limit-open").assertDoesNotExist(); assertTrue(f.commands.isEmpty())
    }
    @Test fun zeroLimitSavesWithoutEnablingPlanningAndSurvivesAColdReopen() {
        val f = WorkflowUiFixture(); show(f); click("workflow-configure"); open("workflow-status-open")
        compose.onNodeWithTag("workflow-limit-open").performScrollTo().performTextReplacement("0")
        compose.onNodeWithTag("workflow-limit-open").assertTextContains("0"); hideKeyboard()
        compose.onNodeWithTag("workflow-limit-open").assertTextContains("0")
        click("workflow-save"); compose.waitUntil(10000) { f.commands.isNotEmpty() && compose.onAllNodesWithTag("workflow-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(0, f.config.getJSONArray("statuses").getJSONObject(0).getInt("wipLimit")); assertTrue(f.config.getBoolean("enabled"))
        show(f); assertTrue(f.journal.load(f.account, "project") == null)
    }
    @Test fun unknownResponseKeepsAnImmutableCommandAcrossReopenAndRetriesOnce() {
        val f = WorkflowUiFixture().apply { lose = true }; show(f); click("workflow-configure"); click("workflow-save"); settle()
        compose.onNodeWithTag("workflow-pending").assertExists(); show(f); click("workflow-restore"); click("workflow-retry")
        compose.waitUntil(10000) { compose.onAllNodesWithTag("workflow-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(2, f.commands.size); assertEquals(f.commands[0], f.commands[1]); assertEquals(1, f.receipts.size)
    }
    @Test fun revokedAccessHidesProjectAndLocalInputWithoutDeletingTheDraft() {
        val f = WorkflowUiFixture(); show(f); click("workflow-configure"); settle(); f.deny = true; click("workflow-refresh")
        compose.waitUntil(10000) { compose.onAllNodesWithTag("workflow-summary").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("План команды").assertDoesNotExist(); assertNotNull(f.journal.load(f.account, "project"))
    }
    @Test fun offlineProjectionCannotConfigureOrSendRules() {
        val f = WorkflowUiFixture().apply { cached = true }; show(f)
        compose.onNodeWithTag("workflow-offline").assertExists(); compose.onNodeWithTag("workflow-configure").assertIsNotEnabled()
        assertTrue(f.commands.isEmpty())
    }
    @Test fun historyLoadsAllThreePagesAndTheLastRevision() {
        val f = WorkflowUiFixture().apply { historyCount = 131; config.put("revision", 131) }; show(f); click("workflow-section-history")
        repeat(3) { click("workflow-history-more"); compose.waitUntil(10000) { f.historyCalls.size == it + 1 }; compose.waitForIdle() }
        compose.onNodeWithTag("workflow-content").performScrollToNode(hasTestTag("workflow-history-1"))
        compose.onNodeWithTag("workflow-history-1").assertExists(); compose.onNodeWithTag("workflow-history-more").assertDoesNotExist()
        assertEquals(listOf(null, 82L, 32L), f.historyCalls)
    }
    @Test fun oldTaskQueueBlocksANewCommandAndKeepsTheDraft() {
        val f = WorkflowUiFixture().apply { queue = true }; show(f); click("workflow-configure"); click("workflow-save"); settle()
        compose.onNodeWithTag("workflow-editor-error").assertExists(); assertTrue(f.commands.isEmpty()); assertNotNull(f.journal.load(f.account, "project"))
    }
    @Test fun changedRevisionRequiresExplicitRefreshWithoutLosingTheEnteredLimit() {
        val f = WorkflowUiFixture(); show(f); click("workflow-configure"); open("workflow-status-open")
        compose.onNodeWithTag("workflow-limit-open").performScrollTo().performTextReplacement("7")
        compose.onNodeWithTag("workflow-limit-open").assertTextContains("7"); hideKeyboard()
        compose.onNodeWithTag("workflow-limit-open").assertTextContains("7"); f.config.put("revision", 1)
        click("workflow-save"); settle(); assertTrue(f.commands.isEmpty()); click("workflow-refresh"); settle(); click("workflow-rebase"); settle()
        compose.onNodeWithTag("workflow-limit-open").performScrollTo().assertTextContains("7")
        click("workflow-save"); compose.waitUntil(10000) { f.commands.isNotEmpty() }
        assertEquals(1, JSONObject(f.commands.single()).getInt("expectedRevision"))
    }
    @Test fun intermediateEmptyRolesSurviveReopenButCannotBeSent() {
        val f = WorkflowUiFixture(); show(f); click("workflow-configure"); click("workflow-section-transitions"); open("workflow-target-open")
        WorkflowLifecycle.roles.forEach { click("workflow-role-open-$it") }
        compose.waitUntil(10000) {
            val record = f.journal.load(f.account, "project")
            record?.getJSONObject("edit")?.getJSONObject("draft")?.getJSONArray("transitions")?.let { edges ->
                WorkflowLifecycle.rows(edges).find { it.isNull("fromStatusId") && it.getString("toStatusId") == "open" }?.getJSONArray("roles")?.length() == 0
            } == true
        }
        show(f)
        // The summary is rendered before the asynchronous journal load finishes.
        compose.waitUntil(10000) {
            compose.onAllNodesWithTag("workflow-restore", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        click("workflow-restore"); click("workflow-section-transitions"); open("workflow-target-open")
        compose.onNodeWithTag("workflow-role-open-owner").assertIsOff(); click("workflow-save"); settle()
        compose.onNodeWithTag("workflow-editor-error").assertExists(); assertTrue(f.commands.isEmpty())
    }
    @Test fun captureWorkflowForms() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("genesisWorkflowCapture") == "true")
        val all = args.getString("genesisWorkflowLanguages") == "true"
        val width = requireNotNull(args.getString("genesisWorkflowWidth")).toFloat()
        val expectedFont = args.getString("genesisWorkflowFontScale")?.toFloat() ?: 1f
        val langs = if (all) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun capture(state: String) {
            compose.waitForIdle()
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText("План команды", useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
            val actualDensity = layouts.single().layoutInput.density
            val logicalWidth = compose.onNodeWithTag("shared-workflow-screen").fetchSemanticsNode().boundsInRoot.width / actualDensity.density
            assertTrue("Dialog must use the phone viewport without overflowing: $logicalWidth / $width", logicalWidth in (width * .75f)..width)
            assertEquals("Dialog font scale", expectedFont, actualDensity.fontScale, .01f)
            println("QA workflow viewport=$logicalWidth density=${actualDensity.density} fontScale=${actualDensity.fontScale} language=$language state=$state")
            val target = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "workflow-system-${if (all) "font130-" else ""}${if (dark) "dark" else "light"}-${width.toInt()}-$language-$state.png")
            ru.genesis.calendar.captureNativeWindow(target)
        }
        for (lang in langs) for (mode in listOf(false, true)) {
            compose.runOnIdle { language = lang; dark = mode }
            val f = WorkflowUiFixture(); show(f)
            if (!all) capture("read")
            click("workflow-configure"); open("workflow-status-open"); capture("fields")
            click("workflow-section-transitions"); open("workflow-target-open"); capture("transitions")
            if (!all) { val historyFixture = WorkflowUiFixture().apply { historyCount = 131; config.put("revision", 131) }; show(historyFixture); click("workflow-section-history"); click("workflow-history-more"); capture("history") }
        }
    }
}
