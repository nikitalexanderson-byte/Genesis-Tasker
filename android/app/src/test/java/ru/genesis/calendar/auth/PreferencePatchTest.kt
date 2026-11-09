package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test

class PreferencePatchTest {
    @Test fun offlineThemeRetryKeepsItsOriginalRevisionAlongsideOtherPreferences() {
        val queued=mapOf("theme" to "standart-dark", "themeRevision" to "108", "display" to "lunar", "time" to "12h")
        repeat(2) {
            val body=PreferencePatch.request(queued)
            assertEquals(108,body.getInt("expectedThemeRevision"))
            assertEquals("standart-dark",body.getString("theme"))
            assertEquals("lunar",body.getString("calendarMode"))
            assertEquals("12h",body.getString("timeFormat"))
        }
        assertThrows(IllegalArgumentException::class.java) { PreferencePatch.request(mapOf("theme" to "standart")) }
    }
}
