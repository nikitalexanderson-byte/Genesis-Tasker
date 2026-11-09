package ru.genesis.calendar.domain.habits

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

class HabitMeasurementsTest {
    private val date = LocalDate.parse("2026-10-16")
    private val timestamp = "2026-10-16T10:00:00Z"
    private val engine = HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
    private fun habit() = Habit(TrackerEntity.create("habit",timestamp,"measured"),"Water",date,
        engine.defaultSchedule(date,CalendarMode.PROFANE),measurement=HabitMeasurement("quantity","ml",100_000,25_000))

    @Test fun decimalValuesAreExactAndInvalidValuesAreRejected() {
        assertEquals(125L,HabitMeasurements.parse("0,125"))
        assertEquals(100L,HabitMeasurements.parse("0.1"))
        listOf("0","-1","1e3","NaN","0.0001","1000000001").forEach { assertNull(it,HabitMeasurements.parse(it)) }
    }
    @Test fun partialThresholdAndOverTargetValuesAwardOnlyOneDailyCompletion() {
        val habit=habit()
        val partial=HabitMeasurements.append(habit,date,60_000,emptyList(),operationId="first",timestamp=timestamp)
        val first=HabitMeasurements.project(listOf(habit),partial,emptyList(),date,timestamp)
        assertFalse(first.single().completed);assertEquals(0,first.single().xpAwarded)
        val full=HabitMeasurements.append(habit,date,60_000,partial,operationId="second",timestamp=timestamp)
        val second=HabitMeasurements.project(listOf(habit),full,first,date,timestamp)
        assertTrue(second.single().completed);assertEquals(10,second.single().xpAwarded)
        assertEquals("habit-completion:measured:2026-10-16",second.single().entity.id)
        val more=HabitMeasurements.append(habit,date,90_000,full,operationId="third",timestamp=timestamp)
        assertEquals(10,HabitMeasurements.project(listOf(habit),more,second,date,timestamp).single().xpAwarded)
        assertEquals(more,HabitMeasurements.append(habit,date,90_000,more,operationId="third",timestamp=timestamp))
    }
    @Test fun concurrentCorrectionsRemainConflictedUntilExplicitResolution() {
        val habit=habit()
        val root=HabitMeasurements.append(habit,date,50_000,emptyList(),operationId="root",timestamp=timestamp)
        val left=HabitMeasurements.append(habit,date,30_000,root,"root",listOf("root"),operationId="left",timestamp=timestamp)
        val right=HabitMeasurements.append(habit,date,40_000,root,"root",listOf("root"),operationId="right",timestamp=timestamp)
        val merged=(left+right).distinctBy { it.entity.id }
        val state=HabitMeasurements.progress(habit,date,merged)
        assertTrue(state.entries.single().conflict);assertEquals(0L,state.total)
        val resolved=HabitMeasurements.append(habit,date,40_000,merged,"root",listOf("left","right"),operationId="resolution",timestamp=timestamp)
        assertFalse(HabitMeasurements.progress(habit,date,resolved).entries.single().conflict)
        assertEquals(40_000L,HabitMeasurements.progress(habit,date,resolved).total)
    }
    @Test fun qualityAndQuantityHaveSeparateConfirmationAndCorrectionsRetainEarnedXP() {
        val habit=habit().copy(qualityScale="ten",scoringMode="quality-ten")
        val events=HabitMeasurements.append(habit,date,100_000,emptyList(),operationId="value",timestamp=timestamp)
        val unconfirmed=HabitMeasurements.project(listOf(habit),events,emptyList(),date,timestamp)
        assertFalse(unconfirmed.single().completed)
        val confirmed=engine.updateCompletion(unconfirmed,habit,date,date,true,7.0,"",timestamp,measurementCompleted=true,measurementRewardEligible=true)
        assertEquals(7,confirmed.single().xpAwarded);assertNotNull(confirmed.single().qualityConfirmedAt)
        val corrected=HabitMeasurements.append(habit,date,20_000,events,"value",listOf("value"),operationId="edit",timestamp=timestamp)
        val result=HabitMeasurements.project(listOf(habit),corrected,confirmed,date,timestamp)
        assertFalse(result.single().completed);assertEquals(7,result.single().xpAwarded)
    }
    @Test fun targetChangesStartTomorrowAndKeepOriginalRules() {
        val habit=habit()
        val edited=preserveHabitCreationSettings(habit.copy(measurement=habit.measurement!!.copy(target=200_000)),habit,date,timestamp)
        assertEquals(100_000L,HabitMeasurements.rule(edited,date).measurement!!.target)
        assertEquals(200_000L,HabitMeasurements.rule(edited,date.plusDays(1)).measurement!!.target)
    }
    @Test fun importedRootsCannotEarnXPThroughCorrectionOrSmallManualAddition() {
        val habit=habit()
        val imported=HabitMeasurements.append(habit,date,100_000,emptyList(),operationId="imported",timestamp=timestamp)
            .map { it.copy(source="import") }
        val corrected=HabitMeasurements.append(habit,date,100_125,imported,"imported",listOf("imported"),operationId="edit",timestamp=timestamp)
        val mixed=HabitMeasurements.append(habit,date,125,corrected,operationId="manual",timestamp=timestamp)
        val state=HabitMeasurements.progress(habit,date,mixed)
        assertTrue(state.completed);assertEquals(125L,state.rewardTotal)
        assertEquals(0,HabitMeasurements.project(listOf(habit),mixed,emptyList(),date,timestamp).single().xpAwarded)
    }
    @Test fun durationDeletionAndRestorationPreserveHistoryAndXP() {
        val habit=habit().copy(measurement=HabitMeasurement("duration","min",60_000,15_000))
        val initial=HabitMeasurements.append(habit,date,60_125,emptyList(),operationId="session",timestamp=timestamp)
        val earned=HabitMeasurements.project(listOf(habit),initial,emptyList(),date,timestamp)
        val removed=HabitMeasurements.append(habit,date,null,initial,"session",listOf("session"),operationId="delete",timestamp=timestamp)
        assertEquals(0L,HabitMeasurements.progress(habit,date,removed).total)
        assertEquals(10,HabitMeasurements.project(listOf(habit),removed,earned,date,timestamp).single().xpAwarded)
        val restored=HabitMeasurements.append(habit,date,60_125,removed,"session",listOf("delete"),operationId="restore",timestamp=timestamp)
        assertEquals(60_125L,HabitMeasurements.progress(habit,date,restored).total)
        assertEquals(3,restored.size)
    }
}
