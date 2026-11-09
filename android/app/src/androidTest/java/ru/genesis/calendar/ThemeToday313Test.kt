package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import java.io.File
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.AppearanceSettings

/** Real shipped shell in the isolated debug workspace; no account, clock or network fixture. */
class ThemeToday313Test {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    private fun awaitShell() {
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun schemeTag(dark: Boolean) = if (dark) "app-theme-Evening" else "app-theme-Standart"

    @Test fun drawerThemePersistsAcrossRecreationAndCalendarSelectionCannotChangeActualToday() {
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val preferences = LocalPreferences(app, scope)
        val originalPreferences = runBlocking { preferences.values.first() }
        val originalHabitRecord = runBlocking { dao.document(scope, "habits") }
        val originalHabits = runBlocking { HabitsRepository(app).workspace.first() }
        val originalTasks = runBlocking { dao.observeTasks(scope).first().sortedBy { it.id } }
        val today = LocalDate.now()
        val otherDate = today.plusDays(1)
        val token = UUID.randomUUID().toString()
        val todayId = "theme-today313-today-$token"
        val otherId = "theme-today313-other-$token"
        val ownedIds = listOf(todayId, otherId)
        val checkpoints = JSONArray()
        val proof = JSONObject().put("scope", scope).put("actualDateAtStart", today.toString())
            .put("otherCalendarDate", otherDate.toString()).put("syntheticTaskIds", JSONArray(ownedIds))
            .put("checkpoints", checkpoints).put("completed", false)
            .put("midnightRollover", "not simulated; system clock is unchanged")
        var observedFailure: Throwable? = null

        fun capture(name: String) {
            captureNativeWindow(File(app.getExternalFilesDir(null), "theme-today313-$name.png"))
        }

        fun freshPreferences() = runBlocking { withTimeout(3_000) {
            LocalPreferences(app, scope).values.first()
        } }

        fun freshAppearance() = runBlocking { withTimeout(3_000) {
            val workspace = HabitsRepository(app).workspace.first()
            AppearanceSettings.read(workspace.settings.rawJson, freshPreferences().theme).mode
        } }

        fun assertActualToday(phase: String) {
            // A real midnight crossing belongs to the separate rollover scenario.
            assertEquals("This bounded journey must stay within one civil day", today, LocalDate.now())
            compose.openWorkspacePage("Сегодня")
            compose.scrollToTodayNode(hasTestTag("today-hero"))
            val civilDate = today.format(DateTimeFormatter.ofPattern("d MMMM yyyy",
                Locale.forLanguageTag(originalPreferences.language)))
            compose.onNodeWithTag("today-civil-date", useUnmergedTree = true).assertTextEquals(civilDate)
            compose.scrollToTodayNode(hasTestTag("task-$todayId"))
            compose.onNodeWithTag("task-$todayId").assertIsDisplayed()
            compose.onNodeWithTag("task-$otherId").assertDoesNotExist()
            assertEquals(today.toString(), runBlocking { app.repository.get(todayId)!!.date })
            assertEquals(otherDate.toString(), runBlocking { app.repository.get(otherId)!!.date })
            checkpoints.put("$phase:system-date-and-only-todays-marker")
        }

        try {
            runBlocking {
                assertNull(app.repository.get(todayId)); assertNull(app.repository.get(otherId))
                app.repository.save(LocalTask(todayId, "Сегодня · $token", date = today.toString()))
                app.repository.save(LocalTask(otherId, "Другой день · $token", date = otherDate.toString()))
            }
            awaitShell()
            val wasDark = compose.onNodeWithTag("app-theme-Evening").isDisplayed()
            compose.onNodeWithTag(schemeTag(wasDark)).assertIsDisplayed()
            compose.onNodeWithTag("today-theme-toggle").assertDoesNotExist()
            compose.onNodeWithTag("calendar-theme-toggle").assertDoesNotExist()
            capture("before")
            compose.onNodeWithTag("workspace-menu").performClick()
            compose.waitUntil(5_000) { compose.onNodeWithTag("workspace-drawer").isDisplayed() }
            compose.onNodeWithTag("drawer-theme-toggle").performScrollTo()
                .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).assertIsEnabled().performClick()
            val expectedDark = !wasDark
            val expectedMode = if (expectedDark) "evening" else "light"
            val expectedPreference = if (expectedDark) "standart-dark" else "standart"
            compose.waitUntil(10_000) {
                compose.onNodeWithTag(schemeTag(expectedDark)).isDisplayed() &&
                    freshPreferences().theme == expectedPreference && freshAppearance() == expectedMode
            }
            proof.put("initialDark", wasDark).put("expectedDark", expectedDark)
                .put("savedTheme", freshPreferences().theme).put("savedAppearance", freshAppearance())
            checkpoints.put("actual-drawer-click:both-durable-stores-and-rendered-scheme")
            compose.onNodeWithTag("drawer-close").performScrollTo().performClick()
            compose.waitUntil(5_000) { !compose.onNodeWithTag("workspace-drawer").isDisplayed() }
            compose.activityRule.scenario.recreate()
            awaitShell()
            compose.waitUntil(10_000) { compose.onNodeWithTag(schemeTag(expectedDark)).isDisplayed() }
            assertEquals(expectedPreference, freshPreferences().theme)
            assertEquals(expectedMode, freshAppearance())
            compose.onNodeWithTag("today-theme-toggle").assertDoesNotExist()
            compose.onNodeWithTag("calendar-theme-toggle").assertDoesNotExist()
            checkpoints.put("activity-recreated:same-scheme-and-durable-preferences")
            capture("theme-recreated")

            compose.openWorkspacePage("Календарь", "month")
            // Reach the Gregorian calendar through its shipped icon, preserving the input calendar.
            repeat(CalendarMode.entries.size) {
                val current = freshPreferences().display
                if (current != CalendarMode.PROFANE) {
                    compose.onNode(hasTestTag("calendar-mode-icon-${current.wireValue}") and
                        hasAnyAncestor(hasTestTag("global-calendar-switch"))).performClick()
                    compose.waitUntil(10_000) { freshPreferences().display != current }
                }
            }
            assertEquals(CalendarMode.PROFANE, freshPreferences().display)
            assertEquals(originalPreferences.input, freshPreferences().input)
            if (YearMonth.from(otherDate) != YearMonth.from(today))
                compose.onNodeWithTag("calendar-month-next").performScrollTo().performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("calendar-day-$otherDate").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("calendar-day-$otherDate").performScrollTo().performClick()
            proof.put("calendarSelectionAfterClick", compose.onNodeWithTag("calendar-day-$otherDate")
                .printToString())
            // The cell's 48dp task counter can receive this one touch. Follow its
            // shipped Show-day action rather than touching the cell a second time.
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("calendar-dialog-show-day").fetchSemanticsNodes().isNotEmpty() ||
                    runCatching { compose.onNodeWithTag("calendar-day-$otherDate").fetchSemanticsNode()
                        .config[androidx.compose.ui.semantics.SemanticsProperties.Selected] }.getOrDefault(false)
            }
            if (compose.onAllNodesWithTag("calendar-dialog-show-day").fetchSemanticsNodes().isNotEmpty()) {
                compose.onNodeWithTag("calendar-dialog-show-day").assertIsEnabled().performClick()
                checkpoints.put("calendar:task-counter-popup-actual-show-day-action")
            }
            compose.waitUntil(10_000) {
                runCatching { compose.onNodeWithTag("calendar-day-$otherDate").fetchSemanticsNode()
                    .config[androidx.compose.ui.semantics.SemanticsProperties.Selected] }.getOrDefault(false)
            }
            compose.onNodeWithTag("calendar-day-$otherDate").assertIsSelected()
            compose.onNodeWithTag("calendar-selected-day").performScrollTo()
            val locale = Locale.forLanguageTag(originalPreferences.language)
            val selectedText = otherDate.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
                .replaceFirstChar { it.titlecase(locale) }
            compose.onNodeWithTag("calendar-selected-primary-date", useUnmergedTree = true)
                .assertTextEquals(selectedText)
            checkpoints.put("calendar:actual-drawer-icon-and-cell-selected-other-date")
            capture("calendar-other-date")
            assertActualToday("after-calendar-selection")
            capture("today-after-calendar")

