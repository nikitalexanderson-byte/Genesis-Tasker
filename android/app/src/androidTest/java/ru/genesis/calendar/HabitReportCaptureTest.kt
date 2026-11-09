package ru.genesis.calendar

import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.ui.*

/** Production widgets, synthetic portable data, and the real Android renderer. */
class HabitReportCaptureTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun restoreAndAnalysisSurfaces() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("genesisEFCapture") == "true")
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val width = args.getString("genesisWidth")?.toInt() ?: 390
        val language = args.getString("genesisLanguage") ?: "ru"; val dark = args.getString("genesisDark") == "true"
        val font = args.getString("genesisFontScale")?.toFloat() ?: 1f; val compact = args.getString("genesisEFCompact") == "true"
        val longTitle = args.getString("genesisEFLongTitle") == "true"
        val density = app.resources.displayMetrics.widthPixels.toFloat() / width
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val text = assets.open("habit-backup-web.json").bufferedReader().use { it.readText() }
        val source = HabitBackups.parse(text).workspace()
        val preview = HabitBackupRestore.preview(source.copy(habits = source.habits.map { it.copy(title = "Текущее собственное название") }), text)
        val draft = HabitRestoreDraft("capture", "Моя сохранённая копия.json", if (longTitle) preview.copy(habits = preview.habits.map { it.copy(title = "Собственное название · ".repeat(23)) }) else preview,
            preview.habits.associate { it.id to "copy" }, false)
        val cases = JSONArray(assets.open("habit-analysis-web.json").bufferedReader().use { it.readText() })
        val workspace = HabitDocument.decode(CloudAccountImporter.habitsDocument(cases.getJSONObject(1).getJSONObject("workspace")), 0)
        val folder = File(app.getExternalFilesDir(null), "ef-captures").apply { mkdirs() }
        var scene by mutableStateOf("restore")
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(density, font), LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize().testTag("ef-capture-root")) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (scene == "restore") HabitRestorePreviewPanel(draft, false, true, { _, _ -> }, {}, {}, {})
                        else HabitAnalysisPanel(workspace, LocalDate.now(), CalendarMode.PROFANE, { _, _ -> }, {})
                    }
                } }
            }
        }
        fun capture(name: String, tags: List<String>) {
            compose.waitForIdle()
            // PixelCopy waits for this Compose surface's buffer; frame callbacks alone can
            // precede the first RenderThread submission on API35's software renderer.
            compose.onNodeWithTag("ef-capture-root").captureToImage()
            // Semantics can settle one compositor frame before a physical screenshot.
            val painted = CountDownLatch(1)
            compose.activity.runOnUiThread { compose.activity.window.decorView.postOnAnimation {
                compose.activity.window.decorView.postOnAnimation { painted.countDown() }
            } }
            assertTrue("Window did not draw the settled state", painted.await(5, TimeUnit.SECONDS))
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            val filename = "ef-$width-$language-${if (dark) "dark" else "light"}-font${(font * 100).toInt()}-${if (longTitle) "long-" else ""}$name"
            // UiDevice.takeScreenshot crops a changed logical display on API28. Shell screencap
            // captures the complete physical display, including the emulator's letterboxing.
            val target = File(folder, "$filename.png")
            val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
            ParcelFileDescriptor.AutoCloseInputStream(pipe).use { input -> target.outputStream().use(input::copyTo) }
            assertTrue(target.length() > 0)
            val rootNode = compose.onNodeWithTag("ef-capture-root").fetchSemanticsNode()
            val root = rootNode.boundsInRoot
            val actualWidth = root.width / rootNode.layoutInfo.density.density
            assertEquals("Actual Compose width must match the requested profile", width.toFloat(), actualWidth, 1f)
            val controls = JSONArray()
            for (tag in tags) {
                val node = compose.onNodeWithTag(tag); node.assertIsDisplayed()
                val semantic = node.fetchSemanticsNode(); val bounds = semantic.boundsInRoot; val renderedDensity = semantic.layoutInfo.density.density
                assertTrue("$filename $tag $bounds outside $root or below 48dp", bounds.width + 1 >= 48 * renderedDensity && bounds.height + 1 >= 48 * renderedDensity
                    && bounds.left >= root.left - 1 && bounds.right <= root.right + 1 && bounds.top >= root.top - 1 && bounds.bottom <= root.bottom + 1)
                controls.put(JSONObject().put("tag", tag).put("bounds", bounds.toString()).put("widthDp", bounds.width / renderedDensity).put("heightDp", bounds.height / renderedDensity))
            }
            File(folder, "$filename.metrics.json").writeText(JSONObject().put("width", width).put("actualWidthDp", actualWidth).put("language", language).put("dark", dark).put("fontScale", font)
                .put("controls", controls).put("capture", "screencap-physical-display").toString())
        }
        compose.onNodeWithTag("habit-restore-footer").performScrollTo()
        capture("restore", listOf("habit-restore-apply", "habit-restore-cancel", "habit-restore-refresh"))
        compose.runOnIdle { scene = "analysis" }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("habit-goal-rate").fetchSemanticsNodes().isNotEmpty() }
        if (!compact) {
            compose.onNodeWithTag("habit-goal-rate").performScrollTo()
            capture("analysis", emptyList())
            compose.onNodeWithTag("habit-analysis-year").performScrollTo().performClick()
            val dates = SemanticsMatcher("report date") { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)?.startsWith("habit-analysis-day-") == true }
            val yearSize = GenesisCalendar().yearRange(LocalDate.now(), CalendarMode.PROFANE).dates().size
            compose.waitUntil(30_000) { compose.onAllNodes(dates).fetchSemanticsNodes().size == yearSize }
            compose.onNodeWithTag("habit-goal-rate").performScrollTo()
            capture("year", emptyList())
            compose.onNodeWithTag("habit-analysis-month").performScrollTo().performClick()
            compose.waitUntil(30_000) { compose.onAllNodes(dates).fetchSemanticsNodes().size in 28..31 }
        }
        val targetMonth = GenesisCalendar().monthRange(LocalDate.parse("2026-10-19"), CalendarMode.PROFANE).start
        compose.onNodeWithTag("habit-analysis-grid-$targetMonth").performScrollTo()
        compose.onNodeWithTag("habit-analysis-day-2026-10-19").performScrollTo().assertIsDisplayed().performClick()
        try { compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-analysis-source").fetchSemanticsNodes().isNotEmpty() } }
        catch (error: Exception) { File(folder, "missing-source.txt").writeText(compose.onRoot().printToString()); throw error }
        if (compose.onAllNodesWithTag("habit-analysis-edit").fetchSemanticsNodes().isEmpty()) {
            File(folder, "missing-history-action.txt").writeText(compose.onRoot().printToString())
        }
        compose.onNodeWithTag("habit-analysis-edit").performScrollTo()
        capture("source", listOf("habit-analysis-edit"))
    }
}
