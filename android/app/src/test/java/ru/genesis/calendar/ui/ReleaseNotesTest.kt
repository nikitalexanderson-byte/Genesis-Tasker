package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseNotesTest {
    @Test fun everyShippedLanguageHasCompleteNotes() {
        assertEquals(setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"), notes.keys)
        notes.forEach { (language, copy) ->
            assertTrue(language, copy.title.isNotBlank() && copy.close.isNotBlank())
            assertEquals(language, 5, copy.changes.size)
            assertTrue(language, copy.changes.all { it.isNotBlank() })
        }
        assertTrue(notes.getValue("el").changes.none {
            "[A-Za-zА-Яа-яЁё]".toRegex().containsMatchIn(it.replace("YooKassa", "").replace("CloudTips", "").replace("Android", "").replace("Google", "").replace("Calendar", "").replace("Tasks", "").replace("GENESIS", "").replace("JSON", "").replace("CSV", "").replace("WebP", "").replace("Free", "").replace("Standard", "").replace("Premium", "").replace("Business", "").replace("Elite", "").replace("°C", "").replace("°F", "").replace("hPa", "").replace("mmHg", ""))
        })
    }
}
