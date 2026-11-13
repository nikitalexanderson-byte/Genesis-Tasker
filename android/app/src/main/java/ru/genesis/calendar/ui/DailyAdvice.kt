package ru.genesis.calendar.ui

import androidx.lifecycle.compose.collectAsStateWithLifecycle

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as NativeText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.domain.habits.AdviceAffinity
import ru.genesis.calendar.domain.habits.AdviceTaskSignal
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.DiaryRepository
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.math.max
import kotlin.math.min

@Composable internal fun adviceCopy(language: String): JSONObject {
    val context = LocalContext.current
    return remember(context, language) {
        context.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()).getJSONObject(language) }
    }
}

@Composable internal fun TodayAdvicePanel(gateway: DailyAdviceGateway, userId: String, day: String, language: String,
    preferences: AdvicePreferences, habits: List<Habit>, reloadToken: Long? = null, tasks: List<LocalTask> = emptyList(),
    diary: DiaryRepository? = null, onOpenDiary: (() -> Unit)? = null) {
    if (!preferences.enabled) return
    key(userId, day, language, preferences) {
        val context = LocalContext.current
        val cache = remember(context, userId, language, preferences) {
            DailyAdviceCache(context, userId, language, preferences.toJson().toString())
        }
        val copy = adviceCopy(language)
        val diaryState = diary?.state?.collectAsStateWithLifecycle()?.value
        LaunchedEffect(diary) { if (diary != null) {
            try { diary.loadCached(); diary.refresh() }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { /* Advice still works; a failed reaction retains its own draft. */ }
        } }
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        var resumed by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
        var attempt by remember { mutableIntStateOf(0) }
        DisposableEffect(lifecycle) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_RESUME -> resumed = true
                    Lifecycle.Event.ON_PAUSE -> resumed = false
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        var response by remember { mutableStateOf<DailyAdviceResponse?>(null) }
        var failed by remember { mutableStateOf(false) }
        var loading by remember { mutableStateOf(false) }
        var changing by remember { mutableStateOf(false) }
        var signals by remember { mutableStateOf(JSONObject()) }
        var serial by remember { mutableIntStateOf(0) }
        LaunchedEffect(gateway, attempt, resumed, changing) {
            if (!resumed || changing) return@LaunchedEffect
            loading = true
            val request = ++serial
            try {
                val contextSignals = withContext(Dispatchers.Default) {
                    fun asset(name: String) = context.assets.open("originals/catalogs/" + name)
                        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
                    AdviceAffinity.context(habits, LocalDate.parse(day), preferences.smart,
                        if (preferences.smart) asset("daily-advice-affinity.json") else JSONObject(),
                        if (preferences.smart || tasks.isNotEmpty()) asset("daily-advice-topics.json") else JSONObject(),
                        tasks.map { task -> AdviceTaskSignal(task.title, task.description, task.done, task.date,
                            runCatching { JSONObject(task.sourceFieldsJson).optString("entryType", "task") }.getOrDefault("task")) })
                }
                signals = contextSignals
                val result = DailyAdviceProtocol.parse(cache.today(day) { gateway.today(contextSignals) })
                // The service owns the daily publication boundary; it can differ from the device's date.
                check(result.advice == null || result.advice.language == language)
                if (request == serial) { response = result; failed = false }
                withContext(Dispatchers.IO) { result.history.mapNotNull { it.image }.distinct().forEach {
                    DailyAdviceArtwork.load(context, it)
                } }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { failed = true }
            finally { loading = false }
        }
        val cards = response?.history.orEmpty().filter { DailyAdviceProtocol.visible(it, preferences) }
        if (failed) Row(Modifier.fillMaxWidth().testTag("daily-advice-load-error").semantics { liveRegion = LiveRegionMode.Polite },
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                NativeText(copy.getString("title"), style = MaterialTheme.typography.titleSmall)
                Text("Не удалось загрузить данные", style = MaterialTheme.typography.bodySmall)
            }
            AffairsIconButton("Обновить", AffairsAction.REFRESH, { attempt++ }, enabled = !loading)
        }
        if (cards.isNotEmpty()) {
            val pager = rememberPagerState(initialPage = cards.lastIndex, pageCount = { cards.size })
            val historyScope = rememberCoroutineScope()
            LaunchedEffect(response?.advice?.id) {
                val latest = cards.indexOfFirst { it.id == response?.advice?.id }
                if (latest >= 0) pager.scrollToPage(latest)
            }
            HorizontalPager(pager, Modifier.fillMaxWidth().testTag("daily-advice-history"),
                verticalAlignment = Alignment.Top, key = { cards[it].id }) { page ->
            val card = cards[page]
            val activePage = page == pager.settledPage
            Box(Modifier.fillMaxWidth().testTag("daily-advice-page-${card.id}")) {
            val view = LocalView.current
            var visible by remember(card.id) { mutableStateOf(false) }
            var recorded by remember(card.id) { mutableStateOf(false) }
            LaunchedEffect(card.id, visible, resumed, attempt, activePage) {
                if (!visible || !resumed || !activePage || recorded) return@LaunchedEffect
                for (retry in 0..2) {
                    try { cache.recordOnce(day, card.id) { gateway.record(card.id, card.day) }; recorded = true; break }
                    catch (cancel: CancellationException) { throw cancel }
                    catch (_: Exception) { if (retry < 2) delay(1000L shl retry) }
                }
            }
            var dismissing by remember(card.id) { mutableStateOf(false) }
            var hideError by remember(card.id) { mutableStateOf(false) }
            var nextError by remember(card.id) { mutableStateOf(false) }
            val scope = rememberCoroutineScope()
            var reactionBusy by remember(card.id) { mutableStateOf(false) }
            var reactionError by remember(card.id) { mutableStateOf(false) }
            val selectedReaction = diaryState?.records?.firstOrNull { it.note.adviceId == card.id && !it.draft }?.note?.reaction
            val react: ((String) -> Unit)? = if (diary == null) null else { kind ->
                if (!reactionBusy) {
                    reactionBusy = true; reactionError = false
                    scope.launch {
                        try {
                            val snapshot = JSONObject().put("id", card.id).put("dayKey", card.day)
                                .put("title", card.title).put("body", card.body).put("language", card.language)
                                .put("categories", JSONArray(card.categories)).put("image", card.image ?: JSONObject.NULL)
                                .put("sources", JSONArray(card.sources.map { source -> JSONObject()
                                    .put("kind", source.kind).put("author", source.author)
                                    .put("work", source.work).put("reference", source.reference) }))
                            diary.react(snapshot, kind)
                        } catch (cancel: CancellationException) { throw cancel }
                        catch (_: Exception) { reactionError = true }
                        finally { reactionBusy = false }
                    }
                }
            }
            val bitmap by produceState<Bitmap?>(null, card.image, attempt) {
                try {
                    card.image?.let { path -> value = withContext(Dispatchers.IO) {
                        DailyAdviceArtwork.load(context, path)
                    } }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { value = null }
            }
            DailyAdviceCard(card, copy, bitmap, dismissing || loading || changing, hideError, Modifier.onGloballyPositioned { coordinates ->
                val bounds = coordinates.boundsInWindow()
                val width = min(bounds.right, view.width.toFloat()) - max(bounds.left, 0f)
                val height = min(bounds.bottom, view.height.toFloat()) - max(bounds.top, 0f)
                visible = width > 0 && height > 0 && height >= min(bounds.height, view.height.toFloat()) * .1f
            }, rotation = response, nextError = nextError,
                authorizeShare = { DailyAdviceProtocol.parse(gateway.share(card.id, card.day, card.collection)).advice ?: error("ADVICE_SHARE_UNAVAILABLE") },
                viewingSequence = card.sequence, historyCount = cards.size,
                onPreviousSaved = if (page > 0) ({ historyScope.launch { pager.animateScrollToPage(page - 1) }; Unit }) else null,
                onNextSaved = if (page < cards.lastIndex) ({ historyScope.launch { pager.animateScrollToPage(page + 1) }; Unit }) else null,
                reaction = selectedReaction, reactionBusy = reactionBusy, reactionError = reactionError,
                onReaction = react, onOpenDiary = onOpenDiary, onNext = {
                val latest = response?.advice
                if (!loading && !changing && !dismissing && response?.canNext == true && latest != null) {
                    changing = true; nextError = false
                    val request = ++serial
                    scope.launch {
                        try {
                            val raw = gateway.next(signals, latest.id, latest.day)
                            val result = DailyAdviceProtocol.parse(raw)
                            check(result.advice == null || result.advice.language == language)
                            cache.save(day, raw)
                            if (request == serial) response = result
                        } catch (cancel: CancellationException) { throw cancel }
                        catch (_: Exception) { if (request == serial) nextError = true }
                        finally { changing = false }
                    }
                }
            }) {
                if (!dismissing) {
                    dismissing = true; hideError = false
                    scope.launch {
                        try {
                            gateway.record(card.id, card.day, true)
                            cache.dismiss(day, card.id)
                            response = response?.let { current -> current.copy(
                                advice = current.advice?.let { if (it.id == card.id) it.copy(dismissed = true) else it },
                                history = current.history.map { if (it.id == card.id) it.copy(dismissed = true) else it }) }
                        } catch (cancel: CancellationException) { throw cancel }
                        catch (_: Exception) { hideError = true }
                        finally { dismissing = false }
                    }
                }
            }
            }
            }
        }
    }
}

@Composable internal fun DailyAdviceCard(card: DailyAdvice, copy: JSONObject, bitmap: Bitmap?, busy: Boolean,
    hideError: Boolean, modifier: Modifier = Modifier, rotation: DailyAdviceResponse? = null,
    nextError: Boolean = false, onNext: (() -> Unit)? = null,
    viewingSequence: Int? = null, historyCount: Int = 1,
    onPreviousSaved: (() -> Unit)? = null, onNextSaved: (() -> Unit)? = null,
    reaction: String? = null, reactionBusy: Boolean = false, reactionError: Boolean = false,
    onReaction: ((String) -> Unit)? = null, onOpenDiary: (() -> Unit)? = null,
    showReactions: Boolean = true, showDismiss: Boolean = true, authorizeShare: (suspend () -> DailyAdvice)? = null, onDismiss: () -> Unit) {
    val blue = LocalDarkPalette.current == "blue"
    val surface = if (blue && !LocalEveningTheme.current) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
    val visibility = if (blue) 1.04f else 1f
    val philosophy = remember(card.body, card.sources, card.collection) {
        if (card.collection == "philosophers") philosopherQuoteParts(card.body, card.sources.firstOrNull()?.author.orEmpty()) else null
    }
    val context = LocalContext.current
    val collectionsCopy = remember(context, card.language) {
        context.assets.open("originals/i18n/advice-collections-copy.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()).getJSONObject(card.language) }
    }
    var shareFailed by remember(card.id) { mutableStateOf(false) }
    Surface(modifier.fillMaxWidth().testTag("today-daily-advice"), shape = AffairsLayout.shape) {
        Box {
            if (bitmap != null) Box(Modifier.matchParentSize()) {
                Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize().testTag("daily-advice-art"),
                    contentScale = ContentScale.Crop, colorFilter = if (blue) ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
                        .86f,0f,0f,0f,0f, 0f,.96f,0f,0f,0f, 0f,0f,1.08f,0f,0f, 0f,0f,0f,1f,0f))) else null)
                Box(Modifier.matchParentSize().background(Brush.horizontalGradient(
                    0f to surface.copy(alpha = 1f - (1f - if (LocalEveningTheme.current) .80f else .624f) * visibility),
                    .40f to surface.copy(alpha = 1f - (1f - if (LocalEveningTheme.current) .76f else .608f) * visibility),
                    .70f to surface.copy(alpha = 1f - (1f - if (LocalEveningTheme.current) .72f else .576f) * visibility),
                    1f to surface.copy(alpha = 1f - (1f - if (LocalEveningTheme.current) .64f else .56f) * visibility))))
            }
            Column(Modifier.padding(vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    NativeText(card.title.ifBlank { copy.getString("title") }, Modifier.weight(1f).testTag("daily-advice-title").semantics { heading() },
                        style = MaterialTheme.typography.titleMedium)
                    if (showDismiss) IconButton(onClick = onDismiss, enabled = !busy,
                        modifier = Modifier.size(48.dp).testTag("daily-advice-dismiss")
                            .semantics { contentDescription = copy.getString("hide") }) {
                        GenesisLucideIcon("x", Modifier.size(18.dp))
                    }
                }
                if (!philosophy?.context.isNullOrBlank()) NativeText(philosophy!!.context,
                    Modifier.testTag("daily-advice-context"), style = MaterialTheme.typography.titleSmall)
                NativeText(compactAdviceBody(philosophy?.quote ?: card.body), Modifier.testTag("daily-advice-body"), style = MaterialTheme.typography.bodyLarge)
                if (!philosophy?.author.isNullOrBlank()) NativeText("(${philosophy!!.author})",
                    Modifier.fillMaxWidth().padding(top = 8.dp).testTag("daily-advice-author"),
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.End)
                val names = copy.getJSONArray("categories")
                val categoryLabel = card.categories.joinToString(" · ") {
                    if (it == "aphrodisia" && card.aphrodisiaTheme != null) copy.getString(when(card.aphrodisiaTheme) {
                        "love" -> "themeLove"; "aesthetics" -> "themeAesthetics"; else -> "themeConsciousness"
                    }) else names.getString(adviceCategories.indexOf(it))
                }
                if(card.collection!="philosophers") NativeText(listOf(collectionsCopy.getString(card.collection), categoryLabel).filter { it.isNotBlank() }.joinToString(" · "),
                    Modifier.fillMaxWidth().testTag("daily-advice-attribution"), maxLines = 1, style = MaterialTheme.typography.bodySmall)
                }
                if (rotation != null && rotation.dailyLimit > 1) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                    .testTag("daily-advice-navigation"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (historyCount > 1) IconButton(onClick = { onPreviousSaved?.invoke() }, enabled = onPreviousSaved != null,
                        modifier = Modifier.size(48.dp).testTag("daily-advice-previous-saved")
                            .semantics { contentDescription = copy.getString("previousSaved") }) {
                        GenesisLucideIcon("chevron-left")
                    }
                    NativeText(copy.getString("position").replace("{current}", (viewingSequence ?: rotation.sequence).toString())
                        .replace("{limit}", rotation.dailyLimit.toString()) +
                        (if (!rotation.canNext) " · " + copy.getString("limitReached") else ""),
                    modifier = Modifier.weight(1f).testTag("daily-advice-position").semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                    if (historyCount > 1) IconButton(onClick = { onNextSaved?.invoke() }, enabled = onNextSaved != null,
                        modifier = Modifier.size(48.dp).testTag("daily-advice-next-saved")
                            .semantics { contentDescription = copy.getString("nextSaved") }) {
                        GenesisLucideIcon("chevron-right")
                    }
                }
                Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth().testTag("daily-advice-actions"),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                    val favoriteLabel = genesisTranslate("Избранное")
                    val dislikeLabel = genesisTranslate("Не нравится")
                    if (showReactions) {
                        IconToggleButton(checked = reaction == "favorite", onCheckedChange = { onReaction?.invoke("favorite") },
                            enabled = onReaction != null && !busy && !reactionBusy, modifier = Modifier.size(48.dp)
                                .testTag("daily-advice-favorite").semantics { contentDescription = favoriteLabel }) {
                            GenesisLucideIcon("thumbs-up")
                        }
                        IconToggleButton(checked = reaction == "dislike", onCheckedChange = { onReaction?.invoke("dislike") },
                            enabled = onReaction != null && !busy && !reactionBusy, modifier = Modifier.size(48.dp)
                                .testTag("daily-advice-dislike").semantics { contentDescription = dislikeLabel }) {
                            GenesisLucideIcon("thumbs-down")
                        }
                    }
                    if (rotation != null && rotation.dailyLimit > 1) {
                        val nextLabel = copy.getString("next")
                        IconButton(onClick = { onNext?.invoke() }, enabled = !busy && rotation.canNext,
                            modifier = Modifier.size(48.dp).testTag("daily-advice-next")
                                .semantics { contentDescription = nextLabel }) {
                            GenesisLucideIcon("refresh-cw")
                        }
                    }
                    if (onOpenDiary != null) IconButton(onClick = onOpenDiary,
                        modifier = Modifier.size(48.dp).testTag("daily-advice-diary")
                            .semantics { contentDescription = "Дневник" }) {
                        GenesisLucideIcon("book-open", Modifier.size(24.dp))
                    }
                    AdviceShareButton(card, bitmap, copy, authorizeShare) { shareFailed = it }
                }
                if (shareFailed) NativeText(copy.getString("shareError"), color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("daily-advice-share-error").semantics { liveRegion = LiveRegionMode.Polite })
                if (reactionBusy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                if (reactionError) Text("Не удалось сохранить. Черновик остаётся в дневнике.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (nextError) NativeText(copy.getString("nextError"), color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                if (hideError) NativeText(copy.getString("hideError"), color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("daily-advice-hide-error").semantics { liveRegion = LiveRegionMode.Polite })
                }
            }
        }
    }
}

