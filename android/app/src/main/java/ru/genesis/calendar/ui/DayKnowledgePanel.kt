package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.MoonInfo
import ru.genesis.calendar.domain.SacredCatalog
import ru.genesis.calendar.domain.SolarLocation

private val elements = listOf(
    RhythmDefinition("🜃", "Земля", "Опора · Тело"),
    RhythmDefinition("🜄", "Вода", "Эмоции · Поток"),
    RhythmDefinition("🜁", "Воздух", "Интеллект · Связь"),
    RhythmDefinition("🜂", "Огонь", "Воля · Действие"),
    RhythmDefinition("✦", "Эфир", "Дух · Синтез"),
)
private val pythagorean = listOf(
    RhythmDefinition("I", "Монада", "Удержание · Стабильность"),
    RhythmDefinition("II", "Диада", "Разделение · Текучесть · Выбор пути"),
    RhythmDefinition("III", "Триада", "Одухотворение · Связь верха и низа"),
    RhythmDefinition("IIII", "Тетрада", "Справедливость · Полнота"),
    RhythmDefinition("V", "Пентада", "Всецелостность · Синтез"),
)
private val pyataMeanings = listOf(
    "Инициация · Явление идеи",
    "Подготовка · Сбор ресурсов",
    "Столкновение · Преодоление хаоса",
    "Кульминация · Расцвет замысла",
    "Плоды · Оценка результатов",
    "Переход · Передача эстафеты",
)

internal val pyataDescriptions = listOf(
    "Явление идеи. Выделение первичного импульса из пустоты. Бог месяца заявляет о себе, мы ставим цель.",
    "Установление границ и «снаряжение корабля». Стихии начинают конфликтовать, выстраивается иерархия. Время подготовки ресурсов.",
    "Срединная битва. Пик сопротивления материала. Преодоление хаоса и наведение порядка в делах.",
    "Проявление доблести. Энергия месяца достигает своего зенита. Лучшая версия реализации наших планов.",
    "Путь домой. Божественная энергия спускается на уровень человеческого действия. Сбор плодов и оценка результатов.",
    "Переход в вечность и память. Угасание формы, но кристаллизация опыта. Очищение места и подготовка к передаче эстафеты следующему месяцу.",
)

private data class RhythmDefinition(val symbol: String, val name: String, val meaning: String)
internal data class DayRhythmFact(val symbol: String, val label: String, val title: String, val meaning: String)

internal fun dayRhythmFacts(date: LocalDate, calendar: GenesisCalendar = GenesisCalendar()): List<DayRhythmFact> {
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val day = month.days[sacred.day - 1]
    if (sacred.monthIndex == 12) return listOf(
        DayRhythmFact(month.symbol, "ВНЕ ВРЕМЕНИ", "Апейрон", "Пространство первообразов"),
        DayRhythmFact("✦", "СТИХИЯ", "Эфир", "Дух · Синтез"),
        DayRhythmFact("∞", "ПИФАГОРЕЙСКИЙ СМЫСЛ", "Апейрон", "Безграничное · Пространство первообразов"),
    )
    val rhythmIndex = (sacred.day - 1) % 5
    val element = elements[rhythmIndex]
    val number = pythagorean[rhythmIndex]
    return listOf(
        DayRhythmFact(month.symbol, "ПЯТА ${day.pyata}", day.pyataTitle,
            pyataMeanings[(day.pyata - 1).coerceIn(0, pyataMeanings.lastIndex)]),
        DayRhythmFact(element.symbol, "СТИХИЯ", element.name, element.meaning),
        DayRhythmFact(number.symbol, "ПИФАГОРЕЙСКИЙ СМЫСЛ", number.name, number.meaning),
    )
}

internal fun isMoonFastingDay(moon: MoonInfo): Boolean {
    val event = moon.event.lowercase(Locale.ROOT)
    return "новолуние" in event || "полнолуние" in event
}

