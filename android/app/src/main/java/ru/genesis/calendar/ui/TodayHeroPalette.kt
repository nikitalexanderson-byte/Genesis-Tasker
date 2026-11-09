package ru.genesis.calendar.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorMatrix
import ru.genesis.calendar.domain.CalendarMode

/** Match the web artwork filter; Gregorian weekday art keeps its authored colors. */
internal fun todayHeroArtworkTint(mode: CalendarMode, evening: Boolean, palette: String): Color? {
    if (!evening || mode == CalendarMode.PROFANE) return null
    return when (palette) {
        "burgundy" -> Color(0xffad5878)
        "blue" -> Color(0xff669cd3)
        "violet" -> Color(0xff9e69cb)
        else -> null
    }
}

/** Include neutral stone shadows, otherwise grey artwork barely reflects the palette. */
internal fun todayHeroArtworkMask(tint: Color) = ColorMatrix(floatArrayOf(
    0f, 0f, 0f, 0f, tint.red * 255f,
    0f, 0f, 0f, 0f, tint.green * 255f,
    0f, 0f, 0f, 0f, tint.blue * 255f,
    -10f, 10f, 0f, 0f, .35f * 255f
))
