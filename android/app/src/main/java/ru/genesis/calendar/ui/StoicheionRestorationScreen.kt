package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.HabitPracticeGoal
import ru.genesis.calendar.domain.habits.HabitPracticeGoals

internal data class RestorationSource(val date: String, val seed: Long, val cards: List<RestorationDrawCard>)

/** A native route with one scrolling surface. Back returns to the unchanged original draw. */
@Composable
internal fun StoicheionRestorationScreen(source: RestorationSource?, letters: List<StoicheionLetter>,
    catalog: StoicheionRestorationCatalog, theokyklos: TheokyklosCatalog, workspace: LocalHabitWorkspace?,
    repository: HabitsRepository, initialSectorId: String?, initialHabitId: String?, inputCalendarMode: CalendarMode,
    onBack: () -> Unit, onOpenHabits: () -> Unit, onOpenTheokyklos: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val today by produceState(LocalDate.now()) {
        while (true) { delay(60_000L); value = LocalDate.now() }
    }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var deleteCycle by remember { mutableStateOf<Habit?>(null) }
    var habitId by rememberSaveable(initialHabitId) { mutableStateOf(initialHabitId) }
    val savedHabit = StoicheionRestoration.habitById(workspace?.habits.orEmpty(), habitId)
    fun runAction(action: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null
            try { action() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = catalog.copy(when (failure.message) {
                "STOICHEION_RESTORATION_INVALID_SNAPSHOT" -> "invalidSnapshot"
                "STOICHEION_RESTORATION_HABIT_ALREADY_LINKED" -> "alreadyLinked"
                "STOICHEION_RESTORATION_CYCLE_EXISTS" -> "cycleExists"
                else -> "error"
            }) }
            finally { busy = false }
        }
    }
    deleteCycle?.let { candidate -> SavedCycleDeleteDialog(candidate, repository) {
        if (habitId == candidate.id) habitId = null
        deleteCycle = null
    } }
    BackHandler(onBack = onBack)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 840.dp).fillMaxSize().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("restoration-back")) {
                    Text("‹ ${catalog.copy("back")}")
                }
                Text(catalog.copy("title"), Modifier.weight(1f).padding(horizontal = 8.dp), style = MaterialTheme.typography.titleMedium)
            }
            HorizontalDivider()
            if (savedHabit != null && workspace != null) {
                RestorationCycle(savedHabit, workspace, letters, catalog, today, busy, error,
                    onComplete = { runAction { repository.complete(savedHabit.id, true) } },
                    onReflection = { text -> runAction { repository.save(savedHabit.copy(
                        stoicheionRestoration = savedHabit.stoicheionRestoration!!.copy(reflection = text.trim()))) } },
                    onOpenHabits = onOpenHabits)
            } else if (source != null) {
                RestorationJourney(source, letters, catalog, theokyklos, workspace, initialSectorId,
                    busy, error, onOpenTheokyklos, inputCalendarMode, onSave = { habit ->
                        runAction { repository.save(habit); habitId = habit.id }
                    })
            } else {
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item { Text(catalog.copy("history"), style = MaterialTheme.typography.headlineSmall) }
                    StoicheionRestoration.visibleHabits(workspace?.habits.orEmpty()).forEach { habit -> item(key = habit.id) {
                        val snapshot = habit.stoicheionRestoration!!
                        val finite = HabitPracticeGoals.progress(habit,workspace?.completions.orEmpty(),today)
                        val count = finite?.dates?.size ?: StoicheionRestoration.completionDates(snapshot, habit.id, workspace?.completions.orEmpty(), today).size
                        val target = finite?.goal?.requiredCompletions ?: 10
                        OutlinedCard(onClick = { habitId = habit.id }, modifier = Modifier.fillMaxWidth().testTag("restoration-history-${habit.id}")) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(catalog.sectors.getValue(snapshot.sectorId).title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                                    AffairsIconButton("Удалить цикл", AffairsAction.DELETE, { deleteCycle = habit },
                                        Modifier.testTag("restoration-delete-cycle-${habit.id}"), enabled = !busy, contentColor = MaterialTheme.colorScheme.error, outlined = false)
                                }
                                Text("${snapshot.sourceDate} · ${letters.first { it.id == snapshot.letterId }.name}")
                                Text("${habit.emoji} ${habit.title}", style = MaterialTheme.typography.bodySmall)
                                Text("${catalog.copy(if (count == target) "completed" else "progress")} · $count/$target",
                                    color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    } }
                }
            }
        }
    }
}

