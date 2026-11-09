package ru.genesis.calendar

import android.accessibilityservice.AccessibilityServiceInfo
import android.os.Build
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

class TalkBackAccessibilityTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Before fun requireAccessibilityCapableEmulator() {
        assumeTrue("Compose accessibility checks require API 34+", Build.VERSION.SDK_INT >= 34)
        check(BuildConfig.DEBUG && compose.activity.packageName.endsWith(".debug"))
        val manager = InstrumentationRegistry.getInstrumentation().targetContext
            .getSystemService(android.view.accessibility.AccessibilityManager::class.java)
        val talkBackEnabled = manager.getEnabledAccessibilityServiceList(
            AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        ).any { it.resolveInfo.serviceInfo.packageName == "com.google.android.marvin.talkback" }
        assertTrue("Enable the real TalkBack service before running this test", talkBackEnabled)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun primaryScreensPassTalkBackAccessibilityChecks() {
        compose.enableAccessibilityChecks()
        compose.onRoot().tryPerformAccessibilityChecks()

        // Enabling TalkBack on a freshly wiped emulator can trigger one late Activity
        // recreation while the accessibility service finishes connecting.
        waitForNode("navigation-Проекты")
        compose.onNodeWithTag("navigation-Проекты").performClick()
        waitForNode("projects-screen")
        compose.onNodeWithTag("projects-screen").assertExists()
        compose.onRoot().tryPerformAccessibilityChecks()

        waitForNode("navigation-Настройки")
        compose.onNodeWithTag("navigation-Настройки").performClick()
        compose.onNodeWithTag("settings-submenu-reminders").performClick()
        compose.onNodeWithText("Системные напоминания").performScrollTo().assertIsDisplayed()
        compose.onRoot().tryPerformAccessibilityChecks()
    }

    private fun waitForNode(tag: String) = compose.waitUntil(15_000) {
        runCatching { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
            .getOrDefault(false)
    }
}
