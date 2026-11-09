package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.util.UUID

class AndroidAffairsUiTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun regionalAffairsCopyIsAvailableOfflineInTheApk() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("мин", ru.genesis.calendar.ui.translateGenesisText(context, "мин", "ru"))
        for ((language, expected) in mapOf("fr" to "Paramètres du tableau", "de" to "Board-Einstellungen",
            "ja" to "ボード設定", "el" to "Ρυθμίσεις πίνακα", "uk" to "Налаштування дошки")) {
            assertEquals(expected, ru.genesis.calendar.ui.translateGenesisText(context, "Настройки доски", language))
        }
    }

    @Test fun personalProjectsTasksAndListsShareOneMenuDestination() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val before = runBlocking { app.repository.tasks.first().map { it.id }.toSet() }
        compose.onNodeWithTag("navigation-Задачи").assertDoesNotExist()
        compose.onNodeWithTag("navigation-Проекты").performClick()
        compose.onNodeWithTag("projects-screen").assertExists()
        compose.onNodeWithTag("personal-affairs-view").assertDoesNotExist()
        compose.onNodeWithTag("submenu-tasks").assertDoesNotExist()
        compose.onNodeWithTag("submenu-lists").assertDoesNotExist()
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("personal-create-task").performClick()
        compose.onNodeWithTag("task-title").assertExists()
        compose.onNodeWithText("Отмена").performScrollTo().performClick()
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("personal-create-list").performClick()
        compose.onNodeWithTag("task-list-title").assertExists()
        compose.onNodeWithTag("close-task-list-editor").performClick()
        compose.onNodeWithTag("projects-screen").assertExists()
        assertEquals(before, runBlocking { app.repository.tasks.first().map { it.id }.toSet() })
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(app.getExternalFilesDir(null), "android-affairs-personal.png"))
    }

    @Test fun freshDefaultsPreserveExplicitSelections() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = LocalPreferences(context, "test-defaults-${UUID.randomUUID()}")
        val fresh = prefs.values.first()
        assertEquals(CalendarMode.PROFANE, fresh.display)
        assertEquals(CalendarMode.PROFANE, fresh.input)
        assertFalse(fresh.navigationLabels)
        assertFalse(fresh.settingsMenuLabels)
        assertTrue(fresh.settingsSubmenuEnabled && fresh.menuSwipeEnabled && fresh.menuSwipeSubmenus)
        assertFalse(fresh.menuThreadsEnabled)
        prefs.set("display", "sacred"); prefs.set("input", "lunar")
        prefs.set("settingsMenuLabels", "text"); prefs.set("menuSwipeEnabled", "false")
        prefs.initializeNewAccount()
        val kept = prefs.values.first()
        assertEquals(CalendarMode.SACRED, kept.display)
        assertEquals(CalendarMode.LUNAR, kept.input)
        assertTrue(kept.settingsMenuLabels)
        assertFalse(kept.menuSwipeEnabled)
    }

    @Test fun todayDetailsAreSacredOnlyAndLunarHeroContainsItsPhase() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first() }
        try {
            compose.onNodeWithTag("navigation-Сегодня").performClick()
            runBlocking { prefs.set("display", "profane") }
            compose.waitForIdle()
            compose.onNodeWithTag("today-day-details-toggle").assertDoesNotExist()
            runBlocking { prefs.set("display", "lunar") }
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("today-lunar-phase").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("today-day-details-toggle").assertDoesNotExist()
            compose.scrollToTodayNode(hasTestTag("today-lunar-phase"))
            compose.onNodeWithTag("today-lunar-phase").assertIsDisplayed()
            compose.onNodeWithTag("lunar-calendar-card").assertDoesNotExist()
            androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "android-today-lunar.png"))
            runBlocking { prefs.set("display", "sacred") }
            compose.scrollToTodayNode(hasTestTag("today-day-details-toggle"))
            compose.onNodeWithTag("today-day-details-toggle").performClick()
            compose.scrollToTodayNode(hasTestTag("three-rhythms-content"))
            compose.onNodeWithTag("three-rhythms-content").assertExists()
            compose.onNodeWithTag("sacred-calendar-card").assertDoesNotExist()
            androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "android-today-sacred-meaning.png"))
            compose.onNodeWithTag("lunar-calendar-card").assertDoesNotExist()
            compose.onNodeWithTag("gregorian-calendar-card").assertDoesNotExist()
        } finally { runBlocking { prefs.set("display", original.display.wireValue) } }
    }
}
