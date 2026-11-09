package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences

/** Real window rotation, navigation and the editor keyboard, in the isolated debug workspace. */
class ResponsiveWorkspaceTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun everySectionRemainsUsableAcrossWindowOrientations() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking { preferences.set("wideNavigation", "left"); preferences.set("language", "ru") }
            for (landscape in listOf(false, true)) {
                if (landscape) device.setOrientationLeft() else device.setOrientationNatural()
                device.waitForIdle()
                compose.waitForIdle()
                val orientation = if (landscape) "rotated" else "natural"
                for (section in listOf("Сегодня", "Календарь", "Проекты", "Привычки", "Сакральное", "Настройки")) {
                    val nav = compose.onNodeWithTag("navigation-$section")
                    if (!nav.isDisplayed()) nav.performScrollTo()
                    nav.performClick()
                    compose.waitForIdle()
                    val content = compose.onNodeWithTag("main-content").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    val header = compose.onNodeWithTag("app-header").fetchSemanticsNode().boundsInRoot
                    compose.onNodeWithTag("genesis-brand-name").assertIsDisplayed()
                    compose.onNodeWithTag("genesis-round-logo").assertIsDisplayed()
                    val footer = compose.onNodeWithTag("app-account-status").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    assertTrue("Account status overlaps the workspace", footer.top >= content.bottom)
                    val density = compose.activity.resources.displayMetrics.density
                    assertTrue("Header consumes too much height: $header", header.height <= 68 * density)
                    assertTrue("No working height left: $content", content.height >= 140 * density)
                    compose.onAllNodesWithTag("main-navigation-rail").fetchSemanticsNodes().firstOrNull()?.let {
                        assertTrue("Rail overlaps the workspace", it.boundsInRoot.right <= content.left + 1)
                    }
                    assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "responsive-$orientation-$section.png")))
                }
                val tasks = compose.onNodeWithTag("navigation-Проекты")
                if (!tasks.isDisplayed()) tasks.performScrollTo()
                tasks.performClick()
                compose.onNodeWithTag("personal-actions").performClick()
                compose.onNodeWithTag("personal-create-task").performClick()
                compose.onNodeWithTag("task-title").performTextInput("Проверка адаптивной формы")
                compose.onNodeWithTag("close-task-editor").assertIsDisplayed()
                assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "responsive-$orientation-keyboard.png")))
                compose.onNodeWithTag("close-task-editor").performClick()
                compose.onNodeWithTag("task-title").assertDoesNotExist()
            }
        } finally {
            runBlocking {
                preferences.set("wideNavigation", if (original.wideNavigationOnLeft) "left" else "top")
                preferences.set("language", original.language)
            }
            device.setOrientationNatural()
            device.unfreezeRotation()
        }
    }
}
