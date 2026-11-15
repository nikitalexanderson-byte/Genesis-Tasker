package ru.genesis.calendar.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class Release333ColorsTest {
    private fun contrast(a: Color, b: Color): Float {
        val x = a.luminance(); val y = b.luminance()
        return (maxOf(x,y)+.05f)/(minOf(x,y)+.05f)
    }
    @Test fun nightDaysFollowTheirPaletteAndRetainReadableTextAndSelection() {
        val days = (0..6).map { LocalDate.of(2026,11,15).plusDays(it.toLong()) }
        val fills = listOf("blue","burgundy","violet","green").map { palette ->
            val marks = days.map { weekdayPatronMark(it).eveningCell(palette) }
            marks.forEachIndexed { index, it ->
                assertEquals("White day text",Color.White,it.selectedForeground)
                assertTrue("Day text contrast in $palette", contrast(it.wash,it.selectedForeground) >= 4.5f)
                assertTrue("Selected day text contrast in $palette", contrast(it.selectedBackground,it.selectedForeground) >= 4.5f)
                val outline = weekdayOutlineColors(days[index].dayOfWeek)
                assertTrue("Selection highlight contrast in $palette", contrast(it.selectedBackground,outline.highlight) >= 3f)
                assertEquals("Selection preserves the fill",it.wash,it.selectedBackground)
            }
            assertEquals("Uniform weekday fill in $palette",1,marks.map {it.wash}.distinct().size)
            marks.first().wash
        }
        assertEquals("Each palette has its own fill",4,fills.distinct().size)
    }
    @Test fun themedRankAndRewardSurfacesRetainGoldContrast() {
        for (palette in listOf("green","blue","burgundy","violet")) {
            val colors=heroPathColors(palette)
            assertTrue(contrast(colors.icon,Color(0xffdfc17e)) >= 4.5f)
            assertTrue(contrast(colors.amphora,Color(0xfffff5df)) >= 4.5f)
        }
    }
}
