package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences

class MenuSwipeNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun portraitSwipeIncludesSubmenusAndCalendarUsesArrows() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val device = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        try {
            val naturalLandscape = compose.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            if (naturalLandscape) device.setOrientationLeft() else device.setOrientationNatural()
            compose.waitUntil(10_000) {
                compose.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT
            }
            runBlocking {
                preferences.set("menuSwipeEnabled", "false")
                preferences.set("menuSwipeSubmenus", "false")
                preferences.set("language", "ru")
            }
            compose.onNodeWithTag("navigation-Настройки").performClick()
            compose.onNodeWithTag("appearance-menu-toggle").performScrollTo().performClick()
            compose.onNodeWithTag("menu-swipe-on").performScrollTo().performClick()
            compose.onNodeWithTag("menu-swipe-submenus").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking {
                preferences.values.first().let { it.menuSwipeEnabled && it.menuSwipeSubmenus }
            } }
            compose.onNodeWithTag("menu-swipe-submenus").assertIsOn()
            compose.onNodeWithText("При общем свайпе месяцы и годы переключаются стрелками.")
                .performScrollTo()
            compose.waitForIdle()
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(
                InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "menu-swipe-settings.png")))

            compose.onNodeWithTag("navigation-Сегодня").performClick()
            device.executeShellCommand("dumpsys gfxinfo ru.genesis.calendar.debug reset")
            compose.onNodeWithTag("main-content").performTouchInput { swipeRight() }
            compose.waitForIdle()
            compose.onNodeWithTag("today-list").assertExists()
            compose.onNodeWithTag("main-content").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("projects-screen").assertExists()
            compose.onNodeWithTag("submenu-tasks").performClick()
            compose.onNodeWithTag("tasks-screen").assertExists()
            compose.onNodeWithTag("submenu-lists").performClick()
            compose.onNodeWithTag("tasks-screen").assertExists()
            compose.onNodeWithTag("submenu-projects").performClick()
            compose.onNodeWithTag("main-content").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("submenu-tasks").assertIsSelected()
            compose.onNodeWithTag("tasks-screen").assertExists()
            compose.onNodeWithTag("main-content").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("submenu-lists").assertIsSelected()
            compose.onNodeWithTag("main-content").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month").assertExists()
            compose.onNodeWithTag("main-content").performTouchInput { swipeRight() }
            compose.waitForIdle()
            compose.onNodeWithTag("tasks-screen").assertExists()
            compose.onNodeWithTag("submenu-lists").assertIsSelected()

            android.util.Log.i("GENESIS_MENU_PERF", device.executeShellCommand(
                "dumpsys gfxinfo ru.genesis.calendar.debug").lineSequence()
                .filter { it.startsWith("Total frames rendered:") || it.startsWith("Janky frames:") ||
                    it.startsWith("90th percentile:") }.joinToString(" | "))

            compose.onNodeWithTag("navigation-Календарь").performClick()
            compose.onNodeWithTag("calendar-month").assertExists()
            compose.onNodeWithTag("calendar-month-navigation").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-year-panel").assertExists()
            val before = compose.onNodeWithTag("calendar-year-period").fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.Text].toString()
            compose.onNodeWithTag("calendar-year-next").performClick()
            compose.waitUntil(5_000) {
                compose.onNodeWithTag("calendar-year-period").fetchSemanticsNode()
                    .config[androidx.compose.ui.semantics.SemanticsProperties.Text].toString() != before
            }
        } finally {
            device.setOrientationNatural()
            device.unfreezeRotation()
            runBlocking {
                preferences.set("menuSwipeEnabled", original.menuSwipeEnabled.toString())
                preferences.set("menuSwipeSubmenus", original.menuSwipeSubmenus.toString())
                preferences.set("language", original.language)
            }
        }
    }

    @Test fun monthSwipeIsRestoredWhenMenuSwipeIsOff() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking { preferences.set("menuSwipeEnabled", "false") }
            compose.openWorkspacePage("Календарь", "month")
            val before = compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.Text].toString()
            compose.onNodeWithTag("calendar-month-navigation").performTouchInput { swipeLeft() }
            compose.waitUntil(5_000) {
                compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode()
                    .config[androidx.compose.ui.semantics.SemanticsProperties.Text].toString() != before
            }
        } finally {
            runBlocking { preferences.set("menuSwipeEnabled", original.menuSwipeEnabled.toString()) }
        }
    }
}
