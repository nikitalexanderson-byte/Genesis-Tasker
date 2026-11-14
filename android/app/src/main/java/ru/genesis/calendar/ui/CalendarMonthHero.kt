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

/** Use the owner's December reference for sizing, independent of the visible month or return action. */
@Composable
internal fun CalendarMonthHero(calendar: GenesisCalendar, referenceDate: LocalDate, mode: CalendarMode,
    zone: ZoneId, offerToday: Boolean, onToday: () -> Unit, onPrevious: () -> Unit, onNext: () -> Unit) {
    val language = LocalGenesisLanguage.current
    val locale = remember(language) { Locale.forLanguageTag(language) }
    val originals = remember(calendar, referenceDate, zone, locale) { monthHeroCopies(calendar, referenceDate, zone, locale) }
    // This date is only a layout reference; the displayed period always comes from referenceDate.
    val referenceCopies = remember(calendar, zone, locale) {
        monthHeroCopies(calendar, LocalDate.of(2026, 12, 31), zone, locale)
    }.map { copy -> copy.copy(title = genesisTranslate(copy.title),
        fields = copy.fields.map { field -> field.copy(text = genesisTranslate(field.text)) }) }
    val copies = originals.map { copy -> copy.copy(title = genesisTranslate(copy.title),
        fields = copy.fields.map { field -> field.copy(text = genesisTranslate(field.text)) }) }
    val civil = !LocalSacredFeaturesEnabled.current
    val copy = copies.first { it.mode == mode }.let { if (civil) it.copy(fields = emptyList()) else it }
    val headingStyle = MaterialTheme.typography.titleLarge.copy(lineHeight = 1.1.em, hyphens = Hyphens.None,
        shadow = Shadow(Color.Black.copy(alpha = .8f), Offset(0f, 1f), 4f))
    val textMeasurer = rememberTextMeasurer(cacheSize = 32)
    val density = LocalDensity.current
    val paletteToned = mode != CalendarMode.PROFANE
    val ink = calendarArtworkControlInk
    val tag = if (mode == CalendarMode.SACRED) "sacred-month-hero" else "calendar-month-description"
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape,
        color = if (mode == CalendarMode.PROFANE) MaterialTheme.colorScheme.primaryContainer
            else eveningSurface(Color(0xff082e2f))) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val contentWidth = with(density) { (maxWidth - 24.dp).roundToPx().coerceAtLeast(1) }
            // Always reserve the same horizontal space, including when Today is absent.
            val headingWidth = (contentWidth - with(density) { 56.dp.roundToPx() }).coerceAtLeast(1)
            val gap = with(density) { 4.dp.roundToPx() }
            var tallestContent = 0
            for (original in referenceCopies) {
                val candidate = if (civil) original.copy(fields = emptyList()) else original
                var height = maxOf(textMeasurer.measure(AnnotatedString(candidate.title), headingStyle,
                    constraints = Constraints(maxWidth = headingWidth)).size.height,
                    with(density) { 48.dp.roundToPx() })
                for (field in candidate.fields) {
                    height += gap + textMeasurer.measure(AnnotatedString(field.text), monthCopyStyle(field.role, candidate.mode),
                        constraints = Constraints(maxWidth = contentWidth)).size.height
                }
                tallestContent = maxOf(tallestContent, height)
            }
            val referenceHeight = if (civil) maxOf(120.dp, calendarMonthHeroHeight * (2f / 3f),
                with(density) { tallestContent.toDp() } + 24.dp) else maxOf(calendarMonthHeroHeight,
                with(density) { tallestContent.toDp() } + 80.dp)
            // The compact civil card still needs two separate 48dp targets plus its padding.
            val commonHeight = maxOf(referenceHeight * .75f, if (civil) 120.dp else 0.dp)
            val styles = copy.fields.map { monthCopyStyle(it.role, mode).copy(shadow = headingStyle.shadow) }
            val textGap = with(density) { 2.dp.roundToPx() }
            fun TextStyle.scaled(scale: Float) = copy(fontSize = fontSize * scale,
                lineHeight = if (lineHeight.isSp) lineHeight * scale else lineHeight)
            fun copyLayout(scale: Float): Pair<Int, List<Int>> {
                val title = textMeasurer.measure(AnnotatedString(copy.title), headingStyle.scaled(scale),
                    constraints = Constraints(maxWidth = headingWidth))
                var valid = !title.splitsWord()
                var height = title.size.height
                val widths = mutableListOf<Int>()
                for ((index, field) in copy.fields.withIndex()) {
                    val width = if (height + textGap < with(density) { 52.dp.roundToPx() }) headingWidth else contentWidth
                    widths += width
                    val text = textMeasurer.measure(AnnotatedString(field.text), styles[index].scaled(scale),
                        constraints = Constraints(maxWidth = width))
                    valid = valid && !text.splitsWord()
                    height += textGap + text.size.height
                }
                return (if (valid) height else Int.MAX_VALUE) to widths
            }
            // Keep 2dp beyond the measured copy for independent text/padding pixel rounding.
            fun copyFits(scale: Float) = copyLayout(scale).first <= with(density) { (commonHeight - 70.dp).roundToPx() }
            var scale = 1f
            if (!civil && !copyFits(scale)) {
                var low = .25f
                var high = 1f
                repeat(12) {
                    val probe = (low + high) / 2f
                    if (copyFits(probe)) low = probe else high = probe
                }
                scale = low
            }
            val fieldWidths = copyLayout(scale).second
            Box(Modifier.fillMaxWidth().height(commonHeight).testTag("month-description-layout")) {
                OriginalImage(copy.image, genesisTranslate("Иллюстрация месяца") + " ${copy.title}",
                    Modifier.matchParentSize().testTag(copy.artTag), darkThemeBrightness = .82f,
                    lightThemeBrightness = (if (mode == CalendarMode.LUNAR) .85f * .93f else .90f * .85f) * .90f)
                if (LocalEveningTheme.current) CalendarHeroContrast(Modifier.matchParentSize(), paletteToned)
                CompositionLocalProvider(LocalContentColor provides ink, LocalPreserveCalendarColors provides true) {
                    if (!civil) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).padding(bottom = 52.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Box(Modifier.fillMaxWidth().padding(end = 56.dp).testTag("month-description-name")) {
                                Text(copy.title, Modifier.testTag("calendar-month-period").semantics { heading() },
                                    style = headingStyle.scaled(scale), translate = false, color = ink, adjustInk = false)
                            }
                            copy.fields.forEachIndexed { index, field ->
                                Text(field.text, (field.tag?.let { Modifier.testTag(it) } ?: Modifier)
                                    .padding(end = if (fieldWidths[index] < contentWidth) 56.dp else 0.dp),
                                    translate = false,
                                    color = ink, adjustInk = false,
                                    style = styles[index].scaled(scale))
                            }
                        }
                    }
                    if (civil) Text(copy.title, Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)
                        .padding(horizontal = 72.dp).testTag("calendar-month-period"), style = headingStyle,
                        textAlign = TextAlign.Center, color = ink, adjustInk = false, translate = false)
                    Box(Modifier.align(Alignment.BottomCenter).padding(12.dp)) { CalendarMonthHeroNavigation(onPrevious, onNext) }
                    if (offerToday) androidx.compose.material3.Surface(onClick = onToday,
                        modifier = Modifier.align(Alignment.TopEnd).padding(12.dp).size(48.dp).testTag("calendar-month-today")
                            .genesisDescription("Сегодня"), shape = AffairsLayout.controlShape,
                        color = Color.Transparent, contentColor = ink) {
                        Box(contentAlignment = Alignment.Center) { GenesisLucideIcon("undo-2") }
                    }
                }
            }
        }
    }
}
