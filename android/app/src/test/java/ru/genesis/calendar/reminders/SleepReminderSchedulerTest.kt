package ru.genesis.calendar.reminders

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.TrackerSchedule
import ru.genesis.calendar.domain.trackers.SleepPlan

class SleepReminderSchedulerTest {
    private val start=LocalDate.of(2026,10,4)
    private val plan=SleepPlan(TrackerEntity.create("sleep-plan"),
        TrackerSchedule(start,timezone="Europe/Moscow",recurrence=RecurrenceConfig(true,"classic","daily",
            listOf(1),rangeStart=start.toString())),
        targetBedtime=LocalTime.of(23,0),reminderEnabled=true,reminderMinutesBefore=30)

    @Test fun nextAlarmUsesPlanTimezoneAndMovesToFollowingDay() {
        assertEquals(Instant.parse("2026-10-04T19:30:00Z"),SleepReminderScheduler.plannedAt(plan,start))
        assertEquals(start to Instant.parse("2026-10-04T19:30:00Z"),
            SleepReminderScheduler.next(plan,Instant.parse("2026-10-04T19:00:00Z")))
        assertEquals(start.plusDays(1) to Instant.parse("2026-10-05T19:30:00Z"),
            SleepReminderScheduler.next(plan,Instant.parse("2026-10-04T19:31:00Z")))
    }

    @Test fun disabledPlanHasNoAlarm() {
        assertNull(SleepReminderScheduler.next(plan.copy(reminderEnabled=false),Instant.parse("2026-10-04T19:00:00Z")))
        assertNull(SleepReminderScheduler.next(plan.copy(active=false),Instant.parse("2026-10-04T19:00:00Z")))
    }
}
