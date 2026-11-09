package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

/** All captures and tasks are synthetic. Run at each physical viewport and both themes. */
class CompactCalendarMonthTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun equalCellsKeepPersonalCountersAtTopAndSharedCountersAtBottomRight() {
        val args = InstrumentationRegistry.getArguments()
        val dark = args.getString("genesisDark") == "true"
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val date = LocalDate.of(2026, 10, 24)
        compose.setContent {
            CompositionLocalProvider(LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize()) { Column(Modifier.safeDrawingPadding()) {
                        CalendarScreen(date, mode, {}, experimental = true, sharedCounts = mapOf(date.toString() to 3, date.minusDays(1).toString() to 1), tasks = listOf(
                            LocalTask("compact-open", "Задача", date = date.toString()),
                            LocalTask("compact-done", "Готово", date = date.toString(), done = true)))
                    } }
                }
            }
        }
        CalendarMode.entries.forEach { calendarMode ->
            compose.runOnIdle { mode = calendarMode }
            if (calendarMode == CalendarMode.LUNAR && args.getString("genesisLunarWeekdays") == "true")
                compose.onNodeWithTag("lunar-layout-weekdays").performScrollTo().performClick()
            val day = compose.onNodeWithTag("calendar-day-$date").performScrollTo()
            val bounds = day.fetchSemanticsNode().boundsInRoot
            val shared = compose.onNodeWithTag("calendar-shared-count-$date", useUnmergedTree = true)
                .assertWidthIsEqualTo(18.dp).assertHeightIsEqualTo(18.dp).fetchSemanticsNode().boundsInRoot
            val personal = compose.onNodeWithTag("calendar-task-count-disc-$date", useUnmergedTree = true)
                .assertWidthIsEqualTo(18.dp).assertHeightIsEqualTo(18.dp)
                .assertContentDescriptionEquals("Не выполнено: 1. Выполнено: 1").fetchSemanticsNode().boundsInRoot
            assertEquals(shared.right, personal.right, 1f)
            assertTrue(personal.bottom <= shared.top)
            assertTrue(personal.top - bounds.top <= 8f * compose.activity.resources.displayMetrics.density)
            assertTrue(bounds.bottom - shared.bottom <= 8f * compose.activity.resources.displayMetrics.density)
            val loneBounds = compose.onNodeWithTag("calendar-day-${date.minusDays(1)}").fetchSemanticsNode().boundsInRoot
            val lone = compose.onNodeWithTag("calendar-shared-count-${date.minusDays(1)}", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue(loneBounds.bottom - lone.bottom <= 8f * compose.activity.resources.displayMetrics.density)
            assertTrue(loneBounds.right - lone.right <= 8f * compose.activity.resources.displayMetrics.density)
            assertTrue(personal.bottom <= bounds.bottom)
            val description = day.fetchSemanticsNode().config[SemanticsProperties.ContentDescription].joinToString()
            assertFalse(description.contains("Восход")); assertFalse(description.contains("закат"))
            val next = compose.onNodeWithTag("calendar-day-${date.minusDays(1)}").fetchSemanticsNode().boundsInRoot
            assertEquals("Task counts must not stretch a day", bounds.height, next.height, 1f)
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val folder = File(compose.activity.getExternalFilesDir(null), "hotfix-months").apply { mkdirs() }
            assertTrue(device.takeScreenshot(File(folder, "${args.getString("genesisWidth", "default")}-${if (dark) "dark" else "light"}-${calendarMode.wireValue}.png")))
            compose.onNodeWithTag("calendar-task-count-$date").assertHeightIsAtLeast(48.dp).performClick()
            compose.onNodeWithTag("calendar-task-list-dialog").assertIsDisplayed()
            compose.onNodeWithText("Закрыть").performClick()
            day.performTouchInput { click(androidx.compose.ui.geometry.Offset(2f, 2f)) }
            compose.onNodeWithTag("calendar-selected-day").performScrollTo()
            compose.onNodeWithTag("calendar-selected-${calendarMode.wireValue}").let { primary ->
                if (calendarMode != CalendarMode.PROFANE) primary.assertDoesNotExist()
            }
            if (calendarMode == CalendarMode.PROFANE) {
                compose.onAllNodesWithTag("calendar-selected-gregorian").assertCountEquals(1)
                val facts = compose.onNodeWithTag("calendar-selected-gregorian").fetchSemanticsNode().boundsInRoot
                val patron = compose.onNodeWithTag("calendar-selected-patron").fetchSemanticsNode().boundsInRoot
                assertTrue("Civil date facts precede the patron", facts.bottom <= patron.top)
            }
            assertTrue(device.takeScreenshot(File(folder, "${args.getString("genesisWidth", "default")}-${if (dark) "dark" else "light"}-${calendarMode.wireValue}-selected.png")))
        }
        compose.runOnIdle { mode = CalendarMode.PROFANE }
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2026-10-01"))
        val own = compose.onNodeWithTag("calendar-year-task-count-disc-10", useUnmergedTree = true)
            .assertWidthIsEqualTo(23.dp).assertHeightIsEqualTo(23.dp).fetchSemanticsNode().boundsInRoot
        val common = compose.onNodeWithTag("calendar-year-shared-count-10", useUnmergedTree = true)
            .assertWidthIsEqualTo(23.dp).assertHeightIsEqualTo(23.dp).fetchSemanticsNode().boundsInRoot
        assertEquals(own.right, common.right, 1f); assertTrue(own.bottom <= common.top)
        val folder = File(compose.activity.getExternalFilesDir(null), "hotfix-months").apply { mkdirs() }
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(File(folder,
            "${args.getString("genesisWidth", "default")}-${if (dark) "dark" else "light"}-year.png")))
    }
}
