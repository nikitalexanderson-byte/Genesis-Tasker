package ru.genesis.calendar.ui

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.genesis.calendar.data.UiPreferences

class GregorianSeasonArtTest {
    @Test fun monthArtworkKeepsWebClimateAndSouthernCalendarOrder() {
        assertEquals("gregorian-months-v1/temperate/10.webp", gregorianMonthArtPath(9, ZoneId.of("Europe/Moscow")))
        assertEquals("gregorian-months-v1/southern/01.webp", gregorianMonthArtPath(0, ZoneId.of("Australia/Sydney")))
        assertEquals("gregorian-months-v1/mediterranean/07.webp", gregorianMonthArtPath(0, ZoneId.of("Australia/Perth")))
        for (zone in listOf("Europe/Moscow", "Europe/Helsinki", "Europe/Rome", "Asia/Riyadh", "Asia/Singapore", "Australia/Sydney")) {
            val paths = (0..11).map { gregorianMonthArtPath(it, ZoneId.of(zone)) }
            assertEquals(12, paths.distinct().size)
            paths.forEach { assertTrue(it, java.io.File("../../public/$it").isFile) }
        }
    }

    @Test fun northernAndSouthernRegionsChooseDifferentSeasonPalettes() {
        assertEquals(SeasonArtRegion.BOREAL, seasonArtRegion(ZoneId.of("Europe/Helsinki")))
        assertEquals(SeasonArtRegion.MEDITERRANEAN, seasonArtRegion(ZoneId.of("Europe/Rome")))
        assertEquals(SeasonArtRegion.ARID, seasonArtRegion(ZoneId.of("Asia/Riyadh")))
        assertEquals(SeasonArtRegion.TROPICAL, seasonArtRegion(ZoneId.of("Asia/Singapore")))
        assertTrue(isSouthernSeasonRegion(ZoneId.of("Australia/Sydney")))
        assertTrue(isSouthernSeasonRegion(ZoneId.of("America/Argentina/Buenos_Aires")))
        assertTrue(isSouthernSeasonRegion(ZoneId.of("Pacific/Auckland")))
        assertEquals(SeasonArtRegion.SOUTHERN, seasonArtRegion(ZoneId.of("Australia/Sydney")))
        assertEquals(SeasonArtRegion.MEDITERRANEAN, seasonArtRegion(ZoneId.of("Australia/Perth")))
        assertEquals(SeasonArtRegion.TROPICAL, seasonArtRegion(ZoneId.of("Australia/Darwin")))
        assertFalse(isSouthernSeasonRegion(ZoneId.of("America/New_York")))
    }

    @Test fun selectedSourceControlsPaletteAndMissingIpFallsBackToDevice() {
        val manual = UiPreferences(regionSource = "manual", manualRegionZone = "Australia/Sydney")
        assertEquals("Australia/Sydney", selectedSeasonZone(manual).id)
        assertEquals("gregorian-seasons/southern/summer.jpg",
            gregorianSeasonArtPath("summer", selectedSeasonZone(manual), true))
        assertEquals("gregorian-seasons/summer.jpg",
            gregorianSeasonArtPath("summer", selectedSeasonZone(manual), false))
        assertEquals(ZoneId.systemDefault(), selectedSeasonZone(UiPreferences(regionSource = "ip")))
    }
}
