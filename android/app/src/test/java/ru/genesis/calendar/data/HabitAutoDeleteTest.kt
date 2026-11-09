package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

class HabitAutoDeleteTest {
    private val policy=HabitAutoDeletePolicy(id="31400000-0000-4000-8000-000000000001",count=3,startOn=LocalDate.parse("2026-10-01"))
    private val now=Instant.parse("2026-10-05T12:00:00Z")
    private fun fixture(points: String="keep"): LocalHabitWorkspace {
        val start=LocalDate.parse("2026-10-01")
        val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
        val habit=Habit(TrackerEntity.create("habit",id="habit-automatic"),"Automatic habit",start,engine.defaultSchedule(start,CalendarMode.PROFANE),autoDeletePolicy=policy.copy(points=points))
        val other=habit.copy(entity=TrackerEntity.create("habit",id="habit-other"),title="Other habit",autoDeletePolicy=null)
        return LocalHabitWorkspace(habits=listOf(habit,other),completions=listOf(habit,other).map {
            HabitCompletion(TrackerEntity.create("completion",id="completion:${it.id}"),it.id,start,true,score=10,xpAwarded=10,note="retained") },
            rewards=listOf(Rewards.create(100.0,"comeback","seed","seed","2026-10-01T12:00:00.000Z")),progress=UserProgress(lifetimeXp=20,laurelsBalance=100))
    }
    @Test fun waitsForClosedConsecutiveDaysAndCompletionOrPauseResetsThePeriod() {
        val source=fixture();val habit=source.habits.first()
        fun due(today: String,completed: List<HabitCompletion> = emptyList(),paused: Boolean=false)=HabitAutoDelete.due(policy,habit.createdDate,
            LocalDate.parse(today),completed,{day -> HabitLifecycle.state(habit,day).let { if(paused && day.toString()=="2026-10-02") it.copy(status="paused") else it } },{true})
        assertNull(due("2026-10-03"));assertEquals("2026-10-04",due("2026-10-04")!!.deadline.toString())
        assertNull(due("2026-10-04",listOf(source.completions.first().copy(date=LocalDate.parse("2026-10-03")))))
        assertNull(due("2026-10-04",paused=true))
        assertNull(due("2026-10-04",listOf(source.completions.first().copy(date=LocalDate.parse("2026-10-04")))))
    }
    @Test fun calendarMonthsClampFebruaryAndWeeksCrossYears() {
        for((start,unit,end) in listOf(Triple("2027-01-31","months","2027-02-28"),Triple("2028-01-31","months","2028-02-29"),Triple("2026-12-31","weeks","2027-01-07")))
            assertEquals(end,HabitAutoDelete.deadline(LocalDate.parse(start),policy.copy(count=1,unit=unit)).toString())
    }
    @Test fun changingTheRuleStartsFreshAndLegacyHabitsStayDisabled() {
        assertNull(fixture().habits.last().autoDeletePolicy)
        assertEquals(policy,HabitAutoDelete.prepare(policy,policy,LocalDate.parse("2026-11-01")))
        val changed=HabitAutoDelete.prepare(policy.copy(count=7),policy,LocalDate.parse("2026-11-01"))!!
        assertNotEquals(policy.id,changed.id);assertEquals("2026-11-01",changed.startOn.toString())
        assertThrows(IllegalArgumentException::class.java) { policy.copy(count=0) }
    }
    @Test fun achievedWeeklyTargetResetsInactivityBeforeThePeriodCloses() {
        val source=fixture();val habit=source.habits.first().copy(autoDeletePolicy=policy.copy(count=1),
            periodGoal=HabitPeriodGoal(period="week",metric="days",target=1,calendar="profane",context=ru.genesis.calendar.domain.CalendarContext(version=2,timeZone="UTC")))
        val done=source.completions.first().copy(entity=TrackerEntity.create("completion",id="weekly"),date=LocalDate.parse("2026-10-13"))
        val next=HabitAutoDeleteWorkspace.apply(source.copy(habits=listOf(habit),completions=source.completions+done),Instant.parse("2026-10-14T12:00:00Z"))
        assertEquals("active",HabitLifecycle.state(next.habits.first()).status)
    }
    @Test fun keepPreservesCreditsLaurelsAndEvidenceAndRepeatsAreNoops() {
        val source=fixture();val next=HabitAutoDeleteWorkspace.apply(source,now)
        assertEquals("deleted",HabitLifecycle.state(next.habits.first()).status)
        assertEquals("active",HabitLifecycle.state(next.habits.last()).status)
        assertEquals(20,next.progress.lifetimeXp);assertEquals(source.rewards,next.rewards);assertEquals(source.completions,next.completions)
        assertEquals(next,HabitAutoDeleteWorkspace.apply(next,now.plusSeconds(86400)))
    }
    @Test fun removeDeductsOnlyThisHabitOnceAndSurvivesCodecAndRestore() {
        val source=fixture("remove");val next=HabitAutoDeleteWorkspace.apply(source,now)
        assertEquals(10,next.progress.lifetimeXp);assertEquals(20,next.progress.grossLifetimeXp);assertEquals(10,next.progress.forfeitedHabitXp)
        assertEquals(100,next.progress.laurelsBalance);assertEquals(source.rewards,next.rewards);assertEquals(source.completions,next.completions)
        val decoded=HabitDocument.decode(HabitDocument.encode(next),0)
        assertEquals(next.habits,decoded.habits);assertEquals(next.progress,decoded.progress);assertEquals(next.completions,decoded.completions)
        assertEquals(decoded,HabitAutoDeleteWorkspace.reconcilePoints(decoded))
        val habit=next.habits.first()
        val restored=HabitLifecycleWorkspace.apply(next,HabitLifecycleCommand("manual-restore",habit.id,now.toString(),"restore",HabitLifecycle.state(habit).heads.map { it.id }))
        assertEquals(10,HabitAutoDeleteWorkspace.reconcilePoints(restored).progress.lifetimeXp)
    }
    @Test fun offlineCompletionDisprovesExpiryWithoutDeletingEitherJournalRecord() {
        val source=fixture("remove");val next=HabitAutoDeleteWorkspace.apply(source,now)
        val late=source.completions.first().copy(entity=TrackerEntity.create("completion",id="offline"),date=LocalDate.parse("2026-10-04"))
        val repaired=HabitAutoDeleteWorkspace.apply(next.copy(completions=next.completions+late),now)
        assertEquals("active",HabitLifecycle.state(repaired.habits.first()).status)
        assertEquals(0,repaired.progress.forfeitedHabitXp);assertEquals(30,repaired.progress.lifetimeXp)
        assertTrue(repaired.habits.first().lifecycleHistory.any { it.action=="delete" })
        assertEquals(repaired,HabitAutoDeleteWorkspace.apply(repaired,now))
    }
    @Test fun staleAccountTotalsCannotReverseDeductionsAfterThreeWayMerge() {
        val source=fixture("remove");val next=HabitAutoDeleteWorkspace.apply(source,now)
        fun web(value: LocalHabitWorkspace)=WorkspacePatch.localDocument(WorkspacePatch.emptyDocument(),null,JSONObject(HabitDocument.encode(value)),null)
        val merged=WorkspacePatch.apply(web(source),web(next),web(source),setOf("habits"),2,now.toString(),"test")
        val decoded=HabitDocument.decode(CloudAccountImporter.habitsDocument(merged.document),2)
        assertEquals(10,HabitAutoDeleteWorkspace.reconcilePoints(decoded).progress.lifetimeXp)
        assertEquals(source.habits.first().autoDeletePolicy,decoded.habits.first().autoDeletePolicy)
    }
}
