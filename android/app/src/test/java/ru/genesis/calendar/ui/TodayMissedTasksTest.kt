package ru.genesis.calendar.ui

import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.RecurrenceConfig

class TodayMissedTasksTest {
    @Test fun onlyUnfinishedStandalonePastDueTasksAreReminded() {
        val past = LocalTask(title = "Past", date = "2026-09-28", zoneId = "UTC")
        val done = past.copy(id = "done", title = "Done", done = true)
        val recurring = past.copy(id = "recurring", title = "Series",
            recurrence = RecurrenceConfig(enabled = true))
        val today = past.copy(id = "today", title = "Today", date = "2026-09-30")
        val future = past.copy(id = "future", title = "Future", date = "2026-10-01")
        val results = missedTasksForToday(listOf(past, done, recurring, today, future),
            LocalDate.parse("2026-09-30"), Instant.parse("2026-09-30T12:00:00Z"))
        assertEquals(listOf(past), results)
    }
}
