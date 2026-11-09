package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*

@RunWith(Parameterized::class)
class HabitAnalysisParityTest(private val fixture: JSONObject) {
    companion object { @JvmStatic @Parameterized.Parameters(name = "{index}") fun cases(): List<Array<Any>> {
        val rows = JSONArray(HabitAnalysisParityTest::class.java.getResource("/habit-analysis-web.json")!!.readText())
        return (0 until rows.length()).map { arrayOf<Any>(rows.getJSONObject(it)) }
    } }
    private fun workspace() = HabitDocument.decode(CloudAccountImporter.habitsDocument(fixture.getJSONObject("workspace")), 0)
    private fun percent(expected: JSONObject, key: String, actual: Double?) {
        if (expected.isNull(key)) assertNull(key, actual) else assertEquals(key, expected.getDouble(key), actual!!, 0.000001)
    }
    @Test fun dayStatesOpportunitiesVolumeAndDenominatorsMatchTheWeb() {
        val w = workspace(); val r = fixture.getJSONObject("range"); val at = Instant.parse(fixture.getString("now"))
        val before = HabitDocument.encode(w)
        val actual = HabitAnalysis.range(w, w.habits.first(), HabitGoalPeriod(LocalDate.parse(r.getString("start")), LocalDate.parse(r.getString("end"))), at)
        val expected = fixture.getJSONObject("expected").getJSONObject("report")
        assertEquals(expected.getInt("closedCount"), actual.closedCount); assertEquals(expected.getInt("completedCount"), actual.completedCount)
        assertEquals(expected.getInt("unknownDays"), actual.unknownDays); assertEquals(expected.getInt("unresolvedCount"), actual.unresolvedCount)
        percent(expected, "completionPercent", actual.completionPercent)
        val days = expected.getJSONArray("days"); assertEquals(days.length(), actual.days.size)
        actual.days.forEachIndexed { index, day ->
            val row = days.getJSONObject(index)
            assertEquals(row.getString("date"), day.date.toString()); assertEquals(row.getString("activity"), day.activity)
            assertEquals(row.getBoolean("scheduled"), day.scheduled); assertEquals(row.getBoolean("availabilityKnown"), day.availabilityKnown)
            assertEquals(row.getBoolean("future"), day.future); assertEquals(row.getString("availability"), day.availability)
            assertEquals(row.getLong("volume"), day.volume)
            if (row.isNull("target")) assertNull(day.target) else assertEquals(row.getLong("target"), day.target)
        }
        val volumes = expected.getJSONArray("volumes"); assertEquals(volumes.length(), actual.volumes.size)
        actual.volumes.forEachIndexed { index, volume ->
            val row = volumes.getJSONObject(index)
            assertEquals(row.getLong("actual"), volume.actual); assertEquals(row.getLong("target"), volume.target)
            assertEquals(row.getLong("openActual"), volume.openActual); assertEquals(row.getLong("unknownActual"), volume.unknownActual)
            assertEquals(row.getLong("extraActual"), volume.extraActual); percent(row, "percent", volume.percent)
        }
        assertEquals(before, HabitDocument.encode(w))
    }
    @Test fun equallyElapsedComparisonAndZeroBaselineMatchTheWeb() {
        val w = workspace(); val at = Instant.parse(fixture.getString("now")); val expected = fixture.getJSONObject("expected").getJSONObject("comparison")
        val actual = HabitAnalysis.comparison(w, LocalDate.parse(fixture.getString("now").take(10)), CalendarMode.PROFANE, CalendarContext(timeZone = "UTC"), at)
        assertEquals(expected.getInt("elapsed"), actual.elapsed); assertEquals(expected.getInt("absoluteChange"), actual.absoluteChange)
        assertEquals(expected.getInt("open"), actual.open); percent(expected, "changePercent", actual.changePercent)
        for ((key, part) in listOf("current" to actual.current, "previous" to actual.previous)) {
            val row = expected.getJSONObject(key)
            assertEquals(row.getInt("completed"), part.completed); assertEquals(row.getInt("planned"), part.planned)
            assertEquals(row.getInt("unknown"), part.unknown); percent(row, "percent", part.percent)
        }
    }
}
