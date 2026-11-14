package ru.genesis.calendar.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import java.time.LocalDate
import java.time.DayOfWeek

/** Sunday-first, matching the Gregorian calendar and its patron symbols on the website. */
internal data class WeekdayPatronMark(
    val symbol: String,
    val patrons: String,
    val guidance: String,
    val accent: Color,
    val wash: Color,
    val selectedBackground: Color,
    val selectedForeground: Color,
)

private val weekdayPatronMarks = listOf(
    WeekdayPatronMark("☉", "Аполлон", "День Света и Прозрения",
        Color(0xffb48618), Color(0xfff4e9c8), Color(0xff70561a), Color(0xfffff7d7)),
    WeekdayPatronMark("☽", "Артемида и Геката", "День Границы и Перекрёстка",
        Color(0xff778986), Color(0xffedf1ee), Color(0xff465451), Color(0xfffffdf8)),
    WeekdayPatronMark("♂", "Арес", "День Натиска и Воли",
        Color(0xffa64d42), Color(0xfff4e4de), Color(0xff73342f), Color(0xfffff2ed)),
    WeekdayPatronMark("☿", "Гермес", "День путешествий и переговоров",
        Color(0xff347d54), Color(0xffe2f0e5), Color(0xff24583d), Color(0xffeffff4)),
    WeekdayPatronMark("♃", "Зевс и Гера", "День Власти и Суверенитета",
        Color(0xff366597), Color(0xffe3edf6), Color(0xff2b5278), Color(0xfff0f7ff)),
    WeekdayPatronMark("♀", "Гестия, Афродита и Дионис", "День любви и очага",
        Color(0xff714b94), Color(0xffeee5f3), Color(0xff55386d), Color(0xfffbf3ff)),
    WeekdayPatronMark("♄", "Аид, Посейдон и Кронос", "День Памяти, Времени и Денег",
        Color(0xff2c403d), Color(0xffe7e9e3), Color(0xff172725), Color(0xfff4f1e8)),
)

internal fun weekdayPatronMark(date: LocalDate): WeekdayPatronMark =
    weekdayPatronMarks[date.dayOfWeek.value % 7]

/** The same weekday hues are shared by all light palettes. */
internal fun WeekdayPatronMark.daylightCell(date: LocalDate): WeekdayPatronMark {
    val (wash, selection) = when (date.dayOfWeek) {
        DayOfWeek.SUNDAY -> Color(0xfff6edcf) to Color(0xffbe963c)
        DayOfWeek.MONDAY -> Color(0xffeef0f2) to Color(0xff9fa7b0)
        DayOfWeek.TUESDAY -> Color(0xfff6eae5) to Color(0xffc47b6c)
        DayOfWeek.WEDNESDAY -> Color(0xffe8f1ea) to Color(0xff6fa582)
        DayOfWeek.THURSDAY -> Color(0xffe8eff6) to Color(0xff6e99c2)
        DayOfWeek.FRIDAY -> Color(0xfff0eaf4) to Color(0xffa483bd)
        DayOfWeek.SATURDAY -> Color(0xffe6e8eb) to Color(0xff656c75)
    }
    return copy(wash = wash, selectedBackground = selection,
        selectedForeground = if (date.dayOfWeek == DayOfWeek.SATURDAY) Color(0xfff5f6f7) else Color(0xff132426))
}

/** Darken the approved daylight colors, keeping Monday silver and Saturday neutral gray. */
internal fun WeekdayPatronMark.eveningCell(date: LocalDate): WeekdayPatronMark {
    val daylight = daylightCell(date)
    return daylight.copy(
        wash = Color.Black.copy(alpha = .68f).compositeOver(daylight.wash),
        selectedBackground = Color.Black.copy(alpha = .35f).compositeOver(daylight.selectedBackground),
        selectedForeground = Color(0xfff5f6f7),
        accent = Color.White.copy(alpha = .22f).compositeOver(daylight.selectedBackground))
}
