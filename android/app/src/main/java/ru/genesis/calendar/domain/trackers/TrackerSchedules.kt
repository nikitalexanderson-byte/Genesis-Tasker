package ru.genesis.calendar.domain.trackers

import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.TrackerSchedule

/** Saved input/recurrence calendar owns the schedule, independently of the visible calendar. */
object TrackerSchedules {
    fun isScheduled(schedule: TrackerSchedule, date: LocalDate): Boolean {
        if (date < schedule.startDate || schedule.endDate?.let { date > it } == true) return false
        val zone = ZoneId.of(schedule.timezone)
        return RecurrenceEngine(GenesisCalendar(zone)).matches(schedule.startDate.toString(), schedule.recurrence.copy(
            calendarContext = schedule.recurrence.calendarContext ?: CalendarContext(timeZone = zone.id),
            rangeStart = schedule.startDate.toString(), rangeEnd = schedule.endDate?.toString() ?: ""),
            date.toString(), ignoreRangeEnd = schedule.endDate == null)
    }
}