@Composable internal fun DailyAdviceSettings(preferences: AdvicePreferences, available: List<String>, catalogAvailable: Boolean,
    language: String, enabled: Boolean, readyCollections: List<String> = listOf("aurora"), use24: Boolean = true,
    onSave: suspend (JSONObject) -> AdvicePreferences) {
    val copy = adviceCopy(language)
    val context = LocalContext.current
    val collectionsCopy = remember(context, language) { context.assets.open("originals/i18n/advice-collections-copy.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(language) } }
    val advanced=LocalFeatureAccess.current.allows("advice-settings")
    var saved by remember(preferences) { mutableStateOf(preferences) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var ageCategories by remember { mutableStateOf<List<String>?>(null) }
    var originOpen by remember { mutableStateOf(false) }
    var collectionTab by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(preferences.collections.first()) }
    val scope = rememberCoroutineScope()
    fun change(patch: JSONObject) {
        if (busy || !enabled) return
        busy = true; error = false
        scope.launch {
            try { saved = onSave(patch) }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { error = true }
            finally { busy = false }
        }
    }
    SettingsPreferenceCard(copy.getString("title"), Modifier.testTag("daily-advice-settings"),
        description = copy.getString("tradition")) {
            @Composable fun toggle(key: String, value: Boolean, label: String, hint: String, canChange: Boolean = true, action: (Boolean) -> Unit) {
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(key)
                    .toggleable(value, enabled = enabled && !busy && canChange, role = Role.Switch, onValueChange = action),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        NativeText(label, style = MaterialTheme.typography.titleSmall)
                        NativeText(hint, style = MaterialTheme.typography.bodyMedium)
                    }
                    Switch(value, null, enabled = enabled && !busy && canChange)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("aurora", "philosophers").forEach { collection ->
                        OutlinedButton({ collectionTab = collection }, selected = collectionTab == collection,
                            modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp)
                            .testTag("advice-source-tab-$collection"), contentPadding = PaddingValues(8.dp),
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (collectionTab == collection)
                                MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent)) {
                            NativeText(collectionsCopy.getString(collection), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                NativeText(collectionsCopy.getString("title"), style = MaterialTheme.typography.titleSmall)
                listOf("aurora", "philosophers").filter { it == collectionTab }.forEach { collection ->
                    toggle("advice-collection-$collection", collection in saved.collections, collectionsCopy.getString(collection),
                        if(collection == "philosophers") collectionsCopy.getString(if(collection in readyCollections) "ready" else "pending") else "",
                        canChange = saved.collections.size > 1 || collection !in saved.collections) { checked ->
                        change(JSONObject().put("collections", JSONArray(listOf("aurora", "philosophers").filter { if(it == collection) checked else it in saved.collections })))
                    }
                }
                NativeText(collectionsCopy.getString("hint"), style = MaterialTheme.typography.bodyMedium)
                if (collectionTab == "philosophers") {
                    NativeText(collectionsCopy.getString("dailyCount"), style = MaterialTheme.typography.titleSmall)
                    Row(Modifier.fillMaxWidth().selectableGroup().testTag("advice-philosophers-per-day"),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        (1..3).forEach { count ->
                            OutlinedButton(onClick = { change(JSONObject().put("philosophersPerDay", count)) }, selected = saved.philosophersPerDay == count,
                                enabled = enabled && !busy && saved.enabled && "philosophers" in saved.collections,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics {
                                    role = Role.RadioButton; selected = saved.philosophersPerDay == count
                                    contentDescription = "${collectionsCopy.getString("dailyCount")}: $count"
                                }, colors = ButtonDefaults.outlinedButtonColors(containerColor = if (saved.philosophersPerDay == count)
                                    MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent)) {
                                NativeText(count.toString())
                            }
                        }
                    }
                }
                if (collectionTab == "aurora") {
                val auroraEnabled = "aurora" in saved.collections
                if(!advanced) {
                    NativeText(if(language=="en") "One advice per day. Category and mode settings are available with Standard and above." else "Один совет в день. Настройки категорий и режима доступны в Standard и выше.")
                    NativeUpgradePrompt("advice-settings")
                }
                val selected = available.filter { it in saved.categories }.ifEmpty { available.take(1) }
                toggle("advice-smart", saved.smart, copy.getString("smart"), copy.getString("smartHint"),canChange=advanced && auroraEnabled) {
                    change(JSONObject().put("smart", it).put("categories", JSONArray(selected)))
                }
                if (saved.smart) NativeText(copy.getString("fallback"), style = MaterialTheme.typography.bodyMedium)
                else {
                    NativeText(copy.getString("choose"), style = MaterialTheme.typography.titleSmall)
                    adviceCategories.forEachIndexed { index, category ->
                        val checked = category in selected
                        val canChange = advanced && auroraEnabled && enabled && !busy && category in available && (!checked || selected.size > 1)
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("advice-category-" + category)
                            .toggleable(checked, enabled = canChange, role = Role.Checkbox) { check ->
                                val categories = available.filter {
                                    if (it == category) check else it in selected
                                }
                                if (category == "aphrodisia" && check) ageCategories = categories
                                else change(JSONObject().put("categories", JSONArray(categories)))
                            }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Checkbox(checked, null, enabled = canChange)
                            Column(Modifier.weight(1f)) {
                                NativeText(copy.getJSONArray("categories").getString(index), style = MaterialTheme.typography.titleSmall)
                                NativeText(copy.getJSONArray("categoryHints").getString(index) +
                                    if (category !in available) " · " + copy.getString("comingSoon") else "",
                                    style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                    NativeText(copy.getString("oneCategory"), style = MaterialTheme.typography.bodyMedium)
                }
                if (advanced && saved.smart && "aphrodisia" in available) {
                    val checked = "aphrodisia" in selected
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("advice-category-aphrodisia")
                        .toggleable(checked, enabled=auroraEnabled && enabled && !busy, role=Role.Checkbox) { check ->
                            val categories=available.filter { if(it=="aphrodisia") check else it in selected }
                            if(check) ageCategories=categories else change(JSONObject().put("categories",JSONArray(categories)))
                        }, verticalAlignment=Alignment.CenterVertically) {
                        Checkbox(checked,null,enabled=auroraEnabled && enabled && !busy)
                        NativeText(copy.getJSONArray("categories").getString(4),Modifier.weight(1f))
                    }
                }
                if (advanced && "aphrodisia" in available && "aphrodisia" in selected) {
                    OutlinedButton(onClick = { ageCategories = saved.categories }, enabled = auroraEnabled && enabled && !busy,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("advice-age-manage")) { NativeText(copy.getString("ageManage"), textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
                    NativeText(copy.getString(if(saved.aphrodisiaAdult == true) "ageAllowed" else "ageRestricted"), style = MaterialTheme.typography.bodyMedium)
                }
                AdvicePsychopompiaControls(saved.psychopompia, language, auroraEnabled && saved.enabled && enabled && !busy,
                    errorMessage = if (error) copy.getString("saveError") else null) {
                    change(JSONObject().put("psychopompia", it.toJson()))
                }
                }
                HorizontalDivider()
                NativeText(collectionsCopy.getString("common"), style = MaterialTheme.typography.titleSmall)
                toggle("advice-enabled", saved.enabled, copy.getString("enable"), copy.getString("enableHint")) {
                    change(JSONObject().put("enabled", it))
                }
                AdviceNotificationControls(saved, language, use24, enabled, busy, ::change)
                NativeText(copy.getString("scopeHint"), style = MaterialTheme.typography.bodyMedium)
                if (!catalogAvailable) NativeText(copy.getString("pending"), style = MaterialTheme.typography.bodyMedium)
            }
            if (error) NativeText(copy.getString("saveError"), color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("daily-advice-settings-error").semantics { liveRegion = LiveRegionMode.Polite })
            OutlinedButton({ originOpen = true }, Modifier.fillMaxWidth().testTag("advice-origin-open"),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary)) {
                GenesisLucideIcon("book-open", Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                NativeText(copy.getString("privacyTitle"), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
    }
    if (originOpen) AlertDialog(onDismissRequest = { originOpen = false }, title = { NativeText(copy.getString("privacyTitle")) },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            NativeText(copy.getString("privacyNotice"), style = MaterialTheme.typography.bodyMedium)
            NativeText(copy.getString("ageLegal"), style = MaterialTheme.typography.bodyMedium)
        } }, confirmButton = {})
    ageCategories?.let { categories -> AlertDialog(onDismissRequest = { ageCategories = null },
        title = { NativeText(copy.getString("ageQuestion")) }, text = { NativeText(copy.getString("ageHint")) },
        confirmButton = { TextButton(onClick = { ageCategories = null; change(JSONObject().put("categories", JSONArray(categories)).put("aphrodisiaAdult", true)) },
            modifier = Modifier.heightIn(min = 48.dp).testTag("advice-age-yes")) { NativeText(copy.getString("ageYes")) } },
        dismissButton = { TextButton(onClick = { ageCategories = null; change(JSONObject().put("categories", JSONArray(categories)).put("aphrodisiaAdult", false)) },
            modifier = Modifier.heightIn(min = 48.dp).testTag("advice-age-no")) { NativeText(copy.getString("ageNo")) } }) }
}
