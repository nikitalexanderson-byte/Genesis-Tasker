package ru.genesis.calendar.ui

import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.text.modifiers.TextAutoSizeLayoutScope
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import ru.genesis.calendar.domain.CalendarRange
import ru.genesis.calendar.domain.CalendarMode

internal val calendarMonthHeroHeight = 176.dp
internal val calendarDayHeroHeight = 240.dp

internal fun calendarDayHeroHeight(mode: CalendarMode) = when (mode) {
    CalendarMode.LUNAR -> 220.dp
    CalendarMode.PROFANE -> 164.dp
    else -> calendarDayHeroHeight
}

/** A period swipe must still offer a return even while today's selected day is retained. */
internal fun calendarOffersToday(selected: LocalDate, page: CalendarRange, today: LocalDate): Boolean =
    selected != today || today < page.start || today > page.end

/** Bounded calendar copy fits both dimensions while retaining complete alphabetic words. */
internal data class CalendarHeroTextAutoSize(val preferred: TextUnit) : TextAutoSize {
    override fun TextAutoSizeLayoutScope.getFontSize(constraints: Constraints, text: AnnotatedString): TextUnit {
        if (constraints.maxWidth == 0 || constraints.maxHeight == 0) return preferred
        val largest = preferred.toPx()
        fun fits(size: Float): Boolean = performLayout(constraints, text, size.toSp()).let {
            !it.hasVisualOverflow && !it.multiParagraph.didExceedMaxLines && !it.splitsWord()
        }
        if (fits(largest)) return preferred
        var lower = minOf(largest, 8.sp.toPx())
        var upper = largest
        var found = fits(lower)
        repeat(20) {
            if (!found) { upper = lower; lower *= .5f; found = fits(lower) }
        }
        if (!found) return minOf(largest, 8.sp.toPx()).toSp()
        repeat(10) {
            val probe = (lower + upper) / 2f
            if (fits(probe)) lower = probe else upper = probe
        }
        return lower.toSp()
    }
}
