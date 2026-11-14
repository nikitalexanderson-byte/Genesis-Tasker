package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences

class SettingsSectionNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun affairsViewsKeepTheirSelectionWithoutAnExtraMainMenuItem() {
        compose.onNodeWithTag("navigation-Задачи").assertDoesNotExist()
        compose.onNodeWithTag("navigation-Проекты").performClick()
        compose.onNodeWithTag("submenu-tasks").performClick()
        compose.onNodeWithTag("tasks-screen").assertExists()
        compose.onNodeWithTag("submenu-lists").performClick()
        compose.onNodeWithTag("submenu-lists").assertIsSelected()
        compose.onNodeWithTag("navigation-Сегодня").performClick()
        compose.onNodeWithTag("navigation-Проекты").performClick()
        compose.onNodeWithTag("submenu-lists").assertIsSelected()
    }

    @Test fun iconOnlySubmenuKeepsComfortableTargetsAndCanReachEverySection() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("settingsMenuLabels", "icons")
                preferences.set("settingsSubmenuEnabled", "true")
                preferences.set("language", "ru")
            }
            compose.onNodeWithTag("navigation-Настройки").performClick()
            val first = compose.onNodeWithTag("settings-submenu-appearance").fetchSemanticsNode().boundsInRoot
            val primary = compose.onNodeWithTag("navigation-Настройки").fetchSemanticsNode().boundsInRoot
            val minTarget = 48 * app.resources.displayMetrics.density
            assertTrue("Icon button is too narrow", first.width >= minTarget)
            assertTrue("Icon button height should match the main menu", kotlin.math.abs(first.height - primary.height) <=
                2 * app.resources.displayMetrics.density)
            val iconBounds = listOf("appearance", "habits", "reminders", "region", "account", "links")
                .map { compose.onNodeWithTag("settings-submenu-$it").assertIsDisplayed().fetchSemanticsNode().boundsInRoot }
            assertEquals("Settings icons must stay in one row", 1, iconBounds.map { it.top }.distinct().size)
            compose.onNodeWithTag("settings-submenu-links").performClick()
            compose.onNodeWithText("Настройки - Ссылки").assertExists()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "settings-icons-2.6.3.png")))
        } finally {
            runBlocking {
                preferences.set("settingsMenuLabels", if (original.settingsMenuLabels) "text" else "icons")
                preferences.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString())
                preferences.set("language", original.language)
            }
        }
    }

    @Test fun sixSettingsPagesFollowOneAnotherWithoutLeavingSettings() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("menuSwipeEnabled", "true")
                preferences.set("menuSwipeSubmenus", "true")
                preferences.set("settingsSubmenuEnabled", "true")
                preferences.set("language", "ru")
            }
            compose.openWorkspacePage("Настройки", "appearance")
            val fixedHeader = compose.onNodeWithTag("app-header")
                .fetchSemanticsNode().boundsInRoot
            val sections = listOf("appearance" to "Оформление", "habits" to "привычек",
                "reminders" to "Напоминания", "region" to "Регион",
                "account" to "Аккаунт GENESIS", "links" to "Ссылки")
            sections.forEachIndexed { index, (id, title) ->
                // The shipped workspace changes settings pages through the drawer;
                // its root pager was removed before 3.1.3 to preserve feature gestures.
                if (index > 0) compose.openWorkspacePage("Настройки", id)
                compose.waitUntil(5_000) {
                    compose.onAllNodes(hasTestTag("workspace-title") and hasText("Настройки\n$title"))
                        .fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithTag("workspace-title").assertTextEquals("Настройки\n$title")
                val currentHeader = compose.onNodeWithTag("app-header")
                    .fetchSemanticsNode().boundsInRoot
                assertTrue("App header must stay fixed while the settings page changes",
                    kotlin.math.abs(currentHeader.top - fixedHeader.top) < app.resources.displayMetrics.density)
                compose.onNodeWithTag("workspace-menu").performClick()
                compose.waitUntil(5_000) { compose.onNodeWithTag("workspace-drawer").isDisplayed() }
                compose.onNodeWithTag("drawer-Настройки-shared").assertDoesNotExist()
                compose.onNodeWithTag("drawer-Настройки-$id").performScrollTo().assertIsSelected()
                compose.onNodeWithTag("drawer-close").performScrollTo().performClick()
                compose.waitUntil(5_000) { !compose.onNodeWithTag("workspace-drawer").isDisplayed() }
                if (index == 3) {
                    val header = compose.onNodeWithTag("app-header").fetchSemanticsNode().boundsInRoot
                    val content = compose.onNodeWithTag("settings-page-sections").fetchSemanticsNode().boundsInRoot
                    assertTrue("Settings content gap: ${content.top - header.bottom}px; header=$header; content=$content",
                        content.top - header.bottom < 40 * app.resources.displayMetrics.density)
                    compose.onNodeWithTag("genesis-page-header").assertDoesNotExist()
                    assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                        .takeScreenshot(File(app.getExternalFilesDir(null), "settings-region-3.3.1.png")))
                }
            }
            compose.openWorkspacePage("Настройки", "appearance")
            compose.onNodeWithTag("workspace-title").assertTextEquals("Настройки\nОформление")
        } finally {
            runBlocking {
                preferences.set("menuSwipeEnabled", original.menuSwipeEnabled.toString())
                preferences.set("menuSwipeSubmenus", original.menuSwipeSubmenus.toString())
                preferences.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString())
                preferences.set("language", original.language)
            }
        }
    }

    @Test fun updateRemindersCanBeTurnedOffAndStayOff() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("updateRemindersEnabled", "true")
                preferences.set("settingsMenuLabels", "icons")
                preferences.set("settingsSubmenuEnabled", "true")
            }
            compose.onNodeWithTag("navigation-Настройки").performClick()
            compose.onNodeWithTag("settings-submenu-account").performClick()
            compose.onNodeWithTag("update-reminders-toggle").performScrollTo().assertIsOn().performClick()
            compose.waitUntil(5_000) { !runBlocking { preferences.values.first().updateRemindersEnabled } }
            compose.onNodeWithTag("update-reminders-toggle").assertIsOff()
        } finally {
            runBlocking {
                preferences.set("updateRemindersEnabled", original.updateRemindersEnabled.toString())
                preferences.set("settingsMenuLabels", if (original.settingsMenuLabels) "text" else "icons")
                preferences.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString())
            }
        }
    }

    @Test fun menuConnectionModesCanBeSwitched() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("menuThreadsEnabled", "true")
                preferences.set("settingsSubmenuEnabled", "true")
            }
            compose.onNodeWithTag("navigation-Настройки").performClick()
            compose.onNodeWithTag("menu-outline-mode").performScrollTo().performClick()
            compose.waitUntil(5_000) { !runBlocking { preferences.values.first().menuThreadsEnabled } }
            compose.onNodeWithTag("menu-outline-mode").assertIsSelected()
            compose.onNodeWithText("Настройки - Оформление").assertExists()
            compose.onNodeWithTag("menu-threads-mode").performClick()
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().menuThreadsEnabled } }
            compose.onNodeWithTag("menu-threads-mode").assertIsSelected()
        } finally {
            runBlocking {
                preferences.set("menuThreadsEnabled", original.menuThreadsEnabled.toString())
                preferences.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString())
            }
        }
    }

    @Test fun settingsCanShowAllSectionsInOneScrollingPage() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking { preferences.set("settingsSubmenuEnabled", "true") }
            compose.onNodeWithTag("navigation-Настройки").performClick()
            compose.onNodeWithTag("settings-layout-sequential").performScrollTo().performClick()
            compose.waitUntil(5_000) { !runBlocking { preferences.values.first().settingsSubmenuEnabled } }
            compose.onNodeWithTag("settings-submenu").assertDoesNotExist()
            listOf("Оформление", "Привычки", "Напоминания", "Общие дела", "Регион",
                "Аккаунт GENESIS", "Ссылки").forEach { section ->
                assertTrue("Missing sequential section: $section",
                    compose.onAllNodesWithText(section).fetchSemanticsNodes().isNotEmpty())
            }
            compose.onNodeWithTag("settings-section-appearance").assertExists()
            compose.onNodeWithText("Настройки - Оформление").assertDoesNotExist()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "settings-sequential-2.6.4.png")))
            compose.onNodeWithTag("settings-layout-submenu").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().settingsSubmenuEnabled } }
            compose.onNodeWithTag("settings-submenu").assertExists()
        } finally {
            runBlocking { preferences.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString()) }
        }
    }
}
