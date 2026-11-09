package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.TaskOccurrences
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.ui.dismissValidationKeyboard

/** End-to-end dialog actions must reach the existing encrypted task repository. */
class CalendarTaskActionsTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private fun openPage(page: String) {
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-$page-root").performScrollTo().performClick()
        compose.waitUntil(5_000) { !compose.onNodeWithTag("workspace-drawer").isDisplayed() }
        if (page == "Календарь") compose.onNodeWithTag("submenu-month").performClick()
        if (page == "Проекты" && compose.onAllNodesWithTag("submenu-personal").fetchSemanticsNodes().isNotEmpty())
            compose.onNodeWithTag("submenu-personal").performClick()
    }

    @Test fun creatingTaskFromTasksAndMonthNeverOpensDeleteConfirmation() {
        openPage("Проекты")
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("personal-create-task").performClick()
        compose.onNodeWithTag("task-title").assertExists()
        compose.onNodeWithTag("delete-series").assertDoesNotExist()
        compose.onNodeWithText("Напоминание этой задачи будет отменено.").assertDoesNotExist()
        compose.onNodeWithTag("close-task-editor").performClick()

        openPage("Календарь")
        compose.onNodeWithTag("calendar-create-task").performScrollTo().performClick()
        compose.onNodeWithTag("task-title").assertExists()
        compose.onNodeWithTag("delete-series").assertDoesNotExist()
        compose.onNodeWithText("Напоминание этой задачи будет отменено.").assertDoesNotExist()
    }

    @Test fun dayDialogCompletesEditsAndDeletesTheStoredTask() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val date = LocalDate.now().withDayOfMonth(10)
        val task = LocalTask(id = UUID.randomUUID().toString(), title = "Mobile task actions", date = date.toString(), time = "18:30")
        try {
            runBlocking { preferences.set("display", "profane"); preferences.set("time", "12h"); app.repository.save(task) }
            openPage("Календарь")
            compose.onNodeWithTag("calendar-task-count-$date").performScrollTo().performClick()
            compose.onNodeWithText("6:30 PM", substring = true).assertExists()
            compose.onNodeWithTag("calendar-task-complete-${task.id}").assertIsOff().performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(task.id)?.done == true } }
            compose.onNodeWithTag("calendar-task-complete-${task.id}").assertIsOn()
            compose.onNodeWithTag("calendar-task-complete-${task.id}").performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(task.id)?.done == false } }
            compose.onNodeWithTag("calendar-task-edit-${task.id}").performClick()
            compose.onNodeWithTag("calendar-task-list-dialog").assertDoesNotExist()
            compose.onNodeWithTag("task-title").performTextReplacement("Mobile task edited")
            compose.onNodeWithTag("task-title").assertTextContains("Mobile task edited")
            compose.dismissValidationKeyboard()
            captureNativeWindow(java.io.File(app.getExternalFilesDir(null), "full-qa-calendar-task-before-save.png"))
            println("GENESIS_QA_EDITOR_BEFORE_SAVE=" + compose.onNodeWithTag("task-title").printToString())
            compose.onNodeWithTag("task-title").assertTextContains("Mobile task edited")
            compose.onNodeWithTag("save-task").assertIsEnabled().performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(task.id)?.title == "Mobile task edited" } }
            assertEquals(date.toString(), runBlocking { app.repository.get(task.id) }!!.date)
            compose.onNodeWithTag("calendar-task-count-$date").performScrollTo().performClick()
            compose.onNode(hasText("Mobile task edited") and hasAnyAncestor(hasTestTag("calendar-task-list-dialog"))).assertExists()
            compose.onNodeWithTag("calendar-task-delete-${task.id}").performClick()
            compose.onNodeWithText("Отмена").performClick()
            assertNotNull(runBlocking { app.repository.get(task.id) })
            compose.onNodeWithTag("calendar-task-delete-${task.id}").performClick()
            compose.onNodeWithTag("calendar-delete-confirm").performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(task.id) == null } }
            compose.onNodeWithTag("calendar-task-${task.id}").assertDoesNotExist()
        } finally {
            runBlocking {
                if (app.repository.get(task.id) != null) app.repository.delete(task.id)
                preferences.set("display", original.display.wireValue)
                preferences.set("time", if (original.use24) "24h" else "12h")
            }
        }
    }

    @Test fun recurringTaskKeepsOtherDatesWhenOnlyOneOccurrenceIsDeleted() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val date = LocalDate.now().withDayOfMonth(10)
        val next = date.plusDays(1)
        val task = LocalTask(id = UUID.randomUUID().toString(), title = "Mobile recurring actions", date = date.toString(),
            recurrence = RecurrenceConfig(enabled = true, mode = "classic", pattern = "daily",
                rangeStart = date.toString(), rangeEnd = date.plusDays(2).toString()))
        try {
            runBlocking { preferences.set("display", "profane"); app.repository.save(task) }
            openPage("Календарь")
            compose.onNodeWithTag("calendar-task-count-$date").performScrollTo().performClick()
            compose.onNodeWithTag("calendar-task-delete-${task.id}").performClick()
            compose.onNodeWithTag("calendar-delete-occurrence").performClick()
            compose.waitUntil(10_000) { runBlocking {
                app.repository.get(task.id)?.recurrenceExcludedDates?.contains(date.toString()) == true
            } }
            val remaining = runBlocking { app.repository.get(task.id) }!!
            assertFalse(TaskOccurrences.occursOn(remaining, date))
            assertTrue(TaskOccurrences.occursOn(remaining, next))
            compose.onNodeWithContentDescription("Закрыть").performClick()
            compose.onNodeWithTag("calendar-task-count-$next").performScrollTo().performClick()
            compose.onNodeWithTag("calendar-task-edit-${task.id}").performClick()
            compose.onNodeWithText("При удалении можно выбрать только $next.", substring = true).assertExists()
            compose.onNodeWithText("Отмена").performClick()
            compose.onNodeWithTag("calendar-task-count-$next").performScrollTo().performClick()
            compose.onNodeWithTag("calendar-task-delete-${task.id}").performClick()
            compose.onNodeWithTag("calendar-delete-confirm").performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(task.id) == null } }
        } finally {
            runBlocking {
                if (app.repository.get(task.id) != null) app.repository.delete(task.id)
                preferences.set("display", original.display.wireValue)
            }
        }
    }
}
