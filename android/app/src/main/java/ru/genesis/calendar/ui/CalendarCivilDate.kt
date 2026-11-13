package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Only break between weekday and date; never leave the year on its own. */
@Composable internal fun CalendarCivilDate(date: LocalDate, locale: Locale) {
    val weekday = remember(date, locale) { date.format(DateTimeFormatter.ofPattern("EEEE", locale)).replaceFirstChar { it.titlecase(locale) } }
    val rest = remember(date, locale) { date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)).replace(' ', '\u00a0') }
    val whole = "$weekday, $rest"
    val style = MaterialTheme.typography.headlineSmall
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val fits = measurer.measure(AnnotatedString(whole), style).size.width <= with(density) { maxWidth.roundToPx() }
        Text(if (fits) whole else "$weekday\n$rest", Modifier.fillMaxWidth().testTag("calendar-selected-primary-date"),
            style = style, translate = false, maxLines = 2)
    }
}
