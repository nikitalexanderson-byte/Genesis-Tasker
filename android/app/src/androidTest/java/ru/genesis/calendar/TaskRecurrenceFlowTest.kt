package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.TaskOccurrences
import ru.genesis.calendar.ui.dismissValidationKeyboard

class TaskRecurrenceFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    private fun selectEditorChoice(tag: String) {
        val viewport = compose.onNodeWithTag("task-editor-scroll")
        val choice = compose.onNodeWithTag(tag)
        viewport.performScrollToNode(hasTestTag(tag))
        choice.performScrollTo() // Position the chip in its own horizontal row too.
        val bounds = choice.getUnclippedBoundsInRoot()
        val frame = viewport.getUnclippedBoundsInRoot()
        val delta = when {
            bounds.bottom > frame.bottom -> (bounds.bottom - frame.bottom).value
            bounds.top < frame.top -> (bounds.top - frame.top).value
            else -> 0f
        }
        val density = compose.activity.resources.displayMetrics.density
        if (delta != 0f) viewport.performSemanticsAction(SemanticsActions.ScrollBy) {
            it(0f, delta * density)
        }
        compose.waitForIdle()
        val node = choice.fetchSemanticsNode()
        assertTrue("The whole choice must be above the fixed footer before tapping $tag",
            node.boundsInRoot.height >= node.size.height - 1f)
        choice.assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil(5_000) { runCatching { choice.assertIsSelected() }.isSuccess }
        choice.assertIsSelected()
    }

    @Test fun taskEditorStoresOneClassicSeriesAndProjectsTomorrow() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val title = "UI серия ${UUID.randomUUID()}"
        compose.openWorkspacePage("Сегодня")
        compose.scrollToTodayNode(hasTestTag("create-task"))
        compose.onNodeWithTag("create-task").performClick()
        compose.onNodeWithTag("task-title").performTextInput(title)
        compose.onNodeWithTag("task-title").assertTextContains(title)
        compose.dismissValidationKeyboard()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "full-qa-recurrence-after-back.png"))
        println("GENESIS_QA_RECURRENCE_AFTER_BACK=" + compose.onNodeWithTag("task-title").printToString())
        compose.onNodeWithTag("task-title").assertTextContains(title)
        selectEditorChoice("task-form-calendar-lunar")
        compose.onNodeWithTag("custom-reminder-toggle").performScrollTo().performClick()
        compose.onNodeWithText("За время до задачи").assertExists()
        compose.onNodeWithTag("custom-reminder-toggle").performScrollTo().performClick()
        compose.onNodeWithText("За время до задачи").assertDoesNotExist()
        compose.onNodeWithTag("custom-reminder-toggle").performScrollTo().performClick()
        compose.onNodeWithText("Точная дата и время").performScrollTo().performClick()
        selectEditorChoice("reminder-form-calendar-profane")
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(app.getExternalFilesDir(null), "task-reminder-mode.png")))
        compose.onNodeWithTag("task-editor-scroll").performScrollToNode(hasTestTag("task-form-calendar-lunar"))
        compose.onNodeWithTag("task-form-calendar-lunar").assertIsSelected()
        compose.onNodeWithTag("custom-reminder-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("recurrence-enabled").performScrollTo().performClick()
        compose.onNodeWithTag("recurrence-enabled").assertIsOn()
        selectEditorChoice("recurrence-mode-classic")
        selectEditorChoice("recurrence-pattern-daily")
        compose.onNodeWithTag("recurrence-count").assertExists()
        compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil(10_000) { runBlocking {
            app.repository.tasks.first().any { it.title == title && it.recurrence.enabled }
        } }
        val stored = runBlocking { app.repository.tasks.first().single { it.title == title } }
        assertEquals("classic", stored.recurrence.mode)
        assertEquals("daily", stored.recurrence.pattern)
        assertTrue(TaskOccurrences.occursOn(stored, LocalDate.parse(stored.date).plusDays(1)))
        assertEquals(1, runBlocking { app.repository.tasks.first().count { it.title == title } })
        compose.scrollToTodayNode(hasText(title))
        compose.onNodeWithText(title).performClick()
        compose.onNodeWithText("Удалить задачу").performScrollTo().performClick()
        compose.onNodeWithTag("delete-occurrence").assertExists().performClick()
        compose.waitUntil(10_000) { runBlocking {
            app.repository.get(stored.id)?.recurrenceExcludedDates?.contains(stored.date) == true
        } }
        val after = runBlocking { app.repository.get(stored.id) }!!
        assertFalse(TaskOccurrences.occursOn(after, LocalDate.parse(stored.date)))
        assertTrue(TaskOccurrences.occursOn(after, LocalDate.parse(stored.date).plusDays(1)))
        assertEquals(1, runBlocking { app.repository.tasks.first().count { it.title == title } })
    }
}