            // Re-entering Calendar retains its selected day while Today remains factual.
            compose.openWorkspacePage("Календарь", "month")
            compose.onNodeWithTag("calendar-day-$otherDate").performScrollTo().assertIsSelected()
            assertActualToday("after-calendar-reentry")
            compose.onNodeWithTag(schemeTag(expectedDark)).assertIsDisplayed()
            val storedTasks = runBlocking { dao.observeTasks(scope).first().sortedBy { it.id } }
            assertEquals("Navigation/theme must not change existing tasks", originalTasks,
                storedTasks.filterNot { it.id in ownedIds })
            assertEquals("Both synthetic tasks remain unique", 2, storedTasks.count { it.id in ownedIds })
            val storedHabits = runBlocking { HabitsRepository(app).workspace.first() }
            assertEquals(originalHabits.habits, storedHabits.habits)
            assertEquals(originalHabits.completions, storedHabits.completions)
            assertEquals(originalHabits.rewards, storedHabits.rewards)
            proof.put("completed", true)
        } catch (failure: Throwable) {
            observedFailure = failure
            proof.put("failure", failure.javaClass.simpleName + ": " + failure.message)
            runCatching { capture("failure") }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        } finally {
            // Restore only values touched by this test; remove only UUID-owned tasks.
            val cleanupFailure = runCatching { runBlocking {
                check(app.workspaceScope == scope) { "The isolated workspace changed unexpectedly" }
                ownedIds.forEach { id ->
                    if (app.repository.get(id) != null) app.repository.delete(id)
                    dao.deleteTaskReminders(scope, id)
                    dao.outbox(scope).filter { it.entityId == id }.forEach {
                        dao.acknowledgeOutbox(scope, it.entityId, it.revision, it.operationId)
                    }
                    dao.deleteCachedTask(scope, id)
                }
                preferences.set("display", originalPreferences.display.wireValue)
                preferences.set("theme", originalPreferences.theme.orEmpty())
                if (originalHabitRecord == null) dao.deleteDocument(scope, "habits")
                else HabitsRepository(app).updateSettings(originalHabits.settings)
                app.scheduler.restoreHabitNotifications()
                assertEquals(originalPreferences, preferences.values.first())
                assertEquals(originalTasks, dao.observeTasks(scope).first().sortedBy { it.id })
            } }.exceptionOrNull()
            proof.put("cleanupRestored", cleanupFailure == null)
            cleanupFailure?.let { proof.put("cleanupFailure", it.javaClass.simpleName + ": " + it.message) }
            File(app.getExternalFilesDir(null), "theme-today313-proof.json").writeText(proof.toString(2))
            cleanupFailure?.let { failure ->
                observedFailure?.addSuppressed(failure) ?: throw failure
            }
        }
    }
}
