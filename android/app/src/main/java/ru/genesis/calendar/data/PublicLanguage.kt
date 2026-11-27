package ru.genesis.calendar.data

import java.util.Locale

internal val publicLanguages = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja", "he", "ar", "ko", "nl")

/** Presentation only: this never establishes residence or payment eligibility. */
internal fun welcomeLanguage(selected: String?, deviceLanguage: String, zoneId: String, country: String,
    suggestRussianByIp: Boolean = false): String =
    selected?.takeIf { it in publicLanguages }
        ?: "ru".takeIf { suggestRussianByIp }
        ?: deviceLanguage.substringBefore('-').substringBefore('_').lowercase(Locale.ROOT)
            .let { if (it == "iw") "he" else it }
            .takeIf { it in publicLanguages }
        ?: regionalLanguage(zoneId, country)

internal fun welcomeLanguageForDevice(selected: String? = null, suggestRussianByIp: Boolean = false): String =
    welcomeLanguage(selected, Locale.getDefault().language, java.util.TimeZone.getDefault().id,
        Locale.getDefault().country, suggestRussianByIp)

/** A nullable outer state distinguishes an unread preference from automatic selection. */
internal data class WelcomeLanguagePreference(val selected: String?)

internal enum class PublicPage(val path: String) {
    HOME("/"), TERMS("/terms"), PRIVACY("/privacy"), REFUND("/refund"), SUPPORT("/support"), LOGIN("/login"), DELETE_ACCOUNT("/delete-account")
}

internal fun publicDocumentUrl(language: String, page: PublicPage): String =
    "https://genesiscalendar.com" + publicPagePath(language, page)

/** Mirrors the public web contract without moving authentication or private data. */
internal fun publicPagePath(language: String, page: PublicPage = PublicPage.HOME): String {
    val locale = language.takeIf { it in publicLanguages } ?: "en"
    return when (locale) {
        "ru" -> "/ru${page.path}"
        "en" -> page.path
        else -> "${page.path}?lang=$locale"
    }
}
