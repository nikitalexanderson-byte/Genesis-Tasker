package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.res.Configuration
import android.graphics.Rect
import android.provider.Settings
import android.view.accessibility.AccessibilityWindowInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.io.File
import java.util.UUID
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

/** Real Compose dialogs, native TLS and encrypted drafts; opt-in isolated application only. */
class SharedTemplatesUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = TemplateHttpsFixture()
    private lateinit var snapshot: JSONObject
    private var language by mutableStateOf("ru")
    private var dark by mutableStateOf(false)
    private var epoch by mutableIntStateOf(0)
    private var visible by mutableStateOf(true)
    private var loseReply = false
    @Volatile private var templateSendCalls = 0
    private var captureTask: JSONObject? = null
    private var writeAllowed by mutableStateOf(true)
    private var parentScreen = false
    @Volatile private var readRevoked = false
    @Volatile private var traceDependencySaves = false
    private val dependencySaveSequence = AtomicInteger()
    private val dependencySaveEvents = Collections.synchronizedList(mutableListOf<JSONObject>())
    private val dependencyDiagnosticErrors = Collections.synchronizedList(mutableListOf<Throwable>())
    private fun dependencySaveEvent(sequence: Int, stage: String, edit: JSONObject, result: String? = null) {
        runCatching {
            val main = edit.optJSONObject("request")?.optJSONObject("manifest")?.optJSONArray("tasks")?.let { rows ->
                PlanningLifecycle.rows(rows).firstOrNull { it.optString("key") == "main" }
            }
            dependencySaveEvents.add(JSONObject().put("sequence", sequence).put("stage", stage).put("atNanos", System.nanoTime())
                .put("mainPresent", main != null).put("dependencies", main?.optJSONArray("dependsOnKeys")?.let { JSONArray(it.toString()) } ?: JSONObject.NULL)
                .put("result", result ?: JSONObject.NULL))
        }.onFailure { dependencyDiagnosticErrors.add(it) }
    }
    @Before fun open() { fixture.open(); snapshot = fixture.client.sharedProject(fixture.generation, fixture.project) }
    @After fun close() {
        try { fixture.close() } finally {
            if (InstrumentationRegistry.getArguments().getString("genesisTemplateLandscape") == "true") UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).unfreezeRotation()
        }
    }
    private fun screen(file: File) {
        compose.waitForIdle()
        val automaticClock = compose.mainClock.autoAdvance
        compose.mainClock.autoAdvance = false
        try {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle(1_500)
            // API28 UiAutomation crops a wm override; screencap keeps the whole physical display.
            val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(pipe).use { pixels -> file.outputStream().use { pixels.copyTo(it) } }
            assertTrue(file.length() > 0)
        } finally { compose.mainClock.autoAdvance = automaticClock }
    }
    @Composable private fun Content() {
        val gateway = remember(epoch) { object : SharedWorkspaceGateway by fixture.gateway {
            override suspend fun sharedProject(projectId: String): JSONObject {
                if (readRevoked) throw AuthApiError("SHARED_PROJECT_FORBIDDEN")
                return fixture.gateway.sharedProject(projectId)
            }
            override suspend fun sharedSpaces() = withContext(Dispatchers.IO) { fixture.client.sharedSpaces(fixture.generation) }
            override suspend fun sharedProjects(spaceId: String) = withContext(Dispatchers.IO) { fixture.client.sharedProjects(fixture.generation, spaceId) }
            override suspend fun archivedSharedProjects(spaceId: String) = withContext(Dispatchers.IO) { fixture.client.archivedSharedProjects(fixture.generation, spaceId) }
            override suspend fun sharedInvitations() = JSONObject().put("invitations", JSONArray())
            override suspend fun sharedSpaceUi(spaceId: String) = JSONObject().put("expandedIds", JSONArray())
            override suspend fun saveSharedSpaceUi(spaceId: String, ids: List<String>) = JSONObject().put("expandedIds", JSONArray(ids))
            override suspend fun flushSharedOfflineTasks() = 0
            override suspend fun queuedSharedTasks(projectId: String) = emptyList<JSONObject>()
            override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = withContext(Dispatchers.IO) { fixture.client.querySharedTasks(fixture.generation, filter, cursor) }
            override suspend fun saveSharedTemplateDraft(project: String, stamp: String?, edit: JSONObject): JSONObject {
                if (!traceDependencySaves) return fixture.gateway.saveSharedTemplateDraft(project, stamp, edit)
                val sequence = dependencySaveSequence.incrementAndGet()
                dependencySaveEvent(sequence, "started", edit)
                try {
                    return fixture.gateway.saveSharedTemplateDraft(project, stamp, edit).also { saved ->
                        runCatching { dependencySaveEvent(sequence, "returned", saved.getJSONObject("edit"), saved.optString("phase")) }
                            .onFailure { dependencyDiagnosticErrors.add(it) }
                    }
                } catch (failure: Throwable) {
                    dependencySaveEvent(sequence, "failed", edit, failure.toString()); throw failure
                }
            }
            override suspend fun sendSharedTemplateDraft(project: String, stamp: String): JSONObject = withContext(Dispatchers.IO) {
                templateSendCalls++
                fixture.service { loseReply.also { loseReply = false } }.send(project, stamp)
            }
        } }
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalGenesisUserId provides fixture.actor, LocalSacredFeaturesEnabled provides true) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                if (parentScreen) SharedProjectsScreen(gateway, language, SharedInvitationDestination(fixture.space, fixture.project))
                else if (visible) SharedTemplatesScreen(gateway, fixture.space, fixture.project, snapshot.getJSONObject("project").getString("title"),
                    listOf(snapshot.getJSONObject("project")), PlanningLifecycle.rows(snapshot.getJSONArray("members")), UiPreferences(), writeAllowed, true,
                    captureTask, { visible = false }, {}, { _, _ -> visible = false })
            } }
        }
    }
    private fun await(tag: String) {
        try {
            compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("template-progress").fetchSemanticsNodes().isEmpty() }
            if (tag == "template-library") compose.waitUntil(30_000) {
                listOf("template-title", "template-preview", "template-received", "template-source-copy").all { compose.onAllNodesWithTag(it).fetchSemanticsNodes().isEmpty() }
            }
        } catch (failure: Throwable) {
            println("Template UI awaiting $tag: " + runCatching { compose.onNodeWithTag("shared-templates-screen", useUnmergedTree = true).printToString() }.getOrDefault("Template dialog is absent"))
            screen(File(fixture.app.filesDir, "template-failure-$tag.png"))
            throw failure
        }
    }
    private fun click(tag: String) {
        if (tag == "template-submit") compose.waitUntil(10_000) {
            compose.onAllNodesWithTag(tag).fetchSemanticsNodes().singleOrNull()?.config?.contains(SemanticsProperties.Disabled) == false
        }
        val node = compose.onNodeWithTag(tag); runCatching { node.performScrollTo() }; node.assertIsDisplayed().performTouchInput { click() }; compose.waitForIdle()
    }
    private fun source() { click("template-source-system:publication"); await("template-source-copy") }
    private fun actionRow(vararg tags: String) {
        val bounds = tags.map { tag -> compose.onNodeWithTag(tag).assertIsDisplayed().fetchSemanticsNode().boundsInRoot }
        bounds.zipWithNext().forEach { (left, right) ->
            assertEquals(left.top, right.top, 1f); assertEquals(left.width, right.width, 1f)
            assertTrue("Native actions overlap", left.right < right.left)
        }
    }
    private fun discard() { click("template-discard"); click("template-discard-confirm"); await("template-library") }
    private fun savedManifest() = fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getJSONObject("manifest")
    private fun fixCapture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("genesisTemplateFixCapture") == "true") {
            screen(File(fixture.app.filesDir, "template-fix-${if (dark) "dark" else "light"}-$name.png"))
        }
    }
    private fun assertNamedToggle(tag: String, name: String, role: Role) {
        val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
        assertEquals(listOf(name), node.config[SemanticsProperties.ContentDescription])
        assertEquals(role, node.config[SemanticsProperties.Role]); assertTrue(node.config.contains(SemanticsActions.OnClick))
        fun childActions(value: androidx.compose.ui.semantics.SemanticsNode): Int = value.children.sumOf { (if (it.config.contains(SemanticsActions.OnClick)) 1 else 0) + childActions(it) }
        assertEquals("A labeled row must have only one toggle action", 0, childActions(node))
    }
    @Test fun allCompletedStatusesBlockAddingUntilTheUserRepairsTheProjectWithoutLosingInput() {
        compose.setContent { Content() }; await("template-library")
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }; source(); click("template-source-copy"); await("template-title")
            compose.onNodeWithTag("template-title").performTextReplacement("Protected status recovery")
            click("template-tab-projects"); compose.onNodeWithText("Статусы", substring = false).performScrollTo().performTouchInput { click() }
            compose.waitUntil(10_000) { fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getString("title") == "Protected status recovery" }
            val statuses = SharedTemplateEdits.rows(savedManifest().getJSONArray("projects").getJSONObject(0).getJSONArray("statuses"))
            for (status in statuses.filter { !it.getBoolean("isDone") }) click("template-status-done-${status.getString("key")}")
            click("template-tab-tasks")
            for (tag in listOf("template-task-add", "template-subtask-add"))
                compose.onAllNodes(hasAnyAncestor(hasTestTag(tag)) and hasClickAction(), useUnmergedTree = true).onFirst().assertIsNotEnabled()
            val count = savedManifest().getJSONArray("tasks").length()
            compose.onNodeWithTag("template-task-add").performTouchInput { click() }
            compose.onNodeWithTag("template-subtask-add").performTouchInput { click() }
            compose.onNodeWithTag("template-open-status-needed").performScrollTo().assertIsDisplayed(); fixCapture("open-status")
            assertEquals(count, savedManifest().getJSONArray("tasks").length())
            click("template-tab-projects"); compose.onNodeWithText("Статусы", substring = false).performScrollTo().performTouchInput { click() }
            click("template-status-done-${statuses.first().getString("key")}")
            click("template-tab-tasks"); click("template-task-add"); click("template-subtask-add")
            compose.waitUntil(10_000) { savedManifest().getJSONArray("tasks").length() == count + 2 }
            assertEquals("Protected status recovery", fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getString("title"))
            discard()
        }
    }
    @Test fun aFiftyFirstDependencyHasANameAndCannotDiscardTheProtectedGraph() {
        traceDependencySaves = true
        val manifest = JSONObject(fixture.source("system:publication").getJSONObject("manifest").toString())
        val root = manifest.getJSONArray("projects").getJSONObject(0); val project = root.getString("key")
        val status = root.getJSONArray("statuses").getJSONObject(0).getString("key")
        val primary = SharedTemplateManifest.newTask("main", project, status, "Protected dependency task")
            .put("dependsOnKeys", JSONArray((1..50).map { "dep:$it" }))
        manifest.put("tasks", JSONArray().put(primary).apply { for (index in 1..51) put(SharedTemplateManifest.newTask("dep:$index", project, status, "Dependency $index")) })
        val edit = SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-save", null,
            JSONObject().put("projectId", fixture.project).put("title", "Protected dependency graph").put("manifest", manifest))
        fixture.service().save(fixture.project, null, edit)
        compose.setContent { Content() }; await("template-title")
        compose.onNodeWithText("Связи и исполнители").performScrollTo().performTouchInput { click() }
        compose.onNodeWithText("Зависимости", substring = false).performScrollTo().performTouchInput { click() }
        repeat(10) { click("template-task-dependencies-more") }
        val extra = "template-task-dependencies-choice-dep:51"
        compose.onNodeWithTag(extra).performScrollTo().assertIsNotEnabled()
        assertNamedToggle(extra, "Dependency 51", Role.Checkbox)
        compose.onNodeWithTag(extra).performTouchInput { click() }
        assertEquals(50, savedManifest().getJSONArray("tasks").getJSONObject(0).getJSONArray("dependsOnKeys").length())
        compose.onNodeWithTag("template-dependency-limit").performScrollTo(); fixCapture("dependency-limit")
        click("template-task-dependencies-choice-dep:1")
        compose.onNodeWithTag("template-task-dependencies-choice-dep:1").assertIsOff()
        compose.onNodeWithTag(extra).assertIsEnabled(); click(extra); compose.onNodeWithTag(extra).assertIsOn()
        compose.mainClock.advanceTimeBy(500); compose.waitForIdle()
        try { compose.waitUntil(30_000) { savedManifest().getJSONArray("tasks").getJSONObject(0).getJSONArray("dependsOnKeys").toString().contains("dep:51") } }
        catch (failure: Throwable) {
            fun diagnostic(action: () -> Unit) {
                try { action() } catch (diagnosticFailure: Throwable) { failure.addSuppressed(diagnosticFailure) }
            }
            synchronized(dependencyDiagnosticErrors) { dependencyDiagnosticErrors.forEach { failure.addSuppressed(it) } }
            diagnostic {
                val record = fixture.service().load(fixture.project)
                val main = record?.optJSONObject("edit")?.optJSONObject("request")?.optJSONObject("manifest")?.optJSONArray("tasks")?.let { rows ->
                    PlanningLifecycle.rows(rows).firstOrNull { it.optString("key") == "main" }
                }
                val proof = JSONObject().put("ownedProjectId", fixture.project).put("ownedTaskKey", "main")
                    .put("failure", failure.stackTraceToString()).put("draftPhase", record?.optString("phase") ?: "none")
                    .put("savedDependencies", main?.optJSONArray("dependsOnKeys") ?: JSONObject.NULL)
                    .put("saveEvents", JSONArray(synchronized(dependencySaveEvents) { dependencySaveEvents.toList() }))
                File(fixture.app.filesDir, "template-failure-dependency-save.json").writeText(proof.toString(2))
            }
            diagnostic { captureNativeWindow(File(fixture.app.filesDir, "template-failure-dependency-save.png")) }
            throw failure
        }
        for (night in listOf(false, true)) { compose.runOnIdle { dark = night }; compose.onNodeWithTag("template-dependency-limit").performScrollTo(); fixCapture("dependency-limit") }
        assertEquals("Protected dependency graph", fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getString("title"))
    }
    @Test fun localizedTransferSwitchesHaveDistinctNamesAndOneAction() {
        compose.runOnIdle { language = "en" }; compose.setContent { Content() }; await("template-library")
        source(); click("template-apply-open"); await("template-preview")
        for ((flag, name) in listOf("tags" to "Text tags", "labels" to "Workspace labels")) {
            val tag = "template-transfer-$flag"; compose.onNodeWithTag(tag).performScrollTo()
            assertNamedToggle(tag, name, Role.Switch); compose.onNodeWithTag(tag).assertIsOn()
            click(tag); compose.onNodeWithTag(tag).assertIsOff()
        }
    }
    @Test fun aLiveWriteDowngradeHidesTheEditorAndKeepsTheAttemptedCommandEncrypted() {
        compose.setContent { Content() }; await("template-library"); source(); click("template-apply-open"); await("template-preview")
        loseReply = true; click("template-submit"); await("template-retry")
        val before = fixture.service().load(fixture.project)!!.toString()
        compose.runOnIdle { writeAllowed = false }; await("template-access-lost")
        compose.onNodeWithTag("template-error").assertTextContains("Доступ к проекту или шаблону изменился.", substring = true)
            .assertTextContains("Когда доступ восстановится", substring = true).assertTextContains("в том же аккаунте", substring = true)
        compose.onAllNodesWithText("Проверьте структуру, сроки и связи шаблона.").assertCountEquals(0)
        compose.onNodeWithTag("template-retry").assertDoesNotExist(); compose.onNodeWithTag("template-preview").assertDoesNotExist()
        assertEquals(before, fixture.service().load(fixture.project)!!.toString())
        for (night in listOf(false, true)) { compose.runOnIdle { dark = night }; fixCapture("write-denied") }
        compose.runOnIdle { writeAllowed = true; epoch++ }; await("template-retry")
        assertEquals(before, fixture.service().load(fixture.project)!!.toString()); click("template-retry"); await("template-received")
    }
    @Test fun aParentPollingReadDenialClosesAnOpenTemplateAndPreservesTheProtectedDraft() {
        parentScreen = true; compose.setContent { Content() }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("shared-boards").fetchSemanticsNodes().isNotEmpty() }
        click("shared-work-actions"); click("shared-templates-open"); await("template-library")
        source(); click("template-source-copy"); await("template-title")
        compose.onNodeWithTag("template-title").performTextReplacement("Protected parent denial")
        compose.waitUntil(10_000) { fixture.service().load(fixture.project)?.getJSONObject("edit")?.getJSONObject("request")?.optString("title") == "Protected parent denial" }
        val protected = fixture.service().load(fixture.project)!!.toString(); readRevoked = true
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("shared-templates-screen").fetchSemanticsNodes().isEmpty() }
        assertEquals(protected, fixture.service().load(fixture.project)!!.toString())
        compose.onNodeWithTag("template-source-copy").assertDoesNotExist(); compose.onNodeWithTag("template-submit").assertDoesNotExist()
        compose.onNodeWithTag("shared-feedback").assertTextContains("Сохранённые черновики и неподтверждённые запросы", substring = true)
            .assertTextContains("Когда доступ восстановится", substring = true).assertTextContains("в том же аккаунте", substring = true)
        compose.onAllNodesWithText("SHARED_PROJECT_FORBIDDEN").assertCountEquals(0)
        for (night in listOf(false, true)) { compose.runOnIdle { dark = night }; fixCapture("parent-read-denied") }
        readRevoked = false
    }
    @Test fun taskCaptureOpensTheFormAndRecreationKeepsEncryptedInputAndSystemBack() {
        val status = snapshot.getJSONArray("statuses").getJSONObject(0).getString("id")
        captureTask = fixture.client.createSharedTask(fixture.generation, fixture.project, JSONObject().put("requestId", UUID.randomUUID().toString()).put("title", "Native capture source").put("statusId", status)).getJSONObject("task")
        val restoration = StateRestorationTester(compose); restoration.setContent { Content() }; await("template-title")
        val title = "Protected native input ${UUID.randomUUID()}"
        compose.onNodeWithTag("template-title").performTextReplacement(title)
        compose.waitUntil(30_000) { fixture.service().load(fixture.project)?.getJSONObject("edit")?.getJSONObject("request")?.optString("title") == title }
        assertTrue(fixture.app.getSharedPreferences("genesis.shared.templates.v1", 0).all.values.none { it.toString().contains(title) })
        restoration.emulateSavedInstanceStateRestore(); await("template-title"); compose.onNodeWithTag("template-title").assertTextContains(title)
        click("template-back"); compose.onNodeWithTag("template-title").assertDoesNotExist(); assertNotNull(fixture.service().load(fixture.project))
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack(); compose.waitUntil(5_000) { !visible }
    }
    @Test fun nativeCopyEditsAndSavesThroughTheBottomAction() {
        compose.setContent { Content() }; await("template-library")
        actionRow("template-capture", "template-new-task", "template-new-project", "template-library-refresh")
        source(); click("template-source-copy"); await("template-title")
        actionRow("template-tab-projects", "template-tab-tasks", "template-tab-fields")
        compose.onNodeWithTag("template-title").performTextReplacement("Native UI copy")
        click("template-submit"); await("template-received")
        val receipt = fixture.service().load(fixture.project)!!.getJSONObject("receipt")
        assertEquals("Native UI copy", fixture.source(receipt.getString("id")).getString("title"))
        click("template-done"); await("template-library"); assertNull(fixture.service().load(fixture.project))
    }
    @Test fun uncertainApplyCanRetryTheExactCommandFromTheVisibleButton() {
        compose.setContent { Content() }; await("template-library"); source(); click("template-apply-open"); await("template-preview")
        loseReply = true; click("template-submit"); await("template-retry")
        val uncertain = fixture.service().load(fixture.project)!!; assertEquals("pending", uncertain.getString("phase")); assertEquals(1, uncertain.getInt("attempts"))
        val command = uncertain.getString("command"); click("template-retry"); await("template-received")
        val received = fixture.service().load(fixture.project)!!; assertEquals("received", received.getString("phase")); assertEquals(command, received.getString("command")); assertEquals(2, received.getInt("attempts"))
    }
    @Test fun changingAFieldTypeKeepsValuesUntilTheUserConfirms() {
        val manifest = JSONObject(fixture.source("system:publication").getJSONObject("manifest").toString())
        val field = "native-field"
        manifest.getJSONArray("fields").put(JSONObject().put("key", field).put("projectKey", JSONObject.NULL)
            .put("title", "Native number").put("type", "number").put("options", JSONArray()).put("required", false)
            .put("showCard", true).put("showList", true).put("position", 0))
        manifest.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues").put(field, 0)
        val request = JSONObject().put("projectId", fixture.project).put("title", "Native field confirmation").put("manifest", manifest)
        val saved = fixture.client.sharedTemplateCommand(fixture.generation, SharedTemplateProtocol.command(
            SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-save", null, request), UUID.randomUUID().toString()))
        compose.setContent { Content() }; await("template-library"); click("template-source-${saved.getString("id")}"); await("template-source-edit")
        click("template-source-edit"); await("template-title"); click("template-tab-fields"); click("template-field-type"); click("template-field-type-text")
        click("template-field-type-cancel")
        assertEquals(0, fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getJSONObject("manifest")
            .getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues").getInt(field))
        click("template-field-type"); click("template-field-type-text"); click("template-field-type-confirm")
        compose.waitUntil(10_000) { fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getJSONObject("manifest")
            .getJSONArray("fields").getJSONObject(0).getString("type") == "text" }
        assertFalse(fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("request").getJSONObject("manifest")
            .getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues").has(field))
    }
    @Test fun thePrimaryActionRemainsReachableWithTheKeyboardOpen() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisTemplateKeyboard") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        if (args.getString("genesisTemplateLandscape") == "true") {
            device.setOrientationLeft()
            compose.waitUntil(10_000) { compose.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
        }
        dark = args.getString("genesisTemplateNight") == "true"
        args.getString("genesisTemplateFontScale")?.toFloat()?.let { assertEquals(it, compose.activity.resources.configuration.fontScale, .005f) }
        val directory = File(fixture.app.filesDir, "template-system-ime").apply { mkdirs() }
        for (name in listOf("copy-ime.png", "copy-received.png", "copy-proof.json", "apply-ime.png", "apply-received.png", "apply-proof.json")) File(directory, name).delete()
        val config = compose.activity.resources.configuration
        File(directory, "metrics.json").writeText(JSONObject().put("widthDp", config.screenWidthDp).put("heightDp", config.screenHeightDp)
            .put("fontScale", config.fontScale.toDouble()).put("night", dark).put("densityDpi", compose.activity.resources.displayMetrics.densityDpi).toString())
        val keyboard = Settings.Secure.getString(fixture.app.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD).substringBefore('/')
        val automation = instrumentation.uiAutomation
        automation.serviceInfo = automation.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        fun saveWithSystemKeyboard(flow: String, tag: String, text: String, label: String, review: Boolean = false) {
            val proof = JSONObject().put("flow", flow).put("systemTap", false).put("density", compose.activity.resources.displayMetrics.density.toDouble())
            try {
            click(tag); assertTrue("Keyboard must actually be visible", device.wait(Until.hasObject(By.pkg(keyboard)), 10_000))
            compose.onNodeWithTag(tag).performTextReplacement(text)
            device.pressBack(); assertTrue("Back must dismiss the IME before the form", device.wait(Until.gone(By.pkg(keyboard)), 10_000))
            compose.onNodeWithTag(tag).assertExists(); assertTrue(visible)
            if (review) { click("template-review"); await("template-preview") }
            compose.onNodeWithTag(tag).assertTextContains(text)
            compose.onNodeWithTag(tag).performScrollTo(); compose.waitForIdle()
            val inputBounds = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInWindow
            assertTrue("The field must be visible before the system touch", inputBounds.width > 0 && inputBounds.height > 0)
            device.click(inputBounds.center.x.toInt(), inputBounds.center.y.toInt())
            assertTrue("System touch must reopen the IME", device.wait(Until.hasObject(By.pkg(keyboard)), 10_000))
            compose.waitForIdle(); device.waitForIdle(1_500)
                val nativeLabel = requireNotNull(device.wait(Until.findObject(By.text(label)), 10_000)) { "Native submit label must be reachable" }
                val submit = requireNotNull(generateSequence(nativeLabel) { it.parent }.firstOrNull { it.isClickable })
                val ime = requireNotNull(automation.windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD })
                val imeBounds = Rect().also(ime::getBoundsInScreen); val saveBounds = submit.visibleBounds
                val field = compose.onNodeWithTag(tag).fetchSemanticsNode(); val fieldBounds = field.boundsInWindow
                proof.put("imeWindow", imeBounds.toShortString()).put("saveBounds", saveBounds.toShortString())
                    .put("saveHeight", saveBounds.height()).put("saveClickable", submit.isClickable).put("saveEnabled", submit.isEnabled)
                    .put("inputBounds", fieldBounds.toString()).put("inputHeight", fieldBounds.height.toDouble()).put("inputFullHeight", field.size.height)
                File(directory, "$flow-proof.json").writeText(proof.toString())
                screen(File(directory, "$flow-ime.png"))
                assertTrue("The real system IME must not cover Submit", !saveBounds.isEmpty && saveBounds.bottom <= imeBounds.top)
                assertTrue("Submit must retain its whole48dp native touch target", saveBounds.height() >= 48f * compose.activity.resources.displayMetrics.density - 1f)
                assertTrue("The entire focused field must remain visible above Submit", fieldBounds.height >= field.size.height - 1f && fieldBounds.bottom <= saveBounds.top)
                assertTrue("Preview must be current before submitting", submit.isEnabled)
                val previousCalls = templateSendCalls
                submit.click(); await("template-received")
                assertEquals(previousCalls + 1, templateSendCalls)
                assertEquals("received", fixture.service().load(fixture.project)!!.getString("phase"))
                screen(File(directory, "$flow-received.png"))
                File(directory, "$flow-proof.json").writeText(proof.put("systemTap", true).put("sendCalls", templateSendCalls).put("phase", "received").toString())
            } catch (failure: Throwable) {
                screen(File(directory, "$flow-ime.png"))
                proof.put("failure", failure.javaClass.simpleName).put("savedTitle", runCatching {
                    fixture.service().load(fixture.project)?.getJSONObject("edit")?.getJSONObject("request")?.optString("title")
                }.getOrNull())
                File(directory, "$flow-proof.json").writeText(proof.toString())
                File(directory, "$flow-semantics.txt").writeText(compose.onNodeWithTag("shared-templates-screen", useUnmergedTree = true).printToString())
                throw failure
            }
        }
        compose.setContent { Content() }; await("template-library")
        val only = args.getString("genesisTemplateKeyboardFlow")
        if (only != "apply") {
            source(); click("template-source-copy"); await("template-title")
            saveWithSystemKeyboard("copy", "template-title", "Шаблон с открытой клавиатурой", "Сохранить шаблон")
            if (device.hasObject(By.pkg(keyboard))) device.pressBack()
            click("template-done"); await("template-library")
        }
        if (only != "copy") {
            source(); click("template-apply-open"); await("template-preview")
            saveWithSystemKeyboard("apply", "template-apply-title", "Задача с открытой клавиатурой", "Создать из шаблона", review = true)
        }
    }
    @Test fun captureActualNativeTemplateForms() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisTemplateCapture") == "true")
        val all = args.getString("genesisTemplateLanguages") == "true"
        val width = requireNotNull(args.getString("genesisTemplateWidth")).toFloat()
        val font = args.getString("genesisTemplateFontScale")?.toFloat() ?: 1f
        val landscape = args.getString("genesisTemplateLandscape") == "true"
        val locales = if (all) SharedTemplateProtocol.languages.toList() else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        if (landscape) device.setOrientationLeft()
        compose.setContent { Content() }; await("template-library")
        if (landscape) assertEquals(android.content.res.Configuration.ORIENTATION_LANDSCAPE, compose.activity.resources.configuration.orientation)
        fun capture(state: String) {
            compose.waitForIdle(); val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("template-heading").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
            val density = layouts.single().layoutInput.density
            val actual = compose.onNodeWithTag("shared-templates-screen").fetchSemanticsNode().boundsInRoot.width / density.density
            if (landscape) assertTrue("Dialog exceeds the landscape safe area", actual in (minOf(width, 1120f) - 96f)..(minOf(width, 1120f) - 24f))
            else assertEquals(minOf(width, 1120f) - 24f, actual, 1f)
            assertEquals(font, density.fontScale, .01f)
            if (state == "editor") compose.onNodeWithTag("template-title").assertIsDisplayed()
            if (state == "source") compose.onNodeWithTag("template-source-copy").assertIsDisplayed()
            val file = File(fixture.app.filesDir, "template-${if (all) "font130-" else ""}${width.toInt()}-${if (dark) "dark" else "light"}-$language-$state.png")
            screen(file); println("QA template width=$width dialog=$actual density=${density.density} font=${density.fontScale} language=$language state=$state")
        }
        for (locale in locales) for (night in listOf(false, true)) {
            compose.runOnIdle { language = locale; dark = night; epoch++ }; await("template-library")
            if (!all) capture("library")
            source(); if (!all) capture("source"); click("template-source-copy"); await("template-title"); capture("editor"); discard()
            source(); click("template-apply-open"); await("template-preview"); capture("apply"); discard()
        }
    }
}
