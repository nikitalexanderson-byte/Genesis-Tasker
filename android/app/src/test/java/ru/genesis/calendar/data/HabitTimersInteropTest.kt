package ru.genesis.calendar.data

import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitTimersInteropTest {
    @Test fun utcAliasesSurviveTheCanonicalCalendarWireContextWithoutChangingTimerIdentity() {
        for (zone in listOf("UTC","Etc/UTC","GMT","Etc/GMT","Zulu")) {
            val plan=HabitTimerPlan("stopwatch",25,5,zone,"profane",CalendarContext(timeZone=zone),"Minutes","legacy:minutes")
            val operations=HabitTimers.start(emptyList(),"minutes","device",plan,Instant.parse("2026-10-21T12:00:00Z"),"clock")
            val wire=HabitTimerCodec.encode(operations)
            assertEquals("UTC",wire.getJSONObject(0).getJSONObject("plan").getJSONObject("context").getString("timeZone"))
            assertEquals(operations,HabitTimerCodec.decode(wire))
            wire.getJSONObject(0).getJSONObject("plan").getJSONObject("context").put("timeZone","Europe/London")
            assertThrows(IllegalArgumentException::class.java) { HabitTimerCodec.decode(wire) }
        }
    }
    private fun canonical(value: Any): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }
    @Test fun webVectorsKeepUtcDurationDstBreaksRoundingAndExactWireData() {
        val vectors = JSONObject(javaClass.getResource("/habit-timers-web.json")!!.readText()).getJSONArray("cases")
        for (index in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(index); val rows = vector.getJSONArray("operations")
            val operations = HabitTimerCodec.decode(rows); val state = HabitTimers.sessions(operations).single().state!!
            val reading = HabitTimers.reading(state); val expected = vector.getJSONObject("expected")
            assertEquals(vector.getString("name"), expected.getString("status"), state.status)
            assertEquals(expected.getLong("workMs"), reading.workMs); assertEquals(expected.getLong("breakMs"), reading.breakMs)
            val days = expected.getJSONArray("days")
            assertEquals(days.length(), state.allocations!!.size)
            for (dayIndex in 0 until days.length()) {
                val day = days.getJSONObject(dayIndex); val actual = state.allocations[dayIndex]
                assertEquals(day.getString("date"), actual.date.toString()); assertEquals(day.getLong("workMs"), actual.workMs)
                assertEquals(day.getLong("value"), actual.value)
            }
            assertEquals(canonical(rows), canonical(HabitTimerCodec.encode(operations)))
        }
    }

    private fun fixture(): LocalHabitWorkspace {
        val date = LocalDate.of(2026, 10, 16)
        val schedule = HabitEngine(GenesisCalendar(ZoneId.of("UTC"))).defaultSchedule(date, CalendarMode.PROFANE).let {
            it.copy(timezone = "UTC", recurrence = it.recurrence.copy(calendarContext = CalendarContext(timeZone = "UTC")))
        }
        val habit = Habit(TrackerEntity.create("habit", id = "timer-reading"), "Reading", date, schedule,
            measurement = HabitMeasurement("duration", "min", 10_000, 1000))
        return LocalHabitWorkspace(habits = listOf(habit))
    }
    private val now = Instant.parse("2026-10-17T01:00:00Z")
    private fun command(action: String, at: String, id: String = action, timeOnly: Boolean = false) =
        HabitTimerCommand(action, "device", at, id, sessionId = "session", habitId = "timer-reading", timeOnly = timeOnly)
    private fun finished(): LocalHabitWorkspace {
        val started = HabitTimerWorkspace.apply(fixture(), command("start", "2026-10-16T23:50:00Z", "session"), now)
        return HabitTimerWorkspace.apply(started, command("finish", "2026-10-17T00:10:00Z"), now)
    }

    @Test fun finishedSessionIsDurableFailedSaveDoesNotEraseItAndReplayNeverDuplicatesCredit() {
        val finished = finished(); val before = HabitDocument.encode(finished)
        val changed = finished.copy(habits = finished.habits.map { it.copy(active = false) })
        try {
            HabitTimerWorkspace.apply(changed, command("save", "2026-10-17T00:11:00Z"), now)
            fail("Changed goal was silently rebound")
        } catch (expected: IllegalArgumentException) { assertEquals("HABIT_TIMER_GOAL_CHANGED", expected.message) }
        assertEquals(before, HabitDocument.encode(finished))
        val saved = HabitTimerWorkspace.apply(finished, command("save", "2026-10-17T00:11:00Z"), now)
        assertEquals(2, saved.measurements.size)
        assertTrue(saved.measurements.first { it.date.toString() == "2026-10-16" }.historical)
        assertEquals(0, saved.completions.first { it.date.toString() == "2026-10-16" }.xpAwarded)
        assertEquals(10, saved.completions.first { it.date.toString() == "2026-10-17" }.xpAwarded)
        assertSame(saved, HabitTimerWorkspace.apply(saved, command("save", "2026-10-18T00:11:00Z"), now.plusSeconds(86400)))
        assertEquals(saved, HabitDocument.decode(HabitDocument.encode(saved), saved.revision))
        val timeOnly = HabitTimerWorkspace.apply(changed, command("save", "2026-10-17T00:11:00Z", timeOnly = true), now)
        assertTrue(timeOnly.measurements.isEmpty()); assertEquals("saved", HabitTimers.sessions(timeOnly.timers).single().state!!.status)
    }

    @Test fun nativeTimerAccountAdapterReturnsBothSessionsAndStableEntriesToTheWeb() {
        val base = WorkspacePatch.emptyDocument()
        val saved = HabitTimerWorkspace.apply(finished(), command("save", "2026-10-17T00:11:00Z"), now)
        val local = WorkspacePatch.localDocument(base, null, JSONObject(HabitDocument.encode(saved)), null)
        val returned = WorkspacePatch.apply(base, local, base, setOf("habits"), 1, "2026-10-17T01:00:00Z", "native-timer-vector").document
        val imported = HabitDocument.decode(CloudAccountImporter.habitsDocument(returned), 0)
        assertEquals(saved.timers, imported.timers); assertEquals(saved.measurements, imported.measurements)
        assertEquals(10, imported.completions.sumOf { it.xpAwarded })
        File("build/test-results/habit-timers-native.json").apply { parentFile!!.mkdirs(); writeText(returned.toString(2)) }
    }

    @Test fun conflictingHeadsRequireAChoiceAndAResetEpochDropsStaleOfflineOperations() {
        val start = finished().timers.first { it.action == "start" }
        val first = HabitTimers.append(listOf(start), "session", "device", "pause", Instant.parse("2026-10-16T23:55:00Z"), "first")
        val second = HabitTimers.append(listOf(start), "session", "device", "pause", Instant.parse("2026-10-16T23:56:00Z"), "second")
        val merged = HabitTimers.merge(first, second)
        assertNull(HabitTimers.sessions(merged).single().state)
        try { HabitTimers.append(merged, "session", "device", "save"); fail("Conflict saved") }
        catch (expected: IllegalArgumentException) { assertEquals("HABIT_TIMER_CONFLICT", expected.message) }
        val resolved = HabitTimers.append(merged, "session", "device", "resolve", Instant.parse("2026-10-17T00:00:00Z"),
            "choice", branchId = "first")
        assertEquals(5 * 60_000L, HabitTimers.reading(HabitTimers.sessions(resolved).single().state!!).workMs)
        val nextEpoch = HabitTimers.nextEpoch("")
        assertTrue(HabitTimerCodec.decode(HabitTimerCodec.encode(merged), nextEpoch).isEmpty())
    }
}
