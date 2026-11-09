package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import androidx.compose.ui.graphics.Color
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.StoicheionDrawRepository
import ru.genesis.calendar.data.StoicheionDraws
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.StoicheionReading
import ru.genesis.calendar.domain.RestorationDrawCard
import ru.genesis.calendar.domain.StoicheionRestoration
import ru.genesis.calendar.domain.StoicheionRestorationCatalogSource
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import java.time.LocalDate

internal data class StoicheionLetter(val id: String, val order: Int, val name: String, val symbol: String,
    val lowercase: String, val value: Int, val pythmen: Int, val tagline: String, val content: String,
    val body: String, val bodyGreek: String, val invocation: String, val accent: Color)

/** All 24 author texts are copied without abridgement from app/stoicheion-data.ts. */
@Composable
fun StoicheionScreen(app: GenesisApplication, divinationDisabled: Boolean,
    onOpenTheokyklosSector: (String) -> Unit = {}, initialCardId: String? = null,
    onInitialCardOpened: () -> Unit = {}, onOpenHabits: () -> Unit = {},
    inputCalendarMode: CalendarMode = CalendarMode.SACRED, onModelingTask: (AuroraTaskDraft) -> Unit = {}) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val english = language == "en"
    val access=LocalFeatureAccess.current
    val upgrade=LocalNativeUpgrade.current
    val restorationAllowed=access.allows("stoicheion-restoration")
    val repository = remember(app, app.workspaceScope) { StoicheionDrawRepository(app) }
    val habitsRepository = remember(app) { HabitsRepository(app) }
    val habitWorkspace by produceState<LocalHabitWorkspace?>(null, habitsRepository) {
        try { habitsRepository.workspace.collect { value = it } }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { value = null }
    }
    var restorationReload by remember { mutableIntStateOf(0) }
    val restorationCatalogResult = remember(context, language, restorationReload) {
        runCatching { StoicheionRestorationCatalogSource.load(context, language) }
    }
    val restorationCatalog = restorationCatalogResult.getOrNull()
    val scope = rememberCoroutineScope()
    var deleteCycle by remember { mutableStateOf<ru.genesis.calendar.domain.habits.Habit?>(null) }
    val today by produceState(LocalDate.now()) {
        while (true) { delay(60_000L); value = LocalDate.now() }
    }
    val draws by produceState<StoicheionDraws?>(null, repository, today) {
        repository.today.collect { value = it }
    }
    val now by produceState(System.currentTimeMillis()) {
        while (true) { delay(1_000L); value = System.currentTimeMillis() }
    }
    val theokyklosResult = remember(context, language, restorationReload) { runCatching { TheokyklosCatalogSource.load(context, language) } }
    val theokyklos = theokyklosResult.getOrNull()
    val letters by produceState<List<StoicheionLetter>?>(null, context, language) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val raw = context.assets.open("stoicheion.json").bufferedReader().use { it.readText() }
                val art = JSONObject(context.assets.open("stoicheion-art.json").bufferedReader().use { it.readText() })
                val translated = if (language == "ru") null else
                    JSONObject(context.assets.open("originals/i18n/catalog-translations/$language.json")
                        .bufferedReader().use { it.readText() })
                val letterCatalog = translated?.getJSONObject("stoicheion")
                val artworkCatalog = translated?.getJSONObject("stoicheionArt")
                JSONArray(raw).let { array -> (0 until array.length()).map { index ->
                    array.getJSONObject(index).let { item ->
                        val id = item.getString("id")
                        val image = art.getJSONObject(id)
                        val localized = letterCatalog?.getJSONObject(id)
                        val artCopy = artworkCatalog?.getJSONObject(id)
                        StoicheionLetter(id, item.getInt("order"), localized?.getString("name") ?: item.getString("name"),
                            item.getString("symbol"), item.getString("lowercase"), item.getInt("value"), item.getInt("pythmen"),
                            localized?.getString("tagline") ?: item.getString("tagline"),
                            ru.genesis.calendar.domain.formatGreekTerms(localized?.getString("content") ?: item.getString("content"), language),
                            artCopy?.getString("body") ?: image.getString("body"),
                            ru.genesis.calendar.domain.formatGreekTerms(artCopy?.getString("bodyGreek") ?: image.getString("bodyGreek"), language),
                            artCopy?.getString("invocation") ?: image.getString("invocation"),
                            Color(android.graphics.Color.parseColor(image.getString("accent"))))
                    }
                } }
            }.getOrDefault(emptyList())
        }
    }
    var selected by remember { mutableStateOf<StoicheionSelection?>(null) }
    var alphabetExpanded by rememberSaveable { mutableStateOf(false) }
    var alphabetReveal by remember { mutableIntStateOf(0) }
    val gridState = rememberLazyGridState()
    LaunchedEffect(alphabetReveal, alphabetExpanded) {
        if (alphabetReveal > 0 && alphabetExpanded) {
            // Two full-width items precede the catalogue; wait for the expanded grid to lay out.
            snapshotFlow { gridState.layoutInfo.totalItemsCount }.first { it > 3 }
            if (android.animation.ValueAnimator.areAnimatorsEnabled()) gridState.animateScrollToItem(2)
            else gridState.scrollToItem(2)
        }
    }
    var restorationOpen by remember { mutableStateOf(false) }
    var restorationSource by remember { mutableStateOf<RestorationSource?>(null) }
    var restorationSectorId by remember { mutableStateOf<String?>(null) }
    var restorationHabitId by remember { mutableStateOf<String?>(null) }
    val openRestoration: (String?) -> Unit = { sectorId ->
        val spread = draws?.spread
        val cards = letters?.let { loaded -> spread?.let { StoicheionReading.spread(loaded, it.seed) } }
        restorationSource = if (spread != null && cards != null) RestorationSource(spread.dayKey, spread.seed,
            cards.map { RestorationDrawCard(it.first.id, it.second) }) else null
        restorationSectorId = sectorId
        restorationHabitId = if (sectorId == null || spread == null) null else StoicheionRestoration.visibleHabits(habitWorkspace?.habits.orEmpty()).firstOrNull {
            it.stoicheionRestoration?.let { snapshot -> snapshot.sourceDate == spread.dayKey && snapshot.sourceSeed == spread.seed && snapshot.sectorId == sectorId } == true
        }?.id
        selected = null
        restorationOpen = true
    }
    LaunchedEffect(initialCardId, letters) {
        if(initialCardId!=null) letters?.firstOrNull { it.id==initialCardId }?.let { letter ->
            selected=StoicheionSelection(letter)
            onInitialCardOpened()
        }
    }
    var motionMode by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var practiceBusy by remember { mutableStateOf(false) }
    var practiceError by remember { mutableStateOf<String?>(null) }
    var drawError by remember { mutableStateOf<String?>(null) }
    var drawRefresh by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(repository, today, drawRefresh) {
        if (app.workspaceScope.startsWith("account-")) try {
            refreshing = true
            repository.refreshFromServer()
            drawError = null
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            drawError = (error as? ru.genesis.calendar.auth.StoicheionSyncFailure)?.message
                ?: "Не удалось обновить выбор карты с сервера. Сохранённая копия на устройстве не изменена."
        } finally { refreshing = false }
    }
    val beginMotion: (String) -> Unit = { mode ->
        val feature=when(mode) { "spread" -> "stoicheion-spread"; "timeline" -> "stoicheion-timeline"; else -> "stoicheion" }
        if (!access.allows(feature)) upgrade?.invoke(feature)
        else if (!saving && !refreshing && !divinationDisabled) { drawError = null; motionMode = mode }
    }
    if (restorationAllowed && restorationOpen && !divinationDisabled && restorationCatalog != null && theokyklos != null && letters?.size == 24) {
        StoicheionRestorationScreen(restorationSource, letters!!, restorationCatalog, theokyklos,
            habitWorkspace, habitsRepository, restorationSectorId, restorationHabitId, inputCalendarMode,
            onBack = { restorationOpen = false }, onOpenHabits = onOpenHabits,
            onOpenTheokyklos = { restorationOpen = false; onOpenTheokyklosSector(it) })
        return
    }
    val headerTitle = if (english) "Oracle · Stoicheion" else "Оракул · Стойхейон"
    val headerSubtitle = if (english) "Gno · Meter · Basileia" else "Гно · Метэр · Базилея"
    val headerInShell = WorkspaceScreenHeader(headerTitle, headerSubtitle)
    LazyVerticalGrid(columns = GridCells.Adaptive(140.dp), state = gridState, modifier = Modifier.fillMaxSize().testTag("stoicheion-grid"),
        contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            if (!headerInShell) GenesisPageHeader(if (english) "Oracle - Stoicheion" else "Оракул - Стойхейон",
                if (divinationDisabled) {
                    if (english) "Twenty-four Greek letters and their meanings"
                    else "Двадцать четыре буквенных образа и их значения"
                } else if (english) "Twenty-four Greek letters, the daily card and the nine-face spread"
                else "Двадцать четыре буквенных образа, карта дня и расклад девяти ликов", "Σ",
                modifier = Modifier.padding(4.dp),
                subtitle = if (english) "Gno · Meter · Basileia" else "Гно · Метэр · Базилея",
                icon = GenesisPageIcon.STOICHEION)
        }
        val loaded = letters
        when {
            loaded == null -> item(span = { GridItemSpan(maxLineSpan) }) {
                Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                    WorkspaceLoadingIndicator()
                }
            }
            loaded.size != 24 -> item(span = { GridItemSpan(maxLineSpan) }) {
                Text("Не удалось открыть авторские карты. Данные не заменены.",
                    Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
            }
            else -> {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (divinationDisabled) Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp)) {
                                Text("Гадания по картам выключены", style = MaterialTheme.typography.titleMedium)
                                Text("Карта дня и расклад скрыты настройкой. Буквы и значения остаются доступными.",
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        } else StoicheionDrawPanel(loaded, draws, now, saving || refreshing, drawError,
                            onBegin = beginMotion, onSelect = { selected = it },
                            onRefresh = if (app.workspaceScope.startsWith("account-")) ({ drawRefresh++ }) else null,
                            restorationLabel = restorationCatalog?.copy("begin"),
                            onRestore = if (!restorationAllowed || restorationCatalog == null || theokyklos == null) null else { { openRestoration(null) } },
                            restorationError = restorationCatalogResult.isFailure || theokyklosResult.isFailure,
                            onReloadRestoration = { restorationReload++ })
                        if (restorationAllowed && !divinationDisabled && restorationCatalog != null) {
                            val cycles = StoicheionRestoration.visibleHabits(habitWorkspace?.habits.orEmpty())
                            if (cycles.isNotEmpty()) {
                                Text(restorationCatalog.copy("history"), Modifier.testTag("stoicheion-saved-cycles-title"), style = MaterialTheme.typography.titleMedium)
                                cycles.forEach { habit ->
                                    val snapshot = habit.stoicheionRestoration!!
                                    val completed = StoicheionRestoration.completionDates(snapshot, habit.id,
                                        habitWorkspace?.completions.orEmpty(), today).size
                                    OutlinedCard(onClick = {
                                        restorationSource = null; restorationSectorId = null
                                        restorationHabitId = habit.id; restorationOpen = true
                                    }, modifier = Modifier.fillMaxWidth().testTag("stoicheion-restoration-cycle-${habit.id}")) {
                                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                Text("${loaded.first { it.id == snapshot.letterId }.symbol} · ${restorationCatalog.sectors.getValue(snapshot.sectorId).title}",
                                                    Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                                AffairsIconButton("Удалить цикл", AffairsAction.DELETE, { deleteCycle = habit },
                                                    Modifier.testTag("stoicheion-delete-cycle-${habit.id}"), contentColor = MaterialTheme.colorScheme.error, outlined = false)
                                            }
                                            Text("${habit.emoji} ${habit.title}", style = MaterialTheme.typography.bodySmall)
                                            Text("${snapshot.sourceDate} · ${restorationCatalog.copy(if (completed == 10) "completed" else "progress")} $completed/10",
                                                style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                                        }
                                    }
                                }
                            }
                        }
                        val modelingSource=remember(draws?.spread,loaded) { draws?.spread?.let { spread ->
                            JSONObject().put("id","stoicheion-${spread.dayKey}-${spread.seed}").put("seed",spread.seed)
                                .put("day",spread.dayKey).put("createdAt",java.time.Instant.ofEpochMilli(spread.firstAt).toString())
                                .put("cards",JSONArray(StoicheionReading.spread(loaded,spread.seed).map { (letter,reversed) ->
                                    JSONObject().put("cardId",letter.id).put("reversed",reversed)
                                }))
                        } }
                        FutureModelingGuide(modelingSource,onModelingTask)
                    }
                }
                item(key = "stoicheion-alphabet", span = { GridItemSpan(maxLineSpan) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        StoicheionAlphabetToggle(alphabetExpanded) {
                            alphabetExpanded = !alphabetExpanded
                            if (alphabetExpanded) alphabetReveal++
                        }
                        if (alphabetExpanded) StoicheionSection(OracleTone.SAGE, "stoicheion-catalog-block") {
                            Text("Основной греческий ряд · 24", style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary)
                            Text("Выберите букву", style = MaterialTheme.typography.titleLarge)
                            Text("Откройте метафизический профиль, прямое и перевёрнутое положение, практику и число.",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                if (alphabetExpanded) items(loaded, key = { it.id }) { letter ->
                    Card(onClick = { selected = StoicheionSelection(letter) },
                        colors = CardDefaults.cardColors(containerColor = oracleSectionColor(OracleTone.SAGE)), modifier = Modifier.fillMaxWidth()
                        .testTag("stoicheion-letter-${letter.id}")) {
                        StoicheionCardFace(letter, Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
    deleteCycle?.let { candidate -> SavedCycleDeleteDialog(candidate, habitsRepository) { deleteCycle = null } }
    selected?.let { reading ->
        val letter = reading.letter
        val readingText=remember(letter.id,letter.content){splitStoicheionReading(context,letter.id,letter.content)}
        var detailsOpen by remember(letter.id){mutableStateOf(false)}
        Dialog(onDismissRequest = { selected = null },
            properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxWidth().testTag("stoicheion-reading-dialog"),
                shape = MaterialTheme.shapes.large) {
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("${letter.symbol} · ${letter.name}", Modifier.weight(1f),
                            style = MaterialTheme.typography.titleLarge)
                        AffairsIconButton("Закрыть", AffairsAction.CLOSE, { selected = null }, Modifier.testTag("stoicheion-reading-close"))
                    }
                    Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            StoicheionCardFace(letter, Modifier.width(220.dp))
                        }
                        Text(letter.tagline, style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary)
                        reading.timePosition?.let { position ->
                            val copy = stoicheionTimelineCopy()
                            UntranslatedText(position.title, style = MaterialTheme.typography.titleMedium)
                            UntranslatedText(position.meaning, style = MaterialTheme.typography.bodyMedium)
                            UntranslatedText(copy.getString(if (reading.reversed == true) "reversedEffect" else "uprightEffect"),
                                style = MaterialTheme.typography.bodyMedium)
                        }
                        Text("Числовое значение ${letter.value} · пифмен ${letter.pythmen}",
                            style = MaterialTheme.typography.labelLarge)
                        if(reading.reversed!=null) listOf(false to readingText.upright,true to readingText.reversed).forEach { (reversed,text) ->
                            val chosen=reading.reversed==reversed
                            Surface(Modifier.fillMaxWidth().testTag(if(reversed)"stoicheion-reading-reversed"else"stoicheion-reading-upright"),
                                shape=MaterialTheme.shapes.medium,
                                color=if(chosen)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                                border=if(chosen)BorderStroke(2.dp,MaterialTheme.colorScheme.primary)else null) {
                                Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                                    Text(if(reversed)"Перевёрнутое положение"else"Парадное положение",style=MaterialTheme.typography.titleSmall)
                                    Text(text,style=MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                        reading.position?.let { position ->
                            HorizontalDivider()
                            Text("${position.direction} · сектор расклада", style = MaterialTheme.typography.titleMedium)
                            Text(position.meaning, style = MaterialTheme.typography.bodyMedium)
                            if (restorationAllowed && reading.reversed == true && restorationCatalog != null && !divinationDisabled) {
                                Button(onClick = { openRestoration(position.id) },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("stoicheion-card-restoration")) {
                                    Text(restorationCatalog.copy("begin"))
                                }
                            }
                            theokyklos?.byId?.get(position.id)?.let { sector ->
                                Text(if (english) "${sector.patrons.en} · ${sector.essence.en}"
                                    else "${sector.patrons.ru} · ${sector.essence.ru}",
                                    style = MaterialTheme.typography.titleSmall)
                                theokyklos.guidanceById[position.id]?.let { guidance ->
                                    val guidanceText = if (reading.reversed == true) guidance.reversed else guidance.upright
                                    Text(if (english) guidanceText.en else guidanceText.ru,
                                        style = MaterialTheme.typography.bodyMedium)
                                }
                                sector.words.forEach { word ->
                                    Text(if (english) "${word.greek} · ${word.pronunciation.en} · ${word.meaning.en}"
                                        else "${word.greek} · ${word.pronunciation.ru} · ${word.meaning.ru}",
                                        style = MaterialTheme.typography.bodySmall)
                                }
                                TextButton(onClick = { selected = null; onOpenTheokyklosSector(position.id) }) {
                                    Text("Открыть сектор Теокиклоса →")
                                }
                            }
                        }
                        if(reading.reversed!=null) {
                            TextButton(onClick={detailsOpen=!detailsOpen},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("stoicheion-reading-more")) {
                                Text("Полная информация о карте",Modifier.weight(1f))
                                GenesisLucideIcon(if(detailsOpen)"chevron-up"else"chevron-down")
                            }
                            if(detailsOpen)StoicheionReadingSections(readingText.profile, Modifier.testTag("stoicheion-reading-profile"))
                        } else StoicheionReadingSections(letter.content)
                        reading.position?.let { position ->
                            theokyklos?.practicesFor(position.id)?.takeIf{it.isNotEmpty()}?.let { practices ->
                                HorizontalDivider()
                                Text("Сакральные привычки",style=MaterialTheme.typography.titleMedium)
                                practiceError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                                practices.forEach { practice ->
                                    val existing = standardSacredHabit(habitWorkspace?.habits.orEmpty(), practice.id)
                                    Text(if(english)"${practice.emoji} ${practice.title.en} — ${practice.description.en}"
                                        else "${practice.emoji} ${practice.title.ru} — ${practice.description.ru}",style=MaterialTheme.typography.bodyMedium)
                                    if (existing == null) UntranslatedText(habitPracticeCopy().getString("warning"), style = MaterialTheme.typography.bodySmall)
                                    Button(onClick = {
                                        if (existing != null) { selected = null; onOpenHabits() }
                                        else if (!practiceBusy) scope.launch {
                                            practiceBusy = true; practiceError = null
                                            try {
                                                habitsRepository.save(practice.toHabit(inputCalendarMode, english))
                                                selected = null; onOpenHabits()
                                            } catch (error: CancellationException) { throw error }
                                            catch (_: Exception) { practiceError = "Не удалось сохранить практику." }
                                            finally { practiceBusy = false }
                                        }
                                    }, enabled = !practiceBusy && habitWorkspace?.settings?.enabled == true,
                                        modifier = Modifier.fillMaxWidth().testTag("stoicheion-practice-${practice.id}")) {
                                        Text(if (existing == null) "Начать практику" else "Открыть привычку")
                                    }
                                }
                                TextButton(onClick={selected=null;onOpenHabits()},modifier=Modifier.heightIn(min=48.dp)) {Text("Привычки")}
                            }
                        }
                    }
                }
            }
        }
    }
    if (motionMode != null && !divinationDisabled) StoicheionMotionDialog(motionMode!!, saving,
        onCancel = { if (!saving) motionMode = null }, onFinish = { seed ->
            val mode = motionMode ?: return@StoicheionMotionDialog
            if (!saving) scope.launch {
                saving = true
                try {
                    val prior = when (mode) { "daily" -> draws?.daily; "timeline" -> draws?.timeline; else -> draws?.spread }
                    var chosen = seed
                    if (mode == "daily" && prior != null && letters != null &&
                        StoicheionReading.cardOfDay(letters!!, chosen) == StoicheionReading.cardOfDay(letters!!, prior.seed))
                        chosen = (chosen + 1L) and 0xffff_ffffL
                    if (mode != "daily" && prior?.seed == chosen) chosen = (chosen + 1L) and 0xffff_ffffL
                    repository.save(mode, chosen)
                    drawError = null
                    selected = null
                    motionMode = null
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) { drawError = error.message ?: "Не удалось сохранить расклад."; motionMode = null }
                finally { saving = false }
            }
        })
}
