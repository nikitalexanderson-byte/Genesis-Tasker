package ru.genesis.calendar.ui

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.app.Activity
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File
import java.io.IOException
import java.util.UUID

private class ExportUiFixture : SharedWorkspaceGateway {
    var calls = 0; var pickers = 0; var selectedFormat = ""; var filename = ""
    var chosen: JSONObject? = null; var complete: ((DataExportDestination?) -> Unit)? = null
    var failure: Exception? = null; var waiting: CompletableDeferred<Unit>? = null
    override suspend fun exportSharedData(spaceId: String, command: JSONObject): JSONObject {
        calls++; chosen = JSONObject(command.toString()); failure?.let { throw it }
        waiting?.let { withContext(NonCancellable) { it.await() } }
        val format = command.getString("format")
        return JSONObject().put("format", format).put("content", if (format == "csv") "\uFEFFНазвание\r\n\"Проверка 🌙\"\r\n" else "{\"format\":\"genesis-shared-workspace\",\"version\":1,\"future\":true}")
            .put("projectCount", 3).put("taskCount", 131).put("notices", JSONArray().put(JSONObject().put("code", "DATA_ATTACHMENTS_METADATA_ONLY").put("field", "")))
    }
}

private class ExportPickerRegistry : ActivityResultRegistry(), ActivityResultRegistryOwner {
    override val activityResultRegistry: ActivityResultRegistry get() = this
    var requestCode = 0
    override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
        this.requestCode = requestCode
    }
}

class SharedDataExportUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var fixture by mutableStateOf<ExportUiFixture?>(null); private var epoch by mutableIntStateOf(0)
    private var account by mutableStateOf("account-a"); private var language by mutableStateOf("ru"); private var dark by mutableStateOf(false)
    private var installed = false; private var closed = false
    private val space = "11111111-1111-4111-8111-111111111111"; private val project = "22222222-2222-4222-8222-222222222222"
    private fun show(value: ExportUiFixture) {
        if (!installed) {
            compose.setContent { fixture?.let { current -> key(epoch) {
                CompositionLocalProvider(LocalGenesisUserId provides account, LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) {
                        Surface(Modifier.fillMaxSize().testTag("export-test-window")) {
                            SharedDataExportScreen(current, space, project, "Проект команды · подробный план работ", { closed = true },
                                picker = { format, filename, callback -> current.pickers++; current.selectedFormat = format; current.filename = filename; current.complete = callback })
                        }
                    }
                }
            } } }; installed = true
        }
        compose.runOnIdle { fixture = value; epoch++; closed = false }
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("export-save").assertIsEnabled() }.isSuccess }; compose.waitForIdle()
    }
    private fun click(tag: String) {
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.performClick(); compose.waitForIdle()
    }
    private fun finish(value: ExportUiFixture, target: DataExportDestination?) {
        compose.runOnIdle { value.complete!!(target) }; compose.waitForIdle()
        if (value.waiting == null) compose.waitUntil(10000) { compose.onAllNodesWithTag("export-working").fetchSemanticsNodes().isEmpty() }
    }
    @Test fun pickerCancellationMakesNoNetworkRequestAndNoSuccess() {
        val f = ExportUiFixture(); show(f); click("export-save")
        assertEquals(1, f.pickers); assertEquals(0, f.calls); finish(f, null)
        assertEquals(0, f.calls); compose.onNodeWithTag("export-saved").assertDoesNotExist(); compose.onNodeWithTag("export-save").assertIsEnabled()
    }
    @Test fun csvTreeScopeAndOwnCalendarAreSavedWithAllCounts() {
        val f = ExportUiFixture(); show(f)
        click("export-scope"); click("export-scope-tree"); click("export-format"); click("export-format-csv")
        compose.onNodeWithText("Фильтры").performClick(); click("export-calendar-lunar")
        compose.onNodeWithTag("export-time-zone").performTextReplacement("America/New_York")
        click("export-save"); assertEquals("csv", f.selectedFormat); assertTrue(f.filename.endsWith(".csv")); assertEquals(0, f.calls)
        var content = ""; finish(f, DataExportDestination { text, current -> current(); content = text })
        compose.waitUntil(10000) { compose.onAllNodesWithTag("export-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("tree", f.chosen!!.getString("scope")); assertEquals("lunar", f.chosen!!.getString("calendarMode"))
        assertEquals("America/New_York", f.chosen!!.getJSONObject("calendarContext").getString("timeZone"))
        assertTrue(content.startsWith("\uFEFF")); compose.onNodeWithTag("export-counts").assertTextContains("131", substring = true)
    }
    @Test fun invalidTimeZonePreventsPickerAndFormRecoversWithoutLosingChoices() {
        val f = ExportUiFixture(); show(f); compose.onNodeWithText("Фильтры").performClick()
        for (zone in listOf("Bad/Zone", "GMT", "Z", "+03:00", "UTC+03:00")) {
            compose.onNodeWithTag("export-time-zone").performTextReplacement(zone)
            compose.onNodeWithTag("export-save").assertIsNotEnabled(); assertEquals(0, f.pickers)
            compose.onNodeWithTag("export-validation").assertIsDisplayed()
        }
        compose.onNodeWithTag("export-time-zone").performTextReplacement("Europe/Moscow")
        compose.onNodeWithTag("export-save").assertIsEnabled(); click("export-from-enabled")
        compose.onNodeWithTag("export-from").assertExists(); click("export-from-enabled"); compose.onNodeWithTag("export-from").assertDoesNotExist()
    }
    @Test fun networkAndProviderErrorsAreVisibleAndNeverShowSuccess() {
        val offline = ExportUiFixture().apply { failure = AuthFailure(AuthFailure.Kind.NETWORK) }; show(offline); click("export-save")
        finish(offline, DataExportDestination { _, _ -> fail("Offline export wrote a file") })
        compose.onNodeWithTag("export-error").assertIsDisplayed(); compose.onNodeWithTag("export-saved").assertDoesNotExist()
        val provider = ExportUiFixture(); show(provider); click("export-save"); finish(provider, DataExportDestination { _, _ -> throw IOException() })
        compose.onNodeWithTag("export-error").assertIsDisplayed(); compose.onNodeWithTag("export-saved").assertDoesNotExist(); compose.onNodeWithTag("export-save").assertIsEnabled()
    }
    @Test fun languageChangeKeepsFrozenSelectionAndUserProjectTitle() {
        val f = ExportUiFixture(); show(f); click("export-format"); click("export-format-csv"); click("export-save")
        compose.runOnIdle { language = "de" }; compose.waitForIdle(); var writes = 0
        finish(f, DataExportDestination { _, current -> current(); writes++ })
        compose.waitUntil(10000) { writes == 1 }; assertEquals("csv", f.chosen!!.getString("format"))
        assertEquals("Название", f.chosen!!.getJSONObject("titles").getString("title"))
        compose.onNodeWithText("Проект команды · подробный план работ").assertExists()
    }
    @Test fun accountSwitchDropsLateResultsBeforeAnyFileWrite() {
        val f = ExportUiFixture().apply { waiting = CompletableDeferred() }; show(f); click("export-save"); var writes = 0
        finish(f, DataExportDestination { _, _ -> writes++ }); compose.waitUntil(10000) { f.calls == 1 }
        compose.onNodeWithTag("export-working").assertIsDisplayed()
        compose.runOnIdle { account = "account-b" }; compose.waitForIdle(); f.waiting!!.complete(Unit); compose.waitForIdle()
        assertEquals(0, writes); compose.onNodeWithTag("export-saved").assertDoesNotExist()
    }
    @Test fun savedStateAndRealPickerRegistryResumeWithANewControllerInstance() {
        val restoration = StateRestorationTester(compose)
        val controllers = mutableListOf<ExportUiFixture>()
        var registry = ExportPickerRegistry()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(context.cacheDir, "restored-export-contract.csv")
        output.delete()
        try {
            restoration.setContent {
                val controller = remember { ExportUiFixture().also { controllers.add(it) } }
                CompositionLocalProvider(LocalGenesisUserId provides "account-a", LocalGenesisLanguage provides "ru",
                    LocalActivityResultRegistryOwner provides registry) {
                    MaterialTheme(colorScheme = standart) { SharedDataExportScreen(controller, space, project, "Проект команды", {}) }
                }
            }
            compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("export-save").assertIsEnabled() }.isSuccess }
            click("export-scope"); click("export-scope-tree"); click("export-format"); click("export-format-csv")
            compose.onNodeWithText("Фильтры").performClick()
            compose.onNodeWithTag("export-time-zone").performTextReplacement("America/New_York")
            click("export-save")
            val original = controllers.single(); val requestCode = registry.requestCode
            assertNotEquals(0, requestCode); assertEquals(0, original.calls)
            val savedRegistry = Bundle()
            compose.runOnIdle { registry.onSaveInstanceState(savedRegistry) }
            registry = ExportPickerRegistry().apply { onRestoreInstanceState(savedRegistry) }
            restoration.emulateSavedInstanceStateRestore(); compose.waitForIdle()
            val restored = controllers.last(); assertEquals(2, controllers.size); assertNotSame(original, restored)
            compose.onNodeWithTag("export-save").assertIsNotEnabled()
            compose.onNodeWithTag("export-format").assertTextContains("CSV", substring = true)
            compose.runOnIdle { assertTrue(registry.dispatchResult(requestCode, Activity.RESULT_OK, Intent().setData(Uri.fromFile(output)))) }
            compose.waitUntil(10000) { compose.onAllNodesWithTag("export-saved").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(0, original.calls); assertEquals(1, restored.calls)
            assertEquals("tree", restored.chosen!!.getString("scope")); assertEquals("csv", restored.chosen!!.getString("format"))
            assertEquals("America/New_York", restored.chosen!!.getJSONObject("calendarContext").getString("timeZone"))
            assertArrayEquals("\uFEFFНазвание\r\n\"Проверка 🌙\"\r\n".toByteArray(Charsets.UTF_8), output.readBytes())
        } finally { output.delete() }
    }
    @Test fun liveControllerReplacementCancelsTheOldExportBeforeWriting() {
        val original = ExportUiFixture().apply { waiting = CompletableDeferred() }; show(original); click("export-save"); var writes = 0
        finish(original, DataExportDestination { _, _ -> writes++ }); compose.waitUntil(10000) { original.calls == 1 }
        val replacement = ExportUiFixture()
        compose.runOnIdle { fixture = replacement }; compose.waitForIdle(); original.waiting!!.complete(Unit); compose.waitForIdle()
        assertEquals(0, writes); assertEquals(0, replacement.calls); compose.onNodeWithTag("export-save").assertIsEnabled()
        compose.onNodeWithTag("export-saved").assertDoesNotExist()
    }
    @Test fun systemBackClosesTheExportScreen() {
        show(ExportUiFixture()); UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack(); compose.waitForIdle(); assertTrue(closed)
    }
    @Test fun androidProviderReceivesExactUtf8Bytes() = runBlocking {
        assumeTrue(Build.VERSION.SDK_INT >= 29)
        val resolver = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "genesis-export-test-${UUID.randomUUID()}.csv")
            put(MediaStore.MediaColumns.MIME_TYPE, "text/csv"); put(MediaStore.MediaColumns.IS_PENDING, 1)
        })!!
        try {
            val content = "a".repeat(8191) + "🌙\uFEFFНазвание,Описание\r\n\"Проверка 🌙\",\"первая\nвторая\"\r\n"
            AndroidDataExportDestination(resolver, uri).write(content) { }
            val bytes = resolver.openInputStream(uri)!!.use { it.readBytes() }; assertArrayEquals(content.toByteArray(Charsets.UTF_8), bytes)
        } finally { resolver.delete(uri, null, null) }
    }
    @Test fun captureExport() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisExportCapture") == "true")
        val all = args.getString("genesisExportLanguages") == "true"; val width = args.getString("genesisExportWidth")!!
        val languages = if (all) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val rotate = args.getString("genesisExportRotateLeft") == "true"
        if (rotate) { device.setOrientationLeft(); compose.waitForIdle() }
        fun capture(name: String) {
            compose.waitForIdle(); val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("export-heading").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
            val density = layouts.single().layoutInput.density
            val viewport = compose.onNodeWithTag("export-test-window").fetchSemanticsNode().boundsInRoot.width / density.density
            assertTrue("Export viewport $viewport does not match $width", viewport in (width.toFloat() - 1)..(width.toFloat() + 1))
            assertEquals(args.getString("genesisExportFontScale")!!.toFloat(), density.fontScale, .01f)
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "export-${if (all) "font130-" else ""}${if (dark) "dark" else "light"}-$width-$language-$name.png")
            assertTrue(device.takeScreenshot(file)); println("QA export width=$viewport density=${density.density} font=${density.fontScale} language=$language state=$name")
        }
        try { for (lang in languages) for (theme in listOf(false, true)) {
            compose.runOnIdle { language = lang; dark = theme }; val f = ExportUiFixture(); show(f); capture("form")
            if (!all) {
                compose.onNodeWithText("Фильтры").performClick(); capture("filters"); click("export-save")
                compose.onNodeWithTag("export-working").assertIsDisplayed(); capture("waiting")
                finish(f, DataExportDestination { _, current -> current() }); compose.waitForIdle()
                compose.waitUntil(10000) { compose.onAllNodesWithTag("export-saved").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag("export-saved").assertIsDisplayed(); compose.onNodeWithTag("export-counts").assertIsDisplayed(); capture("saved")
                val offline = ExportUiFixture().apply { failure = AuthFailure(AuthFailure.Kind.NETWORK) }; show(offline); click("export-save")
                finish(offline, DataExportDestination { _, _ -> fail("Offline write") }); compose.onNodeWithTag("export-error").assertIsDisplayed(); capture("offline")
            }
        } } finally { if (rotate) { device.setOrientationNatural(); device.unfreezeRotation() } }
    }
}
