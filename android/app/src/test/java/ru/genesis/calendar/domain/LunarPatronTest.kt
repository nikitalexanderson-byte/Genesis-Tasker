package ru.genesis.calendar.domain

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class LunarPatronTest {
    @Test fun allDecadeBoundariesAndMonthLengths() {
        for (day in 1..30) assertEquals(when {
            day <= 10 -> LunarPatron.ARTEMIS; day <= 20 -> LunarPatron.SELENE; else -> LunarPatron.HECATE
        }, lunarPatronForDay(day))
        for (day in listOf(0, 31, -1)) assertThrows(IllegalArgumentException::class.java) { lunarPatronForDay(day) }
        val calendar = GenesisCalendar(ZoneId.of("Europe/Moscow"))
        val lengths = mutableSetOf<Int>()
        for (offset in 0..365) {
            val date = LocalDate.of(2026, 1, 1).plusDays(offset.toLong())
            val lunar = calendar.lunarDate(date)
            assertEquals(lunarPatronForDay(lunar.day).nameRu, calendar.moonInfo(date).epithet)
            if (lunar.isThreshold) lengths += lunar.monthLength
        }
        assertEquals(setOf(29, 30), lengths)
    }
}
