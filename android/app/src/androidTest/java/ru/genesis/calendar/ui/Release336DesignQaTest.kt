package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.data.WorkspaceStructure
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.time.LocalDate

/** Focused native-window evidence of the shipped Today components; no account or production API. */
class Release336DesignQaTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val phase get() = InstrumentationRegistry.getArguments().getString("genesisDesignPhase", "after")
    private val widths get() = InstrumentationRegistry.getArguments().getString("genesisDesignWidths", "360,390,768,1440")!!
        .split(',').map(String::toInt)
    private val skipLanguages get() = InstrumentationRegistry.getArguments().getString("genesisDesignSkipLanguageMatrix") == "true"
    private val palettes = listOf("blue", "green", "burgundy", "violet")
    private val languages = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
    private val emptyShared = object : SharedWorkspaceGateway {
        override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = JSONObject()
            .put("tasks", JSONArray()).put("total", 0).put("hasMore", false).put("queryVersion", "qa336")
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "design336-$phase-$name.png"))
    }

    @Composable private fun Frame(width: Int, palette: String, dark: Boolean, language: String,
        content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark,
            LocalDarkPalette provides palette, LocalSacredFeaturesEnabled provides true,
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f)) {
            MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { Box(Modifier.safeDrawingPadding()) { content() } }
            }
        }
    }

    @Test fun todayEmptyGroupsAndDecorativeHeadersInFourPalettesAndBothSchemes() {
        check(context.packageName == "ru.genesis.calendar.qa1103.debug")
        var width by mutableIntStateOf(390)
        var palette by mutableStateOf("blue")
        var dark by mutableStateOf(true)
        var language by mutableStateOf("ru")
        var epoch by mutableIntStateOf(0)
        val app = context.applicationContext as GenesisApplication
        compose.setContent { key(epoch) { Frame(width, palette, dark, language) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text("Сегодня", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    WorkspaceHeaderButton("Порядок блоков", "today-order-toggle", onClick = {}) {
                        GenesisLucideIcon("arrow-up-down", Modifier.size(22.dp))
                    }
                }
                Column(Modifier.verticalScroll(rememberScrollState()).padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TodayTasksPanel(emptyList(), emptyList(), LocalDate.now().toString(), true,
                        WorkspaceStructure(), {}, {}, {}, {}, sharedController = emptyShared)
                    TodayHabitTrackerBlock {
                        TodayHabitsContent(app, LocalDate.now(), LocalHabitWorkspace(), {}, showTopDivider = false)
                    }
                }
            }
        } } }
        fun inspectAndCapture(name: String) {
            compose.waitUntil(10_000) { compose.onAllNodesWithText(genesisTranslateForTest("Общие", language) + " · 0")
                .fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("today-order-toggle").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            compose.onNodeWithTag("today-personal-tasks").assertExists()
            compose.onNodeWithTag("today-shared-tasks").assertExists()
            shot(name)
            for (tag in listOf("today-personal-tasks", "today-shared-tasks")) {
                val nodes = compose.onAllNodes(hasAnyAncestor(hasTestTag(tag)) and hasText("", substring = true), useUnmergedTree = true)
                for (index in 0 until nodes.fetchSemanticsNodes().size) {
                    val results = mutableListOf<TextLayoutResult>()
                    nodes[index].performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
                    results.forEach { assertFalse("Task group text overflow: $name", it.hasVisualOverflow) }
                }
            }
        }
        for (w in widths) for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { width = w; palette = p; dark = night; language = "ru"; epoch++ }
            inspectAndCapture("today-$w-$p-${if (night) "dark" else "light"}")
        }
        if (phase == "after" && !skipLanguages) for (lang in languages) for (night in listOf(false, true)) {
            compose.runOnIdle { width = 390; palette = "blue"; dark = night; language = lang; epoch++ }
            inspectAndCapture("today-390-blue-${if (night) "dark" else "light"}-$lang")
        }
    }

    @Test fun trackerDateUsesTheAvailableWidthAndCentersAllCalendarLabels() {
        var width by mutableIntStateOf(390)
        var palette by mutableStateOf("blue")
        var dark by mutableStateOf(false)
        var language by mutableStateOf("ru")
        var chosen by mutableStateOf("2026-11-18")
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(width, palette, dark, language) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Text("Сон и настроение", style = MaterialTheme.typography.titleLarge)
                CalendarMode.entries.forEach { mode ->
                    Column(Modifier.fillMaxWidth().testTag("date-mode-${mode.name}")) {
                        Text(calendarModeLabel(mode), style = MaterialTheme.typography.titleMedium)
                        TrackerDateNavigation(chosen, mode) { chosen = it }
                    }
                }
                CalendarInlineTasks(LocalDate.parse(chosen), emptyList(), true, {}, {}, {}, {})
            }
        } } }
        fun inspect(name: String) {
            compose.waitForIdle()
            for (mode in CalendarMode.entries) {
                val dateButton = compose.onNode(hasTestTag("sleep-mood-date") and hasAnyAncestor(hasTestTag("date-mode-${mode.name}")))
                val todayButton = compose.onNode(hasTestTag("sleep-mood-today") and hasAnyAncestor(hasTestTag("date-mode-${mode.name}")))
                dateButton.assertHeightIsAtLeast(52.dp).assertWidthIsAtLeast(100.dp)
                todayButton.assertHeightIsAtLeast(48.dp)
                val texts = compose.onAllNodes(hasAnyAncestor(hasTestTag("sleep-mood-date")) and
                    hasAnyAncestor(hasTestTag("date-mode-${mode.name}")) and hasText("", substring = true), useUnmergedTree = true)
                for (index in 0 until texts.fetchSemanticsNodes().size) {
                    val layouts = mutableListOf<TextLayoutResult>()
                    texts[index].performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                    for (layout in layouts) {
                        assertFalse("Date label overflow: $name/$mode", layout.hasVisualOverflow)
                        assertEquals("Centered date text: $name/$mode", androidx.compose.ui.text.style.TextAlign.Center, layout.layoutInput.style.textAlign)
                    }
                }
            }
            compose.onNodeWithTag("calendar-tasks-section-icon").assertHasNoClickAction()
            shot(name)
        }
        for (w in widths) for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { width = w; palette = p; dark = night; language = "ru"; epoch++ }
            inspect("dates-$w-$p-${if (night) "dark" else "light"}")
        }
        if (!skipLanguages) for (lang in languages) for (night in listOf(false, true)) {
            compose.runOnIdle { width = 390; palette = "blue"; dark = night; language = lang; epoch++ }
            inspect("dates-390-blue-${if (night) "dark" else "light"}-$lang")
        }
        val modeParent = hasAnyAncestor(hasTestTag("date-mode-PROFANE"))
        compose.onNode(hasTestTag("sleep-mood-date") and modeParent).performClick()
        compose.onNodeWithTag("author-date-close").assertExists().performClick()
        compose.runOnIdle { chosen = "2026-11-01" }
        compose.onNode(hasTestTag("sleep-mood-today") and modeParent).performClick()
        compose.runOnIdle { assertEquals("Today still selects the actual civil date", LocalDate.now().toString(), chosen) }
    }

    @Test fun plainHeaderAndTonalToolbarsKeepPressReleaseCancelFocusAndDisabledStates() {
        var dark by mutableStateOf(false)
        var palette by mutableStateOf("blue")
        var epoch by mutableIntStateOf(0)
        var clicks = 0
        var selected by mutableStateOf(false)
        val focus = FocusRequester()
        lateinit var inputModes: InputModeManager
        compose.setContent { key(epoch) { Frame(390, palette, dark, "ru") {
            inputModes = LocalInputModeManager.current
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Сегодня", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    WorkspaceHeaderButton("Порядок блоков", "qa336-header", onClick = { clicks++ }) {
                        GenesisLucideIcon("arrow-up-down", Modifier.size(22.dp))
                    }
                }
                GenesisIconButton({ clicks++ }, Modifier.testTag("qa336-focus").focusRequester(focus)
                    .semantics { contentDescription = "Фокус клавиатуры" }) { GenesisLucideIcon("settings") }
                CompositionLocalProvider(LocalGenesisIconButtonTonal provides true) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AffairsIconButton("Показать структуру", AffairsAction.SUBTASK, { selected = !selected },
                            Modifier.testTag("qa336-selected"), selected = selected)
                        AffairsIconButton("Отменить изменение", AffairsAction.UNDO, { clicks++ },
                            Modifier.testTag("qa336-disabled"), enabled = false)
                        AffairsIconButton("История", AffairsAction.HISTORY, {}, Modifier.testTag("qa336-history"))
                        SharedMindmapButton {}
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SharedWorkspaceViewChoice("list", {}, compact = true)
                        SharedWorkspaceCreateMenu(true, true, true, {}, {})
                    }
                }
            }
        } } }
        fun sample(tag: String): List<Float> {
            val pixels = compose.onNodeWithTag(tag).captureToImage().toPixelMap()
            return listOf(pixels[10, 10].red, pixels[10, 10].green, pixels[10, 10].blue)
        }
        fun difference(a: List<Float>, b: List<Float>) = a.zip(b).sumOf { (x, y) -> kotlin.math.abs(x - y).toDouble() }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night; selected = false; epoch++ }
            compose.onNodeWithTag("qa336-header").assertContentDescriptionEquals("Порядок блоков")
                .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            compose.onNodeWithTag("qa336-disabled").assertIsNotEnabled().assertHeightIsAtLeast(48.dp)
            val idle = sample("qa336-header")
            val initialClicks = clicks
            shot("actions-$p-$night-idle")
            compose.onNodeWithTag("qa336-header").performTouchInput { down(center) }
            val pressed = sample("qa336-header")
            assertTrue("Press keeps the header transparent: $p/$night", difference(idle, pressed) < .02)
            shot("actions-$p-$night-pressed")
            compose.onNodeWithTag("qa336-header").performTouchInput { up() }
            compose.mainClock.advanceTimeBy(700)
            compose.waitForIdle()
            val released = sample("qa336-header")
            assertTrue("Release restores transparency: $p/$night", difference(idle, released) < .02)
            assertEquals(initialClicks + 1, clicks)
            shot("actions-$p-$night-released")
            compose.onNodeWithTag("qa336-header").performTouchInput { down(center); advanceEventTime(80); cancel() }
            compose.mainClock.advanceTimeBy(700)
            compose.waitForIdle()
            assertEquals("A cancelled press must not activate", initialClicks + 1, clicks)
            assertTrue("Cancel restores transparency", difference(idle, sample("qa336-header")) < .02)
            compose.onNodeWithTag("qa336-selected").performClick().assertIsSelected()
            shot("actions-$p-$night-selected")
            compose.onNodeWithTag("shared-view-selector").performClick().assertIsSelected()
            shot("actions-$p-$night-menu-open")
            compose.onNodeWithTag("shared-view-list").performClick()
            compose.onNodeWithTag("shared-view-selector").assertIsNotSelected()
            compose.runOnIdle {
                assertTrue("Keyboard mode is available", inputModes.requestInputMode(InputMode.Keyboard))
                focus.requestFocus()
            }
            compose.onNodeWithTag("qa336-focus").assertIsFocused()
            shot("actions-$p-$night-focused")
        }
    }

    private fun genesisTranslateForTest(text: String, language: String): String =
        translateGenesisText(context, text, language)
}
