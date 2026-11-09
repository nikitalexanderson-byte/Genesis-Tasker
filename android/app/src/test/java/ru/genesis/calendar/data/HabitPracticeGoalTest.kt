package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitPracticeGoalTest {
    private val start=LocalDate.parse("2026-10-23")
    private val next=start.plusDays(1)
    private val expired=start.plusDays(2)
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
    private val at="2026-10-23T12:00:00.000Z"
    private fun habit(mode: CalendarMode=CalendarMode.PROFANE): Habit {
        val schedule=StoicheionRestoration.dailySchedule(engine.defaultSchedule(start,mode)).let {
            it.copy(endDate=next,recurrence=it.recurrence.copy(rangeEnd=next.toString())) }
        return Habit(TrackerEntity("single-practice",at,at),"Synthetic practice",start,schedule,
            sacredPracticeId="fixture",practiceGoal=HabitPracticeGoal(startDate=start))
    }
    private fun completed(h: Habit, day: LocalDate)=engine.updateCompletion(emptyList(),h,day,day,true,null,"",day.toString()+"T12:00:00.000Z")

    @Test fun todaysCompletionSurvivesLaterPauseAndResumeWithoutAllowingPausedWrites() {
        val today = LocalDate.now(ZoneId.of("UTC"))
        val schedule = StoicheionRestoration.dailySchedule(engine.defaultSchedule(today, CalendarMode.PROFANE))
            .let { it.copy(endDate = today.plusDays(8), recurrence = it.recurrence.copy(rangeEnd = today.plusDays(8).toString())) }
        val h = habit().copy(createdDate = today, schedule = schedule,
            practiceGoal = HabitPracticeGoal(requiredCompletions = 3, startDate = today))
        val entries = engine.updateCompletion(emptyList(), h, today, today, true, null, "retained",
            "${today}T10:00:00.000Z")
        val paused = HabitLifecycle.apply(h, HabitLifecycleCommand("pause", h.id,
            "${today}T11:00:00.000Z", "pause", emptyList()))
        assertEquals(listOf(today), HabitPracticeGoals.progress(h, entries, today)!!.dates)
        assertEquals(listOf(today), HabitPracticeGoals.progress(paused, entries, today)!!.dates)
        assertEquals("open", HabitPracticeGoals.progress(paused, entries, today)!!.status)
        assertFalse(engine.isScheduled(paused, today, entries))
        assertSame(entries, engine.updateCompletion(entries, paused, today, today, false, null, "changed",
            "${today}T11:30:00.000Z"))
        val resumed = HabitLifecycle.apply(paused, HabitLifecycleCommand("resume", h.id,
            "${today}T12:00:00.000Z", "resume", listOf("pause")))
        assertEquals(listOf(today), HabitPracticeGoals.progress(resumed, entries, today)!!.dates)

        // A stale offline mark written during the pause remains invalid after Resume.
        val stale = entries.map { it.copy(entity = it.entity.changed("${today}T11:30:00.000Z")) }
        assertTrue(HabitPracticeGoals.progress(paused, stale, today)!!.dates.isEmpty())
        assertTrue(HabitPracticeGoals.progress(resumed, stale, today)!!.dates.isEmpty())
        assertTrue(HabitPracticeGoals.progress(h.copy(active = false), entries, today)!!.dates.isEmpty())
        assertTrue(HabitPracticeGoals.progress(h.copy(practiceGoal = h.practiceGoal!!.copy(startDate = today.plusDays(1))), entries, today)!!.dates.isEmpty())
        assertTrue(HabitPracticeGoals.progress(h.copy(schedule = schedule.copy(endDate = today.minusDays(1))), entries, today)!!.dates.isEmpty())

        val archive = HabitLifecycle.apply(h, HabitLifecycleCommand("archive", h.id,
            "${today}T11:00:00.000Z", "archive", emptyList()))
        val conflict = HabitLifecycle.project(h.copy(lifecycleHistory = HabitLifecycle.merge(paused.lifecycleHistory, archive.lifecycleHistory)))
        assertTrue(HabitPracticeGoals.progress(conflict, entries, today)!!.dates.isEmpty())
        val root = HabitMeasurements.rule(h, today)
        val rules = h.copy(ruleHistory = listOf(root,
            root.copy(id = "left", supersedes = listOf(root.id)), root.copy(id = "right", supersedes = listOf(root.id))))
        assertTrue(HabitPracticeGoals.progress(rules, entries, today)!!.dates.isEmpty())
        assertEquals("conflict", HabitPracticeGoals.progress(rules, entries, today)!!.status)
    }

    @Test fun everyInputCalendarAllowsEitherDayAndClosesAfterOneCompletion() {
        for(mode in CalendarMode.entries) {
            val h=habit(mode)
            assertTrue(engine.isScheduled(h,start));assertTrue(engine.isScheduled(h,next));assertFalse(engine.isScheduled(h,expired))
            val entries=completed(h,start)
            assertEquals("completed",HabitPracticeGoals.progress(h,entries,expired)?.status)
            assertFalse(engine.isScheduled(h,next,entries))
            assertSame(entries,engine.updateCompletion(entries,h,next,next,true,null,"",at))
        }
    }
    @Test fun intermediateDayIsNeutralAndTheSecondDayCanComplete() {
        val h=habit()
        assertEquals(0 to 0,engine.dailyCounts(listOf(h),emptyList(),start,today=next))
        assertTrue(HabitPracticeGoals.penalties(listOf(h),emptyList(),emptyList(),next).isEmpty())
        assertEquals(1 to 1,engine.dailyCounts(listOf(h),completed(h,next),next,today=next))
    }
    @Test fun penaltyIsExactlyTenOnceAndATimelyOfflineCompletionRepairsIt() {
        val h=habit();val seed=Rewards.create(40.0,"achievement","seed","seed",at)
        val first=HabitPracticeGoals.penalties(listOf(h),emptyList(),listOf(seed),expired)
        assertEquals(30,Rewards.balance(first))
        assertEquals(first,HabitPracticeGoals.penalties(listOf(h),emptyList(),first+first,expired.plusDays(20)))
        assertEquals(40,Rewards.balance(HabitPracticeGoals.penalties(listOf(h),completed(h,next),first,expired)))
        assertEquals("2026-10-25T00:00:00.000Z",first.first { it.reason=="practice-expired" }.createdAt)
    }
    @Test fun concurrentOfflineCompletionsDoNotDoubleExperienceAndPolicySurvivesCodec() {
        val h=habit();val entries=completed(h,start)+completed(h,next)
        assertEquals(listOf(10),habitCompletionCredits(HabitPracticeGoals.xpEntries(listOf(h),entries)))
        val source=LocalHabitWorkspace(habits=listOf(h),completions=entries)
        val decoded=HabitDocument.decode(HabitDocument.encode(source),1)
        assertEquals(h.practiceGoal,decoded.habits.single().practiceGoal)
        val reconciled=reconcileHabitWorkspace(source,expired,"UTC","2026-10-25T12:00:00.000Z")
        assertEquals(10,reconciled.progress.lifetimeXp)
    }
    @Test fun historicalDefaultSuccessClosesWithoutRetroactivePenaltyAndCustomSchedulesStay() {
        val h=habit().copy(practiceGoal=null,schedule=habit().schedule.copy(endDate=null,recurrence=habit().schedule.recurrence.copy(enabled=false,rangeEnd="")))
        val entries=completed(h,start)
        assertEquals("completed",HabitPracticeGoals.progress(h,entries,expired)?.status)
        assertTrue(HabitPracticeGoals.penalties(listOf(h),emptyList(),emptyList(),expired).isEmpty())
        val custom=h.copy(schedule=h.schedule.copy(recurrence=h.schedule.recurrence.copy(enabled=true,pattern="weekdays",days=listOf(5))))
        assertNull(HabitPracticeGoals.progress(custom,entries,expired))
    }
    @Test fun completionAndDeletionNeverResetTheWholeLaurelBalance() {
        val h=habit();val entries=completed(h,start)
        val seed=Rewards.create(40.0,"achievement","seed","seed",at)
        val source=LocalHabitWorkspace(habits=listOf(h),completions=entries,rewards=listOf(seed))
        val deleted=deleteHabitFromWorkspace(source,h.id,at)
        assertEquals(40,Rewards.balance(deleted.rewards))
        assertFalse(deleted.rewards.any { it.reason=="habit-deleted-reset" })
    }
    @Test fun aLegacyDeletionResetDoesNotWipeTheFinitePracticeBalance() {
        val h=habit();val seed=Rewards.create(40.0,"achievement","seed","seed",at)
        val old=Rewards.reset(listOf(seed),"habit-deleted-reset",h.id,"old-client-delete",at)
        assertEquals(40,Rewards.balance(HabitPracticeGoals.penalties(listOf(h),completed(h,start),old,expired)))
        assertEquals(30,Rewards.balance(HabitPracticeGoals.penalties(listOf(h),emptyList(),old,expired)))
    }
    @Test fun attachingAPracticePreservesAnEarlierLegitimateReset() {
        val snapshot=StoicheionRestorationTest.fixture()
        val h=habit().copy(stoicheionRestoration=snapshot)
        val attached=java.time.Instant.parse(snapshot.startedAt)
        val seed=Rewards.create(40.0,"achievement","seed","seed",attached.minusSeconds(120).toString())
        val before=Rewards.reset(listOf(seed),"habit-deleted-reset",h.id,"before-attachment",attached.minusSeconds(60).toString())
        val earned=Rewards.create(20.0,"achievement","earned","earned",attached.plusSeconds(60).toString())
        val ledger=Rewards.reset(before+earned,"habit-deleted-reset",h.id,"after-attachment",attached.plusSeconds(120).toString())
        val reconciled=HabitPracticeGoals.penalties(listOf(h),completed(h,start),ledger,expired)
        assertEquals(20,Rewards.balance(reconciled))
        assertEquals(1,reconciled.count { it.reason=="habit-deleted-reset" })
        assertEquals(10,Rewards.balance(HabitPracticeGoals.penalties(listOf(h),emptyList(),ledger,expired)))
    }
}
