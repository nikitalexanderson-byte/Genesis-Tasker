package ru.genesis.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RegionalLanguageTest {
    @Test fun `device zone wins over interface locale for Sacramento`() {
        assertEquals("en", regionalLanguage("America/Los_Angeles", "RU"))
    }

    @Test fun `supported country and unsupported region use sensible defaults`() {
        assertEquals("ja", regionalLanguage("Asia/Tokyo", "RU"))
        assertEquals("pl", regionalLanguage("Etc/UTC", "PL"))
        assertEquals("en", regionalLanguage("Etc/UTC", "US"))
    }
}