private val deepTeal = Color(0xff082e2f)
private val moonGold = Color(0xffffe9b5)
private val parchment = Color(0xfffffdf8)
private val parchmentSoft = Color(0xfffffaf2)
private val ink = Color(0xff132426)
private val mutedInk = Color(0xff526263)
private val gold = Color(0xffb28a4a)

internal fun secondaryCalendarModes(primary: CalendarMode): List<CalendarMode> =
    when (primary) {
        CalendarMode.SACRED -> listOf(CalendarMode.LUNAR, CalendarMode.PROFANE)
        CalendarMode.PROFANE -> listOf(CalendarMode.SACRED, CalendarMode.LUNAR)
        CalendarMode.LUNAR -> listOf(CalendarMode.SACRED, CalendarMode.PROFANE)
    }

/** Today expands only the selected sacred day's meaning and its three rhythms. */
@Composable
fun DayKnowledgePanel(date: LocalDate, primaryMode: CalendarMode,
    calendar: GenesisCalendar = GenesisCalendar()) {
    if (primaryMode != CalendarMode.SACRED) return
    Column(Modifier.fillMaxWidth().testTag("day-knowledge"),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ThreeRhythmsCard(date, calendar)
    }
}

@Composable
private fun SacredCalendarCard(date: LocalDate, calendar: GenesisCalendar) {
    val copy = todayHeroCopy(date, CalendarMode.SACRED, calendar, LocalGenesisLanguage.current)
    Card(Modifier.fillMaxWidth().testTag("sacred-calendar-card"),
        shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Color(0x66dfc17e)),
        colors = CardDefaults.cardColors(containerColor = parchment)) {
        Box(Modifier.fillMaxWidth().heightIn(min = 350.dp)) {
            OriginalImage(copy.imagePath, "Иллюстрация сакрального дня: ${copy.title}", Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(
                0f to Color(0x1a041416), .38f to Color(0x55041416), 1f to Color(0xf5071d20))))
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("САКРАЛЬНЫЙ КАЛЕНДАРЬ", style = MaterialTheme.typography.labelMedium,
                    color = Color(0xffdfc17e), fontWeight = FontWeight.Bold)
                Text(copy.month, style = MaterialTheme.typography.titleMedium, color = Color(0xffdcc995))
                Text(copy.title, style = MaterialTheme.typography.headlineSmall,
                    color = Color(0xfffff7e7), fontFamily = GenesisHeadingFont)
                copy.subtitle?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = Color(0xffeee0bd)) }
                Text(copy.description, style = MaterialTheme.typography.bodyMedium, color = Color(0xfff1eadc))
            }
        }
        ThreeRhythmsContent(date, calendar)
    }
}

@Composable
private fun GregorianCalendarCard(date: LocalDate, calendar: GenesisCalendar, solarLocation: SolarLocation) {
    val copy = todayHeroCopy(date, CalendarMode.PROFANE, calendar, LocalGenesisLanguage.current)
    Card(Modifier.fillMaxWidth().testTag("gregorian-calendar-card"),
        shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Color(0x66dfc17e))) {
        Box(Modifier.fillMaxWidth().heightIn(min = 460.dp)) {
            OriginalImage(copy.imagePath, "Иллюстрация дня недели: ${copy.title}", Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(
                0f to Color(0x23041416), .28f to Color(0x66041416), 1f to Color(0xf7071d20))))
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("ГРИГОРИАНСКИЙ КАЛЕНДАРЬ", style = MaterialTheme.typography.labelMedium,
                    color = Color(0xffdfc17e), fontWeight = FontWeight.Bold)
                Text(copy.month, style = MaterialTheme.typography.titleMedium, color = Color(0xffdcc995))
                Text(copy.title, style = MaterialTheme.typography.headlineSmall,
                    color = Color(0xfffff7e7), fontFamily = GenesisHeadingFont)
                copy.subtitle?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = Color(0xffeee0bd)) }
                Text(copy.description, style = MaterialTheme.typography.bodyMedium, color = Color(0xfff1eadc))
                copy.details.forEach { detail ->
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = Color(0xffd7dfd8))
                }
                SunriseSunsetLine(date, solarLocation, calendar, Color(0xfff4deb0), Color(0xfff4deb0))
                calendar.solarEvent(date)?.let { event ->
                    val locale = genesisLocale()
                    Text("${event.symbol} ${event.name} · ${event.instant.atZone(calendar.zoneId)
                        .format(DateTimeFormatter.ofPattern("HH:mm z", locale))}",
                        style = MaterialTheme.typography.labelLarge, color = Color(0xffdfc17e))
                }
            }
        }
    }
}

