package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitDayDecisionWorkspaceTest {
    private val date=LocalDate.parse("2026-10-18")
    private val at="2026-10-18T12:00:00.000Z"
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
    private fun fixture()=LocalHabitWorkspace(habits=listOf(Habit(TrackerEntity("day",at,at),"Day",date,engine.defaultSchedule(date,CalendarMode.PROFANE))))
    private fun command()=HabitDayDecisionCommand("skip",at,"day",date,emptyList(),true)
    @Test fun explicitDecisionSurvivesDocumentAndCloudRoundTripAndReplaysWithoutNewRewards() {
        val source=fixture()
        val next=HabitDayDecisionWorkspace.apply(source,command(),Instant.parse(at))
        assertEquals(at,next.completions.single().skippedAt)
        assertFalse(next.completions.single().completed)
        val decoded=HabitDocument.decode(HabitDocument.encode(next),2)
        assertEquals(next.history,decoded.history)
        assertEquals(next.completions.single().skippedAt,decoded.completions.single().skippedAt)
        assertEquals(source.rewards,decoded.rewards)
        assertEquals(0,decoded.progress.lifetimeXp)
        assertSame(decoded,HabitDayDecisionWorkspace.apply(decoded,command(),Instant.parse("2026-10-19T12:00:00Z")))
        val cloud=WorkspacePatch.localDocument(JSONObject(),null,JSONObject(HabitDocument.encode(decoded)),null)
        val imported=HabitDocument.decode(CloudAccountImporter.habitsDocument(cloud),3)
        assertEquals(decoded.history,imported.history)
        assertEquals(at,imported.completions.single().skippedAt)
    }
    @Test fun laterCompletionClearsSkipAndCanEarnOnlyOneCreditAcrossTwoClientsAndLegacyDuplicates() {
        val source=fixture()
        val skipped=HabitDayDecisionWorkspace.apply(source,command(),Instant.parse(at))
        val habit=source.habits.single()
        val later="2026-10-18T12:01:00.000Z"
        val a=engine.updateCompletion(skipped.completions,habit,date,date,true,null,"",later,"client-a")
        val b=engine.updateCompletion(emptyList(),habit,date,date,true,null,"",later,"client-b")
        assertEquals(a.single().entity.id,b.single().entity.id)
        val projected=HabitHistory.project(listOf(habit),skipped.history,a,emptyList())
        assertTrue(projected.single().completed);assertNull(projected.single().skippedAt)
        val legacy=projected.single().copy(entity=projected.single().entity.copy(id="legacy-second"))
        assertEquals(listOf(10),habitCompletionCredits(projected+b+legacy))
        val reconciled=reconcileHabitWorkspace(skipped.copy(completions=projected),date,"UTC",later)
        assertEquals(10,reconciled.progress.lifetimeXp)
        assertThrows(IllegalArgumentException::class.java) { HabitDayDecisionWorkspace.apply(source.copy(completions=b),command(),Instant.parse(at)) }
    }
    @Test fun observingLegacyAvailabilityDoesNotInventTransitionsOrDuplicateOnRefresh() {
        val source=fixture()
        assertEquals(source,observeChangedHabitAvailability(source,source,at))
        val changed=source.copy(habits=source.habits.map { it.copy(title="Edited") })
        val next=observeChangedHabitAvailability(source,changed,at)
        assertEquals("observe",next.habits.single().lifecycleHistory.single().action)
        assertEquals(next,observeChangedHabitAvailability(next,next,at))
        assertEquals(source.progress,next.progress)
    }
}
