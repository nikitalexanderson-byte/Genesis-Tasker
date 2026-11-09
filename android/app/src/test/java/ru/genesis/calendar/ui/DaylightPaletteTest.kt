package ru.genesis.calendar.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.*
import org.junit.Test

class DaylightPaletteTest {
    private fun contrast(a: Color, b: Color): Float {
        val x = a.luminance(); val y = b.luminance()
        return (maxOf(x, y) + .05f) / (minOf(x, y) + .05f)
    }
    @Test fun eachPaletteHasReadableTextContainersAndActionsInBothModes() {
        for (palette in listOf("green", "blue", "burgundy", "violet")) for (scheme in listOf(daylightPalette(palette), eveningPalette(palette))) {
            for ((ink, background) in listOf(scheme.onSurface to scheme.surface,
                scheme.onSurfaceVariant to scheme.surfaceContainerHigh, scheme.onBackground to scheme.background,
                scheme.onPrimary to scheme.primary, scheme.onPrimaryContainer to scheme.primaryContainer,
                scheme.onSecondaryContainer to scheme.secondaryContainer)) {
                assertTrue("$palette text contrast ${contrast(ink, background)}", contrast(ink, background) >= 4.5f)
            }
            assertTrue("$palette control boundary", contrast(scheme.outline, scheme.surface) >= 3f)
        }
        assertEquals(standart, daylightPalette("green"))
        assertEquals(standart, daylightPalette("unknown"))
    }
}
