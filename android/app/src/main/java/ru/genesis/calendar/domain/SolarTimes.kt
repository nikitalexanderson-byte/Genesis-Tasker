package ru.genesis.calendar.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin

data class SolarLocation(val latitude: Double, val longitude: Double,
    val timeZoneId: String? = null, val placeName: String? = null,
    val approximate: Boolean = true)
data class SolarDayTimes(val sunrise: Instant, val sunset: Instant)

/** Same offline astronomy used by the web app, with the device time-zone as its safe fallback region. */
object SolarTimes {
    private const val DAY_MS = 86_400_000.0
    private const val JULIAN_UNIX_EPOCH = 2_440_588.0
    private const val JULIAN_2000 = 2_451_545.0
    private const val SOLAR_TRANSIT_OFFSET = 0.0009
    private val obliquity = Math.toRadians(23.4397)
    private val sunriseAltitude = Math.toRadians(-0.833)

    private val timezoneReferences = mapOf(
        "Etc/UTC" to SolarLocation(51.4769, 0.0),
        "UTC" to SolarLocation(51.4769, 0.0),
        "America/Los_Angeles" to SolarLocation(34.0522, -118.2437),
        "Europe/Kaliningrad" to SolarLocation(54.7104, 20.4522),
        "Europe/Moscow" to SolarLocation(55.7558, 37.6173),
        "Europe/Simferopol" to SolarLocation(44.9521, 34.1024),
        "Europe/Kirov" to SolarLocation(58.6035, 49.6679),
        "Europe/Volgograd" to SolarLocation(48.708, 44.514),
        "Europe/Astrakhan" to SolarLocation(46.3497, 48.0408),
        "Europe/Saratov" to SolarLocation(51.5336, 46.0343),
        "Europe/Ulyanovsk" to SolarLocation(54.3142, 48.4031),
        "Europe/Samara" to SolarLocation(53.1959, 50.1002),
        "Asia/Yekaterinburg" to SolarLocation(56.8389, 60.6057),
        "Asia/Omsk" to SolarLocation(54.9885, 73.3242),
        "Asia/Novosibirsk" to SolarLocation(55.0084, 82.9357),
        "Asia/Barnaul" to SolarLocation(53.3474, 83.7784),
        "Asia/Tomsk" to SolarLocation(56.4977, 84.9744),
        "Asia/Novokuznetsk" to SolarLocation(53.7557, 87.1099),
        "Asia/Krasnoyarsk" to SolarLocation(56.0153, 92.8932),
        "Asia/Irkutsk" to SolarLocation(52.2869, 104.305),
        "Asia/Chita" to SolarLocation(52.034, 113.4994),
        "Asia/Yakutsk" to SolarLocation(62.0355, 129.6755),
        "Asia/Khandyga" to SolarLocation(62.6533, 135.5617),
        "Asia/Vladivostok" to SolarLocation(43.1155, 131.8855),
        "Asia/Ust-Nera" to SolarLocation(64.5667, 143.2),
        "Asia/Magadan" to SolarLocation(59.5682, 150.8085),
        "Asia/Sakhalin" to SolarLocation(46.9591, 142.738),
        "Asia/Srednekolymsk" to SolarLocation(67.458, 153.706),
        "Asia/Kamchatka" to SolarLocation(53.0452, 158.6483),
        "Asia/Anadyr" to SolarLocation(64.7337, 177.5089),
    )

    fun fallbackLocation(zoneId: ZoneId): SolarLocation {
        timezoneReferences[zoneId.id]?.let { return it }
        val id = zoneId.id
        val latitude = when {
            id.startsWith("Australia/") || id.startsWith("Indian/") ||
                Regex("Buenos_Aires|Sao_Paulo|Santiago|Montevideo").containsMatchIn(id) -> -25.0
            id.startsWith("America/") -> 40.0
            id.startsWith("Europe/") -> 50.0
            id.startsWith("Asia/") -> 35.0
            id.startsWith("Antarctica/") -> -70.0
            else -> 0.0
        }
        val longitude = zoneId.rules.getOffset(Instant.now()).totalSeconds / 3600.0 * 15.0
        return SolarLocation(latitude, longitude.coerceIn(-180.0, 180.0))
    }

    fun sunriseSunset(date: LocalDate, location: SolarLocation, zoneId: ZoneId): SolarDayTimes? {
        require(location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0)
        val latitude = Math.toRadians(location.latitude)
        val longitudeWest = Math.toRadians(-location.longitude)
        // Noon anchors the requested civil day across positive and negative UTC offsets.
        val dateInstant = date.atTime(12, 0).atZone(zoneId).toInstant()
        val days = toJulian(dateInstant) - JULIAN_2000
        val cycle = round(days - SOLAR_TRANSIT_OFFSET - longitudeWest / (2 * PI))
        val approximateTransit = SOLAR_TRANSIT_OFFSET + longitudeWest / (2 * PI) + cycle
        val meanAnomaly = Math.toRadians(357.5291 + 0.98560028 * approximateTransit)
        val center = Math.toRadians(1.9148 * sin(meanAnomaly) + 0.02 * sin(2 * meanAnomaly) +
            0.0003 * sin(3 * meanAnomaly))
        val longitude = meanAnomaly + center + Math.toRadians(102.9372) + PI
        val declination = asin(sin(longitude) * sin(obliquity))
        val hourAngleCosine = (sin(sunriseAltitude) - sin(latitude) * sin(declination)) /
            (cos(latitude) * cos(declination))
        if (!hourAngleCosine.isFinite() || hourAngleCosine !in -1.0..1.0) return null
        val hourAngle = acos(hourAngleCosine)
        val solarNoon = solarTransitJulian(approximateTransit, meanAnomaly, longitude)
        val sunset = solarTransitJulian(approximateTransit + hourAngle / (2 * PI), meanAnomaly, longitude)
        val sunrise = solarNoon - (sunset - solarNoon)
        return SolarDayTimes(fromJulian(sunrise), fromJulian(sunset))
    }

    private fun toJulian(instant: Instant) = instant.toEpochMilli() / DAY_MS - 0.5 + JULIAN_UNIX_EPOCH
    private fun fromJulian(day: Double) = Instant.ofEpochMilli(((day + 0.5 - JULIAN_UNIX_EPOCH) * DAY_MS).toLong())
    private fun solarTransitJulian(approximateTransit: Double, meanAnomaly: Double, longitude: Double) =
        JULIAN_2000 + approximateTransit + 0.0053 * sin(meanAnomaly) - 0.0069 * sin(2 * longitude)
}
