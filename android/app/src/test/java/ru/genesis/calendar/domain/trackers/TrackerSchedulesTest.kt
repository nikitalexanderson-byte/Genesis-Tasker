package ru.genesis.calendar.domain.trackers

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.habits.TrackerSchedule

class TrackerSchedulesTest {
    @Test fun savedRecurrenceAndInclusiveBoundsOwnTheDayWithoutDisplayCalendar() {
        val monday = LocalDate.of(2026, 10, 26)
        val schedule = TrackerSchedule(monday, monday.plusDays(14), "Europe/Moscow",
            RecurrenceConfig(true, "classic", "weekdays", listOf(1)))
        assertTrue(TrackerSchedules.isScheduled(schedule, monday))
        assertFalse(TrackerSchedules.isScheduled(schedule, monday.plusDays(1)))
        assertTrue(TrackerSchedules.isScheduled(schedule, monday.plusDays(14)))
        assertFalse(TrackerSchedules.isScheduled(schedule, monday.plusDays(21)))
        assertTrue(TrackerSchedules.isScheduled(schedule.copy(endDate=null), monday.plusDays(21)))
        assertFalse(TrackerSchedules.isScheduled(schedule, monday.minusDays(7)))
    }
}
