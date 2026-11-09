package ru.genesis.calendar

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import androidx.compose.ui.graphics.Color

/** Real interactions in the debug workspace; never changes a signed-in account. */
class MobilePolishTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    @Before fun requireDebugWorkspace() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        check(app.workspaceScope == "internal-validation-v1")
        compose.runOnUiThread { compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        runBlocking { LocalPreferences(app, app.workspaceScope).set("language", "ru") }
        compose.waitUntil(10_000) { compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.waitForIdle(1000)
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "2.3.4-$name.png")))
    }

    @Test fun compactPersonalControlsMoveHideAndRestoreInboxWithoutChangingTasks() {
        val layout = app.getSharedPreferences("genesis.personal-layout.v1", 0)
        val prefix = app.workspaceScope + ":inbox:"
        val old = listOf("hidden", "bottom").associateWith { if (layout.contains(prefix + it)) layout.getBoolean(prefix + it, false) else null }
        layout.edit().putBoolean(prefix + "hidden", false).putBoolean(prefix + "bottom", false).commit()
        try {
            compose.onNodeWithTag("navigation-Проекты").performClick()
            compose.onNodeWithTag("personal-mindmaps").assertWidthIsAtLeast(300.dp).assertHeightIsAtLeast(48.dp)
            compose.onNodeWithTag("personal-actions").performClick()
            val task = compose.onNodeWithTag("personal-create-task").fetchSemanticsNode().boundsInRoot
            val list = compose.onNodeWithTag("personal-create-list").fetchSemanticsNode().boundsInRoot
            val project = compose.onNodeWithTag("create-project").fetchSemanticsNode().boundsInRoot
            assertTrue(task.bottom <= list.top && list.bottom <= project.top)
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            compose.onNodeWithTag("personal-move-inbox").performScrollTo().performClick()
            compose.waitUntil { layout.getBoolean(prefix + "bottom", false) }
            compose.onNodeWithTag("personal-hide-inbox").performScrollTo().performClick()
            compose.onNodeWithTag("project-inbox").assertDoesNotExist()
            compose.onNodeWithTag("personal-show-inbox").performScrollTo().performClick()
            compose.onNodeWithTag("project-inbox").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("task-sort-control").performScrollTo().performClick()
            compose.onNodeWithTag("task-sort-title").performClick()
            compose.onNodeWithTag("personal-actions").performScrollTo()
            capture("personal-mobile-design")
        } finally {
            layout.edit().apply { old.forEach { (key, value) -> if (value == null) remove(prefix + key) else putBoolean(prefix + key, value) } }.commit()
        }
    }

    @Test fun historyDisclosureAndNamedHabitStatesStayUsableWithBackNavigation() {
        val scopedApp = app
        val repository = HabitsRepository(scopedApp)
        val day = LocalDate.now()
        val habit = Habit(TrackerEntity.create("habit", id = "mobile-history-" + UUID.randomUUID()),
            "Проверка истории", day, HabitEngine(GenesisCalendar()).defaultSchedule(day, CalendarMode.PROFANE))
        runBlocking { repository.save(habit) }
        try {
        compose.onNodeWithTag("navigation-Привычки").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("habit-history-disclosure").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-history-content").assertDoesNotExist()
        compose.onNodeWithTag("habit-history-disclosure").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag("habit-history-content").assertExists()
        capture("habit-history-mobile-design")
        compose.onNodeWithTag("habit-history-disclosure").performScrollTo().performClick()
        compose.onNodeWithTag("habit-history-content").assertDoesNotExist()
        compose.onNodeWithTag("habit-state-choice").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag("habit-state-paused").performClick()
        compose.onNodeWithTag("habit-state-choice").assertTextContains("Пауза", substring = true)
        compose.onNodeWithTag("habit-state-choice").performClick()
        compose.onNodeWithTag("habit-state-active").assertExists()
        InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(350, 5000)
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.onNodeWithTag("habit-state-active").assertDoesNotExist()
        capture("habits-mobile-design")
        compose.onNodeWithTag("habit-state-choice").performClick()
        compose.onNodeWithTag("habit-state-active").performClick()
        } finally { runBlocking { repository.delete(habit.id) } }
    }

    @Test fun dayDescriptionUsesFullCardWidthAndVoiceControlIsUnavailable() {
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-Сегодня-root").performScrollTo().performClick()
        compose.onNodeWithTag("today-art-expand").assertWidthIsAtLeast(240.dp)
        compose.onNodeWithTag("today-day-details-toggle").assertDoesNotExist()
        compose.onNodeWithTag("voice-assistant-open").assertDoesNotExist()
        compose.onNodeWithTag("voice-control-bar").assertDoesNotExist()
        compose.onNodeWithTag("global-calendar-switch").assertIsDisplayed()
        capture("today-full-width-description")
    }

    @Test fun completionIsGreyAndStruckThroughAndCanBeUndone() {
        val taskId = "mobile-polish-completion-${UUID.randomUUID()}"
        runBlocking {
            val old = app.repository.get(taskId)
            app.repository.save(LocalTask(id = taskId, title = "Проверить выполненную задачу",
                date = LocalDate.now().toString(), revision = old?.revision ?: 0))
        }
        try {
            compose.onNodeWithTag("navigation-Проекты").performClick()
            compose.onNodeWithTag("personal-task-search").performTextInput("Проверить выполненную задачу")
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("task-$taskId"))
            val checkbox = compose.onNode(isToggleable() and hasAnyAncestor(hasTestTag("task-$taskId")), useUnmergedTree = true)
            checkbox.assertIsOff().performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.done == true } }
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("task-$taskId"))
            checkbox.assertIsDisplayed().assertIsOn()
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("task-title-$taskId", useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals(TextDecoration.LineThrough, layouts.single().layoutInput.style.textDecoration)
            val completedColor = layouts.single().layoutInput.style.color
            if (compose.onAllNodesWithTag("app-theme-Evening").fetchSemanticsNodes().isNotEmpty()) {
                assertTrue("Completed title must remain readable in the evening theme",
                    completedColor.luminance() > .35f)
            } else assertTrue("Completed title must remain readable on the light surface",
                (Color(0xffecebe7).luminance() + .05f) / (completedColor.luminance() + .05f) >= 4.5f)
            capture("completed-task")
            checkbox.performClick()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.done == false } }
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("task-$taskId"))
            layouts.clear()
            compose.onNodeWithTag("task-title-$taskId", useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertEquals(TextDecoration.None, layouts.single().layoutInput.style.textDecoration)
        } finally { runBlocking { app.repository.delete(taskId) } }
    }

    @Test fun taskCloseRemainsAtTopRightAfterScrollingAndDoesNotSaveDraft() {
        val draft = "Несохранённая задача полировки"
        compose.onNodeWithTag("navigation-Проекты").performClick()
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("personal-create-task").performClick()
        compose.onNodeWithTag("task-title").performTextInput(draft)
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        val close = compose.onNodeWithTag("close-task-editor")
        close.assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        val title = compose.onNodeWithText("Новая задача").fetchSemanticsNode().boundsInRoot
        assertTrue(close.fetchSemanticsNode().boundsInRoot.left >= title.right)
        capture("task-editor-top")
        val before = close.fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("save-task").performScrollTo()
        close.assertIsDisplayed()
        assertEquals(before, close.fetchSemanticsNode().boundsInRoot)
        capture("task-editor-scrolled")
        close.performClick()
        compose.onNodeWithTag("task-title").assertDoesNotExist()
        assertFalse(runBlocking { app.repository.tasks.first().any { it.title == draft } })
    }

    @Test fun projectCloseDiscardsDraftAndSecondClickCollapsesProject() {
        val projectId = "mobile-polish-project"
        val projectTitle = "A Проект проверки сворачивания"
        runBlocking { WorkspaceStructureRepository(app).saveProject(
            GenesisProject(projectId, null, null, projectTitle, "Описание раскрытого проекта", emptyList(), "active", 0)) }
        compose.onNodeWithTag("navigation-Проекты").performClick()
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("create-project").performClick()
        compose.onNodeWithTag("project-title").performTextInput("Несохранённый проект полировки")
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        val close = compose.onNodeWithTag("close-project-editor")
        close.assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
        val title = compose.onNodeWithText("Новый проект").fetchSemanticsNode().boundsInRoot
        assertTrue(close.fetchSemanticsNode().boundsInRoot.left >= title.right)
        capture("project-editor-top")
        val before = close.fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("save-project").performScrollTo()
        close.assertIsDisplayed()
        assertEquals(before, close.fetchSemanticsNode().boundsInRoot)
        close.performClick()
        compose.onNodeWithTag("project-title").assertDoesNotExist()
        assertFalse(runBlocking { WorkspaceStructureRepository(app).workspace.first().projects
            .any { it.title == "Несохранённый проект полировки" } })
        compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$projectId"))
        // Click the title as a user does; the expanded card also contains task buttons.
        val project = compose.onNodeWithText(projectTitle, useUnmergedTree = true)
        project.performClick()
        compose.onNodeWithTag("delete-project-$projectId").assertExists()
        capture("project-expanded")
        project.performClick()
        compose.onNodeWithTag("delete-project-$projectId").assertDoesNotExist()
        capture("project-collapsed")
        project.performClick()
        compose.onNodeWithTag("delete-project-$projectId").assertExists()
    }
}
