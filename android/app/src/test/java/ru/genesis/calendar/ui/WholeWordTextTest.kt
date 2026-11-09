package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test

class WholeWordTextTest {
    @Test fun identifiesForbiddenBreaksAcrossShippedAlphabeticScripts() {
        assertTrue(isInsideWord("Секундомер", 9))
        assertTrue(isInsideWord("пользоваться", 11))
        assertTrue(isInsideWord("Gregorian", 5))
        assertTrue(isInsideWord("Ελληνικά", 4))
        assertFalse(isInsideWord("Как пользоваться", 3))
        assertFalse(isInsideWord("Как пользоваться", 4))
        assertFalse(isInsideWord("Сон · настроение", 4))
        assertFalse(isInsideWord("сон-бодрствование", 4))
        assertFalse(isInsideWord("Чтение\nсегодня", 6))
        assertFalse(isInsideWord("", 0))
    }

    @Test fun doesNotTreatNormalCjkLineBreaksAsBrokenAlphabeticWords() {
        assertFalse(isInsideWord("今日気分", 2))
        assertFalse(isInsideWord("今日心情", 2))
        assertFalse(isInsideWord("カレンダー", 2))
    }
}
