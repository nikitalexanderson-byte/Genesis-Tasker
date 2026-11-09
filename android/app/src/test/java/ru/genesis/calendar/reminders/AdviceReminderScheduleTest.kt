package ru.genesis.calendar.reminders

import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.AdviceNotificationPreferences

class AdviceReminderScheduleTest {
    @Test fun accountTimeZoneAndLateWindowDoNotFollowTheDeviceDate() {
        val settings = AdviceNotificationPreferences(true, "09:00", "Europe/Moscow")
        val day = LocalDate.parse("2026-11-01")
        assertEquals(Instant.parse("2026-11-01T06:00:00Z"), AdviceReminderScheduler.plannedAt(day, settings))
        assertFalse(AdviceReminderScheduler.withinWindow(day, settings, Instant.parse("2026-11-01T05:59:59Z")))
        assertTrue(AdviceReminderScheduler.withinWindow(day, settings, Instant.parse("2026-11-01T06:00:00Z")))
        assertTrue(AdviceReminderScheduler.withinWindow(day, settings, Instant.parse("2026-11-01T07:59:59Z")))
        assertFalse(AdviceReminderScheduler.withinWindow(day, settings, Instant.parse("2026-11-01T08:00:00Z")))
        assertFalse(AdviceReminderScheduler.withinWindow(day, settings, Instant.parse("2026-11-02T06:00:00Z")))
    }
    @Test fun midnightNeverReplaysYesterdayAndDstUsesTheConfiguredWallTime() {
        val late = AdviceNotificationPreferences(true, "23:30", "Europe/Moscow")
        val day = LocalDate.parse("2026-11-01")
        assertTrue(AdviceReminderScheduler.withinWindow(day, late, Instant.parse("2026-11-01T20:45:00Z")))
        assertFalse(AdviceReminderScheduler.withinWindow(day, late, Instant.parse("2026-11-01T21:00:00Z")))
        val dst = AdviceNotificationPreferences(true, "02:30", "Europe/Berlin")
        assertEquals(Instant.parse("2026-03-29T01:30:00Z"), AdviceReminderScheduler.plannedAt(LocalDate.parse("2026-03-29"), dst))
        assertEquals(Instant.parse("2026-10-25T00:30:00Z"), AdviceReminderScheduler.plannedAt(LocalDate.parse("2026-10-25"), dst))
    }
}
