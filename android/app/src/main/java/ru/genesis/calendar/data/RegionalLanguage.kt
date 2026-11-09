package ru.genesis.calendar.data

import java.util.Locale
import java.util.TimeZone

/** Approximate device region, with no location permission or network request. */
internal fun regionalLanguage(zoneId: String, country: String): String {
    val byZone = mapOf(
        "Europe/Moscow" to "ru", "Europe/Kaliningrad" to "ru",
        "Europe/Kyiv" to "uk", "Europe/Kiev" to "uk", "Europe/Warsaw" to "pl",
        "Europe/Belgrade" to "sr", "Europe/Podgorica" to "sr",
        "Europe/Athens" to "el", "Europe/Nicosia" to "el",
        "Europe/Berlin" to "de", "Europe/Vienna" to "de",
        "Europe/Paris" to "fr", "Europe/Brussels" to "fr",
        "Europe/Madrid" to "es", "Europe/Rome" to "it",
        "Europe/Lisbon" to "pt", "Atlantic/Azores" to "pt",
        "Europe/London" to "en", "Europe/Dublin" to "en",
        "America/Los_Angeles" to "en", "America/Denver" to "en",
        "America/Phoenix" to "en", "America/Chicago" to "en",
        "America/New_York" to "en", "America/Anchorage" to "en",
        "America/Toronto" to "en", "America/Vancouver" to "en",
        "Australia/Sydney" to "en", "Australia/Melbourne" to "en",
        "Australia/Perth" to "en",
        "America/Sao_Paulo" to "pt", "America/Mexico_City" to "es",
        "America/Argentina/Buenos_Aires" to "es",
        "Asia/Shanghai" to "zh", "Asia/Chongqing" to "zh", "Asia/Singapore" to "zh",
        "Europe/Istanbul" to "tr", "Asia/Istanbul" to "tr", "Asia/Tokyo" to "ja",
    )
    val byCountry = mapOf(
        "RU" to "ru", "BY" to "ru", "KZ" to "ru", "UA" to "uk", "PL" to "pl",
        "RS" to "sr", "ME" to "sr", "GR" to "el", "CY" to "el",
        "DE" to "de", "AT" to "de", "FR" to "fr", "BE" to "fr",
        "ES" to "es", "MX" to "es", "AR" to "es", "CL" to "es",
        "CO" to "es", "PE" to "es", "IT" to "it", "PT" to "pt", "BR" to "pt",
        "CN" to "zh", "SG" to "zh", "TR" to "tr", "JP" to "ja",
    )
    return byZone[zoneId] ?: byCountry[country.uppercase(Locale.ROOT)] ?: "en"
}

internal fun regionalLanguageForDevice(): String =
    regionalLanguage(TimeZone.getDefault().id, Locale.getDefault().country)
