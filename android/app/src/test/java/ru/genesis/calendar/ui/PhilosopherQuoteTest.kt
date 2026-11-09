package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test

class PhilosopherQuoteTest {
    @Test fun contextAndCreditAreSeparatedWithoutRewritingQuote() {
        assertEquals(PhilosopherQuoteParts("О дружбе из письма", "«Дружба — благо».\nВторая строка.", "Эпикур"),
            philosopherQuoteParts("(О дружбе (из письма)) «Дружба — благо».\nВторая строка.\nЭпикур", "Эпикур"))
        assertEquals(PhilosopherQuoteParts("論友誼", "言葉。", "エピクロス"),
            philosopherQuoteParts("（論友誼）言葉。\n（エピクロス）", "エピクロス"))
    }
    @Test fun contextFreeQuoteAndUnknownCreditArePreserved() {
        assertEquals(PhilosopherQuoteParts("", "Цитата.", "Платон"), philosopherQuoteParts("Цитата.\nПлатон", "Платон"))
        assertEquals("Цитата.\nДругой автор", philosopherQuoteParts("Цитата.\nДругой автор", "Платон").quote)
        assertEquals("(Неоконченная вводная.", philosopherQuoteParts("(Неоконченная вводная.", "").quote)
    }
}
