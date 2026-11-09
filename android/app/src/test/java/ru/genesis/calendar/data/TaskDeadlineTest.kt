package ru.genesis.calendar.data

import java.time.*
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig

class TaskDeadlineTest {
    private fun task(date:String="2026-09-28",time:String="",zone:String="UTC") = LocalTask(
        "deadline-check","Open task",date=date,time=time,zoneId=zone)
    @Test fun pastDayIsOverdueWithoutChangingCompletion() {
        val record=task()
        assertTrue(isTaskOverdue(record,Instant.parse("2026-09-29T00:00:00Z")))
        assertFalse(record.done)
    }
    @Test fun allDayTaskIsAvailableUntilItsDayEnds() {
        val record=task()
        assertFalse(isTaskOverdue(record,Instant.parse("2026-09-28T23:59:59Z")))
        assertTrue(isTaskOverdue(record,Instant.parse("2026-09-29T00:00:00Z")))
    }
    @Test fun timedDeadlineUsesTheTasksTimeZone() {
        val record=task(time="10:30",zone="Europe/Moscow")
        assertFalse(isTaskOverdue(record,Instant.parse("2026-09-28T07:29:59Z")))
        assertTrue(isTaskOverdue(record,Instant.parse("2026-09-28T07:30:00Z")))
    }
    @Test fun movingEndDateKeepsMultiDayTaskOpenWithoutAnOverdueLabel() {
        val record=task().copy(sourceFieldsJson="{\"endDate\":\"2026-09-30\"}")
        assertFalse(isTaskOverdue(record,Instant.parse("2026-09-29T12:00:00Z")))
        assertTrue(isTaskOverdue(record,Instant.parse("2026-10-01T00:00:00Z")))
    }
    @Test fun occurrenceAndWholeSeriesDeadlinesRemainIndependent() {
        val record=task(time="09:00").copy(recurrence=RecurrenceConfig(enabled=true,mode="classic",pattern="daily",
            rangeStart="2026-09-28",rangeEnd="2026-09-30"))
        val now=Instant.parse("2026-09-29T12:00:00Z")
        assertFalse(isTaskOverdue(record,now))
        assertTrue(isTaskOverdue(record,now,LocalDate.parse("2026-09-28")))
        assertFalse(isTaskOverdue(record,now,LocalDate.parse("2026-09-30")))
        assertTrue(isTaskOverdue(record.copy(recurrenceExcludedDates=listOf("2026-09-30")),now))
    }
    @Test fun completedUndatedAndInvalidTasksNeverAppearOverdue() {
        val now=Instant.parse("2026-09-29T12:00:00Z")
        assertFalse(isTaskOverdue(task().copy(done=true),now))
        assertFalse(isTaskOverdue(task(date=""),now))
        assertFalse(isTaskOverdue(task(date="2026-02-31"),now))
    }
}
