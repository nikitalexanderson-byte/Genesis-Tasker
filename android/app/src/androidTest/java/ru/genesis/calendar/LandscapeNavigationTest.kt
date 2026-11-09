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

class LandscapeNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun landscapeMovesPrimaryMenuLeftAndSettingCanReturnItToTop() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as GenesisApplication
        val device = UiDevice.getInstance(instrumentation)
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        try {
            runBlocking {
                preferences.set("wideNavigation", "left")
                preferences.set("navigationLabels", "text")
            }
            device.setOrientationLeft()
            device.waitForIdle()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("main-navigation-rail").fetchSemanticsNodes().isNotEmpty()
            }
            val rail = compose.onNodeWithTag("main-navigation-rail").assertIsDisplayed()
                .fetchSemanticsNode().boundsInRoot
            val content = compose.onNodeWithTag("main-content").assertIsDisplayed()
                .fetchSemanticsNode().boundsInRoot
            assertTrue("Primary menu must be to the left of content", rail.right <= content.left + 1f)
            val density = compose.activity.resources.displayMetrics.density
            assertTrue("Compact rail must be at most 132dp", rail.width <= 133f * density)
            val header = compose.onNodeWithTag("app-header").fetchSemanticsNode().boundsInRoot
            val account = compose.onNodeWithTag("app-account-status").fetchSemanticsNode().boundsInRoot
            assertTrue(device.takeScreenshot(File(app.cacheDir,
                "landscape-navigation-left-2.3.10.png")))
            compose.onNodeWithTag("genesis-round-logo").assertIsDisplayed()
            compose.onNodeWithTag("genesis-brand-name").assertIsDisplayed()
            assertTrue("Account status belongs below the workspace: header=$header content=$content account=$account",
                account.top >= content.bottom && account.top >= header.bottom)

            compose.onNodeWithTag("navigation-Настройки").performScrollTo().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("wide-navigation-top").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("wide-navigation-top").performScrollTo().performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("main-navigation-scroll").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("main-navigation-scroll").assertIsDisplayed()
            assertTrue(device.takeScreenshot(File(app.cacheDir,
                "landscape-navigation-top-2.3.10.png")))
        } finally {
            runBlocking {
                preferences.set("wideNavigation", if (original.wideNavigationOnLeft) "left" else "top")
                preferences.set("navigationLabels", if (original.navigationLabels) "text" else "icons")
            }
            device.setOrientationNatural()
            device.unfreezeRotation()
        }
    }
}
