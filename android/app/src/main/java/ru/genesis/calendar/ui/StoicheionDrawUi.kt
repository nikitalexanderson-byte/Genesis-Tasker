package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import java.security.SecureRandom
import kotlin.math.hypot
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.min
import ru.genesis.calendar.data.StoicheionDraw
import ru.genesis.calendar.data.StoicheionDraws
import ru.genesis.calendar.domain.StoicheionReading

internal data class StoicheionPosition(val id: String, val direction: String, val meaning: String)

/** Site order is clockwise within the 3×3 cosmic square, with the center in slot five. */
internal val stoicheionPositions = listOf(
    StoicheionPosition("northwest", "Северо-запад", "Мир границ, переходов и рискованных действий. Скрытые угрозы или внезапные прорывы."),
    StoicheionPosition("north", "Север", "Мир ужаса или глубокого познания. Способность вкушать опыт и переваривать сложные ситуации."),
    StoicheionPosition("northeast", "Северо-восток", "Мир завершения, смерти старого и рождения нового. Интуитивное чутьё и материальные ценности."),
    StoicheionPosition("west", "Запад", "Мир опьянения, иллюзий и глубокого видения. Зависимости и способность видеть истину сквозь морок."),
    StoicheionPosition("center", "Центр", "Духовность, координация всех сфер и связь с вечностью. Точка сборки всей ситуации."),
    StoicheionPosition("east", "Восток", "Мир магии, созидания и интеллекта. Здесь, подобно восходящему Солнцу, зарождаются идеи и планы."),
    StoicheionPosition("southwest", "Юго-запад", "Мир ярости, скрытых возможностей и трансформации через страдание. Сектор преодоления препятствий."),
    StoicheionPosition("south", "Юг", "Мир войны, активной деятельности и логического ума. Дисциплина, борьба и прямое действие."),
    StoicheionPosition("southeast", "Юго-восток", "Мир дикой природы и проявления Эго. Инстинкты, первичные импульсы и необузданная сила."),
)

internal data class StoicheionSelection(val letter: StoicheionLetter, val reversed: Boolean? = null,
    val position: StoicheionPosition? = null, val timePosition: StoicheionTimePosition? = null)

private fun orientation(reversed: Boolean) = if (reversed) "Перевёрнутое положение" else "Парадное положение"
@Composable internal fun stoicheionCardSurface(reversed: Boolean, upright: Color = MaterialTheme.colorScheme.surface): Color =
    if (!reversed) upright else if (LocalEveningTheme.current) stoicheionDarkReversedColor(LocalDarkPalette.current) else MaterialTheme.colorScheme.errorContainer
