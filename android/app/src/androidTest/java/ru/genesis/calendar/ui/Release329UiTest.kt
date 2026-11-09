package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.DpRect
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.auth.TrialAccess
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.HabitTimerPreferences

/** Production UI with synthetic state, restricted to the separate QA application. */
class Release329UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val languages = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")

    @Before fun isolatedPackageOnly() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".qa328.debug")) {
            "Release329UiTest requires the isolated .qa328.debug application."
        }
    }

    @Composable private fun Frame(width: Int, night: Boolean, language: String = "ru",
        sacred: Boolean = false, content: @Composable () -> Unit) {
        CompositionLocalProvider(
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f),
            LocalGenesisLanguage provides language,
            LocalEveningTheme provides night,
            LocalDarkPalette provides "blue",
            LocalSacredFeaturesEnabled provides sacred,
            LocalFeatureAccess provides FeatureAccess()
        ) {
            MaterialTheme(colorScheme = if (night) eveningPalette("blue") else daylightPalette("blue"),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }

    private fun catalog(path: String): JSONObject = context.assets.open("originals/i18n/$path")
        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }

    private fun capture(name: String) = captureNativeWindow(
        File(context.getExternalFilesDir(null), "release329-$name.png"))

    private fun assertCompleteText(node: SemanticsNodeInteraction, description: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("$description: a real text layout is available", layouts.isNotEmpty())
        layouts.forEach { layout ->
            assertFalse("$description: text is complete", layout.hasVisualOverflow)
            assertFalse("$description: words stay whole", layout.splitsWord())
        }
    }

    private fun assertTouchTarget(bounds: DpRect, description: String) {
        assertTrue("$description: 48dp width", bounds.right - bounds.left >= 47.5.dp)
        assertTrue("$description: 48dp height", bounds.bottom - bounds.top >= 47.5.dp)
    }

    @Test fun comparisonWindowUsesItsExplicitLanguageForTrialInFourteenLocalesAndBothSchemes() {
        val controller = AuthController.get(context)
        check(controller.state.value.user == null && !controller.state.value.ready) {
            "The synthetic comparison fixture requires a signed-out QA controller."
        }
        val offer = TrialAccess("unavailable", null, null, null, null,
            Instant.parse("2026-11-09T00:00:00Z"), emptyList())
        val access = FeatureAccess(trial = offer)
        val expectedCopy = catalog("billing-trial-copy.json")
        var language by mutableStateOf("ru")
        var night by mutableStateOf(false)
        compose.setContent {
            // The real comparison window receives its language before providing a locale to its children.
            Frame(360, night, language = "ru") {
                NativeUpgradeDialog(controller, "release329-synthetic-comparison", access,
                    language = language, onClose = {})
            }
        }
        for (locale in languages) for (dark in listOf(false, true)) {
            compose.runOnIdle { language = locale; night = dark }
            compose.onNodeWithTag("native-upgrade-dialog").assertIsDisplayed()
            val expected = expectedCopy.getJSONObject(locale)
            for (key in listOf("trialTitle", "duration", "noCharge")) {
                val node = compose.onNodeWithText(expected.getString(key), useUnmergedTree = true)
                    .performScrollTo().assertIsDisplayed()
                assertCompleteText(node, "$locale/$dark/trial/$key")
            }
            val unavailable = compose.onNodeWithTag("trial-unavailable").performScrollTo()
                .assertIsDisplayed().assertTextEquals(expected.getString("unavailable"))
            assertCompleteText(unavailable, "$locale/$dark/trial/unavailable")
            if (locale == "en") capture("trial-$dark")
        }
    }

    @Test fun personalCreateMenuTranslatesEventAndMeetingAndDispatchesTheirKindsInFourteenLocales() {
        val app = compose.activity.application as GenesisApplication
        val copies = languages.filter { it != "ru" }.associateWith { catalog("ui-translations/$it.json") }
        val created = mutableListOf<Pair<String?, String>>()
        var language by mutableStateOf("ru")
        var night by mutableStateOf(false)
        compose.setContent { Frame(360, night, language) {
            ProjectsScreen(app, emptyList(), true, {}, {},
                onCreateEntry = { project, kind -> created += project to kind })
        } }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("personal-actions").fetchSemanticsNodes().size == 1
        }
        for (locale in languages) for (dark in listOf(false, true)) {
            compose.runOnIdle { language = locale; night = dark; created.clear() }
            for ((kind, source) in listOf("event" to "Создать событие", "meeting" to "Создать встречу")) {
                compose.onNodeWithTag("personal-actions").assertIsDisplayed().performClick()
                val expected = copies[locale]?.getString(source) ?: source
                val action = compose.onNodeWithTag("personal-create-$kind").assertIsDisplayed()
                    .assert(hasText(expected))
                assertTouchTarget(action.getUnclippedBoundsInRoot(), "$locale/$dark/create-$kind")
                assertCompleteText(compose.onNodeWithText(expected, useUnmergedTree = true),
                    "$locale/$dark/create-$kind")
                if (locale == "el" && kind == "meeting") capture("create-menu-$dark")
                action.performClick()
                compose.onNodeWithTag("personal-create-$kind").assertDoesNotExist()
            }
            compose.runOnIdle {
                assertEquals("$locale/$dark: event and meeting reach their distinct editor callbacks",
                    listOf(null to "event", null to "meeting"), created.toList())
            }
        }
    }

    @Test fun lowerReturnActionSelectsActualTodayFromAnotherMonthWithoutMovingHorizontalControls() {
        val today = LocalDate.now()
        val future = today.plusMonths(3)
        var width by mutableIntStateOf(360)
        var night by mutableStateOf(false)
        var sacred by mutableStateOf(false)
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(future)
        var epoch by mutableIntStateOf(0)
        var selections = 0
        compose.setContent { key(epoch) {
            Frame(width, night, if (night) "en" else "ru", sacred) {
                CalendarScreen(date, mode, { date = it; selections++ }, experimental = true,
                    hiddenSubmenus = setOf("calendar.year"))
            }
        } }
        val cases = listOf(CalendarMode.PROFANE to false) + CalendarMode.entries.map { it to true }
        for ((calendarMode, enabled) in cases) for (size in listOf(360, 390, 768, 1440)) {
            for (dark in listOf(false, true)) {
                compose.runOnIdle {
                    width = size; night = dark; sacred = enabled; mode = calendarMode
                    date = future; selections = 0; epoch++
                }
                val label = "${calendarMode.wireValue}/sacred=$enabled/$size/$dark"
                val todayAction = compose.onNodeWithTag("calendar-month-today").performScrollTo()
                    .assertIsDisplayed().assertContentDescriptionEquals(
                        translateGenesisText(context, "Сегодня", if (dark) "en" else "ru"))
                val hero = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
                val previous = compose.onNodeWithTag("calendar-month-previous").getUnclippedBoundsInRoot()
                val next = compose.onNodeWithTag("calendar-month-next").getUnclippedBoundsInRoot()
                val undo = todayAction.getUnclippedBoundsInRoot()
                for (bounds in listOf(previous, undo, next)) assertTouchTarget(bounds, label)
                assertTrue("$label: return sits beside the lower right arrow", undo.right <= next.left)
                assertEquals("$label: return and next share the lower edge", next.bottom.value, undo.bottom.value, 1f)
                assertEquals("$label: arrows share the lower edge", previous.bottom.value, next.bottom.value, 1f)
                assertTrue("$label: left arrow stays in the lower artwork corner",
                    previous.left >= hero.left && previous.left - hero.left <= 13.dp &&
                        previous.bottom <= hero.bottom && hero.bottom - previous.bottom <= 13.dp)
                assertTrue("$label: right arrow stays in the lower artwork corner",
                    next.right <= hero.right && hero.right - next.right <= 13.dp &&
                        next.bottom <= hero.bottom && hero.bottom - next.bottom <= 13.dp)
                if (!enabled) assertCivilMonthCentered(label)
                if (size == 390) capture("month-${calendarMode.wireValue}-$enabled-$dark")
                todayAction.performClick()
                compose.waitForIdle()
                compose.runOnIdle {
                    assertEquals("$label: Today selects the actual date", today, date)
                    assertEquals("$label: one navigation callback", 1, selections)
                }
                compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
                val returnedPrevious = compose.onNodeWithTag("calendar-month-previous").getUnclippedBoundsInRoot()
                val returnedNext = compose.onNodeWithTag("calendar-month-next").getUnclippedBoundsInRoot()
                assertEquals("$label: previous keeps its horizontal position", previous.left.value, returnedPrevious.left.value, 1f)
                assertEquals("$label: next keeps its horizontal position", next.left.value, returnedNext.left.value, 1f)
                if (!enabled) assertCivilMonthCentered(label)
            }
        }
    }

    private fun assertCivilMonthCentered(description: String) {
        val hero = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
        val title = compose.onNodeWithTag("calendar-month-period").getUnclippedBoundsInRoot()
        assertEquals("$description: civil month stays centered", (hero.left.value + hero.right.value) / 2,
            (title.left.value + title.right.value) / 2, 1f)
        assertCompleteText(compose.onNodeWithTag("calendar-month-period"), "$description/month")
    }

    @Test fun habitHsvPickerAppliesOnceCancelsWithoutSavingAndPreservesTheStoredColorOnReopen() {
        val original = "#8a5ba1"
        var color by mutableStateOf(original)
        var enabled by mutableStateOf(true)
        var width by mutableIntStateOf(360)
        var night by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        val saved = mutableListOf<String>()
        compose.setContent { key(epoch) { Frame(width, night, if (night) "en" else "ru") {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HabitPersonalizationFields("✨", color, false, "none", "", enabled,
                    {}, { color = it; saved += it }, {}, {}, {})
            }
        } } }
        for (size in listOf(360, 390)) for (dark in listOf(false, true)) {
            compose.runOnIdle {
                width = size; night = dark; color = original; enabled = true; saved.clear(); epoch++
            }
            val entry = compose.onNodeWithTag("habit-custom-color").performScrollTo().assertIsEnabled()
            assertTouchTarget(entry.getUnclippedBoundsInRoot(), "$size/$dark/custom-color")
            entry.performClick()
            compose.onNodeWithTag("habit-color-picker").assertIsDisplayed()
            compose.onNodeWithTag("habit-color-hue").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { it(200f) }
            compose.onNodeWithTag("habit-color-sv").performScrollTo().performTouchInput { click(center) }
            compose.runOnIdle {
                assertEquals("Preview changes do not save", original, color)
                assertTrue(saved.isEmpty())
            }
            if (size == 390) capture("color-picker-$dark")
            compose.onNodeWithTag("habit-color-apply").assertHeightIsAtLeast(48.dp).performClick()
            compose.onNodeWithTag("habit-color-picker").assertDoesNotExist()
            lateinit var committed: String
            compose.runOnIdle {
                assertEquals(1, saved.size)
                assertTrue(color.matches(Regex("#[0-9a-f]{6}")))
                assertNotEquals(original, color)
                committed = color
            }
            compose.onNodeWithTag("habit-custom-color").performScrollTo().performClick()
            compose.onNodeWithTag("habit-swatch-#dfc17e").performScrollTo().performClick()
            compose.onNodeWithText(if (dark) "Cancel" else "Отмена").performClick()
            compose.onNodeWithTag("habit-color-picker").assertDoesNotExist()
            compose.runOnIdle { assertEquals(committed, color); assertEquals(1, saved.size) }
            compose.onNodeWithTag("habit-custom-color").performScrollTo().performClick()
            compose.onNodeWithTag("habit-color-apply").performClick()
            compose.runOnIdle { assertEquals(committed, color); assertEquals(listOf(committed, committed), saved) }
            compose.runOnIdle { enabled = false }
            compose.onNodeWithTag("habit-custom-color").assertIsNotEnabled()
        }
    }

    @Test fun timerModesStayBesideEachOtherAndKeepAtLeastOneSelectionInFourteenLocales() {
        var language by mutableStateOf("ru")
        var width by mutableIntStateOf(360)
        var night by mutableStateOf(false)
        var preferences by mutableStateOf(HabitTimerPreferences())
        var valid = false
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(width, night, language) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                HabitTimerPreferenceFields(true, {}, preferences, true, { preferences = it }, { valid = it })
            }
        } } }
        for (locale in languages) for (size in listOf(360, 390)) for (dark in listOf(false, true)) {
            compose.runOnIdle {
                language = locale; width = size; night = dark; preferences = HabitTimerPreferences(); epoch++
            }
            val label = "$locale/$size/$dark/timer-modes"
            val stopwatch = compose.onNodeWithTag("habit-timer-allow-stopwatch").performScrollTo()
                .assertIsDisplayed().assertIsOn().assertIsEnabled()
            val pomodoro = compose.onNodeWithTag("habit-timer-allow-pomodoro").assertIsDisplayed()
                .assertIsOn().assertIsEnabled()
            val left = stopwatch.getUnclippedBoundsInRoot()
            val right = pomodoro.getUnclippedBoundsInRoot()
            assertTouchTarget(left, "$label/stopwatch")
            assertTouchTarget(right, "$label/pomodoro")
            assertEquals("$label: both options start on the same row", left.top.value, right.top.value, 1f)
            assertEquals("$label: both options have the same height", (left.bottom - left.top).value,
                (right.bottom - right.top).value, 1f)
            assertTrue("$label: options have a usable gap", right.left - left.right >= 7.5.dp)
            for (tag in listOf("habit-timer-allow-stopwatch", "habit-timer-allow-pomodoro")) {
                val text = compose.onNode(hasAnyAncestor(hasTestTag(tag)) and
                    SemanticsMatcher.keyIsDefined(SemanticsProperties.Text), useUnmergedTree = true)
                assertCompleteText(text, "$label/$tag")
            }
            if (locale == "fr" && size == 390) capture("timer-$dark")
            stopwatch.performClick().assertIsOff()
            pomodoro.assertIsOn().assertIsNotEnabled()
            compose.runOnIdle { assertEquals(listOf("pomodoro"), preferences.modes); assertTrue(valid) }
            stopwatch.performClick().assertIsOn()
            pomodoro.assertIsOn().assertIsEnabled()
            compose.runOnIdle {
                assertEquals(listOf("stopwatch", "pomodoro"), preferences.modes)
                assertEquals(25, preferences.workMinutes)
                assertEquals(5, preferences.breakMinutes)
                assertTrue(valid)
            }
        }
    }
}
