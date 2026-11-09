package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/** Authored watches and four elemental periods from app/day-rhythm.ts. */
internal data class RhythmWatch(val start: Int, val deity: String, val title: String, val description: String, val symbol: String)
internal data class RhythmPeriod(val name: String, val element: String, val start: Int, val symbol: String,
    val alchemy: String, val source: String, val description: String, val watches: List<RhythmWatch>)

internal val rhythmPeriods = listOf(
    RhythmPeriod("Утро", "Воздуха", 6, "🌬", "🜁", "Время «Пневмы» Гомера",
        "Пробуждение мысли и настройка связей.", listOf(
            RhythmWatch(6, "Арес", "Первый бросок", "Энергия волевого импульса. Время встать и заявить права на свой день.", "♂"),
            RhythmWatch(8, "Афродита", "Красота воплощения", "Забота о теле, эстетика быта и первый вкус жизни.", "♀"),
            RhythmWatch(10, "Гермес", "Летящее слово", "Час вестника: коммуникации, почта, обмен информацией.", "☿"))),
    RhythmPeriod("День", "Огня", 12, "🔥", "🜂", "Время «Логоса» Гераклита",
        "Максимальная трансформация материи в результат.", listOf(
            RhythmWatch(12, "Артемида", "Зенит защиты", "Удержание фокуса и границ эффективности в пик дневного зноя.", "☾"),
            RhythmWatch(14, "Аполлон", "Лик ясности", "Время солнца и чистого разума. Час для принятия ключевых решений.", "☀"),
            RhythmWatch(16, "Деметра", "Жатва момента", "Упорядочивание и шлифовка того, что было сделано за день.", "⚘"))),
    RhythmPeriod("Вечер", "Воды", 18, "💧", "🜄", "Время «Катарсиса» Аристотеля",
        "Очищение чувств и спуск во внутренний мир.", listOf(
            RhythmWatch(18, "Гефест", "Закалка баланса", "Вечерняя кузня: переплавка дневного опыта в мудрость покоя.", "⚒"),
            RhythmWatch(20, "Афина", "Зоркость совы", "Глубокий анализ смыслов, скрытых за дневной суетой.", "⚴"),
            RhythmWatch(22, "Зевс", "Закон и Итог", "Час высшего суда над собой и утверждение планов на завтра.", "♃"))),
    RhythmPeriod("Ночь", "Земли", 0, "⛰", "🜃", "Время «Корней» Гесиода",
        "Глубина подсознания и восстановление основ.", listOf(
            RhythmWatch(0, "Гестия", "Центр Очага", "Точка абсолютной стабильности и охраны внутреннего огня души.", "🕯"),
            RhythmWatch(2, "Гера", "Небесный Порядок", "Время глубокой структуры сна и восстановления иерархии психики.", "♛"),
            RhythmWatch(4, "Посейдон", "Океан Предбытия", "Растворение старых форм перед новым рождением на рассвете.", "Ψ")))
)

internal data class RhythmPalette(val accent: Color, val deep: Color)

/** The four element tones are the same colors as .rhythm-air/fire/water/earth on the site. */
internal fun rhythmPalette(period: RhythmPeriod): RhythmPalette = when (period.start) {
    6 -> RhythmPalette(Color(0xff83b9b7), Color(0xff15363b))
    12 -> RhythmPalette(Color(0xffe39348), Color(0xff432719))
    18 -> RhythmPalette(Color(0xff6d9fc2), Color(0xff172d43))
    else -> RhythmPalette(Color(0xffb6a477), Color(0xff312e26))
}

@Composable
fun DayRhythmPanel(use24Hour: Boolean) {
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) { DayRhythmContent(use24Hour) }
}

