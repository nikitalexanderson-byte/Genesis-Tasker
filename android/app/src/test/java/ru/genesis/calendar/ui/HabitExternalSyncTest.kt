package ru.genesis.calendar.ui

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.TrackerEntity

class HabitExternalSyncTest {
    @Test fun calendarOccurrencesFollowHabitScheduleAndEndDate() {
        val start = LocalDate.of(2026,10,5)
        val schedule = HabitEngine(GenesisCalendar()).defaultSchedule(start,CalendarMode.PROFANE)
            .copy(endDate=start.plusDays(2))
        val habit = Habit(TrackerEntity.create("habit"),"Читать",start,schedule)
        assertEquals(listOf(start,start.plusDays(1),start.plusDays(2)),
            habitCalendarOccurrences(habit,start))
    }

    @Test fun invalidColorCannotBeSaved() {
        assertEquals("#2d7771",normalizedHabitColor(" #2D7771 "))
        assertEquals(null,normalizedHabitColor("red"))
        assertEquals("🧘",normalizedHabitEmoji("🧘"))
        assertEquals("👨‍👩‍👧‍👦",normalizedHabitEmoji("👨‍👩‍👧‍👦"))
        assertEquals(null,normalizedHabitEmoji("smile"))
    }
}
