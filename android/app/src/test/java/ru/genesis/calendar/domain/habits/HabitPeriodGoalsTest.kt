package ru.genesis.calendar.domain.habits

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

class HabitPeriodGoalsTest {
    private val first = LocalDate.parse("2026-05-04")
    private val last = LocalDate.parse("2026-05-10")
    private val stamp = "2026-05-04T12:00:00.000Z"
    private val now = Instant.parse("2026-05-10T12:00:00.000Z")
    private val context = CalendarContext(timeZone="Europe/Moscow")
    private fun goal(metric: String = "days", target: Long = 3) = HabitPeriodGoal(period="week",metric=metric,target=target,calendar="profane",context=context)
    private fun habit(metric: String = "days", target: Long = 3) = Habit(TrackerEntity.create("habit",stamp,"period-habit"),"Synthetic goal",first,
        HabitEngine(GenesisCalendar(ZoneId.of(context.timeZone))).defaultSchedule(first,CalendarMode.PROFANE),periodGoal=goal(metric,target),
        measurement=if(metric=="sum") HabitMeasurement("duration","min",60_000,15_000) else null)

    @Test fun entriesAndDifferentDaysNeverShareADenominator() {
        val habit = habit("entries")
        var events = emptyList<HabitMeasurementEvent>()
        repeat(3) { index -> events = HabitMeasurements.append(habit,first,1000,events,operationId="entry-$index",timestamp=stamp) }
        val completions = HabitMeasurements.project(listOf(habit),events,emptyList(),first,stamp)
        val executions = HabitPeriodGoals.progress(habit,last,events,completions,now)!!
        assertEquals(3L,executions.value); assertTrue(executions.completed)
        val distinct = HabitPeriodGoals.progress(habit.copy(periodGoal=goal()),last,events,completions,now)!!
        assertEquals(1L,distinct.value); assertFalse(distinct.completed)
        assertEquals(10,completions.single().xpAwarded)
        assertThrows(IllegalArgumentException::class.java) { HabitMeasurements.append(habit,first,3000,events) }
    }

    @Test fun exactPartialAmountsSumAcrossDaysWithoutCountingTheNextWeek() {
        val habit = habit("sum",120_000).copy(measurement=HabitMeasurement("duration","min",60_000,15_000))
        var events = HabitMeasurements.append(habit,first,30_125,emptyList(),operationId="first",timestamp=stamp)
        events = HabitMeasurements.append(habit,first.plusDays(2),89_875,events,operationId="second",timestamp="2026-05-06T12:00:00Z")
        events = HabitMeasurements.append(habit,first.plusDays(7),50_000,events,operationId="next-week",timestamp="2026-05-11T12:00:00Z")
        val result = HabitPeriodGoals.progress(habit,last,events,emptyList(),now)!!
        assertEquals(120_000L,result.value); assertEquals(0L,result.remaining); assertTrue(result.completed)
        assertNull(HabitPeriodGoals.settlement(habit,first.plusDays(2),events,emptyList(),now))
        assertTrue(HabitPeriodGoals.settlement(habit,last,events,emptyList(),now)!!.completed)
    }

    @Test fun periodSumShowsQuantityBeforeQualityIsConfirmed() {
        val habit = habit("sum",120_000).copy(measurement=HabitMeasurement("duration","min",60_000,15_000),qualityScale="ten",scoringMode="quality-ten")
        val events = HabitMeasurements.append(habit,first,120_000,emptyList(),operationId="value",timestamp=stamp)
        val pending = HabitPeriodGoals.progress(habit,last,events,emptyList(),now)!!
        assertEquals(120_000L,pending.value); assertTrue(pending.qualityPending); assertFalse(pending.completed)
        val completed = HabitCompletion(TrackerEntity.create("completion",stamp),habit.id,first,true,8.0,8,8,qualityConfirmedAt=stamp)
        assertTrue(HabitPeriodGoals.progress(habit,last,events,listOf(completed),now)!!.completed)
    }

    @Test fun partialAndImpossiblePeriodsAreNeutralWithoutLoweringTheTarget() {
        val partial = habit().let { it.copy(createdDate=first.plusDays(3),schedule=it.schedule.copy(startDate=first.plusDays(3))) }
        assertEquals("neutral",HabitPeriodGoals.progress(partial,last,emptyList(),emptyList(),now.plusSeconds(86_400))!!.status)
        val impossible = HabitPeriodGoals.progress(habit(target=10),last,emptyList(),emptyList(),now)!!
        assertTrue(impossible.unattainable); assertEquals(10L,impossible.goal.target); assertEquals("neutral",impossible.status)
    }

    @Test fun finalAllowedDayIsTheDeadline() {
        val habit = habit().let { it.copy(schedule=it.schedule.copy(recurrence=it.schedule.recurrence.copy(pattern="weekdays",days=listOf(1,3,5)))) }
        val result = HabitPeriodGoals.progress(habit,last,emptyList(),emptyList(),now)!!
        assertEquals(LocalDate.parse("2026-05-08"),result.deadline); assertEquals("missed",result.status)
        assertNull(HabitPeriodGoals.settlement(habit,first,emptyList(),emptyList(),now))
    }

    @Test fun civilWeeksPyatasApeironAndLunarMonthUseTheSavedContext() {
        fun check(goal: HabitPeriodGoal, date: String, start: String, end: String) {
            assertEquals(HabitGoalPeriod(LocalDate.parse(start),LocalDate.parse(end)),HabitPeriodGoals.period(goal,LocalDate.parse(date)))
        }
        check(goal(),"2026-03-08","2026-03-02","2026-03-09")
        check(goal().copy(calendar="sacred"),"2026-03-20","2026-03-20","2026-03-25")
        check(goal().copy(calendar="sacred"),"2027-03-16","2027-03-15","2027-03-20")
        check(goal().copy(calendar="lunar",period="month",context=CalendarContext(timeZone="UTC")),"2026-05-01","2026-04-17","2026-05-16")
    }

    @Test fun importedRootCannotBeMadeRewardEligibleByAManualFraction() {
        val habit = habit("sum",120_000).copy(measurement=HabitMeasurement("duration","min",60_000,15_000))
        val imported = HabitMeasurements.append(habit,first,120_000,emptyList(),operationId="imported",timestamp=stamp)
            .map { it.copy(source="import") }
        val events = HabitMeasurements.append(habit,first.plusDays(2),1,imported,operationId="manual",timestamp="2026-05-06T12:00:00Z")
        val result = HabitPeriodGoals.progress(habit,last,events,emptyList(),now)!!
        assertEquals(120_001L,result.value); assertEquals(1L,result.rewardValue); assertFalse(result.rewardEligible)
    }
}
