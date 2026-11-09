package ru.genesis.calendar.domain

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.ui.CivilWeatherVisualPolicy
import ru.genesis.calendar.ui.civilWeatherEffects
import java.io.File
import java.time.Instant

/** Shared backend snapshot, prepared for a future permitted native test run. */
class WeatherSnapshotTest {
    private val now = Instant.parse("2026-11-06T12:30:00Z")
    private val policy = CivilWeatherVisualPolicy()
    private fun fixture() = JSONObject(File("../../tests/fixtures/weather-v1.json").readText())

    @Test fun forecastPreservesUnknownMetricsAndExpiresAtItsActualWindow() {
        val weather = WeatherSnapshotV1.fromJson(fixture())
        assertEquals("forecast", weather.provider.dataKind)
        assertNull(weather.observedAt)
        assertNull(weather.current?.snowDepthCm)
        assertNull(weather.current?.apparentTemperatureC)
        assertTrue(weather.isFresh(now))
        assertFalse(weather.isFresh(Instant.parse("2026-11-06T11:59:59Z")))
        assertFalse(weather.isFresh(Instant.parse("2026-11-06T13:00:00Z")))
        assertFalse(weather.copy(expiresAt = null).isFresh(now))
    }

    @Test fun explicitZeroRateOverridesEarlierHourRainAndStaleHasNoOngoingEffects() {
        val original = WeatherSnapshotV1.fromJson(fixture())
        val current = requireNotNull(original.current)
        val zero = original.copy(current = current.copy(precipitationRateMmH = 0.0, precipitation1hMm = 2.5))
        assertEquals("none", civilWeatherEffects(zero, now, policy).precipitation)
        assertEquals(0, civilWeatherEffects(zero, now, policy).particles)
        val stale = civilWeatherEffects(original.copy(status = "stale"), now, policy)
        assertFalse(stale.fresh)
        assertEquals(0, stale.particles)
        assertEquals(1f, stale.sunTransmission, 0f)
        assertFalse(stale.snowCover)
    }

    @Test fun coldTemperatureAndSnowfallNeverInventSnowDepth() {
        val original = WeatherSnapshotV1.fromJson(fixture())
        val current = requireNotNull(original.current).copy(temperatureC = -18.0, condition = "snow",
            precipitationKind = "snow", precipitationRateMmH = .5, precipitation1hMm = .5, snowDepthCm = null)
        val snowfall = civilWeatherEffects(original.copy(current = current), now, policy)
        assertEquals("snow", snowfall.precipitation)
        assertFalse(snowfall.snowCover)
        assertTrue(civilWeatherEffects(original.copy(current = current.copy(snowDepthCm = 1.0)), now, policy).snowCover)
        assertEquals(policy.lightParticles, civilWeatherEffects(original.copy(current = current.copy(
            intensity = "light", precipitationRateMmH = 2.5, precipitation1hMm = 2.5)), now, policy).particles)
    }

    @Test(expected = IllegalArgumentException::class)
    fun forecastCannotPretendToBeAMeasuredObservation() {
        WeatherSnapshotV1.fromJson(fixture().put("observedAt", "2026-11-06T12:00:00Z"))
    }
}
