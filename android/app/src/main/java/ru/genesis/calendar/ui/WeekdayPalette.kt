package ru.genesis.calendar.ui

import androidx.compose.ui.graphics.Color
import java.time.LocalDate

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

/** Warm/cool hues stay recognisable without using bright day-mode backgrounds at night. */
internal fun weekdayEveningWash(date: LocalDate): Color = listOf(
    Color(0xff4b4026), Color(0xff3b4844), Color(0xff50342f), Color(0xff2e4b39),
    Color(0xff2e445b), Color(0xff473652), Color(0xff2e3d36),
)[date.dayOfWeek.value % 7]
