package ru.genesis.calendar.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class GreekTermsTest {
    @Test fun accentedGreekWordsAreLocalizedWithoutChangingIndividualSymbols() {
        val original = "Τάξις · λόγος · α · β / ΓΕΝΕΣΙΣ"
        assertEquals("Таксис · логос · α · β / Генесис", formatGreekTerms(original, "ru"))
        assertEquals("Taxis · logos · α · β / Genesis", formatGreekTerms(original, "en"))
        assertEquals(original, formatGreekTerms(original, "el"))
    }

    @Test fun nonGreekTextAndDecomposedAccentsArePreservedOrLocalized() {
        assertEquals("Практика 42 / done", formatGreekTerms("Практика 42 / done", "ru"))
        assertEquals("Logos", formatGreekTerms("Λο\u0301γος", "en"))
    }
}
