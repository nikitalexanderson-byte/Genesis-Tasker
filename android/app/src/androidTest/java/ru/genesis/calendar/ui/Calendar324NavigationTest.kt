package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

/** Production calendar composables with synthetic dates; no account, network or preference writes. */
class Calendar324NavigationTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val languages = listOf("ru", "en", "de", "el", "fr", "es", "it", "pt", "pl", "sr", "uk", "tr", "ja", "zh")

    @Composable private fun Frame(language: String = "ru", night: Boolean = false, content: @Composable () -> Unit) {
        val density = Density(LocalDensity.current.density, 1.3f)
        CompositionLocalProvider(LocalDensity provides density, LocalGenesisLanguage provides language,
            LocalEveningTheme provides night, LocalSacredFeaturesEnabled provides true) {
            MaterialTheme(colorScheme = if (night) evening else standart,
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { Box(Modifier.safeDrawingPadding()) { content() } }
            }
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "calendar324-$name.png"))
    }

    @Test fun allFourteenLanguagesKeepCompleteCopyAndContentSizedHeroesWithLowerCornerArrowsAtFont130() {
        var language by mutableStateOf("ru")
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(LocalDate.of(2026, 10, 4))
        var epoch by mutableIntStateOf(0)
        val calendar = GenesisCalendar()
        val layouts = linkedMapOf<String, TextLayoutResult>()
        val checks = JSONArray()
        compose.setContent { key(epoch) { Frame(language) {
            CompositionLocalProvider(LocalGenesisTextLayoutAudit provides { text, result -> layouts[text] = result }) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    CalendarMonthHero(calendar, date, mode, ZoneId.of("Europe/Moscow"), true, {}, {}, {})
                }
            }
        } } }
        for (locale in languages) for (sample in listOf(LocalDate.of(2026, 10, 4), LocalDate.of(2027, 1, 15))) {
            val heights = mutableListOf<Float>()
            for (choice in CalendarMode.entries) {
                compose.runOnIdle { layouts.clear(); language = locale; date = sample; mode = choice; epoch++ }
                val hero = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
                val previous = compose.onNodeWithTag("calendar-month-previous").getUnclippedBoundsInRoot()
                val next = compose.onNodeWithTag("calendar-month-next").getUnclippedBoundsInRoot()
                val today = compose.onNodeWithTag("calendar-month-today").getUnclippedBoundsInRoot()
                val label = "$locale/$sample/${choice.wireValue}"
                heights += (hero.bottom - hero.top).value
                assertTrue("$label: lower left arrow stays inside artwork", previous.left >= hero.left && previous.bottom <= hero.bottom &&
                    previous.left - hero.left <= 13.dp && hero.bottom - previous.bottom <= 13.dp)
                assertTrue("$label: lower right arrow stays inside artwork", next.right <= hero.right && next.bottom <= hero.bottom &&
                    hero.right - next.right <= 13.dp && hero.bottom - next.bottom <= 13.dp)
                for (arrow in listOf(previous, next)) {
                    assertTrue("$label: arrow has 48dp touch target: $arrow", arrow.right - arrow.left >= 47.5.dp && arrow.bottom - arrow.top >= 47.5.dp)
                }
                assertTrue("$label: Today stays beside the lower right arrow",
                    today.right <= next.left && kotlin.math.abs((today.bottom - next.bottom).value) <= 1f &&
                        today.right - today.left >= 47.5.dp && today.bottom - today.top >= 47.5.dp)
                compose.runOnIdle {
                    val minimumCopyLayouts = if (choice == CalendarMode.LUNAR) 3 else 4
                    assertTrue("$label: actual title and description layouts were observed", layouts.size >= minimumCopyLayouts)
                    layouts.forEach { (text, result) ->
                        assertFalse("$label: complete text must fit: $text", result.hasVisualOverflow || result.splitsWord())
                    }
                }
                checks.put(JSONObject().put("language", locale).put("date", sample.toString())
                    .put("mode", choice.wireValue).put("heightDp", heights.last()))
                if (locale in listOf("ru", "en") && sample.monthValue == 10) capture("hero-$locale-${choice.wireValue}-font130")
            }
            assertTrue("$locale/$sample: each calendar keeps its controls visible: $heights", heights.all { it >= 48f })
        }
        File(context.getExternalFilesDir(null), "calendar324-hero14-font130.json").writeText(checks.toString(2))
    }

    @Test fun shellTitleIdentifiesEveryCalendarInMonthAndYearInFourteenLanguages() {
        var language by mutableStateOf("ru")
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(language) {
            MobileWorkspaceShell("Календарь", null, emptyList(), "QA", false, calendarMode = mode,
                onNavigate = {}, actions = {}) {
                CalendarScreen(LocalDate.of(2026, 10, 4), mode, {}, experimental = true)
            }
        } } }
        for (locale in languages) for (choice in CalendarMode.entries) {
            compose.runOnIdle { language = locale; mode = choice; epoch++ }
            val expected = translateGenesisText(context, calendarScreenTitle(choice), locale)
            fun assertTitle() {
                val title = compose.onNodeWithTag("workspace-title").assertTextEquals(expected).assertIsDisplayed()
                val results = mutableListOf<TextLayoutResult>()
                title.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
                assertFalse("$locale/${choice.wireValue}: title must be complete", results.single().hasVisualOverflow || results.single().splitsWord())
                compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            }
            assertTitle()
            compose.onNodeWithTag("month-description-layout").assertExists()
            compose.onNodeWithTag("calendar-month-navigation").assert(hasAnyAncestor(hasTestTag("month-description-layout")))
            compose.onNodeWithTag("calendar-month-navigation-card").assertDoesNotExist()
            compose.onNodeWithTag("submenu-year").performClick()
            assertTitle()
            compose.onNodeWithTag("calendar-year-navigation").assert(hasAnyAncestor(hasTestTag("calendar-year-navigation-card")))
            compose.onNodeWithTag("month-description-layout").assertDoesNotExist()
        }
    }

    @Test fun previousNextSwipesWeekdayLayoutAndTodayKeepTheActualMonthInEveryCalendar() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(LocalDate.now())
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame {
            CalendarScreen(date, mode, { date = it }, experimental = true)
        } } }
        fun period(): String = compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode()
            .config[SemanticsProperties.Text].joinToString { it.text }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode = choice; date = LocalDate.now(); epoch++ }
            val original = period()
            compose.onNodeWithTag("calendar-month-previous").performScrollTo().performClick()
            compose.waitForIdle()
            assertNotEquals(original, period())
            compose.onNodeWithTag("calendar-month-next").performScrollTo().performClick()
            compose.waitForIdle()
            assertEquals(original, period())
            compose.onNodeWithTag("calendar-month-navigation").performScrollTo().performTouchInput { swipeLeft() }
            compose.waitForIdle()
            assertNotEquals(original, period())
            compose.onNodeWithTag("calendar-month-navigation").performScrollTo().performTouchInput { swipeRight() }
            compose.waitForIdle()
            assertEquals(original, period())
            if (choice == CalendarMode.LUNAR) {
                val before = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
                compose.onNodeWithTag("lunar-layout-weekdays").performScrollTo().performClick()
                val after = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
                assertEquals((before.bottom - before.top).value, (after.bottom - after.top).value, .02f)
            }
            compose.onNodeWithTag("calendar-month-next").performScrollTo().performClick()
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-today").performScrollTo().performClick()
            compose.waitForIdle()
            compose.runOnIdle { assertEquals(LocalDate.now(), date) }
            assertEquals(original, period())
            compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
            val chosen = LocalDate.now().minusDays(1)
            if (GenesisCalendar().monthRange(LocalDate.now(), choice).let { chosen >= it.start && chosen <= it.end }) {
                compose.onNodeWithTag("calendar-day-$chosen").performScrollTo().performClick()
                compose.waitForIdle()
                compose.onNodeWithTag("calendar-selected-day").assertIsDisplayed()
                compose.runOnIdle { assertEquals(chosen, date) }
                compose.onNodeWithTag("calendar-month-today").performScrollTo().performClick()
                compose.waitForIdle()
            }
            capture("navigation-${choice.wireValue}-font130")
        }
    }

    @Test fun nextMonthMovesLeftWithIncomingPageOnRightAndReducedMotionCompletesImmediately() {
        var page by mutableIntStateOf(0)
        var reduced by mutableStateOf(false)
        var advance: () -> Unit = {}
        compose.setContent { Frame {
            CalendarPeriodPager(page, page - 1, page + 1, { page-- }, { page++ },
                transitionMillis = if (reduced) 0 else 360) { current, _, next ->
                if (current == page) advance = next
                Box(Modifier.fillMaxWidth().height(220.dp).testTag("calendar324-page-$current")) { Text("Page $current") }
            }
        } }
        compose.mainClock.autoAdvance = false
        try {
            compose.runOnIdle { advance() }
            compose.mainClock.advanceTimeBy(112)
            val outgoing = compose.onNodeWithTag("calendar324-page-0").getUnclippedBoundsInRoot()
            val incoming = compose.onNodeWithTag("calendar324-page-1").getUnclippedBoundsInRoot()
            assertTrue(outgoing.left < 0.dp)
            assertTrue(incoming.left > 0.dp)
            assertEquals((outgoing.right - outgoing.left).value, (incoming.left - outgoing.left).value, 1f)
            compose.mainClock.advanceTimeBy(600)
            compose.runOnIdle { assertEquals(1, page) }
        } finally { compose.mainClock.autoAdvance = true }
        compose.runOnIdle { reduced = true }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        try {
            compose.runOnIdle { advance(); assertEquals(2, page) }
            compose.mainClock.advanceTimeByFrame()
            compose.onNodeWithTag("calendar324-page-2").assertIsDisplayed()
            compose.onNodeWithTag("calendar324-page-1").assertDoesNotExist()
        } finally { compose.mainClock.autoAdvance = true }
    }
}
