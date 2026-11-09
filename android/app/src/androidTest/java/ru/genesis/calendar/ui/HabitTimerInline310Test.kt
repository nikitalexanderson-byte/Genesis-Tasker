package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*
import java.time.LocalDate

class HabitTimerInline310Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    @Test fun timerStaysInsideItsHabitAndCollapsePreservesTheRunningSession() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(app.workspaceScope == "internal-validation-v1")
        val scope = app.workspaceScope; val dao = app.database.dao()
        val original = runBlocking { dao.document(scope, "habits") }
        val today = LocalDate.now(); val engine = HabitEngine(GenesisCalendar())
        val habits = listOf("timer-inline-a", "timer-inline-b").map { id -> Habit(TrackerEntity.create("habit", id = id),
            id, today, engine.defaultSchedule(today, CalendarMode.PROFANE)) }
        val repository = HabitsRepository(app)
        try {
            runBlocking {
                dao.putDocument(DocumentRecord(scope, "habits", LocalCipher().encrypt(HabitDocument.encode(LocalHabitWorkspace(habits = habits)), "$scope/habits"), 1))
                repository.refresh()
            }
            compose.setContent { MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) { HabitsScreen(app, true, CalendarMode.PROFANE, CalendarMode.PROFANE) }
            } }
            compose.waitUntil(8000) { compose.onAllNodesWithTag("habit-timer-open-timer-inline-a").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("habit-timer-open-timer-inline-a").performScrollTo().performClick()
            val insideA = hasAnyAncestor(hasTestTag("habit-card-timer-inline-a"))
            compose.onNode(hasTestTag("habit-timer-inline-timer-inline-a") and insideA).assertExists()
            compose.onNodeWithTag("habit-timer-start").performScrollTo().performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("habit-timer-pause").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("habit-timer-open-timer-inline-a").performScrollTo().performClick()
            compose.onNodeWithTag("habit-timer-inline-timer-inline-a").assertDoesNotExist()
            val running = runBlocking { repository.workspace.first() }.timers
            assertEquals(1, HabitTimers.sessions(running).size)
            assertEquals("running", HabitTimers.sessions(running).single().state?.status)
            compose.onNodeWithTag("habit-timer-open-timer-inline-b").performScrollTo().performClick()
            compose.onNodeWithTag("habit-timer-start").performScrollTo().assertIsNotEnabled()
            compose.onNodeWithTag("habit-timer-inline-timer-inline-a").assertDoesNotExist()
            compose.onNodeWithTag("habit-timer-open-timer-inline-a").performScrollTo().performClick()
            compose.onNode(hasTestTag("habit-timer-pause") and insideA).performScrollTo().assertIsDisplayed()
            assertEquals(running, runBlocking { repository.workspace.first() }.timers)
        } finally {
            runBlocking { original?.let { dao.putDocument(it) } ?: dao.deleteDocument(scope, "habits") }
        }
    }
}
