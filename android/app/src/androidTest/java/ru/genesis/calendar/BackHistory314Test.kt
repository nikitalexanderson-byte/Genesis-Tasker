package ru.genesis.calendar

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate

/** Real root navigation, real Android Back, without changing the signed-in application. */
class BackHistory314Test {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private fun waitForRoot() = compose.waitUntil(15_000) {
        compose.onAllNodesWithTag("workspace-title").fetchSemanticsNodes().isNotEmpty()
    }
    private fun title(): String {
        compose.waitForIdle()
        return compose.onNodeWithTag("workspace-title").fetchSemanticsNode()
            .config[SemanticsProperties.Text].joinToString { it.text }
    }
    private fun open(page: String): String {
        compose.onNodeWithTag("workspace-menu").performClick()
        val section = if (page == "Привычки") "Привычки" else "root"
        compose.onNodeWithTag("drawer-$page-$section").performScrollTo().performClick()
        compose.waitForIdle()
        return title()
    }
    private fun backTo(expected: String) {
        compose.waitForIdle()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitUntil(10_000) { runCatching { title() == expected }.getOrDefault(false) }
        assertEquals(expected, title())
    }
    private fun inRussian(body: () -> Unit) {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && !app.workspaceScope.startsWith("account-"))
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking { preferences.set("language", "ru") }
            waitForRoot()
            body()
        } finally { runBlocking { preferences.set("language", original.language) } }
    }
    @Test fun drawerTransitionsReturnThroughTheActualScreens() = inRussian {
        val today = title()
        val calendar = open("Календарь")
        val projects = open("Проекты")
        open("Привычки")
        backTo(projects)
        backTo(calendar)
        backTo(today)
    }
    @Test fun directTodayCardIsRecordedAndDrawerBackClosesTheDrawerFirst() = inRussian {
        val calendar = open("Календарь")
        val today = open("Сегодня")
        compose.onNodeWithTag("today-habits-open").performScrollTo().performClick()
        compose.waitForIdle()
        val habits = title()
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-close").assertIsDisplayed()
        backTo(habits)
        backTo(today)
        backTo(calendar)
    }
    @Test fun historySurvivesActivityRecreation() = inRussian {
        val today = title()
        val calendar = open("Календарь")
        open("Проекты")
        compose.activityRule.scenario.recreate()
        waitForRoot()
        backTo(calendar)
        backTo(today)
    }
    @Test fun dateDialogAndEmptyEditorCloseBeforeThePreviousScreen() = inRussian {
        val app = compose.activity.application as GenesisApplication
        val input = runBlocking { LocalPreferences(app, app.workspaceScope).values.first() }.input
        val calendar = open("Календарь")
        val today = open("Сегодня")
        compose.onNodeWithTag("create-task").performScrollTo().performClick()
        compose.onNode(hasText(GenesisCalendar().formatDate(LocalDate.now(), input)) and hasClickAction())
            .performScrollTo().performClick()
        compose.onNodeWithTag("author-date-close").assertExists()
        backTo(today)
        compose.onNodeWithTag("author-date-close").assertDoesNotExist()
        compose.onNodeWithTag("task-title").assertExists()
        backTo(today)
        compose.onNodeWithTag("task-title").assertDoesNotExist()
        backTo(calendar)
    }
}