@Composable
private fun LunarCalendarCard(date: LocalDate, calendar: GenesisCalendar) {
    val lunar = calendar.lunarDate(date)
    val moon = calendar.moonInfo(date)
    Card(Modifier.fillMaxWidth().testTag("lunar-calendar-card"), shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, Color(0x55dfc17e)),
        colors = CardDefaults.cardColors(containerColor = deepTeal)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("ЛУННЫЙ КАЛЕНДАРЬ", style = MaterialTheme.typography.labelMedium,
                color = Color(0xffa9beb8), fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Surface(shape = CircleShape, color = Color(0x0ffff3d0),
                    border = BorderStroke(1.dp, Color(0x55dfc17e))) {
                    Box(Modifier.size(76.dp), contentAlignment = Alignment.Center) {
                        MoonPhaseIcon(moon.phaseStep, size = 54.dp)
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("${moon.direction} · ${moon.day} день", style = MaterialTheme.typography.labelMedium,
                        color = Color(0xff9cafaa), fontWeight = FontWeight.Bold)
                    Text(moon.epithet, style = MaterialTheme.typography.headlineSmall,
                        color = moonGold, fontFamily = GenesisHeadingFont)
                    Text("${moon.phase} · освещённость ${moon.illumination}%",
                        style = MaterialTheme.typography.bodySmall, color = Color(0xffa9beb8))
                }
            }
            if (moon.event.isNotBlank()) {
                Surface(shape = RoundedCornerShape(50), color = Color(0x227f7443),
                    border = BorderStroke(1.dp, Color(0x66dfc17e))) {
                    Text(moon.event.uppercase(genesisLocale()), Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.labelMedium, color = moonGold, fontWeight = FontWeight.Bold)
                }
            }
            HorizontalDivider(color = Color(0x287f9b94))
            Text("${lunar.month.roman} · ${lunar.month.name}", style = MaterialTheme.typography.titleMedium,
                color = moonGold, fontFamily = GenesisHeadingFont)
            Text(lunar.month.title, style = MaterialTheme.typography.titleSmall, color = Color(0xffe8dfcc))
            Text(lunar.month.description, style = MaterialTheme.typography.bodySmall, color = Color(0xffa9beb8))
            Text("${lunar.decade}${if (lunar.isThreshold) " · Рубеж" else ""} · ${lunar.day} из ${lunar.monthLength} дней",
                style = MaterialTheme.typography.labelMedium, color = Color(0xffd8c28e))
        }
    }
}

@Composable
private fun MoonFastingCard(moon: MoonInfo) {
    val newMoon = "новолуние" in moon.event.lowercase(Locale.ROOT)
    Card(Modifier.fillMaxWidth().testTag("moon-fasting-notice"), shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, Color(0x55dfc17e)),
        colors = CardDefaults.cardColors(containerColor = deepTeal)) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Surface(shape = CircleShape, color = Color(0x0ffff3d0),
                border = BorderStroke(1.dp, Color(0x55dfc17e))) {
                Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                    MoonPhaseIcon(moon.phaseStep, size = 40.dp)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(if (newMoon) "НОВОЛУНИЕ" else "ПОЛНОЛУНИЕ",
                    style = MaterialTheme.typography.labelMedium, color = Color(0xffdfc17e),
                    fontWeight = FontWeight.Bold)
                Text(if (newMoon) "Сегодня новолуние" else "Сегодня полнолуние",
                    style = MaterialTheme.typography.titleLarge, color = Color(0xfffff7e7),
                    fontFamily = GenesisHeadingFont)
                Text("Это время хорошо подходит для аскезы, включая голодание на воде, если у вас нет к этому противопоказаний. При сомнениях заранее посоветуйтесь с врачом.",
                    style = MaterialTheme.typography.bodySmall, color = Color(0xffa9beb8))
            }
        }
    }
}