private fun countdown(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

@Composable
internal fun StoicheionDrawPanel(letters: List<StoicheionLetter>, draws: StoicheionDraws?, now: Long,
    busy: Boolean, error: String?, onBegin: (String) -> Unit, onSelect: (StoicheionSelection) -> Unit,
    restorationLabel: String? = null, onRestore: (() -> Unit)? = null,
    restorationError: Boolean = false, onReloadRestoration: () -> Unit = {}, onRefresh: (() -> Unit)? = null) {
    val spreadAllowed=LocalFeatureAccess.current.allows("stoicheion-spread")
    val restorationAllowed=LocalFeatureAccess.current.allows("stoicheion-restoration")
    val daily = draws?.daily
    val dailyLetter = daily?.let { StoicheionReading.cardOfDay(letters, it.seed) }
    val spread = draws?.spread
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        error?.let {
            Column(Modifier.fillMaxWidth().testTag("stoicheion-sync-error"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(it, color = MaterialTheme.colorScheme.error)
                if (onRefresh != null) OutlinedButton(onClick = onRefresh, enabled = !busy,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("stoicheion-sync-retry")) { Text("Обновить") }
            }
        }
        StoicheionSection(OracleTone.GOLD, "stoicheion-daily-block") {
            Text("Карта дня", style = MaterialTheme.typography.titleLarge)
            Text("Один из 24 авторских образов на сегодня. Выбор сохраняется на этом устройстве.",
                style = MaterialTheme.typography.bodyMedium)
            if (dailyLetter == null) {
                Button(onClick = { onBegin("daily") }, enabled = draws != null && !busy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("stoicheion-draw-daily")) {
                    Text("Начать выбор карты дня")
                }
            } else {
                val reversed = StoicheionReading.reversed(daily.seed)
                Card(onClick = { onSelect(StoicheionSelection(dailyLetter, reversed)) },
                    colors = CardDefaults.cardColors(containerColor = stoicheionCardSurface(reversed, Color.Transparent)),
                    modifier = Modifier.fillMaxWidth().testTag("stoicheion-daily-result")) {
                    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StoicheionCardFace(dailyLetter, Modifier.width(106.dp)
                            .graphicsLayer { rotationZ = if (reversed) 180f else 0f })
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(dailyLetter.name, style = MaterialTheme.typography.titleMedium)
                            Text(dailyLetter.tagline, style = MaterialTheme.typography.bodySmall)
                            Text(orientation(reversed), style = MaterialTheme.typography.labelMedium)
                            Text("Открыть полный профиль", color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                RerollAction(daily, now, busy, "Перебросить карту") { onBegin("daily") }
            }
        }
        if (dailyLetter != null) {
            val cards = spread?.let { StoicheionReading.spread(letters, it.seed) }
            StoicheionSection(OracleTone.BLUE, "stoicheion-spread-block") {
                Text("Космический круг и девять ликов силы", style = MaterialTheme.typography.titleLarge)
                Text("Девять букв соотносятся со сторонами света и центром. Расклад начинается с карты дня и вашего движения.",
                    style = MaterialTheme.typography.bodyMedium)
                if (!spreadAllowed) NativeUpgradePrompt("stoicheion-spread")
                if (cards == null) {
                    Button(onClick = { onBegin("spread") }, enabled = !busy && spreadAllowed,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("stoicheion-draw-spread")) {
                        Text("Начать расклад")
                    }
                } else {
                    stoicheionPositions.chunked(3).forEachIndexed { row, positions ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            positions.forEachIndexed { column, position ->
                                val (letter, reversedCard) = cards[row * 3 + column]
                                Card(onClick = { onSelect(StoicheionSelection(letter, reversedCard, position)) },
                                    colors = CardDefaults.cardColors(containerColor = stoicheionCardSurface(reversedCard)),
                                    modifier = Modifier.weight(1f).testTag("stoicheion-spread-${position.id}")) {
                                    Column(Modifier.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text(position.direction, style = MaterialTheme.typography.labelSmall, maxLines = 2)
                                        StoicheionCardFace(letter, Modifier.fillMaxWidth()
                                            .graphicsLayer { rotationZ = if (reversedCard) 180f else 0f })
                                        Text("${letter.name} · ${letter.value}", style = MaterialTheme.typography.labelSmall, maxLines = 2)
                                        Text(orientation(reversedCard), style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (spread != null && cards != null) {
                StoicheionSection(OracleTone.MAUVE, "stoicheion-restoration-block") {
                    Text("Решение ситуации", style = MaterialTheme.typography.titleLarge)
                    Column(Modifier.testTag("stoicheion-isopsephy"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val total = cards.sumOf { it.first.value }
                        Text("ἰσοψηφία · Пифмен расклада", style = MaterialTheme.typography.titleMedium)
                        androidx.compose.material3.Surface(Modifier.fillMaxWidth().testTag("stoicheion-sum-details"),
                            color=MaterialTheme.colorScheme.surfaceContainerHigh,shape=AffairsLayout.shape,
                            border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)){
                            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                                Text("${cards.joinToString(" + ") { it.first.value.toString() }} = $total")
                                Text("${StoicheionReading.trace(total).joinToString(" → ")} · ${StoicheionReading.pythmen(total)}",
                                    style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                        Text("Числовые значения девяти букв складываются до корня от 1 до 9.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    // Keep the entry visible even for an all-upright spread; the journey explains that state.
                    Button(onClick = { onRestore?.invoke() }, enabled = restorationAllowed && onRestore != null && !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stoicheion-restoration-begin")) {
                        Text(restorationLabel ?: "Начать восполнение")
                    }
                    if (restorationError) {
                        Text("Не удалось открыть восполнение. Повторите загрузку.", color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onReloadRestoration, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Повторить загрузку")
                        }
                    }
                    RerollAction(spread, now, busy || !spreadAllowed, "Перебросить расклад", tone = OracleTone.MAUVE) { onBegin("spread") }
                }
            }
        }
        StoicheionTimelinePanel(letters, draws?.timeline, draws != null, now, busy,
            onBegin = { onBegin("timeline") }, onSelect = onSelect)
    }
}

internal enum class OracleTone { GOLD, BLUE, MAUVE, SAGE, CLAY }

@Composable internal fun oracleSectionColor(tone: OracleTone): Color {
    val pair = when (tone) {
        OracleTone.GOLD -> 0xfff2e8d3 to 0xff302a1e
        OracleTone.BLUE -> 0xffe0eaf0 to 0xff202e36
        OracleTone.MAUVE -> 0xffede3ed to 0xff302632
        OracleTone.SAGE -> 0xffdfede4 to 0xff1b3029
        OracleTone.CLAY -> 0xffeee2d9 to 0xff332923
    }
    return Color(if (LocalEveningTheme.current) pair.second else pair.first)
}

@Composable internal fun StoicheionSection(tone: OracleTone, tag: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape, color = oracleSectionColor(tone)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
internal fun RerollAction(draw: StoicheionDraw, now: Long, busy: Boolean, label: String,
    tone: OracleTone? = null, onClick: () -> Unit) {
    if (draw.canReroll(now) && tone == OracleTone.MAUVE) Button(onClick = onClick, enabled = !busy,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (LocalEveningTheme.current) Color(0xff554058) else Color(0xff604966),
            contentColor = Color(0xfffff5ff), disabledContainerColor = Color(0xff57495a),
            disabledContentColor = Color(0xffe1d7e2)),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stoicheion-reroll-${draw.kind}")) {
        Text(if(draw.unlimited) label else "$label · ${countdown(draw.remainingSeconds(now))}")
    } else if (draw.canReroll(now)) OutlinedButton(onClick = onClick, enabled = !busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stoicheion-reroll-${draw.kind}")) {
        Text(if(draw.unlimited) label else "$label · ${countdown(draw.remainingSeconds(now))}")
    } else Text(if (draw.attempts == 2) "Переброс на сегодня использован"
        else if(draw.kind=="daily") "Выбор закреплён до завтра" else "Расклад сохранён до следующей недели", style = MaterialTheme.typography.bodySmall)
}

@Composable
internal fun StoicheionMotionDialog(mode: String, busy: Boolean, onCancel: () -> Unit,
    onFinish: (Long) -> Unit) {
    var travel by remember(mode) { mutableFloatStateOf(0f) }
    var seed by remember(mode) { mutableLongStateOf(SecureRandom().nextInt().toUInt().toLong()) }
    var submitted by remember(mode) { mutableStateOf(false) }
    var pointer by remember(mode) { mutableStateOf(Offset.Unspecified) }
    val density = LocalDensity.current.density
    val motionDescription = genesisTranslate("Поле движения для случайного выбора")
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(.92f).padding(12.dp),
            shape = RoundedCornerShape(22.dp), color = Color(0xff071d20)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    val timelineCopy = if (mode == "timeline") stoicheionTimelineCopy() else null
                    Text(when (mode) { "daily" -> "Проведите рукой над знаками"
                        "timeline" -> timelineCopy!!.getString("motion"); else -> "Соберите девять ликов движением" },
                        Modifier.weight(1f), style = MaterialTheme.typography.titleLarge,
                        color = Color(0xfffffcf6))
                    AffairsIconButton("Закрыть", AffairsAction.CLOSE, onCancel, contentColor = Color(0xffdfc17e))
                }
                Text("Проведите пальцем несколько раз. Движение создаёт зерно расклада.",
                    color = Color(0xfffffcf6), style = MaterialTheme.typography.bodyMedium)
                Box(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(16.dp))
                    .background(eveningSurface(Color(0xff15413d)))
                    .pointerInput(mode, busy) {
                        detectDragGestures { change, drag ->
                            change.consume()
                            if (!submitted && !busy) {
                                pointer = change.position
                                travel = (travel + (hypot(drag.x, drag.y) / density).coerceAtMost(70f))
                                    .coerceAtMost(4480f)
                                seed = StoicheionReading.mix(seed,
                                    change.position.x / size.width * 100f,
                                    change.position.y / size.height * 100f, System.nanoTime())
                                if (travel >= 4480f) { submitted = true; onFinish(seed) }
                            }
                        }
                    }
                    .semantics { contentDescription = motionDescription }
                    .testTag("stoicheion-motion-field"), contentAlignment = Alignment.Center) {
                    Canvas(Modifier.matchParentSize()) {
                        val point = if (pointer.x.isFinite() && pointer.y.isFinite()) pointer
                            else Offset(size.width / 2, size.height / 2)
                        drawCircle(Brush.radialGradient(listOf(Color(0x99dfc17e), Color(0x22245d59),
                            Color.Transparent), center = point, radius = size.minDimension * .58f),
                            radius = size.minDimension * .58f, center = point)
                        listOf(.24f, .36f, .45f).forEach { fraction ->
                            drawCircle(Color(0x88dfc17e), radius = size.minDimension * fraction,
                                style = Stroke(1.dp.toPx()))
                        }
                    }
                    BoxWithConstraints(Modifier.matchParentSize()) {
                        val orbit = min(maxWidth.value, maxHeight.value) * .34f
                        val symbols = listOf("Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ",
                            "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω")
                        symbols.forEachIndexed { index, symbol ->
                            val angle = index * Math.PI * 2 / symbols.size - Math.PI / 2 + travel / 240f
                            Text(symbol, Modifier.offset(
                                x = (maxWidth.value / 2 + cos(angle).toFloat() * orbit - 7).dp,
                                y = (maxHeight.value / 2 + sin(angle).toFloat() * orbit - 9).dp)
                                .testTag("stoicheion-orbit-$index"),
                                color = Color(0xffdfc17e), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    Surface(shape = RoundedCornerShape(100.dp), color = Color(0xd9071d20)) {
                        Text("${(travel / 44.8f).toInt()}%", Modifier.padding(20.dp),
                            color = Color(0xfffffcf6), style = MaterialTheme.typography.headlineLarge)
                    }
                }
                LinearProgressIndicator(progress = { travel / 4480f }, modifier = Modifier.fillMaxWidth(),
                    color = Color(0xffdfc17e), trackColor = Color(0x665b756e))
                Text("${(travel / 44.8f).toInt()}% · ${if (travel < 1568f) "Пробуждение поля"
                    else if (travel < 3360f) "Знаки смешиваются" else "Образ почти проявился"}",
                    color = Color(0xfffffcf6), style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = {
                    if (!submitted) { submitted = true; onFinish(SecureRandom().nextInt().toUInt().toLong()) }
                }, enabled = !busy && !submitted,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xffdfc17e)),
                    border = BorderStroke(1.dp, Color(0xffdfc17e)),
                    modifier = Modifier.fillMaxWidth().testTag("stoicheion-accessible-draw")) {
                    Text("Выбрать без жеста")
                }
                Text("Доступный способ выбора для управления без движения пальцем.",
                    color = Color(0xffdfc17e), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
