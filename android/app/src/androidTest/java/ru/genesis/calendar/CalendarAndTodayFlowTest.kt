package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import androidx.test.uiautomator.UiDevice
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.calendarName
import java.time.LocalDate

class CalendarAndTodayFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun singleThemeTodayAndCalendarExposeWebDayDetails() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first() }
        val originalHabits = runBlocking { app.database.dao().document(app.workspaceScope, "habits") }
        val habits = HabitsRepository(app)
        try {
            val date = LocalDate.now()
            compose.openWorkspacePage("Сегодня")
            runBlocking { habits.save(Habit(TrackerEntity.create("habit", id = "today-reading-validation"),
                "Чтение для проверки", date, HabitEngine(GenesisCalendar()).defaultSchedule(date, CalendarMode.PROFANE))) }
            runBlocking { prefs.set("display", "sacred") }
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("workspace-title").assertTextEquals("Сегодня")
            try {
                // The theme surface already existed before the preference write. Wait
                // for the actual calendar content, and compose its lazy item first.
                compose.scrollToTodayNode(hasTestTag("today-hero"))
                compose.waitUntil(10_000) {
                    compose.onAllNodes(hasTestTag("today-calendar-name") and hasText(
                        ru.genesis.calendar.ui.mobileCalendarCopy("ru").calendarName(CalendarMode.SACRED)),
                        useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithTag("today-hero-copy", useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("today-hero-description", useUnmergedTree = true).assertExists()
            } catch (failure: Throwable) {
                runCatching {
                    val stored = runBlocking { prefs.values.first() }
                    val visibility = ru.genesis.calendar.auth.AuthController.get(app).state.value.accountSettings?.uiVisibility
                    val proof = org.json.JSONObject().put("stage", "actual-sacred-today-hero")
                        .put("storedDisplay", stored.display.wireValue).put("language", stored.language)
                        .put("sacredFeaturesEnabled", visibility?.sacredFeaturesEnabled ?: true)
                        .put("hero", runCatching { compose.onNodeWithTag("today-hero", useUnmergedTree = true)
                            .printToString() }.getOrElse { it.javaClass.simpleName })
                    File(app.getExternalFilesDir(null), "today-hero313-failure.json").writeText(proof.toString(2))
                    captureNativeWindow(File(app.getExternalFilesDir(null), "today-hero313-failure.png"))
                }.exceptionOrNull()?.let(failure::addSuppressed)
                throw failure
            }
            compose.scrollToTodayNode(hasTestTag("today-day-details"))
            compose.onNodeWithTag("today-day-details").assertIsDisplayed()
            compose.onNodeWithTag("day-knowledge").assertExists()
            val todayImage = File(app.cacheDir, "today-after.png")
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(todayImage))
            compose.scrollToTodayNode(hasTestTag("today-hero"))
            runBlocking { prefs.set("display", "profane") }
            compose.waitUntil(10_000) {
                runCatching { compose.onNodeWithTag("today-calendar-name").assertTextEquals(
                    ru.genesis.calendar.ui.mobileCalendarCopy("ru").calendarName(CalendarMode.PROFANE)) }.isSuccess
            }
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.cacheDir, "today-profane-after.png")))
            compose.onNodeWithTag("today-gregorian-summary").assertDoesNotExist()
            compose.onNodeWithTag("today-gregorian-year-position", useUnmergedTree = true).assertExists()
            compose.scrollToTodayNode(hasTestTag("today-day-rhythm"))
            compose.onNodeWithTag("today-day-rhythm").assertExists()
            compose.scrollToTodayNode(hasTestTag("today-tasks-section"))
            compose.onNodeWithTag("today-habits-section").assertExists()
            compose.scrollToTodayNode(hasTestTag("today-habit-check-today-reading-validation"))
            compose.onNodeWithTag("today-habit-check-today-reading-validation").performClick()
            compose.waitUntil(8_000) { runBlocking { habits.workspace.first().completions.any {
                it.habitId == "today-reading-validation" && it.completed && it.date == date } } }
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.cacheDir, "today-activity-after.png")))
            compose.scrollToTodayNode(hasTestTag("today-hero"))
            runBlocking { prefs.set("display", "lunar") }
            compose.waitUntil(10_000) {
                runCatching { compose.onNodeWithTag("today-calendar-name").assertTextEquals(
                    ru.genesis.calendar.ui.mobileCalendarCopy("ru").calendarName(CalendarMode.LUNAR)) }.isSuccess
            }
            compose.onNodeWithTag("today-calendar-image", useUnmergedTree = true).assertExists()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.cacheDir, "today-lunar-after.png")))
            runBlocking { prefs.set("display", "sacred") }
            compose.waitUntil(10_000) {
                runCatching { compose.onNodeWithTag("today-calendar-name").assertTextEquals(
                    ru.genesis.calendar.ui.mobileCalendarCopy("ru").calendarName(CalendarMode.SACRED)) }.isSuccess
            }
            compose.scrollToTodayNode(hasTestTag("day-rhythm-expand"))
            compose.onNodeWithTag("day-rhythm-expand").assertExists()
            compose.scrollToTodayNode(hasTestTag("today-day-details"))
            compose.onNodeWithTag("day-knowledge").assertExists()
            val calendar = GenesisCalendar()
            val equinox = calendar.solarEvents(calendar.sacredDate(date).sacredYear).single { it.name == "Осеннее равноденствие" }
            compose.openWorkspacePage("Календарь", "year")
            val monthTag = "sacred-year-month-${calendar.sacredDate(equinox.date).monthIndex}"
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(monthTag))
            compose.onNodeWithTag(monthTag).performClick()
            compose.onNodeWithTag("pyata-1").performScrollTo().performClick()
            compose.onNodeWithText("Явление идеи.", substring = true).assertExists()
            compose.onNodeWithTag("calendar-day-${equinox.date}").performScrollTo().performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Осеннее равноденствие", substring = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("calendar-selected-day").assertExists()
            compose.onAllNodesWithText("Осеннее равноденствие", substring = true).onLast().assertExists()
            val image = File(app.cacheDir, "calendar-selected-day-after.png")
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(image))
        } finally {
            runBlocking { prefs.set("display", original.display.wireValue) }
            runBlocking {
                if (originalHabits == null) app.database.dao().deleteDocument(app.workspaceScope, "habits")
                else app.database.dao().putDocument(originalHabits)
                app.scheduler.restoreHabitNotifications()
            }
        }
    }
}
