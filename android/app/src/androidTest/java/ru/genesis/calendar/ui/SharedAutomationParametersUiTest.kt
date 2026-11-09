package ru.genesis.calendar.ui

import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
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

/** Real source/preview/Keystore and management transport, without applying a template. */
class SharedAutomationParametersUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = AutomationEditorHttpsFixture()
    private var dark by mutableStateOf(false)
    private var language by mutableStateOf("ru")
    private var epoch by mutableIntStateOf(0)
    private lateinit var rule: String
    private var captureCase = "functional"
    @Before fun setup() {
        fixture.open()
        val options = SharedAutomationEditorProtocol.templateOptions(fixture.space, fixture.project,
            JSONObject().put("title", "Сохранённое название команды").put("include", JSONObject().put("assignees", false)))
        val definition = SharedAutomationEditorEdits.initial(SharedCustomCalendar.initial(UiPreferences()))
            .put("actions", JSONArray().put(JSONObject().put("type", "createTemplate").put("templateId", "system:publication").put("options", options)))
        val response = fixture.base.client.saveSharedAutomation(fixture.base.generation, fixture.project, null,
            JSONObject().put("operationId", UUID.randomUUID().toString()).put("title", "Правило с сохранёнными параметрами")
                .put("enabled", false).put("ownerId", fixture.actor).put("definition", definition))
        rule = response.getJSONObject("rule").getString("id")
        val preflight = SharedAutomationsState(fixture.gateway, fixture.project, "ru", "", false, { _, _ -> }, {}, {})
        runBlocking { preflight.load(); preflight.choose(rule) }
        try { check(preflight.error.isEmpty()) { "C2 fixture preflight: ${preflight.error}" } }
        finally { preflight.close() }
    }
    @After fun cleanup() {
        try {
            runCatching { File(fixture.base.app.filesDir, "automation-parameters-semantics.txt").writeText(compose.onNodeWithTag("shared-automations-screen", useUnmergedTree = true).printToString()) }
            runCatching { screenshot("last-state") }
        } finally { fixture.close() }
    }
    @Composable private fun Content() { key(epoch, language) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalGenesisUserId provides fixture.actor,
            LocalSacredFeaturesEnabled provides true, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize().testTag("parameters-case-$epoch-$language-$dark")) {
                SharedAutomationsScreen(fixture.gateway, fixture.project, {}, {}, {}, {}, UiPreferences())
            } }
        }
    } }
    private fun await(tag: String) {
        try { compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() } }
        catch (failure: Throwable) {
            File(fixture.base.app.filesDir, "automation-parameters-await.txt").writeText("$captureCase: $tag\n" + compose.onAllNodes(isRoot()).printToString())
            throw failure
        }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("automation-working").fetchSemanticsNodes().isEmpty() }
    }
    private fun click(tag: String) {
        val node = compose.onNodeWithTag(tag)
        if (tag !in setOf("automation-confirm-command", "automation-retry-command", "automation-done")) node.performScrollTo()
        node.performClick()
    }
    private fun expand(tag: String) = compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag(tag))).performScrollTo().performClick()
    private fun choose() { await("automation-rule-$rule"); click("automation-rule-$rule"); await("automation-enabled") }
    private fun parameters() { expand("automation-actions"); await("automation-template-parameters-0"); expand("automation-template-parameters-0"); await("template-apply-title") }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
        val pixels = ParcelFileDescriptor.AutoCloseInputStream(pipe).use { it.readBytes() }
        val image = requireNotNull(BitmapFactory.decodeByteArray(pixels, 0, pixels.size))
        try {
            File(fixture.base.app.filesDir, "automation-parameters-$name.png").writeBytes(pixels)
            val root = compose.onNodeWithTag("shared-automations-screen").fetchSemanticsNode().boundsInWindow
            val title = compose.onNodeWithTag("automation-close").fetchSemanticsNode().boundsInWindow
            val metrics = JSONObject().put("imageWidth", image.width).put("imageHeight", image.height).put("root", root.toString()).put("close", title.toString())
                .put("screenWidthDp", compose.activity.resources.configuration.screenWidthDp).put("density", compose.activity.resources.displayMetrics.density.toDouble())
                .put("logicalWidth", compose.activity.resources.displayMetrics.widthPixels).put("logicalHeight", compose.activity.resources.displayMetrics.heightPixels)
                .put("fontScale", compose.activity.resources.configuration.fontScale.toDouble()).put("capture", "screencap-physical-display")
            File(fixture.base.app.filesDir, "automation-parameters-$name.metrics.json").writeText(metrics.toString())
            if (InstrumentationRegistry.getArguments().getString("genesisAutomationParametersBaseline") != "true") {
                assertTrue("Dialog must fit the logical viewport", root.left >= 0 && root.right <= metrics.getInt("logicalWidth") + 1f && root.top >= 0 && root.bottom <= metrics.getInt("logicalHeight") + 1f)
                assertTrue("The full close target must remain inside the viewport", title.left >= 0 && title.right <= metrics.getInt("logicalWidth") + 1f && title.width >= 48 * compose.activity.resources.displayMetrics.density - 1f)
                assertTrue("The complete close target must fit the dialog", title.top >= root.top && title.bottom <= root.bottom && title.height >= 48 * compose.activity.resources.displayMetrics.density - 1f)
            }
        }
        finally { image.recycle() }
    }
    @Test fun disclosedOptionsEnableThroughConfirmationAndLostReplyReplaysTheSameNativeCommand() {
        var step = "open"
        try {
        val restore = StateRestorationTester(compose); restore.setContent { Content() }; choose()
        compose.onNodeWithTag("automation-enabled").assertIsOff().assertIsEnabled()
        parameters()
        compose.onNodeWithTag("template-apply-title").assertTextContains("Сохранённое название команды").assertIsNotEnabled()
        compose.onNodeWithTag("template-transfer-assignees").performScrollTo().assertIsOff().assertIsNotEnabled()
        assertEquals(0, fixture.templateSends); assertEquals(0, fixture.managementSends)
        step = "enable"
        fixture.loseManagementReply = true
        click("automation-enabled"); assertEquals(0, fixture.managementSends)
        click("automation-confirm-command"); await("automation-retry-command"); assertEquals(1, fixture.managementSends)
        step = "restore-pending"
        restore.emulateSavedInstanceStateRestore(); await("automation-retry-command"); click("automation-retry-command"); await("automation-done")
        step = "receipt"
        assertEquals(2, fixture.managementSends); click("automation-done"); await("automation-enabled")
        compose.onNodeWithTag("automation-enabled").assertIsOn().assertIsEnabled()
        val stored = fixture.base.client.sharedAutomation(fixture.base.generation, fixture.project, rule).getJSONObject("rule")
        assertEquals(2, stored.getInt("revision")); assertTrue(stored.getBoolean("enabled"))
        assertFalse(stored.getJSONObject("definition").getJSONArray("actions").getJSONObject(0).getJSONObject("options").getJSONObject("include").getBoolean("assignees"))
        assertEquals(0, fixture.templateSends); assertEquals(0, fixture.snapshot().getJSONArray("tasks").length())
        } catch (failure: Throwable) {
            File(fixture.base.app.filesDir, "automation-parameters-first-failure.txt").writeText(step + "\n" + failure.stackTraceToString())
            throw failure
        }
    }
    @Test fun captureNativeTemplateParameters() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisAutomationParametersCapture") == "true")
        val baseline = args.getString("genesisAutomationParametersBaseline") == "true"
        val width = requireNotNull(args.getString("genesisAutomationParametersWidth"))
        val languages = if (args.getString("genesisAutomationParametersLanguages") == "true") SharedTemplateProtocol.languages else setOf("ru")
        compose.setContent { Content() }
        for (locale in languages) for (night in listOf(false, true)) {
            compose.runOnIdle { language = locale; dark = night; epoch++ }
            // Wait for the new keyed composition before a rule from the previous locale can match.
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("parameters-case-$epoch-$locale-$night").fetchSemanticsNodes().size == 1 }
            compose.waitForIdle()
            val name = "$width-$locale-${if (night) "dark" else "light"}"
            captureCase = name
            if (baseline) {
                await("automation-rule-$rule"); screenshot("$name-top"); click("automation-rule-$rule"); await("automation-back")
                screenshot("$name-selection")
            } else {
                choose(); compose.onNodeWithTag("automation-enabled").performScrollTo().assertIsEnabled(); screenshot("$name-top")
                expand("automation-actions")
                await("automation-template-parameters-0"); expand("automation-template-parameters-0"); await("template-apply-title")
                compose.onNodeWithTag("template-apply-title").performScrollTo().assertIsNotEnabled(); screenshot("$name-options")
                compose.onNodeWithTag("template-transfer-assignees").performScrollTo().assertIsOff().assertIsNotEnabled()
                compose.onNodeWithTag("template-preview").performScrollTo(); screenshot("$name-preview")
            }
        }
        assertEquals(0, fixture.managementSends); assertEquals(0, fixture.templateSends)
    }
}
