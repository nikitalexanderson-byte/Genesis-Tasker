package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import ru.genesis.calendar.domain.TheokyklosPractice
import ru.genesis.calendar.domain.TheokyklosSector
import ru.genesis.calendar.domain.StoicheionRestorationCatalogSource
import ru.genesis.calendar.domain.StoicheionRestoration
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.HabitReminder
import ru.genesis.calendar.domain.habits.HabitPracticeGoal
import ru.genesis.calendar.domain.habits.TrackerEntity
import java.time.LocalDate
import kotlin.math.cos
import kotlin.math.sin

private val night = Color(0xff071d20)
private val pine = Color(0xff103632)
private val jade = Color(0xff245d59)
private val cream = Color(0xfffffcf6)
private val gold = Color(0xffdfc17e)

@Composable
fun TheokyklosScreen(app: GenesisApplication, calendarMode: CalendarMode, onOpenHabits: () -> Unit,
    initialSectorId: String? = null, onInitialSectorConsumed: () -> Unit = {}, onOpenStoicheion: () -> Unit = {}) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val english = language == "en"
    val catalog = remember(context, language) { runCatching { TheokyklosCatalogSource.load(context, language) } }
    val repository = remember(app) { HabitsRepository(app) }
    var workspace by remember { mutableStateOf<LocalHabitWorkspace?>(null) }
    var storageError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(initialSectorId) {
        if (initialSectorId != null) {
            selectedId = initialSectorId
            onInitialSectorConsumed()
        }
    }

    LaunchedEffect(repository) {
        try { repository.workspace.collect { workspace = it; storageError = null } }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { storageError = "Защищённые привычки недоступны. Практики можно читать, но изменения не сохраняются." }
    }
    val data = catalog.getOrNull()
    if (data == null) {
        Text("Не удалось открыть каталог Теокиклоса.", color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(16.dp))
        return
    }
    val selected = selectedId?.let(data.byId::get)
    val headerTitle = if (english) "Oracle · Theokyklos" else "Оракул · Теокиклос"
    val headerDescription = if (english) "Circle of divine powers" else "Круг божественных сил"
    val headerInShell = WorkspaceScreenHeader(headerTitle, headerDescription)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val diagram: @Composable () -> Unit = {
        if (!headerInShell) GenesisPageHeader(if (english) "Oracle - Theokyklos" else "Оракул - Теокиклос",
            headerDescription, "Θ",
            animatedMandala = true, icon = GenesisPageIcon.THEOKYKLOS)
        Text("Круг божественных сил", style = MaterialTheme.typography.titleLarge)
        Text("Коснитесь любого направления, полюса, очага, центра или врат.",
            style = MaterialTheme.typography.bodySmall)
        TheokyklosMandala(data.sectors, english) { selectedId = it }
        }
        val sectors: @Composable () -> Unit = {
        Text("Ось, врата и ядро", style = MaterialTheme.typography.titleMedium)
        listOf("zenith", "nadir", "entrance", "exit", "center", "hearth").chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { id ->
                    val sector = data.byId.getValue(id)
                    SectorCard(sector, english, Modifier.weight(1f)) { selectedId = id }
                }
            }
        }
        Text("Восемь направлений", style = MaterialTheme.typography.titleMedium)
        data.sectors.take(8).chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { sector -> SectorCard(sector, english, Modifier.weight(1f)) { selectedId = sector.id } }
            }
        }
        NativeFeatureGate("theokyklos-olympians", if(english)
            "The 13 Olympians and their sacred numbers are available with Standard and above."
            else "13 олимпийцев и их сакральные числа доступны в Standard и выше.") { OlympianIsopsephy(onOpenStoicheion) }
        }
        if (maxWidth >= 840.dp) Row(Modifier.fillMaxSize().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(Modifier.weight(1.2f).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { diagram() }
            Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) { sectors() }
        } else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) { diagram(); sectors() }
    }
    if (selected != null) {
        TheokyklosDetail(
            sector = selected, practices = data.practicesFor(selected.id), workspace = workspace, english = english,
            storageError = storageError, actionError = actionError, busy = busy,
            onClose = { selectedId = null; actionError = null },
            onOpenHabits = { selectedId = null; onOpenHabits() },
            onPractice = { practice, existing, action ->
                scope.launch {
                    busy = true
                    actionError = null
                    try {
                        when (action) {
                            "begin" -> repository.save(practice.toHabit(calendarMode, english))
                            "pause" -> repository.save(requireNotNull(existing).copy(active = false))
                            "resume" -> repository.save(requireNotNull(existing).copy(active = true))
                            "restore-default" -> repository.save(restoreSacredHabitContent(requireNotNull(existing), practice, english))
                            "complete" -> repository.complete(requireNotNull(existing).id,
                                workspace?.completions?.firstOrNull { it.habitId == existing.id && it.date == LocalDate.now() }?.completed != true)
                        }
                    } catch (error: CancellationException) { throw error }
                    catch (error: Exception) { actionError = error.message ?: "Не удалось сохранить практику." }
                    finally { busy = false }
                }
            },
        )
    }
}

