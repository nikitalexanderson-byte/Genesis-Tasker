package ru.genesis.calendar.domain

import java.time.Instant
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tan

data class SolarPosition(
    val altitudeDeg: Double,
    /** Degrees clockwise from true north, in [0, 360). */
    val azimuthDeg: Double,
    val sunVisible: Boolean,
    val phase: String,
    val polarState: String,
    val minAltitudeDeg: Double,
    val maxAltitudeDeg: Double,
)

data class SolarLandscapePoint(val x: Double, val y: Double)

/** Portable SunCalc geometry shared with app/solar-times.ts; no refraction or device clock inputs. */
fun solarPosition(now: Instant, location: SolarLocation): SolarPosition {
    require(location.latitude.isFinite() && location.latitude in -90.0..90.0 &&
        location.longitude.isFinite() && location.longitude in -180.0..180.0)
    val radians = PI / 180.0
    val days = now.toEpochMilli() / 86_400_000.0 - 0.5 + 2_440_588.0 - 2_451_545.0
    val latitude = location.latitude * radians
    val longitudeWest = -location.longitude * radians
    val obliquity = 23.4397 * radians
    val meanAnomaly = (357.5291 + 0.98560028 * days) * radians
    val center = (1.9148 * sin(meanAnomaly) + 0.02 * sin(2 * meanAnomaly) +
        0.0003 * sin(3 * meanAnomaly)) * radians
    val longitude = meanAnomaly + center + 102.9372 * radians + PI
    val declination = asin((sin(longitude) * sin(obliquity)).coerceIn(-1.0, 1.0))
    val rightAscension = atan2(sin(longitude) * cos(obliquity), cos(longitude))
    val hourAngle = (280.16 + 360.9856235 * days) * radians - longitudeWest - rightAscension
    val altitude = asin((sin(latitude) * sin(declination) +
        cos(latitude) * cos(declination) * cos(hourAngle)).coerceIn(-1.0, 1.0)) / radians
    val southAzimuth = atan2(sin(hourAngle),
        cos(hourAngle) * sin(latitude) - tan(declination) * cos(latitude)) / radians
    val azimuth = ((southAzimuth + 180.0) % 360.0 + 360.0) % 360.0
    // Extrema avoid division by cos(latitude), including at both geographic poles.
    val centerAltitude = sin(latitude) * sin(declination)
    val amplitude = abs(cos(latitude) * cos(declination))
    val minimum = asin((centerAltitude - amplitude).coerceIn(-1.0, 1.0)) / radians
    val maximum = asin((centerAltitude + amplitude).coerceIn(-1.0, 1.0)) / radians
    return SolarPosition(altitude, azimuth, altitude > 0.0,
        phase = when {
            altitude >= 0.0 -> "day"
            altitude >= -6.0 -> "civil-twilight"
            altitude >= -12.0 -> "nautical-twilight"
            altitude >= -18.0 -> "astronomical-twilight"
            else -> "night"
        },
        polarState = when {
            minimum > 0.0 -> "polar-day"
            maximum < 0.0 -> "polar-night"
            else -> "none"
        },
        minAltitudeDeg = minimum, maxAltitudeDeg = maximum)
}

/** A continuous panorama projection, including the midnight arc during polar day. */
fun solarLandscapePoint(position: SolarPosition, latitude: Double, horizonY: Double,
    horizontalAmplitude: Double = .44, skyTop: Double = .08): SolarLandscapePoint {
    require(latitude.isFinite() && latitude in -90.0..90.0 &&
        position.altitudeDeg.isFinite() && position.azimuthDeg.isFinite() &&
        horizontalAmplitude.isFinite() && horizontalAmplitude in 0.0..0.5 &&
        skyTop.isFinite() && skyTop in 0.0..1.0 &&
        horizonY.isFinite() && horizonY > skyTop && horizonY < 1.0)
    val hemisphere = if (latitude < 0.0) -1.0 else 1.0
    val altitude = position.altitudeDeg.coerceIn(0.0, 90.0) * PI / 180.0
    return SolarLandscapePoint(
        x = 0.5 - horizontalAmplitude * cos(altitude) * sin(position.azimuthDeg * PI / 180.0) * hemisphere,
        y = horizonY - (horizonY - skyTop) * sin(altitude),
    )
}
