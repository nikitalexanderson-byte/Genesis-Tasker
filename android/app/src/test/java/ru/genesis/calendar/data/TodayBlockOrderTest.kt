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
}
