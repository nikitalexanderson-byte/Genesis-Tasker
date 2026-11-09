package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle as DateTextStyle
import java.util.Locale
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog

internal fun calendarScreenTitle(mode: CalendarMode, sacredFeaturesEnabled: Boolean = true): String = if (!sacredFeaturesEnabled) "Календарь" else when (mode) {
    CalendarMode.PROFANE -> "Календарь — григорианский"
    CalendarMode.SACRED -> "Календарь — сакральный"
    CalendarMode.LUNAR -> "Календарь — лунный"
}

private enum class MonthCopyRole { LABEL, META, TITLE, BODY }
private data class MonthCopy(val text: String, val role: MonthCopyRole,
    val tag: String? = null, val accent: Boolean = false)
private data class MonthHeroCopy(val mode: CalendarMode, val title: String,
    val image: String, val artTag: String, val fields: List<MonthCopy>)

private fun monthHeroCopies(calendar: GenesisCalendar, date: LocalDate,
    zone: ZoneId, locale: Locale): List<MonthHeroCopy> {
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val lunar = calendar.lunarDate(date)
    return listOf(
        MonthHeroCopy(CalendarMode.PROFANE,
            date.month.getDisplayName(DateTextStyle.FULL_STANDALONE, locale)
                .replaceFirstChar { it.titlecase(locale) } + " ${date.year}",
            gregorianMonthArtPath(date.monthValue - 1, zone), "gregorian-month-art", listOf(
                MonthCopy("Григорианский месяц", MonthCopyRole.LABEL),
                MonthCopy(gregorianMonthOrigin(date.monthValue), MonthCopyRole.BODY, "gregorian-month-origin"),
                MonthCopy(gregorianMonthNature(date.monthValue, zone), MonthCopyRole.BODY, "gregorian-month-nature"))),
        MonthHeroCopy(CalendarMode.SACRED, month.name, sacredMonthArtPath(month.index), "sacred-month-art", listOf(
            MonthCopy("${month.season} · ${month.roman} месяц · ${sacred.sacredYear}", MonthCopyRole.META, accent = true),
            MonthCopy(month.title, MonthCopyRole.TITLE, accent = true),
            MonthCopy(month.description, MonthCopyRole.BODY))),
        MonthHeroCopy(CalendarMode.LUNAR, lunar.month.name, lunarMonthArtPath(lunar.monthOrdinal - 1), "lunar-month-art", listOf(
            MonthCopy(lunar.month.title, MonthCopyRole.TITLE, accent = true),
            MonthCopy(lunar.month.description, MonthCopyRole.BODY))))
}

@Composable
private fun monthCopyStyle(role: MonthCopyRole, mode: CalendarMode): TextStyle = when (role) {
    MonthCopyRole.LABEL -> MaterialTheme.typography.labelMedium
    MonthCopyRole.META -> MaterialTheme.typography.labelSmall
    MonthCopyRole.TITLE -> MaterialTheme.typography.titleSmall.copy(lineHeight = 1.12.em)
    MonthCopyRole.BODY -> MaterialTheme.typography.bodySmall.copy(
        lineHeight = if (mode == CalendarMode.PROFANE) 1.2.em else 1.25.em)
}.copy(hyphens = Hyphens.None)

/** The active period sizes its own description; artwork follows the content bounds. */
@Composable
internal fun CalendarMonthHero(calendar: GenesisCalendar, referenceDate: LocalDate, mode: CalendarMode,
    zone: ZoneId, offerToday: Boolean, onToday: () -> Unit, onPrevious: () -> Unit, onNext: () -> Unit) {
    val language = LocalGenesisLanguage.current
    val locale = remember(language) { Locale.forLanguageTag(language) }
    val originals = remember(calendar, referenceDate, zone, locale) { monthHeroCopies(calendar, referenceDate, zone, locale) }
    val copies = originals.map { copy -> copy.copy(title = genesisTranslate(copy.title),
        fields = copy.fields.map { field -> field.copy(text = genesisTranslate(field.text)) }) }
    val copy = copies.first { it.mode == mode }
    val headingStyle = MaterialTheme.typography.titleLarge.copy(lineHeight = 1.1.em, hyphens = Hyphens.None)
    val civil = !LocalSacredFeaturesEnabled.current
    val lightHero = !LocalEveningTheme.current
    val paletteToned = mode != CalendarMode.PROFANE
    val ink = if (lightHero) Color.White else if (paletteToned) MaterialTheme.colorScheme.onSurface else Color(0xfff9f2e2)
    val tag = if (mode == CalendarMode.SACRED) "sacred-month-hero" else "calendar-month-description"
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape,
        color = if (mode == CalendarMode.PROFANE) MaterialTheme.colorScheme.primaryContainer
            else eveningSurface(Color(0xff082e2f))) {
            Box(Modifier.fillMaxWidth().testTag("month-description-layout")) {
                OriginalImage(copy.image, genesisTranslate("Иллюстрация месяца") + " ${copy.title}",
                    Modifier.matchParentSize().testTag(copy.artTag), darkThemeBrightness = .82f, lightThemeBrightness = 1f)
                CalendarHeroContrast(Modifier.matchParentSize(), paletteToned)
                CompositionLocalProvider(LocalContentColor provides ink,
                    LocalPreserveCalendarColors provides (lightHero || LocalPreserveCalendarColors.current),
                    LocalArtworkTextShadow provides if (lightHero) artworkTextShadow() else null) {
                    Column(Modifier.fillMaxWidth().then(if (civil) Modifier.heightIn(min = 112.dp) else Modifier).padding(6.dp),
                        verticalArrangement = if (civil) Arrangement.Bottom else Arrangement.spacedBy(6.dp)) {
                        if (civil) {
                            CalendarMonthHeroNavigation(onPrevious, onNext, copy.title, offerToday, onToday)
                        } else {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f).testTag("month-description-name")) {
                                    Text(copy.title, Modifier.testTag("calendar-month-period").semantics { heading() },
                                        style = headingStyle, translate = false)
                                }
                            }
                            copy.fields.forEach { field ->
                                Text(field.text, field.tag?.let { Modifier.testTag(it) } ?: Modifier,
                                    style = monthCopyStyle(field.role, mode), translate = false,
                                    color = if (field.accent && !lightHero) MaterialTheme.colorScheme.primary else ink)
                            }
                        }
                        CalendarMonthHeroNavigation(onPrevious, onNext, offerToday = offerToday, onToday = onToday)
                        }
                    }
                }
            }
    }
}
