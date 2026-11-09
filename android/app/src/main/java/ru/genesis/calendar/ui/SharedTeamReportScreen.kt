package ru.genesis.calendar.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun SharedTeamReportScreen(controller: SharedWorkspaceGateway, spaceId: String, projectId: String, projectTitle: String,
    initialFilter: JSONObject, initialMode: CalendarMode, statuses: List<JSONObject>, onClose: () -> Unit, onLost: () -> Unit) {
    key(controller, LocalGenesisUserId.current, spaceId, projectId) {
        val context = LocalContext.current
        val preferences by produceState<UiPreferences?>(null) {
            val app = context.applicationContext as? GenesisApplication
            value = if (app == null) UiPreferences() else LocalPreferences(context, app.workspaceScope).values.first()
        }
        val settings = preferences
        if (settings == null) Dialog(onClose) { Surface { Column(Modifier.padding(16.dp)) { EditorDialogHeader("Загрузка…", "loading-close", onClose); WorkspaceLoadingIndicator() } } }
        else TeamReportContent(controller, spaceId, projectId, projectTitle, initialFilter, initialMode, statuses, settings, onClose, onLost)
    }
}

@Composable private fun TeamReportContent(controller: SharedWorkspaceGateway, space: String, project: String, title: String,
    initialFilter: JSONObject, initialMode: CalendarMode, statuses: List<JSONObject>, preferences: UiPreferences,
    onClose: () -> Unit, onLost: () -> Unit) {
    val calendars = if (LocalSacredFeaturesEnabled.current) LocalEnabledCalendars.current else setOf(CalendarMode.PROFANE)
    val initial = remember {
        val mode = initialMode.takeIf { it in calendars } ?: CalendarMode.PROFANE
        val zone = DataExportProtocol.timeZone(ZoneId.systemDefault().id)?.id ?: "UTC"
        val start = if (preferences.gregorianYearStartsInMarch) "march" else "january"
        val range = GenesisCalendar(ZoneId.of(zone), 2, start).monthRange(LocalDate.now(ZoneId.of(zone)), mode)
        JSONObject().put("filter", JSONObject(initialFilter.toString())).put("from", range.start.toString()).put("to", range.end.toString())
            .put("calendarMode", mode.wireValue).put("calendarContext", JSONObject().put("version", 2).put("timeZone", zone).put("gregorianYearStart", start))
            .put("cycleStartStatusIds", JSONArray())
    }
    var savedOptions by rememberSaveable { mutableStateOf(initial.toString()) }
    val lost by rememberUpdatedState(onLost)
    val state = remember { TeamReportState(controller, JSONObject(savedOptions)) { lost() } }
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    var pane by rememberSaveable { mutableStateOf("summary") }
    val estimateHeading = sharedPlanningCopy().getString("estimates")
    val sections = listOf("summary" to "Все задачи", "conditions" to "Фильтры и период отчёта", "members" to "Распределение задач по участникам",
        "time" to "Время цикла", "daily" to "Динамика выбранных задач", "estimates" to estimateHeading)
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    val compactHeader = LocalConfiguration.current.screenWidthDp < 720
    val showFooter = state.busy || state.error.isNotBlank() || ((pane == "conditions" || state.report == null) && state.metric == null)
    fun update(value: JSONObject) { state.change(value); savedOptions = value.toString() }
    fun back() { if (state.metric != null || state.task != null) state.back() else onClose() }
    DisposableEffect(state) { onDispose { state.close() } }
    DisposableEffect(state, context) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) { if (manager?.activeNetwork == null) scope.launch { state.goOffline() } }
        }
        val registered = runCatching { manager?.registerDefaultNetworkCallback(callback); manager != null }.getOrDefault(false)
        onDispose { if (registered) runCatching { manager?.unregisterNetworkCallback(callback) }; Unit }
    }
    LaunchedEffect(state) { state.refresh() }
    LaunchedEffect(state, calendars) {
        if (CalendarMode.fromWire(state.options.getString("calendarMode")) !in calendars)
            update(JSONObject(state.options.toString()).put("calendarMode", (calendars.firstOrNull() ?: CalendarMode.PROFANE).wireValue))
    }
    LaunchedEffect(state, lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        if (!lifecycle.isAtLeast(Lifecycle.State.STARTED)) return@LaunchedEffect
        state.check(); while (isActive) { delay(30000); state.check() }
    }
    @Composable fun Navigation(modifier: Modifier, compact: Boolean) {
        if (compact) ImportChoice("Просмотр", pane, sections.map { it.first to genesisTranslate(it.second) }, !state.busy, "team-section") { value -> state.back(); pane = value }
        else Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            sections.forEach { (id, label) ->
                OutlinedButton({ state.back(); pane = id }, enabled = !state.busy, selected = pane == id,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-section-$id"),
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = if (pane == id) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                        contentColor = if (pane == id) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurface)) { Text(label, Modifier.fillMaxWidth()) }
            }
        }
    }
    @Composable fun Header(compact: Boolean) {
        val actions: @Composable RowScope.() -> Unit = {
            AffairsIconButton("Обновить отчёт", AffairsAction.REFRESH, { scope.launch { state.refresh() } }, Modifier.testTag("team-refresh"), !state.busy && !state.lost)
            AffairsIconButton("Закрыть", AffairsAction.CLOSE, onClose, Modifier.testTag("team-close"))
        }
        if (compact) AffairsDialogHeader("Отчёт", onClose = null, onBack = ::back, backTag = "affairs-back", compact = true, actions = actions)
        else AffairsPageHeader(if (compactHeader) "Отчёт" else "Отчёт по совместной работе", title, contextIsUserContent = true,
            contextMaxLines = 2, onBack = ::back, actions = actions)
    }
    @Composable fun Footer(compact: Boolean) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 16.dp)) {
            if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("team-loading"))
            if (state.error.isNotBlank()) Text(teamReportError(state.error), Modifier.testTag("team-error").semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            if ((pane == "conditions" || state.report == null) && state.metric == null) Button({ scope.launch { state.refresh() } },
                enabled = !state.busy && !state.lost, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-apply")) { Text("Обновить отчёт") }
        }
    }
    @Composable fun Body(modifier: Modifier, compact: Boolean, chromeInside: Boolean) {
        val scroll = androidx.compose.foundation.lazy.rememberLazyListState()
        LaunchedEffect(pane, state.metric, state.task?.optString("id")) { scroll.scrollToItem(0) }
        LazyColumn(modifier.testTag("team-content"), state = scroll, verticalArrangement = Arrangement.spacedBy(if (chromeInside) 8.dp else 16.dp)) {
            if (chromeInside) item(key = "chrome:header") { Header(true) }
            if (compact && state.metric == null) item(key = "chrome:navigation") { Navigation(Modifier.fillMaxWidth(), true) }
            val task = state.task; val sources = state.sources
            when {
                task != null -> item(key = "content:task") {
                    Column(Modifier.fillMaxWidth().testTag("team-task"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        TeamHeading("Задача")
                        UntranslatedText(task.getString("title"), style = MaterialTheme.typography.titleLarge)
                        task.optString("description").takeIf { it.isNotBlank() }?.let { UntranslatedText(it, style = MaterialTheme.typography.bodyMedium) }
                        if (!task.isNull("archivedAt")) Text("Архив")
                        SharedTaskEstimates(task, sharedTaskDetailDraft(task), true, false, true, {})
                        SharedTaskDetailsFields(task, sharedTaskDetailDraft(task), {}, true)
                    }
                }
                state.metric != null -> {
                    item(key = "content:sources") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            TeamHeading("Точная выборка задач")
                            if (sources != null) UntranslatedText("${sources.getJSONArray("tasks").length()} / ${sources.getInt("total")}", Modifier.testTag("team-source-count"), style = MaterialTheme.typography.bodyMedium)
                            if (sources?.getInt("total") == 0) Text("Задач нет.")
                        }
                    }
                    items(sources?.let { importRows(it.getJSONArray("tasks")) }.orEmpty(), key = { "task:${it.getString("id")}" }) { reference ->
                        TextButton({ scope.launch { state.openTask(reference) } }, enabled = state.ready,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-source-${reference.getString("id")}")) {
                            UntranslatedText(reference.getString("title"), Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (sources?.isNull("nextCursor") == false) item(key = "content:more") {
                        OutlinedButton({ state.metric?.let { scope.launch { state.choose(it, true) } } }, enabled = state.ready,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-sources-more")) { Text("Показать ещё") }
                    }
                }
                pane == "conditions" -> item(key = "content:conditions") {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) { TeamReportFields(state, space, project, calendars, statuses, ::update) }
                }
                state.report != null -> item(key = "content:report") {
                    key(state.report) {
                        CompositionLocalProvider(LocalTeamReportChoose provides { selected: String -> scope.launch { state.choose(selected) }; Unit }) {
                            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) { TeamReportSections(state, pane) }
                        }
                    }
                }
            }
            if (chromeInside && showFooter) item(key = "chrome:footer") { Footer(true) }
            item(key = "chrome:space") { Spacer(Modifier.height(8.dp)) }
        }
    }
    Dialog(onDismissRequest = ::back, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        val evening = LocalEveningTheme.current
        SideEffect { window?.let { WindowInsetsControllerCompat(it, it.decorView).apply {
            isAppearanceLightStatusBars = !evening; isAppearanceLightNavigationBars = !evening
        } } }
        GenesisModalFrame(::back) {
            val compactIme = WindowInsets.ime.getBottom(LocalDensity.current) > 0 && maxHeight < 360.dp
            val spacing = if (compactIme) 8.dp else 16.dp
            // Preserve a full input row above a landscape IME, including enlarged text.
            Column(Modifier.fillMaxWidth().padding(horizontal = spacing, vertical = if (compactIme) 0.dp else spacing)
                .testTag("shared-team-report"), verticalArrangement = Arrangement.spacedBy(spacing)) {
                if (!compactIme) Header(false)
                BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth()) {
                    val wideNavigation = maxWidth >= 720.dp && !compactIme
                    // Keep Body at one call site so IME resizing preserves the focused input.
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        if (wideNavigation)
                            Navigation(Modifier.width(248.dp).verticalScroll(rememberScrollState()), false)
                        Body(Modifier.weight(1f), !wideNavigation, compactIme)
                    }
                }
                if (!compactIme && showFooter) Footer(false)
            }
        }
    }
}

internal fun teamReportError(code: String): String = when (code) {
    "NETWORK" -> "Для отчёта подключитесь к интернету."
    "UNAUTHORIZED", "NOT_DEPLOYED" -> "Нет доступа"
    "REPORT_CHANGED", "SHARED_QUERY_CHANGED" -> "Данные изменились. Обновите отчёт; выбранные условия сохранены."
    "REPORT_STATUS_CHANGED" -> "Выберите доступный незавершённый статус для начала цикла."
    "REPORT_PERIOD_INVALID" -> "Укажите корректный период не длиннее 10 лет."
    "REPORT_CONTEXT_INVALID" -> "Обновите календарный контекст отчёта."
    "REPORT_TOKEN_INVALID", "REPORT_METRIC_INVALID" -> "Обновите отчёт и повторите переход к задачам."
    else -> "Не удалось загрузить отчёт. Условия сохранены; повторите попытку."
}
