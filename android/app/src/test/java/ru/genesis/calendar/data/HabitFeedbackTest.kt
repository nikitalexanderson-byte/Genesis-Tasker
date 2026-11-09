package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.time.LocalDate
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

class HabitFeedbackTest {
    private val day = LocalDate.of(2026, 10, 29)
    private val stamp = "2026-10-29T12:00:00Z"
    private val engine = HabitEngine(GenesisCalendar())
    private val habit = Habit(TrackerEntity("habit", stamp, stamp), "Read", day,
        engine.defaultSchedule(day, CalendarMode.PROFANE))
    private val before = LocalHabitWorkspace(habits = listOf(habit))
    private val after = before.copy(completions = engine.updateCompletion(emptyList(), habit, day, day, true, null, ""))

    @Test fun onlyNewCompletionsProduceFeedback() {
        assertEquals("completion", habitFeedbackTransition("account-test", before, after)?.kind)
        assertNull(habitFeedbackTransition("account-test", after, after))
        assertNull(habitFeedbackTransition("account-test", after, before))
        assertNull(habitFeedbackTransition("account-test", before, after.copy(settings = HabitSettings(enabled = false))))
        assertEquals("account-test", habitFeedbackTransition("account-test", before, after)?.scope)
    }

    @Test fun goalsRanksAndTrialsChooseDistinctCues() {
        val goal = DailyGoalRecord(day, "rhythm", "UTC", 1, 1, 1, "qualified", stamp)
        assertEquals("daily-goal", habitFeedbackTransition("test", before, after.copy(goals = listOf(goal)))?.kind)
        assertEquals("perfect-day", habitFeedbackTransition("test", before, after.copy(goals = listOf(goal.copy(status = "perfect"))))?.kind)
        val quest = HabitQuest(TrackerEntity("quest", stamp, stamp), "daily", "daily-goal", null, day, day, 1, 1, 3, stamp)
        assertEquals("quest", habitFeedbackTransition("test", before, after.copy(quests = listOf(quest)))?.kind)
        assertEquals("completion", habitFeedbackTransition("test", before, after.copy(quests = listOf(quest),
            settings = HabitSettings(feedback = HabitFeedbackSettings(questsEnabled = false))))?.kind)
        assertEquals("rank-up", habitFeedbackTransition("test", before, after.copy(progress = UserProgress(currentRankId = "new")))?.kind)
    }

    @Test fun allSoundSchemesRoundTripAndOldDocumentsDefaultToCalm() {
        habitSoundSchemes.forEach { scheme ->
            val workspace = before.copy(settings = HabitSettings(feedback = HabitFeedbackSettings(sound = true, soundScheme = scheme)))
            assertEquals(scheme, HabitDocument.decode(HabitDocument.encode(workspace), 1).settings.feedback.soundScheme)
        }
        val root = JSONObject(HabitDocument.encode(before))
        root.getJSONObject("settings").getJSONObject("feedback").put("soundScheme", "unknown")
        assertEquals("calm", HabitDocument.decode(root.toString(), 1).settings.feedback.soundScheme)
        root.getJSONObject("settings").getJSONObject("feedback").remove("soundScheme")
        assertEquals("calm", HabitDocument.decode(root.toString(), 1).settings.feedback.soundScheme)
        assertFalse(HabitDocument.decode(root.toString(), 1).settings.feedback.sound)
    }
}
