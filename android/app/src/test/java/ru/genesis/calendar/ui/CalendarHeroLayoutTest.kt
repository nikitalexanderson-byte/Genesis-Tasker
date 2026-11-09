package ru.genesis.calendar.ui

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

class CalendarHeroLayoutTest {
    @Test fun todayReturnTracksBothTheSelectedDayAndTheActuallyRenderedPeriod() {
        val today = LocalDate.of(2026, 10, 30)
        val calendar = GenesisCalendar()
        for (mode in CalendarMode.entries) {
            val current = calendar.monthRange(today, mode)
            val anotherDay = if (today < current.end) today.plusDays(1) else today.minusDays(1)
            assertFalse("$mode already shows today", calendarOffersToday(today, current, today))
            assertTrue("$mode another selected day needs a return", calendarOffersToday(anotherDay, current, today))
            val next = calendar.monthRange(current.end.plusDays(1), mode)
            val previous = calendar.monthRange(current.start.minusDays(1), mode)
            assertTrue("$mode next-month preview retains a return", calendarOffersToday(today, next, today))
            assertTrue("$mode previous-month preview retains a return", calendarOffersToday(today, previous, today))
            assertFalse("$mode returning clears the redundant action", calendarOffersToday(today, current, today))
        }
    }
}
