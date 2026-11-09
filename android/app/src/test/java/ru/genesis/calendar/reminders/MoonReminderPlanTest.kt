package ru.genesis.calendar.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import ru.genesis.calendar.domain.LunarEphemeris

class MoonReminderPlanTest {
    private val now = Instant.parse("2026-09-30T00:00:00Z")
    private val zone = ZoneId.of("Europe/Moscow")

    @Test fun phasesHaveIndependentLeadTimesAtLocalMorning() {
        val reminders = planMoonReminders(now, zone, fullLeadDays = setOf(1, 2, 3), newLeadDays = setOf(1, 2, 3), horizonDays = 45)
        assertTrue(reminders.any { it.kind == "full" })
        assertTrue(reminders.any { it.kind == "new" })
        reminders.forEach { reminder ->
            val local = reminder.at.atZone(zone)
            assertEquals(LocalTime.of(9, 0), local.toLocalTime())
            assertEquals(reminder.eventDate.minusDays(reminder.leadDays.toLong()),
                local.toLocalDate())
        }
        assertTrue(reminders.groupBy { it.kind to it.eventDate }.values.any { group ->
            group.map { it.leadDays }.toSet() == setOf(1, 2, 3)
        })
        assertEquals(reminders.size, reminders.map { it.key }.toSet().size)
        val exactFullDates = LunarEphemeris.fullMoons.map { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }.toSet()
        assertTrue(reminders.filter { it.kind == "full" }.all { it.eventDate in exactFullDates })
    }

    @Test fun disabledPhaseProducesNoReminders() {
        assertTrue(planMoonReminders(now, zone, emptySet(), emptySet()).isEmpty())
        assertTrue(planMoonReminders(now, zone, emptySet(), setOf(2)).all { it.kind == "new" })
    }
}
