package ru.genesis.calendar.ui

import ru.genesis.calendar.domain.SolarTimes
import java.time.ZoneId
import kotlin.math.abs

/** Coarse, offline climate hints. The time zone is a regional hint, not a precise location. */
internal enum class SeasonArtRegion(val folder: String) {
    TEMPERATE(""), BOREAL("boreal"), MEDITERRANEAN("mediterranean"),
    ARID("arid"), TROPICAL("tropical"), SOUTHERN("southern")
}

internal fun isSouthernSeasonRegion(zone: ZoneId): Boolean {
    val id = zone.id
    return SolarTimes.fallbackLocation(zone).latitude < -5.0 ||
        id.startsWith("Australia/") || id.startsWith("Antarctica/") ||
        id.startsWith("America/Argentina/") ||
        id.contains(Regex("Auckland|Chatham|Buenos_Aires|Montevideo|Santiago|Sao_Paulo|Johannesburg|Windhoek|Harare|Maputo"))
}

internal fun seasonArtRegion(zone: ZoneId): SeasonArtRegion {
    val id = zone.id
    val latitude = abs(SolarTimes.fallbackLocation(zone).latitude)
    if (id.contains(Regex("Phoenix|Hermosillo|Chihuahua|Cairo|Tripoli|Algiers|Tunis|Khartoum|Riyadh|Dubai|Abu_Dhabi|Kuwait|Baghdad|Tehran|Ashgabat|Alice_Springs|Lima")))
        return SeasonArtRegion.ARID
    if (id.contains(Regex("Rome|Madrid|Lisbon|Athens|Malta|Nicosia|Istanbul|Los_Angeles|Perth|Tel_Aviv|Beirut|Casablanca")))
        return SeasonArtRegion.MEDITERRANEAN
    if (id.contains(Regex("Darwin|Sao_Paulo|Singapore|Bangkok|Jakarta|Manila|Kolkata")))
        return SeasonArtRegion.TROPICAL
    if ((latitude >= 58.0 || id.contains(Regex("Helsinki|Stockholm|Oslo|Reykjavik|Anchorage"))) &&
        !isSouthernSeasonRegion(zone)) return SeasonArtRegion.BOREAL
    if (isSouthernSeasonRegion(zone) &&
        (latitude >= 23.0 || id.contains(Regex("Johannesburg|Windhoek|Harare|Maputo|Auckland|Chatham"))))
        return SeasonArtRegion.SOUTHERN
    if (latitude < 23.5 || id.startsWith("Pacific/") || id.startsWith("Indian/"))
        return SeasonArtRegion.TROPICAL
    return SeasonArtRegion.TEMPERATE
}

internal fun gregorianSeasonArtPath(season: String, zone: ZoneId, regional: Boolean): String {
    require(season in setOf("winter", "spring", "summer", "autumn"))
    val region = if (regional) seasonArtRegion(zone) else SeasonArtRegion.TEMPERATE
    val folder = region.folder.takeIf { it.isNotEmpty() }?.let { "$it/" } ?: ""
    return "gregorian-seasons/$folder$season.jpg"
}

/** Same January–December artwork and climate selection as the website's month view. */
internal fun gregorianMonthArtPath(monthIndex: Int, zone: ZoneId): String {
    require(monthIndex in 0..11)
    val region = seasonArtRegion(zone)
    val offset = if (isSouthernSeasonRegion(zone) && region != SeasonArtRegion.SOUTHERN) 6 else 0
    val month = (monthIndex + offset) % 12 + 1
    return "gregorian-months-v1/${region.folder.ifEmpty { "temperate" }}/${month.toString().padStart(2, '0')}.webp"
}

/** The solar scene has the same civil-month/climate mapping, with a separate transparent terrain plate. */
internal fun solarLandscapeArtPath(monthIndex: Int, zone: ZoneId): String =
    "solar-landscapes-v1/" + gregorianMonthArtPath(monthIndex, zone).removePrefix("gregorian-months-v1/")
