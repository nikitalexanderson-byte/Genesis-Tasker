package ru.genesis.calendar.data

import org.junit.Assert.assertEquals
import org.junit.Test

class PublicLanguageTest {
    @Test fun `explicit choice survives changed device region and language`() {
        for (language in publicLanguages) assertEquals(language,
            welcomeLanguage(language, "en", "Europe/Moscow", "RU", russianAvailable = true))
    }

    @Test fun `automatic language respects supported system language before approximate region`() {
        assertEquals("de", welcomeLanguage(null, "de-DE", "Europe/Moscow", "RU"))
        assertEquals("en", welcomeLanguage(null, "ru", "America/Los_Angeles", "US"))
        assertEquals("pt", welcomeLanguage(null, "pt_BR", "Etc/UTC", "US"))
        assertEquals("zh", welcomeLanguage(null, "zh-Hant", "Etc/UTC", "US"))
        assertEquals("ja", welcomeLanguage("invalid", "JA", "Europe/Berlin", "DE"))
    }

    @Test fun `unsupported system language falls back to approximate region then English`() {
        assertEquals("en", welcomeLanguage(null, "fi", "Europe/Moscow", "FI"))
        assertEquals("pl", welcomeLanguage(null, "", "Etc/UTC", "PL"))
        assertEquals("en", welcomeLanguage(null, "ar", "Etc/UTC", "EG"))
    }

    @Test fun `Russian requires a current positive IP result regardless of stored choice or device hints`() {
        for (saved in listOf(null, "ru")) for (russianAvailable in listOf(false, true)) {
            assertEquals(if (russianAvailable) "ru" else "en",
                welcomeLanguage(saved, "ru-RU", "Europe/Moscow", "RU", russianAvailable))
        }
        assertEquals("de", welcomeLanguage("de", "ru", "Europe/Moscow", "RU", true))
        assertEquals("ru", welcomeLanguage(null, "en", "America/New_York", "US", true))
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
