package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitTimerAvailability313Test {
    private val date = LocalDate.of(2026, 10, 30)
    private val habit = Habit(TrackerEntity.create("habit", id = "timer313"), "Чтение", date,
        HabitEngine(GenesisCalendar(ZoneId.of("UTC"))).defaultSchedule(date, CalendarMode.PROFANE).copy(timezone = "UTC"))
    private fun command(action: String, at: String, id: String = action) = HabitTimerCommand(action, "device", at, id,
        sessionId = "session313", habitId = habit.id)

    @Test fun legacyHabitsKeepTimersAndDisabledChoiceSurvivesTheEncryptedDocumentShape() {
        val document = JSONObject(HabitDocument.encode(LocalHabitWorkspace(habits = listOf(habit))))
        document.getJSONArray("habits").getJSONObject(0).remove("timerEnabled")
        assertTrue(HabitDocument.decode(document.toString(), 0).habits.single().timerEnabled)
        val disabled = LocalHabitWorkspace(habits = listOf(habit.copy(timerEnabled = false)))
        assertFalse(HabitDocument.decode(HabitDocument.encode(disabled), 0).habits.single().timerEnabled)
    }

    @Test fun disablingKeepsElapsedTimeWithoutBlockingOtherTimersOrAwardingAnything() {
        val started = HabitTimerWorkspace.apply(LocalHabitWorkspace(habits = listOf(habit)),
            command("start", "2026-10-30T12:00:00Z", "session313"))
        val disabled = HabitTimerWorkspace.finishDisabled(started.copy(habits = listOf(habit.copy(timerEnabled = false))),
            "2026-10-30T12:05:00Z", "device")
        val session = HabitTimers.sessions(disabled.timers).single()
        assertEquals("saved", session.state!!.status)
        assertEquals(300_000L, HabitTimers.reading(session.state!!, Instant.parse("2026-10-31T12:00:00Z")).workMs)
        assertEquals(started.rewards, disabled.rewards)
        assertEquals(started.completions, disabled.completions)
        assertEquals(disabled, HabitTimerWorkspace.finishDisabled(disabled, "2026-10-30T12:10:00Z", "device"))
        assertThrows(IllegalArgumentException::class.java) {
            HabitTimerWorkspace.apply(disabled, command("resume", "2026-10-30T12:10:00Z"))
        }
        val enabled = disabled.copy(habits = listOf(habit))
        val restarted = HabitTimerWorkspace.apply(enabled, command("start", "2026-10-30T12:15:00Z", "session314"))
        assertEquals(2, HabitTimers.sessions(restarted.timers).size)
        assertEquals(300_000L, HabitTimers.reading(HabitTimers.sessions(restarted.timers).first { it.id == "session313" }.state!!,
            Instant.parse("2026-10-30T12:20:00Z")).workMs)
    }

    @Test fun disabledHabitCannotStartATimerEvenThroughADirectCommand() {
        assertThrows(IllegalArgumentException::class.java) {
            HabitTimerWorkspace.apply(LocalHabitWorkspace(habits = listOf(habit.copy(timerEnabled = false))),
                command("start", "2026-10-30T12:00:00Z", "session313"))
        }
    }

    @Test fun timerModesAndCountingPreferenceSurviveSyncAndPreventWrongModeResume() {
        val preferences = HabitTimerPreferences(listOf("stopwatch"), 40, 8, "time-only")
        val configured = habit.copy(timerPreferences = preferences)
        val workspace = LocalHabitWorkspace(habits = listOf(configured))
        assertEquals(preferences, HabitDocument.decode(HabitDocument.encode(workspace), 0).habits.single().timerPreferences)
        assertThrows(IllegalArgumentException::class.java) {
            HabitTimerWorkspace.apply(workspace, command("start", "2026-10-30T12:00:00Z", "session313").copy(mode = "pomodoro"))
        }
        val started = HabitTimerWorkspace.apply(workspace, command("start", "2026-10-30T12:00:00Z", "session313"))
        val paused = HabitTimerWorkspace.apply(started, command("pause", "2026-10-30T12:05:00Z"))
        val changed = paused.copy(habits = listOf(configured.copy(timerPreferences = preferences.copy(modes = listOf("pomodoro")))))
        assertThrows(IllegalArgumentException::class.java) { HabitTimerWorkspace.apply(changed, command("resume", "2026-10-30T12:06:00Z")) }
        val finished = HabitTimerWorkspace.apply(paused, command("finish", "2026-10-30T12:10:00Z"))
        val saved = HabitTimerWorkspace.apply(finished, command("save", "2026-10-30T12:11:00Z"))
        assertTrue(saved.measurements.isEmpty()); assertTrue(saved.completions.isEmpty())
        assertEquals(300_000L, HabitTimers.reading(HabitTimers.sessions(saved.timers).single().state!!).workMs)
    }

    @Test fun disablingDoesNotWriteOperationsOnBehalfOfAnotherDevice() {
        val started = HabitTimerWorkspace.apply(LocalHabitWorkspace(habits = listOf(habit)),
            command("start", "2026-10-30T12:00:00Z", "session313"))
        val disabled = started.copy(habits = listOf(habit.copy(timerEnabled = false)))
        assertEquals(disabled, HabitTimerWorkspace.finishDisabled(disabled, "2026-10-30T12:05:00Z", "other-device"))
    }
}