@Composable
private fun ThreeRhythmsCard(date: LocalDate, calendar: GenesisCalendar) {
    Card(Modifier.fillMaxWidth().testTag("three-rhythms-card"), shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, Color(0x33b28a4a)),
        colors = CardDefaults.cardColors(containerColor = parchment)) {
        ThreeRhythmsContent(date, calendar)
    }
}

@Composable
private fun ThreeRhythmsContent(date: LocalDate, calendar: GenesisCalendar) {
        Column(Modifier.padding(18.dp).testTag("three-rhythms-content"), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val dark=LocalEveningTheme.current
            val headerInk=if(dark) MaterialTheme.colorScheme.onPrimaryContainer else Color(0xfff9f2e2)
            val headerAccent=if(dark) MaterialTheme.colorScheme.onSecondaryContainer else Color(0xffdfc17e)
            Surface(Modifier.fillMaxWidth().testTag("three-rhythms-heading"),shape=RoundedCornerShape(18.dp),
                color=if(dark) MaterialTheme.colorScheme.primaryContainer else Color(0xff123b36),
                border=BorderStroke(1.dp,headerAccent.copy(alpha=.35f))) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("САКРАЛЬНЫЙ КАЛЕНДАРЬ · СМЫСЛ ДНЯ", style = MaterialTheme.typography.labelMedium,
                        color = headerAccent, fontWeight = FontWeight.Bold)
                    Text("Три ритма в одной точке", style = MaterialTheme.typography.headlineSmall,
                        color = headerInk, fontFamily = GenesisHeadingFont)
                    Text("Пята, стихия и пифагорейский смысл выбранного сакрального дня.",
                        style = MaterialTheme.typography.bodySmall, color = headerInk)
                }
                ThreeRhythmsIcon(headerAccent)
            }
            }
            dayRhythmFacts(date, calendar).forEach { fact -> RhythmFactCard(fact) }
        }
}

@Composable private fun ThreeRhythmsIcon(ink: Color) {
    val description=genesisTranslate("Три ритма соединяются в центре")
    Canvas(Modifier.size(44.dp).testTag("three-rhythms-icon").semantics { contentDescription=description }) {
        for(angle in listOf(-90.0,30.0,150.0)) {
            val radians=Math.toRadians(angle)
            val point=Offset(center.x + kotlin.math.cos(radians).toFloat()*size.minDimension*.34f,
                center.y + kotlin.math.sin(radians).toFloat()*size.minDimension*.34f)
            drawLine(ink,point,center,strokeWidth=1.6.dp.toPx(),cap=StrokeCap.Round)
            drawCircle(ink,radius=size.minDimension*.075f,center=point)
        }
    }
}

@Composable
private fun RhythmFactCard(fact: DayRhythmFact) {
    val dark=LocalEveningTheme.current
    Surface(Modifier.fillMaxWidth().testTag("rhythm-fact-${fact.label}"), shape = RoundedCornerShape(18.dp),
        color = if(dark) MaterialTheme.colorScheme.surfaceContainerLowest else parchmentSoft,
        border = BorderStroke(1.dp, if(dark) MaterialTheme.colorScheme.secondary.copy(alpha=.5f) else Color(0x26b28a4a))) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(fact.symbol, style = MaterialTheme.typography.headlineMedium, color = if(dark) MaterialTheme.colorScheme.secondary else gold,
                fontFamily = GenesisHeadingFont)
            Text(fact.label, style = MaterialTheme.typography.labelSmall, color = if(dark) MaterialTheme.colorScheme.onSurfaceVariant else mutedInk,
                fontWeight = FontWeight.Bold)
            Text(fact.title, style = MaterialTheme.typography.titleLarge, color = if(dark) MaterialTheme.colorScheme.onSurface else ink,
                fontFamily = GenesisHeadingFont)
            Text(fact.meaning, style = MaterialTheme.typography.bodySmall, color = if(dark) MaterialTheme.colorScheme.onSurfaceVariant else mutedInk)
        }
    }
}

