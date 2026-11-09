package ru.genesis.calendar.ui

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test
import ru.genesis.calendar.domain.CalendarRange

class CalendarVisualDataTest {
    @Test fun marchYearNumbersCrossTheCivilYearBoundaryWithoutChangingDates() {
        val start = LocalDate.of(2026, 3, 1)
        assertEquals((1..12).toList(), (0L..11L).map { gregorianMonthOrdinal(start.plusMonths(it).monthValue, true) })
        assertEquals(11, gregorianMonthOrdinal(1, true))
        assertEquals(12, gregorianMonthOrdinal(2, true))
        assertEquals((1..12).toList(), (1..12).map { gregorianMonthOrdinal(it, false) })
    }


    @Test
    fun `lunar cells format sacred dates as day pyata and month`() {
        assertEquals("II/3/VII", lunarSacredDateLabel(sacredDay = 12, pyata = 3, monthIndex = 6))
        assertEquals("IIII/6/VIIII", lunarSacredDateLabel(sacredDay = 29, pyata = 6, monthIndex = 8))
        assertEquals("V/1/O", lunarSacredDateLabel(sacredDay = 5, pyata = 1, monthIndex = 12))
    }
    @Test fun lunarGridCanDisplayRealApeironDatesOutsideThePentads() {
        val calendar = ru.genesis.calendar.domain.GenesisCalendar()
        val first = calendar.sacredDate(calendar.gregorianDate(2026, 12, 1))
        val last = calendar.sacredDate(calendar.gregorianDate(2026, 12, 4))
        assertEquals("I/O", lunarSacredDateLabel(first.day, 0, first.monthIndex))
        assertEquals("IIII/O", lunarSacredDateLabel(last.day, 0, last.monthIndex))
    }
    @Test fun gregorianGridShowsFadedNeighbouringDatesInSundayFirstRows() {
        val dates = gregorianGridDates(CalendarRange(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 31)))
        assertEquals(LocalDate.of(2025, 12, 28), dates.first())
        assertEquals(LocalDate.of(2026, 1, 1), dates[4])
        assertEquals(LocalDate.of(2026, 1, 31), dates.last())
        assertEquals(35, dates.size)
    }

    @Test fun gregorianGridCanStartWithMonday() {
        val dates = gregorianGridDates(
            CalendarRange(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 31)),
            weekStartsOnSunday = false,
        )
        assertEquals(LocalDate.of(2025, 12, 29), dates.first())
        assertEquals(LocalDate.of(2026, 1, 1), dates[3])
        assertEquals(LocalDate.of(2026, 2, 1), dates.last())
        assertEquals(35, dates.size)
    }

    @Test fun gregorianGridFillsNextMonthWithoutInventingSixthRow() {
        val dates = gregorianGridDates(CalendarRange(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30)))
        assertEquals(LocalDate.of(2026, 8, 30), dates.first())
        assertEquals(LocalDate.of(2026, 10, 3), dates.last())
        assertEquals(35, dates.size)
    }

    @Test fun patronSymbolsFollowWebsiteSundayFirstOrder() {
        val sunday = LocalDate.of(2026, 9, 27)
        assertEquals(listOf("☉", "☽", "♂", "☿", "♃", "♀", "♄"),
            (0L..6L).map { weekdayPatronMark(sunday.plusDays(it)).symbol })
        assertEquals("Гестия, Афродита и Дионис", weekdayPatronMark(LocalDate.of(2026, 9, 25)).patrons)
    }

    @Test fun lunarGridUsesReadOnlyContextBeforeAndAfterTheMonth() {
        val range = CalendarRange(LocalDate.of(2026, 4, 17), LocalDate.of(2026, 5, 15))
        val dates = lunarGridDates(range)
        assertEquals(LocalDate.of(2026, 4, 13), dates.first())
        assertEquals(range.start, dates[4])
        assertEquals(LocalDate.of(2026, 5, 17), dates.last())
        assertEquals(35, dates.size)
        assertEquals(0.46f, lunarAdjacentAlpha(3, 4, 29, 35), 0.001f)
        assertEquals(1f, lunarAdjacentAlpha(4, 4, 29, 35), 0.001f)
        assertEquals(0.18f, lunarAdjacentAlpha(34, 4, 29, 35), 0.001f)
    }

    @Test fun additiveRomanFourMatchesGenesisNotation() {
        assertEquals("IIII", genesisRoman(4))
        assertEquals("XIIII", genesisRoman(14))
        assertEquals("XXIIII", genesisRoman(24))
    }
}
