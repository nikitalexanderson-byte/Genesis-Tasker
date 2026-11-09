package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PriorityControlTest {
    @Test
    fun `horizontal position maps continuously across all priorities`() {
        assertEquals(1, priorityForPosition(-20f, 1000))
        assertEquals(1, priorityForPosition(0f, 1000))
        assertEquals(5, priorityForPosition(499f, 1000))
        assertEquals(6, priorityForPosition(500f, 1000))
        assertEquals(10, priorityForPosition(999f, 1000))
        assertEquals(10, priorityForPosition(1200f, 1000))
    }
}
