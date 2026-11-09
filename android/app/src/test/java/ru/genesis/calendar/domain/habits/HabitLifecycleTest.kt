package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class HabitLifecycleTest {
    private fun command(events: List<HabitLifecycleEvent>, action: String, id: String,
        at: String = "2026-10-17T12:00:00Z", selected: String? = null) = HabitLifecycleCommand(id,"original",at,action,
        HabitLifecycle.state("original",true,events).heads.map { it.id },selected)
    private fun apply(events: List<HabitLifecycleEvent>, action: String, id: String,
        at: String = "2026-10-17T12:00:00Z", selected: String? = null) = HabitLifecycle.apply("original",true,"Europe/Moscow",events,command(events,action,id,at,selected))

    @Test fun distinctStatesRetainOriginalIdAndPastAvailability() {
        var rows = apply(emptyList(),"pause","pause","2026-10-16T22:30:00Z")
        assertEquals(LocalDate.parse("2026-10-17"),rows.single().date)
        assertEquals("active",HabitLifecycle.state("original",false,rows,LocalDate.parse("2026-10-16")).status)
        assertEquals("paused",HabitLifecycle.state("original",false,rows).status)
        for ((action,status) in listOf("archive" to "archived","delete" to "deleted","restore" to "paused","resume" to "active")) {
            rows = apply(rows,action,action)
            assertEquals(status,HabitLifecycle.state("original",false,rows).status)
            assertTrue(rows.all { it.habitId == "original" })
        }
        assertEquals(5,rows.size)
    }

    @Test fun concurrentArchiveAndResumeRequireAnExplicitChoiceAndReplayDoesNotAppend() {
        val base = apply(emptyList(),"pause","base","2026-10-17T08:00:00Z")
        val archive = apply(base,"archive","archive","2026-10-17T09:00:00Z")
        val resume = apply(base,"resume","resume","2026-10-17T09:00:00Z")
        val merged = HabitLifecycle.merge(archive,resume)
        assertTrue(HabitLifecycle.state("original",true,merged).conflict)
        assertEquals("archived",HabitLifecycle.state("original",true,merged).status)
        val input = command(merged,"resolve","explicit","2026-10-17T10:00:00Z","resume")
        val resolved = HabitLifecycle.apply("original",true,"Europe/Moscow",merged,input)
        assertEquals("active",HabitLifecycle.state("original",true,resolved).status)
        assertFalse(HabitLifecycle.state("original",true,resolved).conflict)
        assertEquals(4,resolved.size)
        assertEquals(resolved,HabitLifecycle.apply("original",true,"Europe/Moscow",resolved,input))
        try { HabitLifecycle.apply("original",true,"Europe/Moscow",resolved,input.copy(action="delete")); fail("ID changed meaning") }
        catch(error: IllegalArgumentException) { assertEquals("HABIT_LIFECYCLE_ID_CONFLICT",error.message) }
    }

    @Test fun malformedAndStaleTransitionsAreRejected() {
        val rows = apply(emptyList(),"archive","archive")
        for (invalid in listOf(rows.single().copy(replaces=listOf("missing")),rows.single().copy(status="active"))) {
            try { HabitLifecycle.merge(listOf(invalid));fail("Malformed journal accepted") }
            catch(error: IllegalArgumentException) { assertEquals("INVALID_HABIT_LIFECYCLE",error.message) }
        }
        try { HabitLifecycle.apply("original",true,"Europe/Moscow",rows,command(emptyList(),"pause","stale"));fail("Stale heads accepted") }
        catch(error: IllegalArgumentException) { assertEquals("HABIT_LIFECYCLE_EDIT_CONFLICT",error.message) }
    }
}
