package ru.genesis.calendar.ui

import android.content.Context
import android.content.res.Configuration
import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Rect
import android.provider.Settings
import android.view.accessibility.AccessibilityWindowInfo
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.io.File
import java.util.UUID

/** Touch, saved-state, real PHP/TLS and encrypted writer journal; never a production account. */
class SharedAutomationEditorUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = AutomationEditorHttpsFixture()
    private var dark by mutableStateOf(false); private var language by mutableStateOf("ru"); private var visible by mutableStateOf(true)
    private var epoch by mutableIntStateOf(0)
    private lateinit var snapshot: JSONObject; private lateinit var task: String
    private val fields = linkedMapOf<String, String>(); private var rule: String? = null
    private var taskTemplate: String? = null
    @Before fun setup() {
        fixture.open(); snapshot = fixture.snapshot()
        val names = mapOf("text" to "Комментарий команды", "number" to "Количество", "date" to "Дата проверки", "select" to "Этап", "multi" to "Направления", "checkbox" to "Проверено", "url" to "Материалы")
        for ((type, title) in names) {
            val draft = JSONObject().put("id", UUID.randomUUID().toString()).put("title", title).put("type", type).put("projectId", fixture.project)
                .put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "first").put("title", "Первый вариант").put("archived", false)) else JSONArray())
                .put("position", 0).put("required", false).put("showCard", true).put("showList", true).put("archived", false).put("expectedRevision", 0)
            val preview = fixture.base.raw("POST", "/api/shared/spaces/${fixture.space}/custom-fields/preview", draft)
            val result = fixture.base.raw("PUT", "/api/shared/spaces/${fixture.space}/custom-fields", JSONObject(draft.toString()).put("operationId", UUID.randomUUID().toString())
                .put("fingerprint", preview.getString("fingerprint")).put("replaceType", preview.getBoolean("replaceType")))
            fields[type] = result.getJSONObject("field").getString("id")
        }
        snapshot = fixture.snapshot()
        task = fixture.base.client.createSharedTask(fixture.base.generation, fixture.project, JSONObject().put("title", "Подготовить материалы для команды")
            .put("statusId", snapshot.getJSONArray("statuses").getJSONObject(0).getString("id")).put("priority", 0).put("requestId", UUID.randomUUID().toString())).getJSONObject("task").getString("id")
    }
    @After fun cleanup() = fixture.close()
    private fun definition() = SharedAutomationEditorEdits.initial(SharedCustomCalendar.initial(UiPreferences()))
    private fun seed(definition: JSONObject = definition(), title: String = "Правило команды") {
        fixture.service().save(fixture.project, null, SharedAutomationEditorProtocol.newEdit(fixture.space, fixture.project, fixture.actor, definition).put("title", title))
    }
    private fun capturedTaskTemplate(): String {
        taskTemplate?.let { return it }
        val request = JSONObject().put("projectId", fixture.project).put("title", "Задача команды как шаблон").put("sourceProjectId", fixture.project).put("sourceTaskId", task)
            .put("capture", JSONObject().put("anchorDate", "2026-10-20").put("calendarMode", "profane").put("calendarContext", definition().getJSONObject("calendarContext")))
        val edit = SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-save", null, request)
        val saved = fixture.base.service().save(fixture.project, null, edit); val pending = fixture.base.service().prepare(fixture.project, saved.getString("stamp"))
        val received = fixture.base.service().send(fixture.project, pending.getString("stamp")); val template = received.getJSONObject("receipt").getString("id")
        fixture.base.service().remove(fixture.project, received.getString("stamp")); taskTemplate = template; return template
    }
    @Composable private fun Content() { key(epoch, language) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalGenesisUserId provides fixture.actor, LocalSacredFeaturesEnabled provides true,
            LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                if (visible) SharedAutomationEditorScreen(fixture.gateway, fixture.project, rule, false, UiPreferences(), { visible = false }, { visible = false })
            } }
        }
    } }
    private fun open(restore: StateRestorationTester? = null) {
        if (restore == null) compose.setContent { Content() } else restore.setContent { Content() }
        await("automation-editor-title")
    }
    private fun await(tag: String) {
        compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("automation-editor-progress").fetchSemanticsNodes().isEmpty() }
    }
    private fun expand(tag: String) { compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag(tag))).performScrollTo().performClick() }
    private fun choice(tag: String, value: String) {
        compose.onNodeWithTag(tag).performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("$tag-$value").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("$tag-$value").performClick()
    }
    @Test fun createAndLostReplyRestoreThroughTouchWithoutDuplicatingTheRule() {
        fixture.loseReply = true; val restore = StateRestorationTester(compose); open(restore)
        compose.onNodeWithTag("automation-editor-title").performTextReplacement("Нативное правило команды")
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-retry"); assertEquals(1, fixture.editorSends)
        val pending = fixture.service().load(fixture.project)!!; val frozen = pending.getString("command")
        assertFalse(pending.getJSONObject("edit").getBoolean("enabled")); restore.emulateSavedInstanceStateRestore(); await("automation-editor-retry")
        assertEquals(frozen, fixture.service().load(fixture.project)!!.getString("command")); compose.onNodeWithTag("automation-editor-retry").performClick(); await("automation-editor-done")
        assertEquals(2, fixture.editorSends); assertEquals(fixture.sent[0], fixture.sent[1])
        val rules = fixture.base.client.sharedAutomations(fixture.base.generation, fixture.project, false, null).getJSONArray("rules")
        assertEquals(1, rules.length()); assertEquals("Нативное правило команды", rules.getJSONObject(0).getString("title"))
        val key = "automation-editor-v1:${fixture.actor.length}:${fixture.actor}:${fixture.project.length}:${fixture.project}"
        val ciphertext = fixture.base.app.getSharedPreferences("genesis.shared.automation-editor.v1", Context.MODE_PRIVATE).getString(key, null)!!
        assertFalse(ciphertext.contains("Нативное правило команды")); assertFalse(ciphertext.contains("operationId")); assertFalse(ciphertext.contains(fixture.sent[0]))
        assertNull(PlanningJournal(PlanningDraftStore(fixture.base.app, "automations"), contract = SharedAutomationJournalContract).load(fixture.actor, fixture.project))
        compose.onNodeWithTag("automation-editor-done").performClick(); compose.waitUntil(20_000) { !visible }; assertNull(fixture.service().load(fixture.project))
    }
    @Test fun aNativeDryRunDoesNotSaveARuleOrChangeTheTask() {
        seed(definition().put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 3))))
        val before = fixture.base.client.sharedTask(fixture.base.generation, fixture.project, task).getJSONObject("task")
        open(); expand("automation-editor-dry-run"); choice("automation-editor-preview-task", task)
        compose.onNodeWithTag("automation-editor-preview").performScrollTo().performClick(); await("automation-editor-preview-result")
        val after = fixture.base.client.sharedTask(fixture.base.generation, fixture.project, task).getJSONObject("task")
        assertEquals(before.getInt("revision"), after.getInt("revision")); assertEquals(0, after.getInt("priority")); assertEquals(0, fixture.editorSends); assertEquals(1, fixture.previews)
        assertEquals(0, fixture.base.client.sharedAutomations(fixture.base.generation, fixture.project, false, null).getJSONArray("rules").length())
    }
    @Test fun switchingToProjectScheduleKeepsIncompatibleTaskActionsUntilAnExplicitRepair() {
        open(); compose.onNodeWithTag("automation-editor-title").performTextReplacement("Project schedule")
        choice("automation-editor-trigger", "schedule"); choice("automation-editor-target", "project")
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-error")
        val saved = fixture.service().load(fixture.project)!!; assertEquals("editing", saved.getString("phase"))
        assertEquals("priority", saved.getJSONObject("edit").getJSONObject("definition").getJSONArray("actions").getJSONObject(0).getString("type"))
        assertEquals(0, fixture.editorSends)
        choice("automation-editor-action-0-type", "notify")
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-done"); assertEquals(1, fixture.editorSends)
    }
    @Test fun checkboxFalseAndNumberZeroAreSavedThroughTheExistingTypedControls() {
        val actions = JSONArray().put(JSONObject().put("type", "custom").put("fieldId", fields.getValue("checkbox")).put("value", JSONObject.NULL))
            .put(JSONObject().put("type", "custom").put("fieldId", fields.getValue("number")).put("value", JSONObject.NULL))
        seed(definition().put("actions", actions)); open()
        compose.onNodeWithTag("shared-custom-${fields.getValue("checkbox")}-false").performScrollTo().performClick()
        compose.onNodeWithTag("shared-custom-${fields.getValue("number")}").performScrollTo().performTextReplacement("0")
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-done")
        val wire = JSONObject(fixture.sent.single()).getJSONObject("definition").getJSONArray("actions")
        assertEquals(false, wire.getJSONObject(0).get("value")); assertEquals(0.0, wire.getJSONObject(1).getDouble("value"), 0.0)
    }
    @Test fun aWriteDowngradeHidesTheFormAndKeepsTheProtectedOwnDraft() {
        seed(); open(); val before = fixture.service().load(fixture.project)!!.toString()
        compose.runOnIdle { fixture.writable = false }; compose.onNodeWithTag("automation-editor-refresh").performClick(); await("automation-editor-error")
        compose.onNodeWithTag("automation-editor-title").assertDoesNotExist()
        compose.onNodeWithText("Доступ к проекту или редактированию правила изменился.", substring = true).assertExists()
        assertEquals(before, fixture.service().load(fixture.project)!!.toString()); assertEquals(0, fixture.editorSends)
    }
    @Test fun configuringATemplateOnlyPreviewsAndNeverCreatesTasksOrAnApplyCommand() {
        val template = capturedTaskTemplate()
        seed(definition().put("actions", JSONArray().put(JSONObject().put("type", "createTemplate").put("templateId", template).put("options", JSONObject()))))
        val before = fixture.base.client.querySharedTasks(fixture.base.generation, JSONObject().put("projectIds", JSONArray().put(fixture.project)), null).getInt("total")
        open(); compose.onNodeWithText("Задача команды как шаблон").assertExists()
        compose.onNodeWithTag("automation-editor-action-0-template-configure").performScrollTo().performClick(); await("template-apply-editor")
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("template-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("template-apply-anchor").assertDoesNotExist(); compose.onNodeWithTag("template-apply-destination").assertDoesNotExist()
        compose.onNodeWithTag("template-apply-title").performScrollTo().performTextReplacement("Собственное название")
        compose.onNodeWithTag("automation-template-done").performClick(); compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-done")
        assertEquals(before, fixture.base.client.querySharedTasks(fixture.base.generation, JSONObject().put("projectIds", JSONArray().put(fixture.project)), null).getInt("total"))
        assertEquals(0, fixture.templateSends); assertNull(fixture.base.service().load(fixture.project))
        val options = JSONObject(fixture.sent.single()).getJSONObject("definition").getJSONArray("actions").getJSONObject(0).getJSONObject("options")
        assertFalse(options.has("anchorDate")); assertEquals(fixture.project, options.getString("projectId")); assertEquals("Собственное название", options.getString("title"))
    }
    @Test fun loadedProjectIdentityAppearsAndClearsWhenAccessIsRevoked() {
        seed(); open()
        val projectTitle = snapshot.getJSONObject("project").getString("title")
        compose.waitUntil(30_000) { compose.onAllNodesWithText(projectTitle).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(projectTitle).assertIsDisplayed()
        compose.waitUntil(30_000) { compose.onAllNodes(hasTestTag("automation-editor-save") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.runOnIdle { fixture.forbidden = true }
        compose.onNodeWithTag("automation-editor-refresh").performClick()
        try { await("automation-editor-error") } catch (failure: Throwable) {
            val directory = File(fixture.base.app.filesDir, "automation-editor-diagnostics").apply { mkdirs() }
            val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(pipe).use { pixels -> File(directory, "access-failure.png").outputStream().use { pixels.copyTo(it) } }
            File(directory, "access-failure.txt").writeText(compose.onNodeWithTag("shared-automation-editor", useUnmergedTree = true).printToString())
            throw failure
        }
        compose.onNodeWithText(projectTitle).assertDoesNotExist()
        compose.onNodeWithTag("automation-editor-title").assertDoesNotExist()
        compose.onNodeWithTag("automation-editor-save").assertIsNotEnabled()
        for (tag in listOf("automation-editor-refresh", "automation-editor-copy", "automation-editor-as-new", "automation-editor-discard")) {
            compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).assertIsNotEnabled()
        }
        assertEquals(0, fixture.editorSends)
    }
    @Test fun nativeBackSavesPartialInputWithoutSendingARule() {
        open(); compose.onNodeWithTag("automation-editor-title").performTextReplacement("Сохранить после возврата")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()); device.pressBack()
        if (compose.onAllNodesWithTag("automation-editor-title").fetchSemanticsNodes().isNotEmpty()) device.pressBack()
        compose.waitUntil(20_000) { !visible }; assertEquals("Сохранить после возврата", fixture.service().load(fixture.project)!!.getJSONObject("edit").getString("title")); assertEquals(0, fixture.editorSends)
    }
    @Test fun invalidIntegerInputKeepsItsInlineExplanationAndRecoversAfterReopening() {
        seed(definition().put("trigger", JSONObject().put("type", "dueSoon").put("leadDays", 1).put("time", "09:00")))
        open(); compose.onNodeWithTag("automation-editor-lead-days").performScrollTo().performTextReplacement("-")
        compose.onNodeWithText("Целое число: от 1 до 366.").assertExists()
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-error")
        compose.mainClock.advanceTimeBy(750); compose.waitForIdle(); compose.onNodeWithTag("automation-editor-error").assertExists()
        compose.runOnIdle { epoch++ }; await("automation-editor-lead-days")
        compose.onNodeWithTag("automation-editor-lead-days").assertTextContains("-")
        assertEquals("-", fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("inputs").getString("trigger.leadDays"))
        compose.onNodeWithTag("automation-editor-lead-days").performScrollTo().performTextReplacement("2")
        compose.onNodeWithText("Целое число: от 1 до 366.").assertDoesNotExist()
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-done")
        assertEquals(2, JSONObject(fixture.sent.single()).getJSONObject("definition").getJSONObject("trigger").getInt("leadDays"))
    }
    @Test fun anEmptyTemplateCatalogExplainsWhereToCreateATaskTemplate() {
        fixture.emptyTemplateCatalog = true
        seed(); open(); choice("automation-editor-action-0-type", "createTemplate"); await("automation-editor-action-0-template-empty")
        compose.onNodeWithText("Создайте шаблон задачи в разделе «Шаблоны».").assertExists()
        compose.onNodeWithTag("automation-editor-action-0-template").assertIsNotEnabled()
        compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-error")
        assertEquals(0, fixture.editorSends); assertEquals("editing", fixture.service().load(fixture.project)!!.getString("phase"))
    }
    @Test fun captureNativeAutomationEditor() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisAutomationEditorCapture") == "true")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        if (args.getString("genesisLandscape") == "true") {
            device.setOrientationLeft()
            compose.waitUntil(10_000) { compose.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
        }
        language = args.getString("genesisLanguage", "ru"); dark = args.getString("genesisNight") == "true"
        val expectedWidth = args.getString("genesisWidth")?.toInt(); val expectedFont = args.getString("genesisFont")?.toFloat()
        if (expectedWidth != null) assertEquals(expectedWidth, compose.activity.resources.configuration.screenWidthDp)
        if (expectedFont != null) assertEquals(expectedFont, compose.activity.resources.configuration.fontScale, .005f)
        val compact = args.getString("genesisAutomationEditorCompact") == "true"
        val topOnly = args.getString("genesisAutomationEditorTopOnly") == "true"
        val template = if (compact || topOnly) null else capturedTaskTemplate()
        val directory = File(fixture.base.app.filesDir, "automation-editor-captures").apply { mkdirs() }
        for (name in listOf("top", "calendar", "schedule", "condition", "typed-action", "template", "pending", "received", "access", "ime-title", "ime-received")) File(directory, "$name.png").delete()
        File(directory, "keyboard-proof.json").delete(); File(directory, "metrics.json").delete()
        seed(); open()
        fun writeMetrics() {
            File(directory, "metrics.json").writeText(JSONObject().put("language", language).put("night", dark).put("densityDpi", compose.activity.resources.displayMetrics.densityDpi)
                .put("widthDp", compose.activity.resources.configuration.screenWidthDp).put("heightDp", compose.activity.resources.configuration.screenHeightDp)
                .put("fontScale", compose.activity.resources.configuration.fontScale.toDouble()).toString())
        }
        fun capture(name: String) {
            compose.mainClock.advanceTimeBy(250)
            compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle(1_500)
            // Native screencap reads the displayed frame, not the already-updated semantics tree.
            android.os.SystemClock.sleep(150)
            val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { pixels -> File(directory, "$name.png").outputStream().use { pixels.copyTo(it) } }
        }
        compose.waitUntil(30_000) { compose.onAllNodes(hasTestTag("automation-editor-save") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        try {
            compose.waitUntil(30_000) { compose.onAllNodesWithText(snapshot.getJSONObject("project").getString("title")).fetchSemanticsNodes().isNotEmpty() }
        } catch (failure: Throwable) {
            capture("ready-failure")
            File(directory, "ready-failure.txt").writeText("Expected project: ${snapshot.getJSONObject("project").getString("title")}\n" + compose.onNodeWithTag("shared-automation-editor", useUnmergedTree = true).printToString())
            throw failure
        }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("automation-editor-progress").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText(snapshot.getJSONObject("project").getString("title")).assertExists()
        capture("top")
        if (topOnly) { writeMetrics(); return }
        if (!compact) {
            expand("automation-editor-context"); compose.onNodeWithTag("automation-editor-zone").performScrollTo(); capture("calendar")
            compose.onNodeWithTag("automation-editor-trigger").performScrollTo(); choice("automation-editor-trigger", "schedule"); expand("automation-editor-schedule")
            compose.onNodeWithTag("automation-schedule-pattern").performScrollTo(); capture("schedule")
            expand("automation-editor-conditions"); compose.onNodeWithTag("automation-editor-condition-add").performScrollTo().performClick()
            compose.onNodeWithTag("automation-editor-condition-0-field").performScrollTo(); capture("condition")
        }
        compose.onNodeWithTag("automation-editor-action-0-type").performScrollTo(); choice("automation-editor-action-0-type", "custom")
        choice("automation-editor-action-0-custom", fields.getValue("checkbox")); compose.onNodeWithTag("shared-custom-${fields.getValue("checkbox")}-false").performScrollTo(); capture("typed-action")
        if (args.getString("genesisAutomationEditorKeyboard") == "true") {
            val keyboard = Settings.Secure.getString(fixture.base.app.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD).substringBefore('/')
            compose.onNodeWithTag("automation-editor-title").performScrollTo().performTouchInput { click() }
            assertTrue("The system keyboard must actually be visible", device.wait(Until.hasObject(By.pkg(keyboard)), 10_000))
            compose.onNodeWithTag("automation-editor-title").performTextReplacement("Правило с открытой клавиатурой")
            device.pressBack()
            assertTrue("Back must dismiss the keyboard first", device.wait(Until.gone(By.pkg(keyboard)), 10_000))
            compose.onNodeWithTag("automation-editor-title").assertExists(); assertTrue(visible); assertEquals(0, fixture.editorSends)
            compose.onNodeWithTag("automation-editor-title").performScrollTo()
            compose.waitForIdle()
            // A semantics click only requests focus on an already-focused TextField. Reopen IME through system touch.
            requireNotNull(device.wait(Until.findObject(By.text("Правило с открытой клавиатурой")), 10_000)).click()
            assertTrue("The system keyboard must reopen", device.wait(Until.hasObject(By.pkg(keyboard)), 10_000))
            try {
                compose.waitUntil(10_000) {
                    val input = compose.onNodeWithTag("automation-editor-title").fetchSemanticsNode()
                    input.boundsInWindow.height >= input.size.height - 1f
                }
            } finally { capture("ime-title") }
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
            val saveLabel = requireNotNull(device.wait(Until.findObject(By.text("Сохранить правило")), 10_000))
            val nativeSave = requireNotNull(generateSequence(saveLabel) { it.parent }.firstOrNull { it.isClickable })
            val imeWindow = requireNotNull(automation.windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD })
            val imeBounds = Rect().also(imeWindow::getBoundsInScreen); val saveBounds = nativeSave.visibleBounds
            val titleInput = compose.onNodeWithTag("automation-editor-title").fetchSemanticsNode()
            val titleBounds = titleInput.boundsInWindow
            val proof = JSONObject().put("imeWindow", imeBounds.toShortString()).put("saveBounds", saveBounds.toShortString())
                .put("saveHeight", saveBounds.height()).put("saveClickable", nativeSave.isClickable)
                .put("inputBounds", titleBounds.toString()).put("inputHeight", titleBounds.height.toDouble()).put("inputFullHeight", titleInput.size.height)
                .put("density", compose.activity.resources.displayMetrics.density.toDouble()).put("systemTap", false)
            File(directory, "keyboard-proof.json").writeText(proof.toString())
            assertTrue("The system IME must not cover the save action", !saveBounds.isEmpty && saveBounds.bottom <= imeBounds.top)
            assertTrue("The focused input must remain fully visible above the save action", titleBounds.height >= titleInput.size.height - 1f && titleBounds.bottom <= saveBounds.top)
            assertTrue("The save action must retain its full48dp touch target above the system IME", saveBounds.height() >= 48f * compose.activity.resources.displayMetrics.density - 1f)
            nativeSave.click(); await("automation-editor-done")
            assertEquals(1, fixture.editorSends)
            assertEquals("Правило с открытой клавиатурой", JSONObject(fixture.sent.single()).getString("title"))
            capture("ime-received")
            File(directory, "keyboard-proof.json").writeText(proof.put("systemTap", true).toString())
        }
        if (!compact) {
            choice("automation-editor-action-0-type", "createTemplate")
            compose.waitUntil(30_000) { compose.onAllNodes(hasTestTag("automation-editor-action-0-template") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            choice("automation-editor-action-0-template", requireNotNull(template))
            compose.onNodeWithTag("automation-editor-action-0-template-configure").performScrollTo().performClick(); await("template-apply-editor")
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("template-preview").fetchSemanticsNodes().isNotEmpty() }
            capture("template")
            if (args.getString("genesisAutomationEditorStates") == "true") {
                compose.onNodeWithTag("automation-template-done").performClick(); fixture.loseReply = true
                compose.onNodeWithTag("automation-editor-save").performClick(); await("automation-editor-retry"); capture("pending")
                compose.onNodeWithTag("automation-editor-retry").performClick(); await("automation-editor-done"); capture("received")
                compose.runOnIdle { fixture.writable = false; epoch++ }; await("automation-editor-error"); capture("access")
            }
        }
        writeMetrics()
    }
}
