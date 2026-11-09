package ru.genesis.calendar.domain.habits

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*

class HabitIntervalsTest {
    private val date=LocalDate.of(2026,10,12)
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))
    private fun habit(mode: String="each")=Habit(TrackerEntity.create("habit",id="interval"),"Squats",date,
        engine.defaultSchedule(date,CalendarMode.PROFANE),intervalSchedule=HabitIntervalSchedule(30,"09:00","10:00",mode))

    @Test fun windowBoundariesAndInvalidValues() {
        assertEquals(19,HabitIntervalSchedule().times().size)
        assertEquals(listOf("09:10","09:40"),HabitIntervalSchedule(30,"09:10","10:00").times())
        assertFalse(HabitIntervalSchedule(0).valid())
        assertFalse(HabitIntervalSchedule(30,"18:00","09:00").valid())
        assertEquals(1440,HabitIntervalSchedule(1,"00:00","23:59").times().size)
    }
    @Test fun intervalMarksCompleteOneDayAndNeverMultiplyXp() {
        val habit=habit()
        var entries=engine.updateIntervalCompletion(emptyList(),habit,date,date,"09:00",true)
        assertFalse(entries.single().completed);assertEquals(0,entries.single().xpAwarded)
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"09:30",true)
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"10:00",true)
        assertTrue(entries.single().completed);assertEquals(10,entries.single().xpAwarded)
        assertEquals(1 to 1,engine.dailyCounts(listOf(habit),entries,date))
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"09:30",false)
        assertFalse(entries.single().completed)
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"09:30",true)
        assertEquals(10,entries.single().xpAwarded)
        assertEquals(entries,engine.updateIntervalCompletion(entries,habit,date,date,"12:00",true))
        assertEquals(entries,engine.updateIntervalCompletion(entries,habit,date.minusDays(1),date,"09:00",true))
    }
    @Test fun oneDailyMarkDoesNotRequireIndividualSlots() {
        val habit=habit("day")
        assertEquals(emptyList<HabitCompletion>(),engine.updateIntervalCompletion(emptyList(),habit,date,date,"09:00",true))
        assertTrue(engine.updateCompletion(emptyList(),habit,date,date,true,null,"").single().completed)
    }
    @Test fun qualityIsConfirmedOnceAfterAllIntervals() {
        val habit=habit().copy(scoringMode="quality-ten",qualityScale="ten")
        var entries=emptyList<HabitCompletion>()
        habit.intervalSchedule!!.times().forEach { entries=engine.updateIntervalCompletion(entries,habit,date,date,it,true) }
        assertFalse(entries.single().completed)
        assertEquals(0,entries.single().xpAwarded)
        entries=engine.updateCompletion(entries,habit,date,date,true,8.0,"")
        val xp=entries.single().xpAwarded
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"09:30",false)
        entries=engine.updateIntervalCompletion(entries,habit,date,date,"09:30",true)
        assertTrue(entries.single().completed)
        assertEquals(xp,entries.single().xpAwarded)
        assertEquals(8.0,entries.single().qualityValue!!,0.0)
    }
}
