package ru.genesis.calendar.domain

import org.junit.Assert.*
import org.junit.Test

class StoicheionReadingTest {
    @Test fun spreadAndOrientationMatchWebSeedVectors() {
        val cards = (0..23).toList()
        assertEquals(listOf(11,9,2,19,17,13,10,20,18),
            StoicheionReading.spread(cards, 0x12345678L).map { it.first })
        assertEquals(listOf(false,true,false,true,false,false,true,true,true),
            StoicheionReading.spread(cards, 0x12345678L).map { it.second })
        assertEquals(listOf(20,5,1,3,8,0,6,9,17),
            StoicheionReading.spread(cards, 0xffff_ffffL).map { it.first })
        assertEquals(cards[0], StoicheionReading.cardOfDay(cards, 0x12345678L))
    }

    @Test fun numericRootAndTraceMatchIsopsephy() {
        assertEquals(0, StoicheionReading.pythmen(0))
        assertEquals(7, StoicheionReading.pythmen(205))
        assertEquals(listOf(205,7), StoicheionReading.trace(205))
        assertEquals(listOf(999,27,9), StoicheionReading.trace(999))
    }
}
