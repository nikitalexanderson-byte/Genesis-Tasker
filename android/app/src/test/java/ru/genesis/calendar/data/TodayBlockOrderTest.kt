package ru.genesis.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayBlockOrderTest {
    @Test fun restoresOrderWithoutUnknownIdsOrDuplicates() {
        assertEquals(listOf("advice", "tasks", "habits", "rhythm", "dream", "ad", "details"),
            normalizeTodayBlockOrder("header,advice,tasks,advice,obsolete"))
    }
    @Test fun movesBothDirectionsAndNeverMovesTheDayHeader() {
        val up = moveTodayBlock(defaultTodayBlockOrder, "advice", "tasks")
        assertEquals("advice", up.first())
        assertEquals(defaultTodayBlockOrder.toSet(), up.toSet())
        assertEquals(defaultTodayBlockOrder, moveTodayBlock(up, "advice", "rhythm"))
        assertEquals(defaultTodayBlockOrder, moveTodayBlock(defaultTodayBlockOrder, "header", "tasks"))
    }

    @Test fun explicitMobileVisibilityPreservesShowAllAndRejectsUnknownBlocks() {
        val inherited = setOf("tasks", "quickCreate")
        assertEquals(inherited, todayHiddenBlockIds("", inherited))
        assertEquals(emptySet<String>(), todayHiddenBlockIds(encodeTodayHiddenBlocks(emptySet()), inherited))
        assertEquals(setOf("dream", "tasks"), todayHiddenBlockIds(encodeTodayHiddenBlocks(setOf("dream", "tasks", "obsolete")), inherited))
        assertEquals(setOf("quickCreate"), todayHiddenBlockIds(encodeTodayHiddenBlocks(setOf("quickCreate")), emptySet()))
    }
}