@Composable
internal fun RestorationJourney(source: RestorationSource, letters: List<StoicheionLetter>,
    catalog: StoicheionRestorationCatalog, theokyklos: TheokyklosCatalog, workspace: LocalHabitWorkspace?,
    initialSectorId: String?, busy: Boolean, error: String?, onOpenTheokyklos: (String) -> Unit,
    inputCalendarMode: CalendarMode = CalendarMode.SACRED,
    onSave: (Habit) -> Unit) {
    val english = LocalGenesisLanguage.current != "ru"
    val reversed = source.cards.mapIndexedNotNull { index, card ->
        if (card.reversed) StoicheionRestoration.positions[index] else null
    }
    var selectedId by rememberSaveable(source.date, source.seed) {
        mutableStateOf(initialSectorId?.takeIf { it in reversed } ?: reversed.firstOrNull())
    }
    var stage by rememberSaveable(source.date, source.seed, selectedId) { mutableIntStateOf(0) }
    var reached by rememberSaveable(source.date, source.seed, selectedId) { mutableIntStateOf(0) }
    BackHandler(enabled = stage > 0) { stage -= 1 }
    val sector = selectedId?.let { catalog.sectors.getValue(it) }
    if (sector == null) {
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(catalog.copy("allUpright")) }
            item { OutlinedButton(onClick = { onOpenTheokyklos("center") }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (english) theokyklos.byId.getValue("center").title.en else theokyklos.byId.getValue("center").title.ru)
            } }
        }
        return
    }
    val card = source.cards[StoicheionRestoration.positions.indexOf(sector.id)]
    val letter = letters.first { it.id == card.letterId }
    val focus = catalog.letterFoci.getValue(letter.id)
    var needId by rememberSaveable(source.date, source.seed, selectedId) { mutableStateOf("conflict") }
    val need = sector.needs.getValue(needId)
    val letterNeed = focus.needs.getValue(needId)
    var supportIds by rememberSaveable(source.date, source.seed, selectedId, needId) { mutableStateOf(listOf(need.supportId)) }
    val total = source.cards.sumOf { StoicheionRestoration.lettersById.getValue(it.letterId).value }
    val equation = remember(letter.id, total, supportIds) { StoicheionRestoration.equation(letter.value, total, supportIds) }
    var resourceId by rememberSaveable(source.date, source.seed, selectedId, needId, supportIds) {
        mutableStateOf<String?>(null)
    }
    val resource = letters.firstOrNull { it.id == resourceId && equation.candidates.any { candidate -> candidate.id == it.id } }
    val resourceText = resource?.let { "${it.symbol} · ${it.name}: ${catalog.letterFoci.getValue(it.id).quality}" }.orEmpty()
    val practiceText = listOf(need.practice, letterNeed.practice, resourceText).filter(String::isNotBlank).joinToString("\n\n")
    val helperPractices = catalog.auxiliaries.filter { it.id in supportIds }.map { auxiliary ->
        theokyklos.practices.first { it.id == auxiliary.practiceId }
    }
    val defaultAction = (listOf(need.action, letterNeed.action) + helperPractices.map {
        if (english) "${it.title.en}: ${it.description.en}" else "${it.title.ru}: ${it.description.ru}"
    }).joinToString("\n\n")
    var intention by rememberSaveable(source.date, source.seed, selectedId, needId) { mutableStateOf(need.intention) }
    var action by rememberSaveable(source.date, source.seed, selectedId, needId, supportIds) { mutableStateOf(defaultAction) }
    var useExisting by rememberSaveable(source.date, source.seed, selectedId, needId) { mutableStateOf(false) }
    var existingId by rememberSaveable(source.date, source.seed, selectedId, needId) { mutableStateOf<String?>(null) }
    val eligible = StoicheionRestoration.eligibleHabits(workspace?.habits.orEmpty())
    val prior = StoicheionRestoration.visibleHabits(workspace?.habits.orEmpty()).firstOrNull {
        it.stoicheionRestoration?.cycleId == StoicheionRestoration.cycleId(source.date, source.seed, sector.id, letter.id)
    }
    val enabled = workspace?.settings?.enabled == true
    val uri = LocalUriHandler.current
    var supportDetails by rememberSaveable(source.date, source.seed, selectedId) { mutableStateOf<String?>(null) }
    val stages = listOf("meaning", "myth", "equation", "practice")
    val scroll = rememberLazyListState()
    LaunchedEffect(stage) { scroll.scrollToItem(0) }
    LazyColumn(Modifier.fillMaxSize().testTag("restoration-scroll"), state = scroll, contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Text(catalog.copy("intro"), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                stages.forEachIndexed { index, name ->
                    FilterChip(selected = stage == index, onClick = { stage = index },
                        enabled = index <= reached && (index < 3 || resource != null),
                        label = { Text("${index + 1} · ${catalog.copy(name)}", Modifier.fillMaxWidth(),
                            style = MaterialTheme.typography.labelSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center) },
                        modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 56.dp).testTag("restoration-stage-$index"))
                }
            }
            LinearProgressIndicator(progress = { (stage + 1) / 4f }, modifier = Modifier.fillMaxWidth())
        }
        if (stage == 0) {
            item { RestorationBlock(catalog.copy("chooseCard"), RestorationTone.SAGE) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    reversed.forEach { id ->
                        val sourceCard = source.cards[StoicheionRestoration.positions.indexOf(id)]
                        val label = letters.first { it.id == sourceCard.letterId }
                        FilterChip(selected = selectedId == id, onClick = { selectedId = id },
                            label = { Text("${label.symbol} · ${catalog.sectors.getValue(id).title.substringBefore(" · ")}") },
                            modifier = Modifier.heightIn(min = 48.dp).testTag("restoration-card-$id"))
                    }
                }
            } }
            item { RestorationBlock(sector.title, RestorationTone.GOLD) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    StoicheionCardFace(letter, Modifier.width(104.dp).graphicsLayer { rotationZ = 180f })
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${letter.symbol} · ${letter.name}", style = MaterialTheme.typography.titleLarge)
                        Text(catalog.copy("field"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        Text(sector.field, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(catalog.copy("cardFocus"), style = MaterialTheme.typography.titleSmall)
                Text(focus.risk, style = MaterialTheme.typography.bodyMedium)
            } }
            item { RestorationBlock(catalog.copy("need"), RestorationTone.MAUVE) {
                Text(catalog.copy("possibility"), style = MaterialTheme.typography.bodySmall)
                StoicheionRestoration.needs.forEach { id ->
                    RestorationChoice(selected = id == needId, title = catalog.copy(id), tag = "restoration-need-$id",
                        onClick = { needId = id })
                }
                HorizontalDivider()
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(catalog.copy("risk"), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                    Text(need.risk, style = MaterialTheme.typography.bodyMedium)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(catalog.copy("quality"), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                    Text("${need.quality}. ${focus.quality}", style = MaterialTheme.typography.bodyMedium)
                }
            } }
        }
        if (stage == 1) {
            item { RestorationFrameworkDisclosure(catalog) }
            item { RestorationBlock(catalog.copy("ambivalence"), RestorationTone.MAUVE) { Text(sector.ambivalence) } }
            item { RestorationBlock(sector.myth.title, RestorationTone.GOLD) {
                Text(sector.myth.body)
                Text(sector.myth.source, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { runCatching { uri.openUri(sector.myth.url) } }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(catalog.copy("source"))
                }
            } }
            item { RestorationBlock(catalog.copy("supports"), RestorationTone.SAGE) {
                Text(catalog.copy("supportHelp"), style = MaterialTheme.typography.bodySmall)
                catalog.auxiliaries.forEach { support ->
                    val checked = support.id in supportIds
                    OutlinedCard(modifier = Modifier.fillMaxWidth().toggleable(value = checked, role = Role.Checkbox,
                        onValueChange = { value -> supportIds = if (value) supportIds + support.id else supportIds - support.id })
                        .testTag("restoration-support-${support.id}"),
                        colors = CardDefaults.outlinedCardColors(containerColor = selectedControlContainer(checked,
                            fallback = MaterialTheme.colorScheme.surface)),
                        border = selectedControlBorder(checked) ?: BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = checked, onCheckedChange = null, modifier = Modifier.size(48.dp))
                                Text(support.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            }
                            Text(support.purpose, style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { supportDetails = if (supportDetails == support.id) null else support.id },
                                modifier = Modifier.heightIn(min = 48.dp).semantics {
                                    contentDescription = "${catalog.copy("explain")} · ${support.title}"
                                }) {
                                Text("${support.word} · ${StoicheionRestoration.isopsephy(support.word)} ${if (supportDetails == support.id) "−" else "+"}")
                            }
                            if (supportDetails == support.id) theokyklos.byId[support.id]?.let { detail ->
                                OriginalImage(detail.art, if (english) detail.patrons.en else detail.patrons.ru,
                                    Modifier.fillMaxWidth().height(150.dp))
                                Text(if (english) detail.description.en else detail.description.ru, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            } }
        }
        if (stage == 2) {
            item { RestorationBlock(catalog.copy("equation"), RestorationTone.BLUE) {
                Text(catalog.copy("formula"), style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                Text("P = ${StoicheionRestoration.trace(total.toLong()).joinToString(" → ")}", style = MaterialTheme.typography.titleMedium)
                Text("A = ${letter.symbol} · ${letter.value}", style = MaterialTheme.typography.bodyLarge)
                Text("U = ${if (equation.supports.isEmpty()) "0" else equation.supports.joinToString(" + ") { "${it.word} ${it.value}" }} = ${equation.supportTotal}")
                if (resource != null) {
                    val sum = letter.value + resource.value + equation.supportTotal
                    Text("${letter.value} + ${resource.value} + ${equation.supportTotal} = ${StoicheionRestoration.trace(sum.toLong()).joinToString(" → ")}",
                        style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                } else Text("ρ(B) = ${equation.requiredRoot}", style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.primary)
                Text(catalog.copy("arithmeticNote"), style = MaterialTheme.typography.bodySmall)
            } }
            item { RestorationBlock(catalog.copy("resource"), RestorationTone.BLUE) {
                Text(catalog.copy("resourceHelp"), style = MaterialTheme.typography.bodySmall)
                equation.candidates.forEach { candidate ->
                    val candidateLetter = letters.first { it.id == candidate.id }
                    val chosen = candidate.id == resourceId
                    OutlinedCard(modifier = Modifier.fillMaxWidth().selectable(selected = chosen,
                        role = Role.RadioButton, onClick = { resourceId = candidate.id }).testTag("restoration-resource-${candidate.id}"),
                        colors = CardDefaults.outlinedCardColors(containerColor = selectedControlContainer(chosen,
                            fallback = MaterialTheme.colorScheme.surface)),
                        border = selectedControlBorder(chosen) ?: BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = candidate.id == resourceId, onClick = null, modifier = Modifier.size(48.dp))
                                Text("${candidate.symbol} · ${candidateLetter.name} · ${candidate.value}", style = MaterialTheme.typography.titleMedium)
                            }
                            Text(catalog.letterFoci.getValue(candidate.id).quality, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            } }
        }
        if (stage == 3 && resource != null) {
            item { RestorationBlock(catalog.copy("contemplation"), RestorationTone.GOLD) {
                Text(practiceText)
                OutlinedTextField(value = intention, onValueChange = { intention = it.take(500) },
                    label = { Text(catalog.copy("intention")) }, modifier = Modifier.fillMaxWidth().testTag("restoration-intention"), minLines = 2)
                OutlinedTextField(value = action, onValueChange = { action = it.take(1600) },
                    label = { Text(catalog.copy("action")) }, modifier = Modifier.fillMaxWidth().testTag("restoration-action"), minLines = 3)
            } }
            item { RestorationBlock(catalog.copy("habit"), RestorationTone.SAGE) {
                val practice = theokyklos.practices.first { it.id == need.practiceId }
                Text(if (english) practice.title.en else practice.title.ru,
                    style = MaterialTheme.typography.titleMedium)
                Text(if (english) practice.description.en else practice.description.ru)
                RestorationChoice(!useExisting, catalog.copy("newHabit"), "restoration-new-habit") { useExisting = false }
                if (eligible.isNotEmpty()) {
                    RestorationChoice(useExisting, catalog.copy("existingHabit"), "restoration-existing-habit") { useExisting = true }
                    if (useExisting) eligible.forEach { habit ->
                        RestorationChoice(existingId == habit.id, "${habit.emoji} ${habit.title}", "restoration-link-${habit.id}") { existingId = habit.id }
                    }
                }
                UntranslatedText(habitPracticeCopy().getString("warning"), style = MaterialTheme.typography.bodySmall)
                if (!enabled) Text(catalog.copy("disabled"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (prior != null) Text(catalog.copy("snapshot"), color = MaterialTheme.colorScheme.primary)
                if (LocalDate.now() !in LocalDate.parse(source.date)..LocalDate.parse(source.date).plusDays(1))
                    UntranslatedText(habitPracticeCopy().getString("divinationExpired"),color=MaterialTheme.colorScheme.error)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(onClick = {
                    val snapshot = StoicheionRestorationSnapshot(
                        cycleId = StoicheionRestoration.cycleId(source.date, source.seed, sector.id, letter.id),
                        startedAt = Instant.now().toString(), startedDate = LocalDate.now().toString(),
                        sourceDate = source.date, sourceSeed = source.seed, cards = source.cards,
                        sectorId = sector.id, letterId = letter.id, need = needId,
                        supportIds = equation.supports.map { it.id }, resourceLetterId = resource.id,
                        practiceId = need.practiceId, spreadTotal = total, pythmen = equation.target,
                        intention = intention.trim(), action = action.trim(), practiceText = practiceText,
                        excludeStartDate = useExisting && workspace?.completions?.any {
                            it.habitId == existingId && it.date == LocalDate.now() && it.completed } == true)
                    val base = if (useExisting) eligible.first { it.id == existingId }
                        else practice.toHabit(inputCalendarMode, english).let { created -> created.copy(
                            schedule = StoicheionRestoration.dailySchedule(created.schedule),
                            description = "${snapshot.action}\n\n${snapshot.practiceText}") }
                    val deadline = LocalDate.parse(source.date).plusDays(1)
                    val finiteSchedule = StoicheionRestoration.dailySchedule(base.schedule).let { it.copy(endDate = deadline,
                        recurrence = it.recurrence.copy(rangeEnd = deadline.toString())) }
                    onSave(base.copy(stoicheionRestoration = snapshot, schedule = finiteSchedule,
                        practiceGoal = HabitPracticeGoal(startDate = LocalDate.now())))
                }, enabled = enabled && !busy && prior == null && intention.isNotBlank() && action.isNotBlank()
                    && LocalDate.now() in LocalDate.parse(source.date)..LocalDate.parse(source.date).plusDays(1)
                    && action.length <= 1600 && practiceText.length <= 1600
                    && (!useExisting || eligible.any { it.id == existingId }),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("restoration-start-cycle")) {
                    Text(catalog.copy("startCycle"))
                }
            } }
        }
        if (stage < 3) item {
            Button(onClick = { stage += 1; reached = maxOf(reached, stage) }, enabled = stage != 2 || resource != null,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("restoration-next")) {
                Text(catalog.copy("next"))
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
    }
}

@Composable
internal fun RestorationCycle(habit: Habit, workspace: LocalHabitWorkspace, letters: List<StoicheionLetter>,
    catalog: StoicheionRestorationCatalog, today: LocalDate, busy: Boolean, error: String?,
    onComplete: () -> Unit, onReflection: (String) -> Unit, onOpenHabits: () -> Unit) {
    val snapshot = habit.stoicheionRestoration!!
    val dates = StoicheionRestoration.completionDates(snapshot, habit.id, workspace.completions, today)
    val finite = HabitPracticeGoals.progress(habit,workspace.completions,today)
    val count = finite?.dates?.size ?: dates.size
    val target = finite?.goal?.requiredCompletions ?: 10
    val finiteCopy = habitPracticeCopy()
    val done = workspace.completions.firstOrNull { it.habitId == habit.id && it.date == today }?.completed == true
    val scheduled = HabitEngine(GenesisCalendar()).isScheduled(habit, today, workspace.completions)
    val simple = habit.scoringMode in listOf("none", "binary") && habit.measurement == null && habit.periodGoal == null && habit.intervalSchedule == null
    var reflection by rememberSaveable(habit.id, snapshot.reflection) { mutableStateOf(snapshot.reflection) }
    var sourceOpen by rememberSaveable(habit.id) { mutableStateOf(false) }
    val sector = catalog.sectors.getValue(snapshot.sectorId)
    val letter = letters.first { it.id == snapshot.letterId }
    LazyColumn(Modifier.fillMaxSize().testTag("restoration-cycle-scroll"), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { RestorationBlock(if(finite?.status == "missed") finiteCopy.getString("missed") else catalog.copy(if (count == target) "completed" else "cycle")) {
            Text(sector.title, style = MaterialTheme.typography.titleMedium)
            Text("${letter.symbol} · ${letter.name} · ${snapshot.sourceDate}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${catalog.copy("progress")} · $count/$target", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
            if(finite != null) {
                UntranslatedText(finiteCopy.getString("deadline") + ": ${finite.deadline} · ${habit.schedule.timezone}")
                UntranslatedText(finiteCopy.getString("warning"),style=MaterialTheme.typography.bodySmall)
            } else { RestorationTetractys(count, catalog); Text(catalog.copy("cycleHelp"), style = MaterialTheme.typography.bodySmall) }
        } }
        item { RestorationBlock(catalog.copy("practice"), RestorationTone.SAGE) {
            Text(habitDisplayDescription(habit.copy(description = snapshot.intention)), style = MaterialTheme.typography.titleMedium)
            Text(habitDisplayDescription(habit.copy(description = snapshot.practiceText)))
            HorizontalDivider()
            Text(catalog.copy("action"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(habitDisplayDescription(habit.copy(description = snapshot.action)))
            Text("${habit.emoji} ${habit.title}", style = MaterialTheme.typography.titleSmall)
            if (!workspace.settings.enabled) Text(catalog.copy("disabled"), style = MaterialTheme.typography.bodySmall)
            if (done && today !in dates && count < 10) Text(catalog.copy("todayEarlier"), style = MaterialTheme.typography.bodySmall)
            if (!scheduled || !habit.active) Text(catalog.copy("notScheduled"), style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (simple && count < target && finite?.status != "missed") Button(onClick = onComplete,
                enabled = !busy && workspace.settings.enabled && scheduled && habit.active && !done,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("restoration-complete-today")) {
                Text(catalog.copy(if (done) "doneToday" else "completeToday"))
            }
            OutlinedButton(onClick = onOpenHabits, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(catalog.copy("openHabits"))
            }
        } }
        item { RestorationBlock(catalog.copy("reflection"), RestorationTone.MAUVE) {
            OutlinedTextField(value = reflection, onValueChange = { reflection = it.take(2000) },
                label = { Text(catalog.copy("reflection")) }, minLines = 3,
                modifier = Modifier.fillMaxWidth().testTag("restoration-reflection"))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = { onReflection(reflection) }, enabled = !busy && reflection.trim() != snapshot.reflection,
                modifier = Modifier.heightIn(min = 48.dp).testTag("restoration-save-reflection")) {
                Text(catalog.copy(if (reflection.trim() == snapshot.reflection && reflection.isNotBlank()) "saved" else "saveReflection"))
            }
        } }
        item { RestorationBlock(catalog.copy("snapshot"), RestorationTone.BLUE) {
            val resource = letters.first { it.id == snapshot.resourceLetterId }
            val supportTotal = StoicheionRestoration.equation(letter.value, snapshot.spreadTotal, snapshot.supportIds).supportTotal
            Text("${letter.symbol} ${letter.value} + ${resource.symbol} ${resource.value} + $supportTotal = " +
                StoicheionRestoration.trace((letter.value + resource.value + supportTotal).toLong()).joinToString(" → "),
                style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            TextButton(onClick = { sourceOpen = !sourceOpen }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(catalog.copy("original"))
            }
            if (sourceOpen) {
                snapshot.cards.forEachIndexed { index, sourceCard ->
                    val original = letters.first { it.id == sourceCard.letterId }
                    Text("${catalog.sectors.getValue(StoicheionRestoration.positions[index]).title.substringBefore(" · ")} · " +
                        "${original.symbol} ${original.name} ${if (sourceCard.reversed) "↓" else "↑"}", style = MaterialTheme.typography.bodySmall)
                }
                Text("${snapshot.spreadTotal} → ${snapshot.pythmen}", style = MaterialTheme.typography.labelLarge)
            }
        } }
    }
}

@Composable
internal fun RestorationTetractys(count: Int, catalog: StoicheionRestorationCatalog) {
    Column(Modifier.fillMaxWidth().semantics {
        contentDescription = "${catalog.copy("tetractys")}. ${catalog.copy("progress")} $count/10"
    }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        var index = 0
        (1..4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                repeat(row) {
                    val filled = index++ < count
                    Box(Modifier.size(16.dp).background(if (filled) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outlineVariant, CircleShape))
                }
            }
        }
        Text(catalog.copy("tetractys"), style = MaterialTheme.typography.labelMedium)
        val activeStage = when { count < 1 -> "foundation"; count < 3 -> "discernment"; count < 6 -> "exercise"; else -> "integration" }
        Text(catalog.copy(activeStage), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
internal fun RestorationFrameworkDisclosure(catalog: StoicheionRestorationCatalog) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("restoration-framework-toggle")) {
                Text(catalog.framework.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                Text(if (expanded) "−" else "+", Modifier.padding(start = 8.dp))
            }
            if (expanded) {
                Text(catalog.framework.formula, style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary)
                Text(catalog.framework.body, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("restoration-framework-body"))
            }
        }
    }
}

@Composable
private fun RestorationChoice(selected: Boolean, title: String, tag: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
        .selectedControlDecoration(selected).testTag(tag), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.size(48.dp))
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    }
}

private enum class RestorationTone { SAGE, GOLD, BLUE, MAUVE }

@Composable
private fun RestorationBlock(title: String, tone: RestorationTone = RestorationTone.GOLD, content: @Composable ColumnScope.() -> Unit) {
    val colors = when (tone) {
        RestorationTone.SAGE -> 0xffdfede4 to 0xff1b3029
        RestorationTone.GOLD -> 0xfff2e8d3 to 0xff302a1e
        RestorationTone.BLUE -> 0xffe0eaf0 to 0xff202e36
        RestorationTone.MAUVE -> 0xffede3ed to 0xff302632
    }
    Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large,
        color = Color(if (LocalEveningTheme.current) colors.second else colors.first), contentColor = MaterialTheme.colorScheme.onSurface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            content()
        }
    }
}
