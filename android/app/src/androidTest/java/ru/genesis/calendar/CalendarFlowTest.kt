package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog

class CalendarFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun sacredMonthYearAndApeironRenderOriginalArtWithoutChangingTaskCalendar() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        try {
            runBlocking { preferences.set("display", "sacred") }
            compose.openWorkspacePage("Календарь")
            compose.onNodeWithTag("sacred-month-hero").assertIsDisplayed()
            val currentMonth = SacredCatalog.months[GenesisCalendar().sacredDate(LocalDate.now()).monthIndex]
            compose.waitUntil(10_000) {
                compose.onAllNodesWithContentDescription("Иллюстрация месяца ${currentMonth.name}")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).onFirst().assertExists()
            compose.onNodeWithTag("sacred-month-hero").assertIsDisplayed()
            device.waitForIdle()
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "calendar-standart-month.png")))
            compose.onNodeWithTag("submenu-year").performClick().assertIsSelected()
            compose.onNodeWithTag("calendar-year").assertIsDisplayed()
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("sacred-year-month-12"))
            compose.onNodeWithTag("sacred-year-month-12").assertIsDisplayed()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithContentDescription("Иллюстрация месяца АПЕЙРОН")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "calendar-sacred-year-apeiron.png")))
            compose.onNodeWithTag("sacred-year-month-12").performClick()
            compose.waitUntil(10_000) {
                runCatching { compose.onAllNodesWithContentDescription("Иллюстрация месяца АПЕЙРОН")
                    .fetchSemanticsNodes().isNotEmpty() }.getOrDefault(false)
            }
            compose.onNodeWithTag("sacred-month-hero").assertIsDisplayed()
            compose.onNodeWithText(SacredCatalog.months[12].name).assertExists()
            val calendar = GenesisCalendar()
            val apeironStart = calendar.gregorianDate(calendar.sacredDate(LocalDate.now()).sacredYear, 12, 1)
            compose.onNodeWithTag("calendar-day-$apeironStart").assertExists()
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "calendar-apeiron-month.png")))
            compose.onNodeWithTag("calendar-day-$apeironStart").performClick()
            compose.onNodeWithTag("calendar-selected-day").assertExists()
            compose.onNodeWithText("Открыть день и задачи").assertDoesNotExist()
            compose.onNodeWithTag("calendar-inline-tasks").performScrollTo().assertExists()
            compose.onNodeWithTag("calendar-create-task").assertExists()
        } finally {
            runBlocking {
                preferences.set("display", original.display.wireValue)
            }
        }
    }
}
