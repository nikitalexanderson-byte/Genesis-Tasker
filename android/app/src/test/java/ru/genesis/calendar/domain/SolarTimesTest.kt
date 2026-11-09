package ru.genesis.calendar.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId

class SolarTimesTest {
    @Test
    fun `Sacramento coordinates produce local sunrise near seven on September 30 2026`() {
        val zone = ZoneId.of("America/Los_Angeles")
        val place = SolarLocation(38.5816, -121.4944, zone.id, "Sacramento, California, United States")
        val times = requireNotNull(SolarTimes.sunriseSunset(LocalDate.of(2026, 9, 30), place, zone))
        val sunrise = times.sunrise.atZone(zone)
        val sunset = times.sunset.atZone(zone)
        assertEquals(LocalDate.of(2026, 9, 30), sunrise.toLocalDate())
        assertEquals(7, sunrise.hour)
        assertTrue(sunrise.minute in 0..5)
        assertEquals(18, sunset.hour)
        assertTrue(sunset.minute in 45..55)
    }

    @Test
    fun `Moscow fallback produces local sunrise before sunset`() {
        val zone = ZoneId.of("Europe/Moscow")
        val location = SolarTimes.fallbackLocation(zone)
        val times = requireNotNull(SolarTimes.sunriseSunset(LocalDate.of(2026, 9, 27), location, zone))
        val sunrise = times.sunrise.atZone(zone)
        val sunset = times.sunset.atZone(zone)

        assertEquals(LocalDate.of(2026, 9, 27), sunrise.toLocalDate())
        assertEquals(LocalDate.of(2026, 9, 27), sunset.toLocalDate())
        assertTrue(sunrise.hour in 4..9)
        assertTrue(sunset.hour in 16..21)
        assertTrue(Duration.between(sunrise, sunset).toHours() in 8..16)
    }

    @Test
    fun `cities in one time zone use their own coordinates`() {
        val date = LocalDate.of(2026, 9, 30)
        val zone = ZoneId.of("America/Los_Angeles")
        val sacramento = requireNotNull(SolarTimes.sunriseSunset(date,
            SolarLocation(38.5816, -121.4944), zone)).sunrise.atZone(zone)
        val losAngeles = requireNotNull(SolarTimes.sunriseSunset(date,
            SolarLocation(34.0522, -118.2437), zone)).sunrise.atZone(zone)
        assertTrue(sacramento.isAfter(losAngeles))
        assertEquals(date, sacramento.toLocalDate())
    }

    @Test
    fun `local sunrise follows daylight saving changes`() {
        val zone = ZoneId.of("America/Los_Angeles")
        val place = SolarLocation(38.5816, -121.4944)
        val before = requireNotNull(SolarTimes.sunriseSunset(LocalDate.of(2026, 10, 31), place, zone))
            .sunrise.atZone(zone)
        val after = requireNotNull(SolarTimes.sunriseSunset(LocalDate.of(2026, 11, 1), place, zone))
            .sunrise.atZone(zone)
        assertEquals(-7 * 3600, before.offset.totalSeconds)
        assertEquals(-8 * 3600, after.offset.totalSeconds)
        assertTrue(after.hour < before.hour)
    }

    @Test
    fun `southern hemisphere and east Asia dates stay local`() {
        listOf(
            Triple("Australia/Sydney", -33.8688 to 151.2093, LocalDate.of(2026, 12, 21)),
            Triple("Asia/Tokyo", 35.6762 to 139.6503, LocalDate.of(2026, 6, 21)),
            Triple("America/Argentina/Buenos_Aires", -34.6037 to -58.3816, LocalDate.of(2026, 9, 30)),
        ).forEach { (zoneId, coordinates, date) ->
            val zone = ZoneId.of(zoneId)
            val times = requireNotNull(SolarTimes.sunriseSunset(date,
                SolarLocation(coordinates.first, coordinates.second), zone))
            assertEquals(zoneId, date, times.sunrise.atZone(zone).toLocalDate())
            assertEquals(zoneId, date, times.sunset.atZone(zone).toLocalDate())
            assertTrue(zoneId, times.sunrise.isBefore(times.sunset))
        }
    }
}
