package ru.genesis.calendar

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import java.time.LocalDate
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.ui.CalendarScreen
import ru.genesis.calendar.ui.LocalGenesisLanguage
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.WelcomeScreen
import ru.genesis.calendar.ui.lunarGridDates
import ru.genesis.calendar.ui.standart
import ru.genesis.calendar.data.LocalTask

class GregorianCalendarVisualTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun selectedGregorianDateUsesWeekdayArtAndGregorianPrimaryLabel() {
        compose.setContent {
            MaterialTheme(colorScheme=standart) {
                Surface(Modifier.fillMaxSize(),color=standart.background) {
                    Column(Modifier.safeDrawingPadding()) {
                        CalendarScreen(LocalDate.of(2026, 1, 29), CalendarMode.PROFANE, onSelect = {})
                    }
                }
            }
        }
        compose.onNodeWithTag("calendar-day-2026-01-29").assertExists()
        compose.onNodeWithTag("calendar-selected-primary-date")
            .assert(hasText("29 января 2026", substring = true))
        compose.onNodeWithTag("calendar-weekday-art").assertExists()
        compose.onNodeWithTag("calendar-selected-patron").assertExists()
        compose.onNodeWithTag("calendar-day-2025-12-28").assertIsNotEnabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(context.getExternalFilesDir(null), "gregorian-refined.png")))
    }

    @Test fun solarPointsAppearInGregorianYear() {
        compose.setContent {
            MaterialTheme(colorScheme=standart) {
                Surface(Modifier.fillMaxSize(),color=standart.background) {
                    Column(Modifier.safeDrawingPadding()) {
                        CalendarScreen(LocalDate.of(2026, 9, 25), CalendarMode.PROFANE,
                            onSelect = {}, experimental = true)
                    }
                }
            }
        }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithText("Солнечные точки года").assertExists()
        compose.onNodeWithTag("solar-point-2026-09-23").assertExists()
        compose.onNodeWithTag("calendar-year-cronus-art").assertDoesNotExist()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(context.getExternalFilesDir(null), "solar-year-refined.png")))
    }

    @Test fun lunarMonthShowsFadingReadOnlyDaysOnBothSides() {
        val date = LocalDate.of(2026, 4, 20)
        val range = ru.genesis.calendar.domain.GenesisCalendar().monthRange(date, CalendarMode.LUNAR)
        val grid = lunarGridDates(range)
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface(Modifier.fillMaxSize(), color = standart.background) {
                    CalendarScreen(date, CalendarMode.LUNAR, onSelect = {}, experimental = true)
                }
            }
        }
        compose.onNodeWithTag("lunar-layout-decades").assertIsSelected()
        compose.onNodeWithTag("lunar-decade-1").assertExists()
        compose.onNodeWithTag("lunar-decade-2").assertExists()
        compose.onNodeWithTag("lunar-decade-3").assertExists()
        compose.onNodeWithTag("calendar-day-${grid.first()}").assertDoesNotExist()
        compose.onNodeWithTag("lunar-layout-weekdays").performClick()
        compose.onNodeWithTag("calendar-day-${grid.first()}").assertIsNotEnabled()
        compose.onNodeWithTag("calendar-day-${range.start}").assertIsEnabled()
        compose.onNodeWithTag("calendar-day-${grid.last()}").performScrollTo()
            .assertIsDisplayed().assertIsNotEnabled()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
                "lunar-month-symmetrical-after.png")))
        compose.onNodeWithTag("calendar-day-${range.start}").performScrollTo().performClick()
        compose.onNodeWithTag("calendar-selected-lunar").assertDoesNotExist()
        compose.onNodeWithTag("calendar-selected-sacred").assertExists()
        compose.onNodeWithTag("calendar-selected-gregorian").assertExists()
        compose.onNodeWithTag("calendar-weekday-art", useUnmergedTree = true).assertExists()
    }

    @Test fun lunarYearUsesMoonMonthCardsAndGregorianRanges() {
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface(Modifier.fillMaxSize(), color = standart.background) {
                    CalendarScreen(LocalDate.of(2026, 9, 28), CalendarMode.LUNAR,
                        onSelect = {}, experimental = true)
                }
            }
        }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("lunar-year-month-1").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("lunar-year-range-1", useUnmergedTree = true).assertExists()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
                "lunar-year-refined-after.png")))
    }

    @Test fun websiteEnglishCopyIsAvailableOffline() {
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "en") {
                MaterialTheme { Column {
                    Text("Привычки")
                    Text("Месяц Рождения и Замысла")
                    Text("Арейос Ридзоматос (Арейос Укореняющий)")
                } }
            }
        }
        compose.onNodeWithText("Habits").assertExists()
        compose.onNodeWithText("Month of Birth and Intention").assertExists()
        compose.onNodeWithText("Areios Ridzomatos (Areios Rooting)").assertExists()
    }

    @Test fun taskCountBadgeOpensDayListInAllThreeMonthCalendars() {
        val date = LocalDate.of(2026, 9, 26)
        var mode by mutableStateOf(CalendarMode.SACRED)
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface(Modifier.fillMaxSize(), color = standart.background) {
                    CalendarScreen(date, mode, onSelect = {}, experimental = true,
                        tasks = listOf(LocalTask(id = "calendar-badge-fixture", title = "Badge task",
                            date = date.toString())))
                }
            }
        }
        listOf(CalendarMode.SACRED, CalendarMode.LUNAR, CalendarMode.PROFANE).forEach { calendarMode ->
            compose.runOnIdle { mode = calendarMode }
            compose.waitForIdle()
            val badge = compose.onNodeWithTag("calendar-task-count-$date").performScrollTo().assertIsDisplayed()
            val dayBounds = compose.onNodeWithTag("calendar-day-$date").fetchSemanticsNode().boundsInRoot
            val badgeBounds = badge.fetchSemanticsNode().boundsInRoot
            assertTrue("Task target stays inside $calendarMode day", badgeBounds.left >= dayBounds.left &&
                badgeBounds.right <= dayBounds.right && badgeBounds.bottom <= dayBounds.bottom)
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
                    "calendar-${calendarMode.name.lowercase()}-task-badge.png")))
            badge.performClick()
            compose.onNodeWithTag("calendar-task-list-dialog").assertIsDisplayed()
            compose.onAllNodesWithText("Badge task").assertCountEquals(2)
            compose.onNodeWithContentDescription("Закрыть").performClick()
        }
    }

    @Test fun welcomeHasLanguageChoiceAndNoWorkspaceShortcut() {
        val app = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as GenesisApplication
        compose.setContent {
            var language by androidx.compose.runtime.remember { mutableStateOf("ru") }
            CompositionLocalProvider(LocalGenesisLanguage provides language) {
                MaterialTheme {
                    WelcomeScreen(AuthPanelState(), AuthController.get(app), language) { language = it }
                }
            }
        }
        compose.onNodeWithTag("genesis-welcome").assertExists()
        compose.onNodeWithTag("welcome-intro").assertExists()
        compose.onNodeWithText("Календарь задач", substring = true).assertExists()
        compose.onNodeWithTag("welcome-google-sign-in").assertExists()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
                "welcome-2.2.9-after.png")))
        compose.onNodeWithTag("language-en").performClick()
        compose.onNodeWithText("Task and project", substring = true).assertExists()
        compose.onNodeWithText("Задачи").assertDoesNotExist()
    }
}
