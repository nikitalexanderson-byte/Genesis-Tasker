package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate
import java.time.ZoneId

class DayKnowledgePanelTest {
    private val calendar = GenesisCalendar(ZoneId.of("Europe/Moscow"))
    private val fullMoon = LocalDate.of(2026, 9, 27)

    @Test
    fun `three rhythms match the reviewed website facts`() {
        val facts = dayRhythmFacts(fullMoon, calendar)

        assertEquals(listOf("Η", "🜄", "II"), facts.map { it.symbol })
        assertEquals("Пурпурное Забвение", facts[0].title)
        assertEquals("Столкновение · Преодоление хаоса", facts[0].meaning)
        assertEquals("Вода", facts[1].title)
        assertEquals("Диада", facts[2].title)
    }

    @Test
    fun `full and new moon events enable the fasting notice`() {
        assertTrue(isMoonFastingDay(calendar.moonInfo(fullMoon)))
        val newMoon = (0L..35L).map(fullMoon::plusDays)
            .first { "новолуние" in calendar.moonInfo(it).event.lowercase() }
        assertTrue(isMoonFastingDay(calendar.moonInfo(newMoon)))
    }

    @Test
    fun `selected hero calendar is not duplicated below it`() {
        CalendarMode.entries.forEach { primary ->
            val secondary = secondaryCalendarModes(primary)
            assertEquals(2, secondary.size)
            assertFalse(primary in secondary)
            assertEquals(3, (secondary + primary).distinct().size)
        }
    }
}
