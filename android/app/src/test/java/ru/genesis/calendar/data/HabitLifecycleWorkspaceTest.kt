package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.*

class HabitLifecycleWorkspaceTest {
    private val at="2026-10-18T12:00:00.000Z"
    private fun fixture(): LocalHabitWorkspace {
        val json=JSONObject(javaClass.getResource("/habit-lifecycle-web.json")!!.readText())
        return HabitDocument.decode(CloudAccountImporter.habitsDocument(json),1)
    }
    @Test fun webJournalRoundTripsThroughTheNativeCodecAndPreservesPastAvailability() {
        val source=fixture();val habit=source.habits.single()
        val restored=HabitDocument.decode(HabitDocument.encode(source),2)
        assertEquals(habit.lifecycleHistory,restored.habits.single().lifecycleHistory)
        val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
        assertTrue(engine.isScheduled(habit,LocalDate.parse("2026-10-10")))
        assertFalse(engine.isScheduled(habit,LocalDate.parse("2026-10-11")))
        assertTrue(engine.isScheduled(habit,LocalDate.parse("2026-10-12")))
        assertEquals("archived",HabitLifecycle.state(habit,LocalDate.parse("2026-10-13")).status)
        assertEquals("paused",HabitLifecycle.state(habit).status)
        assertEquals("lifecycle7:",JSONObject(HabitDocument.encode(restored)).getString("timerEpoch"))
    }
    @Test fun concurrentWebAndNativeTransitionsRemainAnExplicitConflictAfterSync() {
        val web=JSONObject(javaClass.getResource("/habit-lifecycle-web.json")!!.readText())
        val source=fixture();val habit=source.habits.single();val heads=HabitLifecycle.state(habit).heads.map { it.id }
        val local=HabitLifecycleWorkspace.apply(source,HabitLifecycleCommand("native-resume",habit.id,at,"resume",heads))
        val remote=HabitLifecycleWorkspace.apply(source,HabitLifecycleCommand("web-delete",habit.id,at,"delete",heads))
        val localDoc=WorkspacePatch.localDocument(web,null,JSONObject(HabitDocument.encode(local)),null)
        val remoteDoc=WorkspacePatch.localDocument(web,null,JSONObject(HabitDocument.encode(remote)),null)
        val merged=WorkspacePatch.apply(web,localDoc,remoteDoc,setOf("habits"),2,"2026-10-18T12:01:00.000Z","native")
        val mergedHabit=HabitDocument.decode(CloudAccountImporter.habitsDocument(merged.document),3).habits.single()
        assertTrue(HabitLifecycle.state(mergedHabit).conflict);assertFalse(mergedHabit.active)
        assertEquals(setOf("native-resume","web-delete"),HabitLifecycle.state(mergedHabit).heads.map { it.id }.toSet())
        val chosen=HabitLifecycle.apply(mergedHabit,HabitLifecycleCommand("choice",habit.id,"2026-10-18T12:02:00.000Z","resolve",
            HabitLifecycle.state(mergedHabit).heads.map { it.id },"native-resume"))
        assertTrue(chosen.active);assertFalse(HabitLifecycle.state(chosen).conflict)
    }
    @Test fun deleteRestoreAndReplayPreserveIdentityAndNeverRepeatThePenalty() {
        val source=fixture().let { it.copy(rewards=listOf(Rewards.create(25.0,"comeback","seed","seed",at))) }
        val habit=source.habits.single();val command=HabitLifecycleCommand("delete-once",habit.id,at,"delete",HabitLifecycle.state(habit).heads.map { it.id })
        val deleted=HabitLifecycleWorkspace.apply(source,command)
        assertEquals(0,Rewards.balance(deleted.rewards));assertEquals(source.habits.single().id,deleted.habits.single().id)
        assertEquals(deleted,HabitLifecycleWorkspace.apply(deleted,command))
        val restored=HabitLifecycleWorkspace.apply(deleted,HabitLifecycleCommand("restore",habit.id,"2026-10-18T12:01:00.000Z","restore",
            HabitLifecycle.state(deleted.habits.single()).heads.map { it.id }))
        assertEquals("paused",HabitLifecycle.state(restored.habits.single()).status)
        assertEquals(deleted.rewards,restored.rewards);assertEquals(source.progress.lifetimeXp,restored.progress.lifetimeXp)
    }
    @Test fun archivePreservesRewardsAndCancelsTheRunningIntervalWithoutRestartingItOnRestore() {
        val day=LocalDate.parse("2026-10-18")
        val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
        val habit=Habit(TrackerEntity("clock-habit",at,at),"Minutes",day,engine.defaultSchedule(day,CalendarMode.PROFANE),
            measurement=HabitMeasurement("duration","min",60000,1000))
        var source=LocalHabitWorkspace(habits=listOf(habit),rewards=listOf(Rewards.create(25.0,"comeback","seed","seed",at)))
        source=HabitTimerWorkspace.apply(source,HabitTimerCommand("start","device","2026-10-18T11:59:00.000Z","clock",habitId=habit.id))
        val archived=HabitLifecycleWorkspace.apply(source,HabitLifecycleCommand("archive",habit.id,at,"archive",emptyList()))
        assertEquals(source.rewards,archived.rewards);assertEquals("paused",HabitTimers.sessions(archived.timers).single().state!!.status)
        val restored=HabitLifecycleWorkspace.apply(archived,HabitLifecycleCommand("restore",habit.id,"2026-10-18T12:01:00.000Z","restore",listOf("archive")))
        assertEquals(archived.timers,restored.timers)
    }
    @Test fun malformedLifecycleDataCannotBeSilentlyDiscarded() {
        val json=JSONObject(HabitDocument.encode(fixture()))
        json.getJSONArray("habits").getJSONObject(0).getJSONArray("lifecycleHistory").getJSONObject(0).put("baselineActive","true")
        assertThrows(IllegalArgumentException::class.java) { HabitDocument.decode(json.toString(),1) }
    }
    @Test fun deletionResetsSameInstantCreditsInEveryTimestampNotationAndArrivalOrder() {
        for(timestamp in listOf(at,"2026-10-18T12:00:00Z","2026-10-18T15:00:00+03:00")) {
            val ledger=Rewards.reset(listOf(Rewards.create(25.0,"comeback","seed","zz-credit",timestamp)),"habit-deleted-reset","habit","aa-deletion",at)
            assertEquals(0,Rewards.balance(ledger));assertEquals(0,Rewards.balance(ledger.reversed()+ledger))
            assertEquals(5,Rewards.balance(ledger+Rewards.create(5.0,"comeback","later","later","2026-10-18T12:00:00.001Z")))
        }
    }
}