@Composable
private fun DayRhythmContent(use24Hour: Boolean) {
    if (!LocalSacredFeaturesEnabled.current) return
    val zone = remember { ZoneId.systemDefault() }
    var now by remember { mutableStateOf(LocalTime.now(zone)) }
    LaunchedEffect(zone) { while (true) { now = LocalTime.now(zone); delay(1_000) } }
    val period = rhythmPeriods.firstOrNull {
        if (it.start == 0) now.hour < 6 else now.hour in it.start until (it.start + 6)
    } ?: rhythmPeriods.last()
    val watch = period.watches.first { now.hour in it.start until (it.start + 2) }
    var expanded by remember { mutableStateOf(false) }
    var inspected by remember { mutableStateOf<String?>(null) }
    val selected = rhythmPeriods.firstOrNull { it.name == inspected } ?: period
    val palette = rhythmPalette(period)
    val parchment = Color(0xfff6efdf)
    val muted = Color(0xffbdc9c5)
    val clockPattern = if (use24Hour) "HH:mm:ss" else "h:mm:ss a"
    fun hourLabel(hour: Int): String = LocalTime.of(hour % 24, 0)
        .format(DateTimeFormatter.ofPattern(if (use24Hour) "HH:mm" else "h:mm a"))

    val elapsedSeconds = (now.hour - watch.start) * 3_600 + now.minute * 60 + now.second
    val remainingSeconds = 7_200 - elapsedSeconds
    Card(Modifier.fillMaxWidth().testTag("today-day-rhythm"),
        shape = AffairsLayout.shape, border = BorderStroke(1.dp, palette.accent.copy(alpha = .55f)),
        colors = CardDefaults.cardColors(containerColor = palette.deep)) {
        Box(Modifier.fillMaxWidth().background(Brush.linearGradient(
            listOf(palette.deep, Color(0xff07171b), palette.deep)))) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    GenesisLucideIcon("sun", Modifier.size(24.dp), tint = palette.accent)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Сакральное время", Modifier.testTag("day-rhythm-title"), color = parchment,
                            style = MaterialTheme.typography.titleMedium)
                        Text("${period.name} · ${watch.deity}", color = parchment,
                            style = MaterialTheme.typography.bodyMedium)
                        Text("${hourLabel(watch.start)}–${hourLabel(watch.start + 2)} · ${watch.title}",
                            color = muted, style = MaterialTheme.typography.bodySmall)
                    }
                    val expandLabel = genesisTranslate(if (expanded) "Свернуть ритм суток" else "Развернуть ритм суток")
                    IconButton(onClick = { expanded = !expanded },
                        modifier = Modifier.size(48.dp).testTag("day-rhythm-expand")
                            .semantics { contentDescription = expandLabel }) {
                        GenesisLucideIcon(if (expanded) "chevron-up" else "chevron-down", tint = palette.accent)
                    }
                }
                if (expanded) {
                    HorizontalDivider(color = palette.accent.copy(alpha = .38f))
                    Surface(color = Color(0x19ffffff), shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, palette.accent.copy(alpha = .42f))) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Surface(Modifier.size(52.dp), shape = CircleShape, color = palette.accent) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Text(watch.symbol, color = Color(0xff07171b),
                                            style = MaterialTheme.typography.headlineSmall)
                                    }
                                }
                                Column(Modifier.weight(1f)) {
                                    Text("${hourLabel(watch.start)}–${hourLabel(watch.start + 2)} · ${period.symbol} ${period.name}",
                                        color = palette.accent, style = MaterialTheme.typography.labelMedium)
                                    Text("${watch.deity} · «${watch.title}»", color = parchment,
                                        style = MaterialTheme.typography.titleMedium)
                                }
                            }
                            Text(watch.description, color = muted, style = MaterialTheme.typography.bodyMedium)
                            LinearProgressIndicator(progress = { (elapsedSeconds / 7_200f).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth(), color = palette.accent,
                                trackColor = Color(0x33ffffff))
                            Text("До смены часа · ${remainingSeconds / 60}:${(remainingSeconds % 60).toString().padStart(2, '0')}",
                                color = palette.accent, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    Text("Двенадцать двухчасовых периодов", color = parchment,
                        style = MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        rhythmPeriods.forEach { family ->
                            val tone = rhythmPalette(family)
                            family.watches.forEach { item ->
                                val current = item == watch
                                Surface(Modifier.width(60.dp).height(58.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    color = if (current) tone.accent else tone.accent.copy(alpha = .13f),
                                    border = BorderStroke(1.dp, tone.accent.copy(alpha = if (current) 1f else .42f))) {
                                    Column(Modifier.padding(5.dp), verticalArrangement = Arrangement.SpaceBetween) {
                                        Text(item.symbol, color = if (current) Color(0xff07171b) else tone.accent,
                                            style = MaterialTheme.typography.titleMedium)
                                        Text(hourLabel(item.start), color = if (current) Color(0xff07171b) else parchment,
                                            style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                    Text("Периоды суток", color = parchment, style = MaterialTheme.typography.titleSmall)
                    rhythmPeriods.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            pair.forEach { option ->
                                val tone = rhythmPalette(option)
                                val chosen = selected == option
                                Card(onClick = { inspected = option.name }, modifier = Modifier.weight(1f)
                                    .heightIn(min = 92.dp).testTag("rhythm-period-${option.start}").semantics { this.selected = chosen },
                                    colors = CardDefaults.cardColors(containerColor = selectedControlContainer(chosen,
                                        fallback = tone.accent.copy(alpha = .1f))),
                                    border = selectedControlBorder(chosen, fallback = BorderStroke(1.dp, tone.accent.copy(alpha = .36f)))) {
                                    Column(Modifier.padding(9.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        val selectionInk = if (chosen) selectedControlColors().content else parchment
                                        val detailInk = if (chosen) selectionInk else tone.accent
                                        Text("${option.symbol} ${option.name}", color = selectionInk,
                                            style = MaterialTheme.typography.titleSmall)
                                        Text("${hourLabel(option.start)}–${hourLabel(option.start + 6)}",
                                            color = detailInk, style = MaterialTheme.typography.labelSmall)
                                        Text("Стихия ${option.element}${if (option == period) " · Сейчас" else ""}",
                                            color = detailInk, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                    val selectedTone = rhythmPalette(selected)
                    Surface(color = selectedTone.accent.copy(alpha = .12f),
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, selectedTone.accent.copy(alpha = .55f))) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${selected.alchemy} ${selected.name.uppercase()} · СТИХИЯ ${selected.element.uppercase()}",
                                color = selectedTone.accent, style = MaterialTheme.typography.labelLarge)
                            Text(selected.source, color = parchment, style = MaterialTheme.typography.titleMedium)
                            Text(selected.description, color = muted, style = MaterialTheme.typography.bodyMedium)
                            if (selected != period) TextButton(onClick = { inspected = null },
                                colors = ButtonDefaults.textButtonColors(contentColor = selectedTone.accent)) {
                                Text("Вернуться к текущему")
                            }
                            selected.watches.forEach { item ->
                                Surface(color = Color(0x22000000), shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, selectedTone.accent.copy(alpha = .25f))) {
                                    Column(Modifier.padding(9.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Text("${item.symbol} ${hourLabel(item.start)}–${hourLabel(item.start + 2)} · ${item.deity} · «${item.title}»",
                                            color = selectedTone.accent, style = MaterialTheme.typography.labelMedium)
                                        Text(item.description, color = muted,
                                            style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
