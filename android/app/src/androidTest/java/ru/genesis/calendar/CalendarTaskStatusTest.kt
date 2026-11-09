package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.ui.CalendarScreen
import ru.genesis.calendar.ui.standart

/** Exercise status transitions through real calendar controls without touching account data. */
class CalendarTaskStatusTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    private fun disc(date: LocalDate) = compose.onNodeWithTag(
        "calendar-task-count-disc-$date", useUnmergedTree = true)

    private fun assertColor(date: LocalDate, done: Boolean) {
        disc(date).performScrollTo().assertIsDisplayed()
        compose.mainClock.advanceTimeBy(400)
        compose.waitForIdle()
        val expected = Color(if (done) 0xff255b59 else 0xffb63b42).toArgb()
        // Dialog dimming belongs to the Android window and can outlast Compose idleness.
        compose.waitUntil(5_000) {
            val image = disc(date).captureToImage().asAndroidBitmap()
            (0 until image.width).any { x ->
                (0 until image.height).any { y -> image.getPixel(x, y) == expected }
            }
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(
            File(instrumentation.targetContext.getExternalFilesDir(null), "${BuildConfig.VERSION_NAME}-$name.png")))
    }

    @Test fun everyCalendarSeparatesStatusesAndUpdatesCountersAfterCompletionAndDeletion() {
        val date = LocalDate.of(2026, 9, 28)
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var tasks by mutableStateOf(emptyList<LocalTask>())
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface(Modifier.fillMaxSize(), color = standart.background) {
                    Column(Modifier.safeDrawingPadding()) {
                        CalendarScreen(date, mode, {}, experimental = true, tasks = tasks,
                            onCompleteTask = { task -> tasks = tasks.map { if (it.id == task.id) it.copy(done = !it.done) else it } },
                            onDeleteTask = { task -> tasks = tasks.filterNot { it.id == task.id } })
                    }
                }
            }
        }
        CalendarMode.entries.forEach { nextMode ->
            compose.runOnIdle {
                mode = nextMode
                tasks = listOf(LocalTask("pending", "Невыполненная задача", date = date.toString()),
                    LocalTask("completed", "Выполненная задача", date = date.toString(), done = true))
            }
            compose.onNodeWithTag("calendar-task-count-$date").performScrollTo()
            assertColor(date, false)
            assertColor(date, true)
            capture("${nextMode.name.lowercase()}-mixed")
            compose.onNodeWithTag("calendar-task-count-$date").performClick()
            compose.onNodeWithTag("calendar-task-complete-pending").performClick()
            compose.onNodeWithContentDescription("Закрыть").performClick()
            disc(date).assertContentDescriptionEquals("Не выполнено: 0. Выполнено: 2")
            assertColor(date, true)
            disc(date).assert(hasAnyDescendant(hasText("2")))
            capture("${nextMode.name.lowercase()}-completed")
            compose.onNodeWithTag("calendar-task-count-$date").performClick()
            compose.onNodeWithTag("calendar-task-complete-pending").performClick()
            compose.onNodeWithTag("calendar-task-delete-pending").performClick()
            compose.onNodeWithTag("calendar-delete-confirm").performClick()
            compose.onNodeWithTag("calendar-task-pending").assertDoesNotExist()
            compose.onNodeWithContentDescription("Закрыть").performClick()
            disc(date).assertContentDescriptionEquals("Не выполнено: 0. Выполнено: 1")
            disc(date).assert(hasAnyDescendant(hasText("1")))
            compose.onNodeWithTag("calendar-task-count-$date").performClick()
            compose.onNodeWithTag("calendar-task-delete-completed").performClick()
            compose.onNodeWithTag("calendar-delete-confirm").performClick()
            compose.onNodeWithText("На этот день задач больше нет.").assertExists()
            compose.onNodeWithContentDescription("Закрыть").performClick()
            compose.onNodeWithTag("calendar-task-count-$date").assertDoesNotExist()
        }
    }

    @Test fun deletedRecurringOccurrenceHasNoCounterWhileRemainingCompletedDatesStayGreen() {
        val date = LocalDate.of(2026, 9, 10)
        val tasks = listOf(LocalTask("series", "Выполненная серия", date = date.toString(), done = true,
            recurrence = RecurrenceConfig(enabled = true, mode = "classic", pattern = "daily",
                rangeStart = date.toString(), rangeEnd = date.plusDays(2).toString()),
            recurrenceExcludedDates = listOf(date.plusDays(1).toString())))
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface(Modifier.fillMaxSize(), color = standart.background) {
                    Column(Modifier.safeDrawingPadding()) {
                        CalendarScreen(date, CalendarMode.PROFANE, {}, experimental = true, tasks = tasks)
                    }
                }
            }
        }
        compose.onNodeWithTag("calendar-task-count-$date").performScrollTo()
        assertColor(date, true)
        compose.onNodeWithTag("calendar-task-count-${date.plusDays(1)}").assertDoesNotExist()
        assertColor(date.plusDays(2), true)
        compose.onNodeWithText("Год").performClick()
        compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2026-09-01"))
        compose.onNodeWithTag("calendar-year-task-count-disc-9", useUnmergedTree = true).assertContentDescriptionEquals("Не выполнено: 0. Выполнено: 2")
        compose.onNodeWithTag("calendar-year-task-open-count-9", useUnmergedTree = true).assertDoesNotExist()
        capture("recurring-year")
    }
}