/** Compact semantic cards used under the selected day in Calendar → Month. */
@Composable
internal fun CalendarSelectedDayFacts(date: LocalDate, calendar: GenesisCalendar, solarLocation: SolarLocation,
    primaryMode: CalendarMode = CalendarMode.SACRED) {
    if (!LocalSacredFeaturesEnabled.current) return
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val day = month.days[sacred.day - 1]
    val lunar = calendar.lunarDate(date)
    val moon = calendar.moonInfo(date)
    val locale = genesisLocale()
    Column(Modifier.fillMaxWidth().testTag("calendar-selected-fact-blocks"),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
      (listOf(primaryMode) + secondaryCalendarModes(primaryMode))
          .filterNot { it == primaryMode }
          .forEach { mode ->
        when (mode) {
        CalendarMode.SACRED -> CalendarFactCard("calendar-selected-sacred", month.symbol, "Сакральный календарь",
            "${sacred.day} · ${month.name} (${month.roman})", "${day.name}. ${day.description}",
            parchmentSoft, ink, mutedInk, gold)
        CalendarMode.PROFANE -> CalendarFactCard("calendar-selected-gregorian", "☼", "Григорианский календарь",
            date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale)).replaceFirstChar { it.titlecase(locale) },
            "${date.dayOfYear}-й из ${date.lengthOfYear()} дней года · ${date.lengthOfMonth()} дней в месяце",
            Color(0xffeef2ed), ink, mutedInk, Color(0xff407064)) {
            SunriseSunsetLine(date, solarLocation, calendar, Color(0xff255b59), mutedInk)
            calendar.solarEvent(date)?.let { event ->
                Text("${event.symbol} ${event.name} · ${event.instant.atZone(calendar.zoneId).format(DateTimeFormatter.ofPattern("HH:mm z", locale))}",
                    style = MaterialTheme.typography.labelMedium, color = Color(0xff407064))
            }
        }
        CalendarMode.LUNAR -> Surface(Modifier.fillMaxWidth().testTag("calendar-selected-lunar"), shape = RoundedCornerShape(16.dp),
            color = if (LocalEveningTheme.current) deepTeal else MaterialTheme.colorScheme.primaryContainer,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    MoonPhaseIcon(moon.phaseStep, size = 46.dp)
                    Column(Modifier.weight(1f)) {
                        Text("Лунный календарь", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        Text("${moon.day} лунный день · ${moon.phase}", style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text("${moon.epithet} · ${moon.direction} · освещённость ${moon.illumination}%",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
                Text("${lunar.month.name} · ${lunar.decade}${if (lunar.isThreshold) " · Рубеж" else ""}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                if (moon.event.isNotBlank()) Text(moon.event, style = MaterialTheme.typography.labelMedium,
                    color = moonGold, fontWeight = FontWeight.Bold)
            }
        }
        }
      }
    }
}

@Composable
private fun CalendarFactCard(tag: String, symbol: String, heading: String, title: String, body: String,
    background: Color, foreground: Color, secondary: Color, accent: Color,
    extra: (@Composable ColumnScope.() -> Unit)? = null) {
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = RoundedCornerShape(16.dp), color = background,
        border = BorderStroke(1.dp, accent.copy(alpha = .25f))) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top) {
            Text(symbol, style = MaterialTheme.typography.headlineSmall, color = accent,
                fontFamily = GenesisHeadingFont)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(heading, style = MaterialTheme.typography.labelMedium, color = accent,
                    fontWeight = FontWeight.Bold)
                Text(title, style = MaterialTheme.typography.titleSmall, color = foreground)
                Text(body, style = MaterialTheme.typography.bodySmall, color = secondary)
                extra?.invoke(this)
            }
        }
    }
}

@Composable
private fun genesisLocale(): Locale =
    Locale.forLanguageTag(LocalGenesisLanguage.current)
