package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AdaptiveSettingsLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun calendarAndMoonChoicesStayInsideTheirCards() {
        compose.onNodeWithTag("navigation-Настройки").performClick()
        fun verifyRow(cardTag: String, tags: List<String>) {
            compose.onNodeWithTag(tags.last()).performScrollTo()
            val card = compose.onNodeWithTag(cardTag).fetchSemanticsNode().boundsInRoot
            val choices = tags.map { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
            assertTrue("First choice escaped $cardTag", choices.first().left >= card.left)
            assertTrue("Last choice escaped $cardTag", choices.last().right <= card.right)
            assertTrue("Choices overlap in $cardTag", choices.zipWithNext().all { (a, b) -> a.right <= b.left })
        }
        for (prefix in listOf("display", "input")) {
            verifyRow("calendar-settings-section", listOf("profane", "sacred", "lunar")
                .map { "$prefix-calendar-$it" })
        }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val directory = instrumentation.targetContext.getExternalFilesDir(null)
        assertTrue(device.takeScreenshot(File(directory, "calendar-choice-settings.png")))
        compose.onNodeWithTag("settings-submenu-reminders").performClick()
        for (phase in listOf("full", "new")) {
            verifyRow("moon-reminder-settings", (0..3).map { "moon-$phase-lead-$it" })
        }
        assertTrue(device.takeScreenshot(File(directory, "moon-reminder-settings.png")))
    }
}
