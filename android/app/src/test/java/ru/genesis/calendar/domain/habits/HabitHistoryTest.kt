package ru.genesis.calendar.domain.habits

import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.reconcileHabitWorkspace

class HabitHistoryTest {
    @Test fun commonWebNativeHistoryVectorsRetainOriginalDatesCreditsAuditAndCorrections() {
        val vectors = JSONArray(File("../../tests/fixtures/habit-history-vectors.json").readText())
        for (index in 0 until vectors.length()) {
            val item = vectors.getJSONObject(index); val label = item.getString("id")
            var workspace = HabitDocument.decode(CloudAccountImporter.habitsDocument(item.getJSONObject("workspace")), 0)
            val commands = item.getJSONArray("commands"); val now = Instant.parse(item.getString("now"))
            for (step in 0 until commands.length()) {
                val command = HabitHistoryCodec.command(commands.getJSONObject(step))
                workspace = HabitHistory.apply(workspace, command, now)
                assertSame(workspace, HabitHistory.apply(workspace, command, now))
                val envelopeEpoch = JSONObject(HabitDocument.encode(workspace)).getString("timerEpoch")
                assertTrue(envelopeEpoch.startsWith("history6:"))
                assertFalse(Regex("\\d{12}-[a-zA-Z0-9-]{1,64}").matches(envelopeEpoch))
                workspace = HabitDocument.decode(HabitDocument.encode(workspace), step.toLong())
            }
            val expected = item.getJSONObject("expected"); val record = expected.getJSONObject("completion")
            val actual = workspace.completions.single { it.habitId == record.getString("habitId") && it.date.toString() == record.getString("date") }
            assertEquals(label, record.getBoolean("completed"), actual.completed)
            assertEquals(label, record.getInt("score"), actual.score); assertEquals(label, record.getInt("xpAwarded"), actual.xpAwarded)
            assertEquals(label, record.getString("note"), actual.note)
            if (record.isNull("qualityValue")) assertNull(actual.qualityValue)
            else assertEquals(record.getDouble("qualityValue"), actual.qualityValue!!, 0.0)
            val times = record.getJSONArray("completedTimes")
            assertEquals(label, (0 until times.length()).map { times.getString(it) }, actual.completedTimes)
            assertEquals(label, expected.getInt("measurementCount"), workspace.measurements.size)
            val ids = expected.getJSONArray("historyIds")
            assertEquals(label, (0 until ids.length()).map { ids.getString(it) }, workspace.history.map { it.entity.id })
            val economy = HabitHistory.economy(workspace)
            assertEquals(label, expected.getInt("economyCompletionCount"), economy.completions.size)
            assertEquals(label, expected.getInt("economyMeasurementCount"), economy.measurements.size)
            if (label != "credited-quality") {
                val reconciled = reconcileHabitWorkspace(workspace, LocalDate.parse("2026-10-17"), "UTC", now.toString())
                assertEquals(label, workspace.rewards, reconciled.rewards)
                assertEquals(label, 0, reconciled.progress.lifetimeXp)
                assertEquals(label, workspace.achievementUnlocks, reconciled.achievementUnlocks)
            }
        }
    }
    @Test fun aConcurrentEditNeedsExplicitHeadsAndTodayFutureAndBeforeCreationAreRejected() {
        val item = JSONArray(File("../../tests/fixtures/habit-history-vectors.json").readText()).getJSONObject(0)
        val workspace = HabitDocument.decode(CloudAccountImporter.habitsDocument(item.getJSONObject("workspace")), 0)
        val command = HabitHistoryCodec.command(item.getJSONArray("commands").getJSONObject(0))
        val now = Instant.parse(item.getString("now"))
        val first = HabitHistory.apply(workspace, command, now)
        val other = HabitHistory.apply(workspace, command.copy(id = "concurrent", value = command.value.copy(completed = false)), now)
        val events = HabitHistory.merge(first.history, other.history)
        val merged = first.copy(history = events)
        assertTrue(HabitHistory.state(events, command.habitId, command.date).conflict)
        assertThrows(IllegalArgumentException::class.java) { HabitHistory.apply(merged, command.copy(id = "stale", heads = listOf(command.id)), now) }
        val resolved = HabitHistory.apply(merged, command.copy(id = "resolved", heads = listOf(command.id, "concurrent")), now)
        assertFalse(HabitHistory.state(resolved.history, command.habitId, command.date).conflict)
        for (date in listOf("2026-10-17", "2026-10-18", "2026-09-30")) assertThrows(IllegalArgumentException::class.java) {
            HabitHistory.apply(workspace, command.copy(id = "unavailable", date = LocalDate.parse(date)), now)
        }
        assertThrows(IllegalArgumentException::class.java) {
            HabitHistory.merge(first.history, listOf(first.history.first().copy(value = command.value.copy(note = "changed meaning"))))
        }
    }
}
