package ru.genesis.calendar.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.domain.habits.HabitTimers

class HabitBackupTimerInteropTest {
    private val cases get() = JSONArray(javaClass.getResource("/habit-backup-timers-web.json")!!.readText())
    private fun verify(index: Int) {
        val case = cases.getJSONObject(index); val label = case.getString("name")
        fun workspace(key: String) = HabitDocument.decode(CloudAccountImporter.habitsDocument(case.getJSONObject(key)), 0)
        val current = workspace("current"); val text = case.getJSONObject("backup").toString()
        val choices = case.getJSONObject("choices").let { value -> value.keys().asSequence().associateWith { value.getString(it) } }
        val result = HabitBackupRestore.apply(current, HabitBackupRestore.preview(current, text), choices, case.getString("at"))
        val expected = workspace("expected")
        // Timer order is not causal: the explicit parent IDs define the same graph.
        assertEquals(label, expected.timers.sortedBy { it.id }, result.timers.sortedBy { it.id })
        assertEquals(label, expected.measurements, result.measurements)
        assertEquals(label, expected.completions, result.completions)
        assertEquals(label, expected.history, result.history)
        assertEquals(label, expected.rewards, result.rewards); assertEquals(label, expected.progress, result.progress)
        val readings = case.getJSONArray("readings")
        val sessions = HabitTimers.sessions(result.timers)
        assertEquals(label, readings.length(), sessions.size)
        for (i in sessions.indices) {
            val state = requireNotNull(sessions[i].state); val reading = HabitTimers.reading(state, Instant.parse(case.getString("at")))
            val wanted = readings.getJSONObject(i)
            assertEquals(label, wanted.getString("status"), state.status)
            assertEquals(label, wanted.getLong("workMs"), reading.workMs)
            assertEquals(label, wanted.getLong("breakMs"), reading.breakMs)
        }
        val repeat = HabitBackupRestore.apply(result, HabitBackupRestore.preview(result, text), choices, case.getString("at"))
        assertEquals(label, result, repeat)
    }
    @Test fun runningPomodoroStopsAtSnapshotWithoutCountingTimeOutsideTheApplication() = verify(0)
    @Test fun copiedPomodoroRemapsSessionAndParentsWithoutChangingCurrentRewards() = verify(1)
    @Test fun savedTimerRetainsBothDstDayAllocationsAndMeasurementProvenance() = verify(2)
    @Test fun copyingSavedTimerKeepsRewardAndMeasurementReplayIdempotent() = verify(3)
}