@Composable
private fun SectorCard(sector: TheokyklosSector, english: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = modifier.heightIn(min = 82.dp)
        .testTag("theokyklos-card-${sector.id}"),
        shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OriginalImage(sector.symbolArt, null, Modifier.size(36.dp))
            Spacer(Modifier.width(6.dp))
            Column {
                Text(sector.cardTitle(english), style = MaterialTheme.typography.labelMedium)
                Text(if (english) sector.patrons.en else sector.patrons.ru,
                    style = MaterialTheme.typography.bodySmall, maxLines = 2)
            }
        }
    }
}

private fun TheokyklosSector.cardTitle(english: Boolean): String = when (id) {
    "center" -> if (english) "Center" else "Центр"
    "hearth" -> if (english) "Hearth" else "Очаг"
    else -> (if (english) title.en else title.ru).substringBefore(" · ").lowercase().replaceFirstChar { it.titlecase() }
}

/** The 14 visible touch nodes preserve the website's eight directions, vertical axis and thresholds. */
@Composable
private fun TheokyklosMandala(sectors: List<TheokyklosSector>, english: Boolean, onSelect: (String) -> Unit) {
    val hearthDescription = if (english) "Hearth, Hestia" else "Очаг, Гестия"
    val customPalette = LocalEveningTheme.current && LocalDarkPalette.current != "green"
    val innerBackground = if (customPalette) MaterialTheme.colorScheme.surfaceContainerLowest else night
    val ringBackground = if (customPalette) MaterialTheme.colorScheme.surfaceContainerHigh else jade
    BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(16.dp))
        .background(eveningSurface(cream)).testTag("theokyklos-mandala")) {
        Canvas(Modifier.fillMaxSize()) {
            val unit = size.width
            val center = Offset(unit * .5f, unit * .49f)
            drawCircle(innerBackground, radius = unit * .345f, center = center)
            drawCircle(ringBackground, radius = unit * .292f, center = center)
            drawCircle(gold, radius = unit * .345f, center = center, style = Stroke(unit * .004f))
            drawCircle(innerBackground, radius = unit * .19f, center = center)
            drawCircle(gold.copy(alpha = .85f), radius = unit * .19f, center = center,
                style = Stroke(unit * .003f))
            for (index in 0 until 8) {
                val angle = Math.toRadians((-90 + index * 45).toDouble())
                val direction = Offset(cos(angle).toFloat(), sin(angle).toFloat())
                drawLine(gold.copy(alpha = .38f), center + direction * (unit * .19f),
                    center + direction * (unit * .345f), unit * .0025f, cap = StrokeCap.Round)
            }
            drawLine(gold.copy(alpha = .45f), Offset(unit * .5f, unit * .02f),
                Offset(unit * .5f, unit * .98f), unit * .003f)
        }
        // The hearth is the inner ring itself, not an extra deity icon above the center.
        Box(Modifier.offset(maxWidth * .5f - 64.dp, maxWidth * .49f - 64.dp)
            .size(128.dp)
            .clickable { onSelect("hearth") }
            .genesisDescription(hearthDescription).semantics { role = Role.Button }
            .testTag("theokyklos-sector-hearth"), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val center = Offset(size.width / 2f, size.height / 2f)
                val radius = size.minDimension * .34f
                for (index in 0 until 40) {
                    val angle = index * 2 * Math.PI / 40
                    drawCircle(gold, radius = 1.8.dp.toPx(),
                        center = center + Offset(cos(angle).toFloat(), sin(angle).toFloat()) * radius)
                }
            }
        }
        sectors.filterNot { it.id == "hearth" }.forEach { sector ->
            val (x, y) = mandalaPosition(sector)
            val description = if (english) "${sector.title.en}, ${sector.patrons.en}"
                else "${sector.title.ru}, ${sector.patrons.ru}"
            Box(Modifier.offset(maxWidth * x - 32.dp, maxWidth * y - 32.dp)
                .size(64.dp)
                .clickable { onSelect(sector.id) }
                .semantics { role = Role.Button; contentDescription = description }
                .testTag("theokyklos-sector-${sector.id}"),
                contentAlignment = Alignment.Center) {
                OriginalImage(sector.symbolArt, null, Modifier.size(52.dp))
            }
        }
    }
}

