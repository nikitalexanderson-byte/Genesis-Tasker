package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences

class CompactNavigationAndReferenceTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun iconMenuFitsSevenDestinationsAndSettingsExposeTextMotionAndReferences() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("wideNavigation", "top")
                preferences.set("navigationLabels", "icons")
                preferences.set("settingsMenuLabels", "icons")
                preferences.set("navigationAutoScroll", "false")
                preferences.set("language", "ru")
            }
            compose.waitUntil(8_000) {
                compose.onAllNodesWithTag("main-navigation-icons").fetchSemanticsNodes().isNotEmpty()
            }
            val pages = listOf("Сегодня", "Задачи", "Проекты", "Календарь", "Привычки", "Сакральное", "Настройки")
            val bounds = pages.map { page ->
                compose.onNodeWithTag("navigation-$page").assertIsDisplayed()
                    .assertContentDescriptionEquals(page).fetchSemanticsNode().boundsInRoot
            }
            assertEquals(1, bounds.map { it.top }.distinct().size)
            assertTrue(bounds.zipWithNext().all { (left, right) -> left.right <= right.left + 1f })
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),
                "2.3.10-portrait-icon-menu.png")))

            compose.onNodeWithTag("navigation-Настройки").performClick()
            compose.onNodeWithTag("settings-submenu-region").performClick()
            compose.onNodeWithTag("region-source-manual").performScrollTo().performClick()
            compose.onNodeWithTag("region-manual-list")
                .performScrollToNode(hasTestTag("region-choice-Australia-Sydney"))
            compose.onNodeWithTag("region-choice-Australia-Sydney").performClick()
            compose.waitUntil(5_000) { runBlocking {
                preferences.values.first().manualRegionZone == "Australia/Sydney"
            } }
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().regionSource == "manual" } }
            compose.onNodeWithTag("settings-submenu-appearance").performClick()
            compose.onNodeWithTag("navigation-with-text").performScrollTo().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("navigation-auto-scroll-setting").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("navigation-auto-scroll").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().navigationAutoScroll } }
            compose.onNodeWithTag("navigation-auto-scroll").performScrollTo().performClick()
            compose.waitUntil(5_000) { !runBlocking { preferences.values.first().navigationAutoScroll } }

            compose.onNodeWithTag("calendar-settings-section").performScrollTo()
            listOf("profane" to "Григорианский", "sacred" to "Сакральный",
                "lunar" to "Лунный").forEach { (mode, label) ->
                compose.onNodeWithTag("calendar-reference-$mode").assertTextEquals(label)
            }
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),
                "2.3.10-calendar-reference-buttons.png")))
            compose.onNodeWithTag("calendar-reference-profane").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Григорианский календарь", useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Григорианский календарь", useUnmergedTree = true).assertIsDisplayed()
            compose.waitForIdle()
            device.waitForIdle(1_000)
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),
                "2.3.10-calendar-reference-profane.png")))
            compose.onNodeWithTag("calendar-reference-close", useUnmergedTree = true).performClick()
            compose.onNodeWithTag("calendar-reference-sacred").performScrollTo().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Сакральный календарь", useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Сакральный календарь", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithTag("calendar-reference-close", useUnmergedTree = true).performClick()
            compose.onNodeWithTag("calendar-reference-lunar").performScrollTo().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Лунный календарь", useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Лунный календарь", useUnmergedTree = true).assertIsDisplayed()
        } finally {
            runBlocking {
                preferences.set("navigationLabels", if (original.navigationLabels) "text" else "icons")
                preferences.set("settingsMenuLabels", if (original.settingsMenuLabels) "text" else "icons")
                preferences.set("navigationAutoScroll", original.navigationAutoScroll.toString())
                preferences.set("language", original.language)
                preferences.set("wideNavigation", if (original.wideNavigationOnLeft) "left" else "top")
                preferences.set("regionSource", original.regionSource)
                preferences.set("manualRegionZone", original.manualRegionZone)
            }
        }
    }
}
