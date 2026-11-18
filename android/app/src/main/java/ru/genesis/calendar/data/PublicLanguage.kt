package ru.genesis.calendar.data

import java.util.Locale

internal val publicLanguages = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")

/** Presentation only: this never establishes residence or payment eligibility. */
internal fun welcomeLanguage(selected: String?, deviceLanguage: String, zoneId: String, country: String,
    russianAvailable: Boolean = false): String {
    fun allowed(value: String?) = value?.takeIf { it in publicLanguages && (it != "ru" || russianAvailable) }
    return allowed(selected) ?: if (russianAvailable) "ru" else
        allowed(deviceLanguage.substringBefore('-').substringBefore('_').lowercase(Locale.ROOT))
            ?: allowed(regionalLanguage(zoneId, country)) ?: "en"
}

internal fun welcomeLanguageForDevice(selected: String? = null, russianAvailable: Boolean = false): String =
    welcomeLanguage(selected, Locale.getDefault().language, java.util.TimeZone.getDefault().id,
        Locale.getDefault().country, russianAvailable)

/** A nullable outer state distinguishes an unread preference from automatic selection. */
internal data class WelcomeLanguagePreference(val selected: String?)

internal enum class PublicPage(val path: String) {
    HOME("/"), TERMS("/terms"), PRIVACY("/privacy"), REFUND("/refund"), SUPPORT("/support"), LOGIN("/login"), DELETE_ACCOUNT("/delete-account")
}

/** Mirrors the public web contract without moving authentication or private data. */
internal fun publicPagePath(language: String, page: PublicPage = PublicPage.HOME): String {
    val locale = language.takeIf { it in publicLanguages } ?: "en"
    return when (locale) {
        "ru" -> "/ru${page.path}"
        "en" -> page.path
        else -> "${page.path}?lang=$locale"
    }
}
