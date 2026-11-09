package ru.genesis.calendar

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test
import androidx.compose.foundation.layout.Column
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File

class CalendarSacredVisibilityTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        check(UiDevice.getInstance(instrumentation).takeScreenshot(
            File(instrumentation.targetContext.cacheDir, "ui214-$name.png")))
    }

    @Test fun calendarRendersWithoutSacredDataInBothThemesAndRestoresItsArtwork() {
        var sacred by mutableStateOf(false)
        var dark by mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalSacredFeaturesEnabled provides sacred,
                LocalEnabledCalendars provides if (sacred) CalendarMode.entries.toSet() else setOf(CalendarMode.PROFANE),
                LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize()) {
                        CalendarScreen(LocalDate.of(2026, 3, 20), CalendarMode.PROFANE,
                            onSelect = {}, experimental = true)
                    }
                }
            }
        }
        for (eveningMode in listOf(false, true)) {
            compose.runOnIdle { dark = eveningMode; sacred = false }
            compose.onNodeWithTag("calendar-selected-primary-date").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("calendar-weekday-art").assertDoesNotExist()
            compose.onNodeWithTag("calendar-selected-fact-blocks").assertDoesNotExist()
            compose.onNodeWithTag("calendar-selected-patron").assertDoesNotExist()
            compose.onNodeWithTag("calendar-mode-icon-profane", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            compose.onAllNodesWithContentDescription("равноденствие", substring = true,
                ignoreCase = true).assertCountEquals(0)
            compose.runOnIdle { sacred = true }
            compose.onNodeWithTag("calendar-weekday-art").assertExists()
            compose.onNodeWithTag("calendar-selected-fact-blocks").assertExists()
        }
        compose.runOnIdle { sacred = false }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("calendar-year-panel").assertExists()
        compose.onNodeWithTag("calendar-mode-icon-profane", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
        for (eveningMode in listOf(false, true)) {
            compose.runOnIdle { dark = eveningMode; sacred = false }
            compose.onNodeWithTag("calendar-year").performScrollToIndex(0)
            compose.onNodeWithTag("calendar-year-solar-card").assertDoesNotExist()
            capture("native-year-plain-${if (eveningMode) "dark" else "light"}")
            compose.runOnIdle { sacred = true }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-solar-card"))
            compose.onNodeWithTag("calendar-year-solar-card").assertIsDisplayed()
            capture("native-year-sacred-${if (eveningMode) "dark" else "light"}")
        }
    }

    @Test fun plainYearNumbersFollowJanuaryOrMarchInBothThemes() {
        var march by mutableStateOf(false)
        var dark by mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalSacredFeaturesEnabled provides false,
                LocalEnabledCalendars provides setOf(CalendarMode.PROFANE), LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize()) {
                        Column {
                            CalendarYearDescriptionCard(ru.genesis.calendar.domain.GenesisCalendar(),
                                LocalDate.of(2026, 10, 17), CalendarMode.PROFANE, march)
                            CalendarScreen(LocalDate.of(2026, 10, 17), CalendarMode.PROFANE,
                                onSelect = {}, experimental = true, gregorianYearStartsInMarch = march,
                                hiddenSubmenus = setOf("calendar.month"))
                        }
                    }
                }
            }
        }
        for (eveningMode in listOf(false, true)) for (fromMarch in listOf(false, true)) {
            compose.runOnIdle { dark = eveningMode; march = fromMarch }
            compose.onNodeWithTag("calendar-year-description-profane").assertDoesNotExist()
            compose.onNodeWithTag("calendar-year").performScrollToIndex(0)
            compose.onNodeWithTag("calendar-flow-nameplate").assertDoesNotExist()
            val firstMonth = if (fromMarch) "2026-03-01" else "2026-01-01"
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-$firstMonth"))
            compose.onNode(hasTestTag("gregorian-year-art-$firstMonth") and hasAnyAncestor(hasTestTag("calendar-year-month-$firstMonth")),
                useUnmergedTree = true).assertExists()
        }
    }
}
