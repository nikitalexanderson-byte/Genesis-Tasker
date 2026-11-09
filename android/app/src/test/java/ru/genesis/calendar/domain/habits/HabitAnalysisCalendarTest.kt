package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.*

class HabitAnalysisCalendarTest {
    @Test fun allFourYearContextsKeepEveryReportDayAndLeaveTheSavedWorkspaceUnchanged() {
        val dates = listOf("2024-01-01", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-19", "2024-03-20", "2026-04-16")
        val configurations = listOf(CalendarMode.PROFANE to "january", CalendarMode.PROFANE to "march", CalendarMode.SACRED to "january", CalendarMode.LUNAR to "january")
        for (zone in listOf("UTC", "Europe/Moscow", "America/New_York", "Pacific/Auckland")) for ((mode, start) in configurations) for (date in dates) {
            val calendar = GenesisCalendar(ZoneId.of(zone), 2, start)
            val range = calendar.yearRange(LocalDate.parse(date), mode)
            val h = habit(range.start, zone); val workspace = LocalHabitWorkspace(habits = listOf(h)); val before = workspace.copy()
            val report = HabitAnalysis.range(workspace, h, HabitGoalPeriod(range.start, range.end.plusDays(1)), range.end.plusDays(1).atStartOfDay(ZoneId.of(zone)).toInstant())
            assertEquals(range.dates().size, report.days.size)
            assertEquals(range.start, report.days.first().date); assertEquals(range.end, report.days.last().date)
            assertEquals(report.days.size, report.days.map { it.date }.distinct().size)
            assertEquals(before, workspace)
        }
    }
    private fun habit(start: LocalDate, zone: String = "UTC"): Habit {
        val at = start.atStartOfDay(ZoneId.of(zone)).toInstant().toString()
        val habit = Habit(TrackerEntity("calendar-analysis", at, at), "Сохранённая практика", start,
            HabitEngine(GenesisCalendar(ZoneId.of(zone))).defaultSchedule(start, CalendarMode.PROFANE))
        return HabitLifecycle.apply(habit, HabitLifecycleCommand("observed", habit.id, at, "observe", emptyList()))
    }
    @Test fun thirteenMonthLunarYearUsesItsActualFullRange() {
        val calendar = GenesisCalendar(ZoneId.of("UTC"))
        val range = (2020..2035).map { calendar.yearRange(LocalDate.of(it, 7, 1), CalendarMode.LUNAR) }.first { it.dates().size > 370 }
        val h = habit(range.start); val now = range.end.plusDays(1).atStartOfDay(ZoneId.of("UTC")).toInstant()
        val report = HabitAnalysis.range(LocalHabitWorkspace(habits = listOf(h)), h, HabitGoalPeriod(range.start, range.end.plusDays(1)), now)
        assertTrue(report.days.size > 370); assertEquals(range.dates().size, report.days.size)
        assertEquals(range.end, report.days.last().date); assertEquals(report.days.size, report.closedCount)
    }
    @Test fun januaryInMarchYearBelongsToPreviousYearAndRetainsLeapDay() {
        val calendar = GenesisCalendar(ZoneId.of("UTC"), 1, "march")
        val range = calendar.yearRange(LocalDate.parse("2024-01-15"), CalendarMode.PROFANE)
        assertEquals(LocalDate.parse("2023-03-01"), range.start); assertEquals(LocalDate.parse("2024-02-29"), range.end)
        val h = habit(range.start)
        val report = HabitAnalysis.range(LocalHabitWorkspace(habits = listOf(h)), h, HabitGoalPeriod(range.start, range.end.plusDays(1)), Instant.parse("2024-03-01T12:00:00Z"))
        assertEquals(366, report.days.size); assertEquals(366, report.closedCount)
    }
    @Test fun reportTodayUsesHabitZoneAcrossDstAndDoesNotInventFutureFailures() {
        val h = habit(LocalDate.parse("2026-01-01"), "America/New_York"); val w = LocalHabitWorkspace(habits = listOf(h))
        val now = Instant.parse("2026-03-08T04:30:00Z")
        val report = HabitAnalysis.range(w, h, HabitGoalPeriod(LocalDate.parse("2026-03-01"), LocalDate.parse("2026-04-01")), now)
        assertEquals(LocalDate.parse("2026-03-07"), report.days.first().today)
        assertEquals(6, report.closedCount); assertEquals(1, report.open.size)
        assertTrue(report.days.first { it.date.toString() == "2026-03-08" }.future)
        val fall = HabitAnalysis.range(w, h, HabitGoalPeriod(LocalDate.parse("2026-10-31"), LocalDate.parse("2026-11-03")), Instant.parse("2026-11-04T00:00:00Z"))
        assertEquals(3, fall.days.size); assertEquals(3, fall.closedCount)
    }
}