private fun mandalaPosition(sector: TheokyklosSector): Pair<Float, Float> {
    return when (sector.id) {
        // All four threshold nodes use the same orbit around the great circle.
        // Entrance/exit share the west–centre–east axis: entrance by the east sector,
        // exit by the west sector.
        "zenith" -> .5f to .075f
        "nadir" -> .5f to .905f
        "entrance" -> .915f to .49f
        "exit" -> .085f to .49f
        "center" -> .5f to .49f
        else -> {
            val angle = Math.toRadians(requireNotNull(sector.angle).toDouble())
            (.5f + cos(angle).toFloat() * .245f) to (.49f + sin(angle).toFloat() * .245f)
        }
    }
}

@Composable
private fun TheokyklosDetail(sector: TheokyklosSector, practices: List<TheokyklosPractice>,
    workspace: LocalHabitWorkspace?, storageError: String?, actionError: String?, busy: Boolean, english: Boolean,
    onClose: () -> Unit, onOpenHabits: () -> Unit,
    onPractice: (TheokyklosPractice, Habit?, String) -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val restoration = remember(context, language) {
        runCatching { StoicheionRestorationCatalogSource.load(context, language) }.getOrNull()
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape,
            color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(Modifier.fillMaxWidth().background(eveningSurface(night)).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    OriginalImage(sector.symbolArt, null, Modifier.size(48.dp))
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(if (english) sector.title.en else sector.title.ru,
                            color = cream, style = MaterialTheme.typography.titleLarge)
                        Text(if (english) sector.patrons.en else sector.patrons.ru,
                            color = gold, style = MaterialTheme.typography.bodyMedium)
                    }
                    AffairsIconButton("Закрыть", AffairsAction.CLOSE, onClose, contentColor = cream)
                }
                OriginalImage(sector.art, if (english) "${sector.patrons.en} — ${sector.title.en}"
                    else "${sector.patrons.ru} — ${sector.title.ru}",
                    Modifier.fillMaxWidth().height(190.dp))
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(if (english) sector.essence.en else sector.essence.ru,
                        style = MaterialTheme.typography.titleMedium)
                    Text(if (english) sector.description.en else sector.description.ru,
                        style = MaterialTheme.typography.bodyMedium)
                    restoration?.let { catalog ->
                        val primary = catalog.sectors[sector.id]
                        val auxiliary = catalog.auxiliaries.firstOrNull { it.id == sector.id }
                        if (primary != null || auxiliary != null) Surface(Modifier.fillMaxWidth()
                            .testTag("theokyklos-restoration-context-${sector.id}"),
                            shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(catalog.copy("title"), style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.primary)
                                if (primary != null) {
                                    Text(catalog.copy("field"), style = MaterialTheme.typography.labelLarge)
                                    Text(primary.field, style = MaterialTheme.typography.bodyMedium)
                                    Text(catalog.copy("ambivalence"), style = MaterialTheme.typography.labelLarge)
                                    Text(primary.ambivalence, style = MaterialTheme.typography.bodyMedium)
                                }
                                if (auxiliary != null) {
                                    Text(catalog.copy("supports"), style = MaterialTheme.typography.labelLarge)
                                    Text(auxiliary.purpose, style = MaterialTheme.typography.bodyMedium)
                                    Text("${auxiliary.word} · ${ru.genesis.calendar.domain.StoicheionRestoration.isopsephy(auxiliary.word)}",
                                        style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                                }
                                RestorationFrameworkDisclosure(catalog)
                            }
                        }
                    }
                    HorizontalDivider()
                    Text("Заклинания Божеств", style = MaterialTheme.typography.titleMedium)
                    Text("Произносите каждое слово осознанно, переходя от смысла к звучанию.",
                        style = MaterialTheme.typography.bodySmall)
                    sector.words.forEachIndexed { index, word ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("${index + 1}", color = MaterialTheme.colorScheme.primary)
                            Column {
                                Text(word.greek, fontFamily = GenesisHeadingFont,
                                    style = MaterialTheme.typography.titleMedium)
                                Text(if (english) "“${word.pronunciation.en}” · ${word.meaning.en}"
                                    else "«${word.pronunciation.ru}» · ${word.meaning.ru}",
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    HorizontalDivider()
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("Сакральные привычки", style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = onOpenHabits) { Text("Все привычки →") }
                    }
                    storageError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    practices.forEach { practice ->
                        val existing = standardSacredHabit(workspace?.habits.orEmpty(), practice.id)
                        val completed = existing?.let { habit -> workspace?.completions?.any {
                            it.habitId == habit.id && it.date == LocalDate.now() && it.completed } } == true
                        val scheduled = existing?.let { habit ->
                            runCatching { HabitEngine(GenesisCalendar()).isScheduled(habit, LocalDate.now(), workspace?.completions.orEmpty()) }
                                .getOrDefault(false)
                        } == true
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("${practice.emoji} ${if (english) practice.title.en else practice.title.ru}",
                                    style = MaterialTheme.typography.titleSmall)
                                Text(if (english) practice.description.en else practice.description.ru,
                                    style = MaterialTheme.typography.bodySmall)
                                Text(if (english) practice.myth.en else practice.myth.ru,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if (existing == null) "Рекомендуется ${practice.suggestedTime} · приоритет ${practice.priority}"
                                    else "${if (existing.active) "Активна" else "На паузе"} · " +
                                        (if (scheduled) "запланирована сегодня" else "сегодня не запланирована") +
                                        " · ${existing.preferredTime}",
                                    style = MaterialTheme.typography.labelSmall)
                                if(existing == null) {
                                    UntranslatedText(habitPracticeCopy().getString("warning"), style = MaterialTheme.typography.bodySmall)
                                    Button(onClick = { onPractice(practice, null, "begin") },
                                        enabled = workspace != null && !busy) { Text("Начать") }
                                }
                                else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if(existing.active) {
                                        Button(onClick = { onPractice(practice, existing, "complete") },
                                            enabled = scheduled && !busy) {
                                            Text(if(completed) "Снять отметку" else "Отметить сегодня")
                                        }
                                        TextButton(onClick = { onPractice(practice, existing, "pause") },
                                            enabled = !busy) { Text("Пауза") }
                                    } else OutlinedButton(onClick = { onPractice(practice, existing, "resume") },
                                        enabled = !busy) { Text("Возобновить") }
                                }
                                SacredHabitRestoreAction(existing, practice, busy) {
                                    onPractice(practice, existing, "restore-default")
                                }
                                }
                            }
                        }
                    }
                    TextButton(onClick = onClose) { Text("Закрыть") }
                }
            }
        }
    }
}

internal fun TheokyklosPractice.toHabit(mode: CalendarMode, english: Boolean = false): Habit {
    val today = LocalDate.now()
    val baseSchedule = HabitEngine(GenesisCalendar()).defaultSchedule(today, mode)
    val schedule = StoicheionRestoration.dailySchedule(baseSchedule).let { it.copy(endDate = today.plusDays(1),
        recurrence = it.recurrence.copy(rangeEnd = today.plusDays(1).toString())) }
    return Habit(TrackerEntity.create("habit"), if (english) title.en else title.ru, today, schedule,
        description = if (english) description.en else description.ru, emoji = emoji, priority = priority,
        color = color, sacredPracticeId = id, sacredSectorId = sectorId,
        preferredTime = suggestedTime,
        ritualId = when (suggestedTime.take(2).toIntOrNull() ?: -1) {
            in 0..11 -> "morning"
            in 18..23 -> "evening"
            else -> "day"
        },
        reminder = HabitReminder(time = suggestedTime), practiceGoal = HabitPracticeGoal(startDate = today))
}
