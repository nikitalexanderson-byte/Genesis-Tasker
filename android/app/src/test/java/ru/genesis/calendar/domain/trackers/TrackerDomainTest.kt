package ru.genesis.calendar.domain.trackers

import org.junit.Assert.*
import org.junit.Test
import java.time.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class TrackerDomainTest {
    private val date=LocalDate.of(2026,9,23)
    private val meta=TrackerEntity("test","2026-09-23T10:00:00.000Z","2026-09-23T10:00:00.000Z")
    private val schedule=HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow"))).defaultSchedule(date,CalendarMode.PROFANE)
    private fun time(value: String): LocalTime? = value.takeIf { it.isNotEmpty() }?.let(LocalTime::parse)

    @Test fun sleepDurationsMatchRealWebIncludingDstGapOverlapAndHalfHourTransitions() {
        webSleepDurationVectors.forEach { line -> val v=line.split('|')
            assertEquals(line,v[4].toInt(),SleepTracker.durationMinutes(LocalDate.parse(v[0]),time(v[1]),time(v[2]),v[3]))
        }
    }
    @Test fun sleepEntriesPreserveSourceScoringDeviationAndQuality() {
        val rules=listOf(SleepRule("bed-early","bedtime","on-or-before",LocalTime.of(23,0),3.0),SleepRule("wake-late","wake","after",LocalTime.of(8,0),-1.5))
        webSleepEntryVectors.forEach { line -> val v=line.split('|')
            val plan=SleepPlan(meta,schedule,scoringEnabled=v[0].toBoolean(),rules=rules)
            val entry=SleepTracker.entry(meta,plan,date,time(v[1]),time(v[2]),7.5,"")
            assertEquals(v[3].toInt(),entry.durationMinutes ?: 0)
            assertEquals(v[4].toInt(),entry.deviationMinutes ?: 0)
            assertEquals(v[5].toDouble(),entry.score,0.0)
            assertEquals(v[6].toInt(),entry.quality)
        }
    }
    @Test fun absentSleepAndQualityRemainNullRatherThanAZeroObservation() {
        val entry=SleepTracker.entry(meta,SleepPlan(meta,schedule),date,null,null,null,"")
        assertNull(entry.durationMinutes);assertNull(entry.deviationMinutes);assertNull(entry.quality)
        assertTrue(SleepTracker.hasAmbiguousLocalTime(LocalDate.of(2026,3,8),LocalTime.of(2,30),LocalTime.of(5,0),ZoneId.of("America/New_York")))
    }
    @Test fun durationDifferenceIsThirtyMinutesForTheReportedEightHourPlan() {
        val plan=SleepPlan(meta,schedule.copy(timezone="America/Los_Angeles"),
            targetBedtime=LocalTime.of(1,0),targetWakeTime=LocalTime.of(9,0))
        assertEquals(30,SleepTracker.deviationMinutes(plan,date,LocalTime.of(1,30),LocalTime.of(9,0)))
        assertEquals(0,SleepTracker.deviationMinutes(plan,date,LocalTime.of(2,0),LocalTime.of(10,0)))
        val old=SleepTracker.entry(meta,plan,date,LocalTime.of(1,30),LocalTime.of(9,0),7.0,"Literal note")
            .copy(durationMinutes=1,deviationMinutes=15)
        val corrected=SleepTracker.recalculate(old,plan)
        assertEquals(450,corrected.durationMinutes);assertEquals(30,corrected.deviationMinutes)
        assertEquals(old.entity,corrected.entity);assertEquals(old.note,corrected.note);assertEquals(old.score,corrected.score,0.0)
    }
    @Test fun originalMoodScaleAndLegacyMappingMatchWeb() {
        assertEquals(12,MoodCatalog.options.size)
        webMoodVectors.forEach { line -> val v=line.split('|');val option=MoodTracker.option(v[0].toDouble())
            assertEquals(line,listOf(v[0],option.value,option.label,option.color).joinToString("|"))
        }
        webLegacyMoodVectors.forEach { line -> val v=line.split('|');assertEquals(line,v[1].toInt(),MoodTracker.normalizedValue(legacyId=v[0])) }
    }
    @Test fun sameDayMoodObservationsKeepSeparateIdsButDuplicateIdUsesLast() {
        val first=MoodTracker.entry(meta,date,meta.updatedAt,0.0,tags=(1..25).map { "tag$it" })
        val second=first.copy(entity=meta.copy(id="second"),moodValue=4)
        val edited=first.copy(note="Changed")
        assertEquals(listOf(edited,second),MoodTracker.normalizeEntries(listOf(first,second,edited)))
        assertEquals(20,first.tags.size)
        assertEquals(0,first.moodValue)
    }
    @Test fun abstinenceScoresMatchWebIncludingRelapsePrecedenceAndZeroPenalty() {
        webAddictionScoreVectors.forEach { line -> val v=line.split('|')
            assertEquals(line,v[4].toInt(),AddictionTrackerRules.score(v[0].toDouble(),v[1].toDouble(),v[2].toBoolean(),v[3].toBoolean()))
        }
        val tracker=AddictionTracker(meta,schedule)
        val relapse=AddictionTrackerRules.entry(meta,tracker,date,true,true,30.0,"","",meta.updatedAt)
        assertFalse(relapse.cleanDay);assertEquals(10,relapse.cravingIntensity);assertEquals(0,relapse.score)
    }
    @Test fun abstinenceStreakEndsOnMissingOrRelapseAndScopesTracker() {
        val tracker=AddictionTracker(meta,schedule)
        val today=AddictionTrackerRules.entry(meta,tracker,date,true,false,0.0,"","",meta.updatedAt)
        val yesterday=today.copy(date=date.minusDays(1))
        assertEquals(2,AddictionTrackerRules.streak(listOf(today,yesterday),tracker.id,date))
        assertEquals(0,AddictionTrackerRules.streak(listOf(yesterday),tracker.id,date))
        assertEquals(0,AddictionTrackerRules.streak(listOf(today.copy(trackerId="another")),tracker.id,date))
        assertEquals(0,AddictionTrackerRules.streak(listOf(today,today.copy(relapse=true)),tracker.id,date))
    }
}
