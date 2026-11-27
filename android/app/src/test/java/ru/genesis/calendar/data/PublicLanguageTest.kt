package ru.genesis.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Test

class PublicLanguageTest {
    @Test fun `explicit choice survives changed device region and language`() {
        for (language in publicLanguages) assertEquals(language,
            welcomeLanguage(language, "en", "America/Los_Angeles", "US"))
    }

    @Test fun `automatic language respects supported system language before approximate region`() {
        assertEquals("de", welcomeLanguage(null, "de-DE", "Europe/Moscow", "RU"))
        assertEquals("ru", welcomeLanguage(null, "ru", "America/Los_Angeles", "US"))
        assertEquals("pt", welcomeLanguage(null, "pt_BR", "Etc/UTC", "US"))
        assertEquals("zh", welcomeLanguage(null, "zh-Hant", "Etc/UTC", "US"))
        for ((tag, expected) in mapOf("he-IL" to "he", "iw_IL" to "he", "ar-EG" to "ar", "ko-KR" to "ko", "nl-BE" to "nl")) {
            assertEquals(tag, expected, welcomeLanguage(null, tag, "Etc/UTC", "US"))
        }
        assertEquals("ja", welcomeLanguage("invalid", "JA", "Europe/Berlin", "DE"))
    }

    @Test fun `unsupported system language falls back to approximate region then English`() {
        assertEquals("ru", welcomeLanguage(null, "fi", "Europe/Moscow", "FI"))
        assertEquals("pl", welcomeLanguage(null, "", "Etc/UTC", "PL"))
        assertEquals("en", welcomeLanguage(null, "fi", "Etc/UTC", "FI"))
    }

    @Test fun `a positive IP hint supplies a default but an explicit choice takes precedence`() {
        assertEquals("ru", welcomeLanguage(null, "en", "America/New_York", "US", suggestRussianByIp = true))
        assertEquals("de", welcomeLanguage("de", "en", "America/New_York", "US", suggestRussianByIp = true))
        assertEquals("ru", welcomeLanguage("ru", "en", "America/New_York", "US"))
    }

    @Test fun `every localized document remains on the single website with only Russian section`() {
        for (language in publicLanguages) for (page in PublicPage.entries) {
            val expected = when (language) {
                "ru" -> "/ru${page.path}"
                "en" -> page.path
                else -> "${page.path}?lang=$language"
            }
            assertEquals(expected, publicPagePath(language, page))
        }
        assertEquals("/", publicPagePath("ru/../../api"))
        assertEquals("/privacy", publicPagePath("//evil.invalid", PublicPage.PRIVACY))
    }
}
