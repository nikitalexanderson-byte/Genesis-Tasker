package ru.genesis.calendar.domain

import java.io.File
import java.time.Instant
import kotlin.math.abs
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Shared TS/Kotlin golden inputs; native tests are intentionally not run during source-only preparation. */
class SolarPositionTest {
    @Test fun `portable geometry and projection match the shared golden cases`() {
        val fixture = JSONObject(File("../../tests/fixtures/solar-landscape-v1.json").readText())
        assertEquals(1, fixture.getInt("version"))
        val rows = fixture.getJSONArray("cases")
        assertTrue("The shared fixture must cover geographic and polar observers", rows.length() >= 20)
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            val id = row.getString("id")
            val latitude = row.getDouble("latitude")
            val position = solarPosition(Instant.parse(row.getString("instant")),
                SolarLocation(latitude, row.getDouble("longitude")))
            val expected = row.getJSONObject("expected")
            assertEquals("$id altitude", expected.getDouble("altitudeDeg"), position.altitudeDeg, 1e-7)
            val azimuthDifference = abs(position.azimuthDeg - expected.getDouble("azimuthDeg"))
            assertTrue("$id azimuth", minOf(azimuthDifference, 360.0 - azimuthDifference) < 1e-7)
            assertEquals("$id minimum", expected.getDouble("minAltitudeDeg"), position.minAltitudeDeg, 1e-7)
            assertEquals("$id maximum", expected.getDouble("maxAltitudeDeg"), position.maxAltitudeDeg, 1e-7)
            assertEquals("$id sun visibility", expected.getBoolean("sunVisible"), position.sunVisible)
            assertEquals("$id phase", expected.getString("phase"), position.phase)
            assertEquals("$id polar state", expected.getString("polarState"), position.polarState)
            val projected = solarLandscapePoint(position, latitude, fixture.getDouble("horizonY"))
            assertEquals("$id panorama x", expected.getDouble("sunX"), projected.x, 1e-7)
            assertEquals("$id panorama y", expected.getDouble("sunY"), projected.y, 1e-7)
        }
    }

    @Test fun `both poles remain finite during continuous daylight and darkness`() {
        for (latitude in listOf(-90.0, 90.0)) {
            for (instant in listOf("2026-06-21T00:00:00Z", "2026-12-21T12:00:00Z")) {
                val position = solarPosition(Instant.parse(instant), SolarLocation(latitude, 0.0))
                assertTrue(position.altitudeDeg.isFinite())
                assertTrue(position.azimuthDeg.isFinite())
                assertTrue(position.minAltitudeDeg.isFinite())
                assertTrue(position.maxAltitudeDeg.isFinite())
                assertTrue(position.polarState in setOf("polar-day", "polar-night"))
                assertEquals(position.polarState == "polar-day", position.sunVisible)
            }
        }
    }

    @Test fun `normalized sun stays inside narrow and wide viewports with the same horizon`() {
        val horizon = .64
        for (width in listOf(360.0, 1440.0)) for (latitude in listOf(-75.0, 75.0)) {
            for (altitude in listOf(0.0, 5.0, 20.0, 90.0)) for (azimuth in listOf(0.0, 90.0, 180.0, 270.0)) {
                val position = SolarPosition(altitude, azimuth, altitude > 0.0, "day", "none", -20.0, 90.0)
                val projected = solarLandscapePoint(position, latitude, horizon)
                val x = projected.x * width; val y = projected.y * 300.0
                assertTrue("x in a $width viewport", x >= .06 * width - 1e-7 && x <= .94 * width + 1e-7)
                assertTrue("y stays above the horizon", y >= .08 * 300.0 - 1e-7 && y <= horizon * 300.0 + 1e-7)
                if (altitude == 0.0) assertEquals(horizon * 300.0, y, 1e-7)
                if (altitude == 90.0) {
                    assertEquals(.08 * 300.0, y, 1e-7)
                    assertEquals("Overhead sun remains centered", width * .5, x, 1e-7)
                }
            }
        }
    }

    @Test fun `invalid observers cannot produce a fabricated sky position`() {
        for (location in listOf(SolarLocation(Double.NaN, 0.0), SolarLocation(91.0, 0.0),
            SolarLocation(0.0, Double.POSITIVE_INFINITY), SolarLocation(0.0, -181.0))) {
            assertTrue(runCatching { solarPosition(Instant.parse("2026-11-06T12:00:00Z"), location) }
                .exceptionOrNull() is IllegalArgumentException)
        }
    }
}
