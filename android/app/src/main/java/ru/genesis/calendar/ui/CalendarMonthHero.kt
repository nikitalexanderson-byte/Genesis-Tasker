package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Constraints
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
                .replaceFirstChar { it.titlecase(locale) } + "\n${date.year}",
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

/** Measure the same three real descriptions so changing calendar does not resize its artwork. */
@Composable
internal fun CalendarMonthHero(calendar: GenesisCalendar, referenceDate: LocalDate, mode: CalendarMode,
    zone: ZoneId, offerToday: Boolean, onToday: () -> Unit, onPrevious: () -> Unit, onNext: () -> Unit) {
    val language = LocalGenesisLanguage.current
    val locale = remember(language) { Locale.forLanguageTag(language) }
    val originals = remember(calendar, referenceDate, zone, locale) { monthHeroCopies(calendar, referenceDate, zone, locale) }
    val copies = originals.map { copy -> copy.copy(title = genesisTranslate(copy.title),
        fields = copy.fields.map { field -> field.copy(text = genesisTranslate(field.text)) }) }
    val civil = !LocalSacredFeaturesEnabled.current
    val copy = copies.first { it.mode == mode }.let { if (civil) it.copy(fields = emptyList()) else it }
    val headingStyle = MaterialTheme.typography.titleLarge.copy(lineHeight = 1.1.em, hyphens = Hyphens.None,
        shadow = Shadow(Color.Black.copy(alpha = .8f), Offset(0f, 1f), 4f))
    val todayStyle = MaterialTheme.typography.labelMedium.copy(hyphens = Hyphens.None)
    val todayLabel = genesisTranslate("Сегодня")
    val textMeasurer = rememberTextMeasurer(cacheSize = 32)
    val density = LocalDensity.current
    val paletteToned = mode != CalendarMode.PROFANE
    val ink = Color(0xfff9f2e2)
    val tag = if (mode == CalendarMode.SACRED) "sacred-month-hero" else "calendar-month-description"
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape,
        color = if (mode == CalendarMode.PROFANE) MaterialTheme.colorScheme.primaryContainer
            else eveningSurface(Color(0xff082e2f))) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val contentWidth = with(density) { (maxWidth - 24.dp).roundToPx().coerceAtLeast(1) }
            val todayWidth = if (offerToday) with(density) { 48.dp.roundToPx() } else 0
            val headingWidth = (contentWidth - todayWidth - if (offerToday) with(density) { 8.dp.roundToPx() } else 0).coerceAtLeast(1)
            val gap = with(density) { 4.dp.roundToPx() }
            var tallestContent = 0
            for (original in copies) {
                val candidate = if (civil) original.copy(fields = emptyList()) else original
                var height = maxOf(textMeasurer.measure(AnnotatedString(candidate.title), headingStyle,
                    constraints = Constraints(maxWidth = headingWidth)).size.height,
                    if (offerToday) with(density) { 48.dp.roundToPx() } else 0)
                for (field in candidate.fields) {
                    height += gap + textMeasurer.measure(AnnotatedString(field.text), monthCopyStyle(field.role, candidate.mode),
                        constraints = Constraints(maxWidth = contentWidth)).size.height
                }
                tallestContent = maxOf(tallestContent, height)
            }
            val commonHeight = if (civil) maxOf(120.dp, calendarMonthHeroHeight * (2f / 3f),
                with(density) { tallestContent.toDp() } + 24.dp) else maxOf(calendarMonthHeroHeight,
                with(density) { tallestContent.toDp() } + 80.dp)
            Box(Modifier.fillMaxWidth().heightIn(min = commonHeight).testTag("month-description-layout")) {
                OriginalImage(copy.image, genesisTranslate("Иллюстрация месяца") + " ${copy.title}",
                    Modifier.matchParentSize().testTag(copy.artTag), darkThemeBrightness = .82f,
                    lightThemeBrightness = if (mode == CalendarMode.LUNAR) .85f * .93f else .90f * .85f)
                if (LocalEveningTheme.current) CalendarHeroContrast(Modifier.matchParentSize(), paletteToned)
                CompositionLocalProvider(LocalContentColor provides ink, LocalPreserveCalendarColors provides true) {
                    Column(Modifier.fillMaxWidth().heightIn(min = commonHeight).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (civil) {
                            Spacer(Modifier.height(24.dp))
                        } else {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f).testTag("month-description-name")) {
                                    Text(copy.title, Modifier.testTag("calendar-month-period").semantics { heading() },
                                        style = headingStyle, translate = false, color = ink, adjustInk = false)
                                }
                                if (offerToday) Spacer(Modifier.width(56.dp).height(48.dp))
                            }
                            copy.fields.forEach { field ->
                                Text(field.text, field.tag?.let { Modifier.testTag(it) } ?: Modifier,
                                    translate = false,
                                    color = ink, adjustInk = false,
                                    style = monthCopyStyle(field.role, mode).copy(shadow = headingStyle.shadow))
                            }
                        }
                        }
                        Spacer(Modifier.height(48.dp))
                    }
                    if (civil) Text(copy.title, Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)
                        .padding(horizontal = 72.dp).testTag("calendar-month-period"), style = headingStyle,
                        textAlign = TextAlign.Center, color = ink, adjustInk = false, translate = false)
                    Box(Modifier.align(Alignment.BottomCenter).padding(12.dp)) { CalendarMonthHeroNavigation(onPrevious, onNext) }
                    if (offerToday) androidx.compose.material3.Surface(onClick = onToday,
                        modifier = Modifier.align(Alignment.TopEnd).padding(12.dp).size(48.dp).testTag("calendar-month-today")
                            .genesisDescription("Сегодня"), shape = AffairsLayout.controlShape,
                        color = MaterialTheme.colorScheme.surface.copy(alpha = .92f), contentColor = MaterialTheme.colorScheme.primary) {
                        Box(contentAlignment = Alignment.Center) { GenesisLucideIcon("undo-2") }
                    }
                }
            }
        }
    }
}
