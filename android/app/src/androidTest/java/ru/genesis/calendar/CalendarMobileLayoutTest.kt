package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.CalendarScreen
import ru.genesis.calendar.ui.mobileCalendarCopy
import ru.genesis.calendar.ui.calendarName
import ru.genesis.calendar.ui.LocalGenesisLanguage
import ru.genesis.calendar.ui.StoicheionScreen
import ru.genesis.calendar.ui.standart
import ru.genesis.calendar.ui.evening
import ru.genesis.calendar.ui.LocalEveningTheme

/** Checks the installed native layout and touch bounds, with no account or server data. */
class CalendarMobileLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val requestedWidth = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull()
    private val requestedDark = InstrumentationRegistry.getArguments().getString("genesisDark").toBoolean()
    private val scheme get() = if (requestedDark) evening else standart
    private fun viewportModifier() = Modifier.safeDrawingPadding().heightIn(max = 760.dp).then(
        requestedWidth?.let { Modifier.width(it.dp) } ?: Modifier)
    private fun setViewportContent(content: @Composable () -> Unit) {
        compose.setContent {
            val originalDensity = LocalDensity.current
            val viewportDensity = requestedWidth?.let {
                Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / it, originalDensity.fontScale)
            } ?: originalDensity
            CompositionLocalProvider(LocalDensity provides viewportDensity,
                LocalEveningTheme provides requestedDark) { content() }
        }
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        compose.waitForIdle()
        val device = UiDevice.getInstance(instrumentation)
        device.waitForIdle(2_000)
        assertTrue(device.takeScreenshot(
            File(instrumentation.targetContext.cacheDir,
                "${BuildConfig.VERSION_NAME}-${requestedWidth?.let { "${it}dp-" } ?: ""}${if (requestedDark) "dark" else "light"}-$name.png")))
    }

    @Test fun viewSwitchPrecedesScrollingMonthAndYearHeadingsInEveryCalendar() {
        var mode by mutableStateOf(CalendarMode.SACRED)
        val date = LocalDate.of(2026, 9, 28)
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) {
                        CalendarScreen(date, mode, onSelect = {}, experimental = true)
                    }
                }
            }
        }
        CalendarMode.entries.forEach { nextMode ->
            compose.runOnIdle { mode = nextMode }
            compose.onNodeWithText("Месяц").performClick()
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            val switch = compose.onNodeWithTag("calendar-view-switch").fetchSemanticsNode().boundsInRoot
            val navigation = compose.onNodeWithTag("month-description-layout").fetchSemanticsNode().boundsInRoot
            compose.onNodeWithTag("calendar-month-navigation").assert(hasAnyAncestor(hasTestTag("month-description-layout")))
            assertTrue("View controls must precede the period", switch.bottom <= navigation.top)
            capture("${nextMode.name.lowercase()}-month-top")
            compose.onNodeWithTag("calendar-selected-day").performScrollTo()
            compose.onNodeWithTag("calendar-view-switch").assertIsDisplayed()
            capture("${nextMode.name.lowercase()}-month-scrolled")
            compose.onNodeWithText("Год").performClick()
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            val firstTag = when (nextMode) {
                CalendarMode.SACRED -> "sacred-year-month-0"
                CalendarMode.LUNAR -> "lunar-year-month-1"
                CalendarMode.PROFANE -> "calendar-year-month-2026-01-01"
            }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(firstTag))
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasContentDescription("Иллюстрация месяца", substring = true) and
                    hasAnyAncestor(hasTestTag(firstTag)), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
            capture("${nextMode.name.lowercase()}-year-months")
            val lastTag = when (nextMode) {
                CalendarMode.SACRED -> "sacred-year-month-12"
                CalendarMode.LUNAR -> "lunar-year-month-12"
                CalendarMode.PROFANE -> "calendar-year-month-2026-11-01"
            }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(lastTag))
            compose.onNodeWithTag(lastTag).assertIsDisplayed()
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            compose.onNodeWithTag("calendar-view-switch").assertIsDisplayed()
            compose.onNodeWithTag(lastTag).performClick()
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
        }
    }

    @Test fun gregorianYearShowsSeasonsDayAndTaskCountsWithoutDuplicateHeadings() {
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) {
                        CalendarScreen(LocalDate.of(2028, 2, 14), CalendarMode.PROFANE, onSelect = {}, experimental = true)
                    }
                }
            }
        }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2028-02-01"))
        compose.onNodeWithTag("gregorian-year-art-2028-02-01", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("gregorian-year-start-2", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("gregorian-year-end-2", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("ГРИГОРИАНСКИЙ МЕСЯЦ 2").assertDoesNotExist()
        compose.onNodeWithTag("calendar-year-task-count-disc-2", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("gregorian-season-winter").assertExists()
        compose.onNodeWithTag("calendar-year-days-2", useUnmergedTree = true).assert(hasText("29 дней"))
        capture("gregorian-leap-year")
        compose.onNodeWithTag("calendar-year-month-2028-02-01").performClick()
        compose.onNodeWithTag("calendar-day-2028-02-29").performScrollTo().assertIsEnabled()
    }

    @Test fun marchYearInAustraliaStartsWithAutumnAndEndsWithSummer() {
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) {
                        CalendarScreen(LocalDate.of(2027, 1, 10), CalendarMode.PROFANE,
                            onSelect = {}, experimental = true, gregorianYearStartsInMarch = true,
                            regionalSeasonArt = true, seasonRegionZone = ZoneId.of("Australia/Sydney"))
                    }
                }
            }
        }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("calendar-year")
            .performScrollToNode(hasTestTag("calendar-year-month-2026-03-01"))
        compose.onNodeWithTag("gregorian-season-autumn").assertExists()
        compose.onNodeWithTag("gregorian-season-art-autumn", useUnmergedTree = true).assertExists()
        capture("australia-march-year-autumn")
        compose.onNodeWithTag("calendar-year")
            .performScrollToNode(hasTestTag("calendar-year-month-2027-02-01"))
        compose.onNodeWithTag("gregorian-season-summer").assertExists()
        compose.onNodeWithTag("gregorian-season-art-summer", useUnmergedTree = true).assertExists()
        capture("australia-march-year-summer")
    }

    @Test fun choosingADayStopsAtItsFirstIllustratedBlockInEachCalendar() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val date = LocalDate.of(2026, 9, 28)
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) { CalendarScreen(date, mode, onSelect = {}, experimental = true) }
                }
            }
        }
        CalendarMode.entries.forEach { next ->
            compose.runOnIdle { mode = next }
            compose.onNodeWithTag("calendar-day-2026-09-26").performScrollTo().performClick()
            compose.waitUntil(10_000) {
                val card = compose.onNodeWithTag("calendar-selected-day").fetchSemanticsNode().boundsInRoot
                val viewport = compose.onNodeWithTag("calendar-month").fetchSemanticsNode().boundsInRoot
                card.top >= viewport.top - 3 && card.top <= viewport.top + 12 * compose.activity.resources.displayMetrics.density
            }
            capture("${next.name.lowercase()}-selected-day-start")
        }
    }

    @Test fun gregorianBadgeHasCompactDiscAndFullHeightFingerTarget() {
        val date = LocalDate.of(2026, 9, 26)
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) {
                        CalendarScreen(date, CalendarMode.PROFANE, onSelect = {}, experimental = true,
                            tasks = listOf(LocalTask(id = "finger-target", title = "Задача для проверки", date = date.toString())))
                    }
                }
            }
        }
        val badge = compose.onNodeWithTag("calendar-task-count-$date").performScrollTo()
        badge.assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("calendar-task-count-disc-$date", useUnmergedTree = true)
            .assertWidthIsEqualTo(18.dp).assertHeightIsEqualTo(18.dp)
        capture("gregorian-task-target")
        badge.performClick()
        compose.onNodeWithTag("calendar-task-list-dialog").assertIsDisplayed()
        capture("day-task-actions")
    }

    @Test fun stoicheionHeaderScrollsWithOriginalLetterCards() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        setViewportContent {
            MaterialTheme(colorScheme = scheme) {
                Surface(Modifier.fillMaxSize(), color = scheme.background) {
                    Column(viewportModifier()) { StoicheionScreen(app, divinationDisabled = true) }
                }
            }
        }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("stoicheion-alphabet-toggle").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithTag("stoicheion-letter-alpha").assertCountEquals(0)
        compose.onNodeWithTag("genesis-page-header").assertIsDisplayed()
        compose.onNodeWithTag("genesis-page-header").assert(hasAnyAncestor(hasTestTag("stoicheion-grid")))
        capture("stoicheion-top")
        compose.onNodeWithTag("stoicheion-alphabet-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("stoicheion-grid").performScrollToNode(hasTestTag("stoicheion-letter-omega"))
        compose.onNodeWithTag("stoicheion-letter-omega").assertIsDisplayed()
        capture("stoicheion-scrolled")
    }

    @Test fun englishYearHeadingAndGregorianDatesStayLocalized() {
        setViewportContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "en") {
                MaterialTheme(colorScheme = scheme) {
                    Surface(Modifier.fillMaxSize(), color = scheme.background) {
                        Column(viewportModifier()) {
                            CalendarScreen(LocalDate.of(2026, 9, 28), CalendarMode.PROFANE, onSelect = {})
                        }
                    }
                }
            }
        }
        compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
        compose.onNodeWithText("Year").performClick()
        compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
        compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2026-01-01"))
        compose.onNodeWithTag("gregorian-year-start-1", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("gregorian-year-end-1", useUnmergedTree = true).assertDoesNotExist()
        compose.onAllNodesWithText("Winter").onFirst().assertExists()
        capture("gregorian-english-year")
    }
}
