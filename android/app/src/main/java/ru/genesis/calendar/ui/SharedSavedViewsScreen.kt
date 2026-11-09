package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedBulkProtocol
import ru.genesis.calendar.auth.SavedViewProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences

internal fun savedViewMessage(code: String): String = when (code) {
    "VIEW_CONFLICT", "PLANNING_DRAFT_CHANGED" -> "Представление изменилось. Обновите его или сохраните копию."
    "VIEW_FILTER_UNAVAILABLE", "VIEW_INVALID", "INVALID_TASK_FILTER", "CUSTOM_FIELD_UNAVAILABLE", "CUSTOM_FIELD_SORT_INVALID", "CUSTOM_FIELD_FILTER_INVALID" -> "Часть условий больше недоступна. Исправьте представление перед открытием."
    "VIEW_SCOPE_IMMUTABLE" -> "Для изменения области или видимости сохраните копию."
    "VIEW_RECEIPT_INVALID", "VIEW_PROTOCOL", "PLANNING_DRAFT_PENDING" -> "Ответ о сохранении не получен. Черновик сохранён; повторите попытку."
    "VIEW_LIMIT" -> "Достигнут лимит представлений. Удалите ненужное и повторите."
    "SHARED_FORBIDDEN", "SHARED_PROJECT_FORBIDDEN", "SHARED_SPACE_FORBIDDEN", "NOT_FOUND", "SHARED_PROJECT_NOT_FOUND" -> "Доступ к данным закрыт."
    "PLANNING_DRAFT_STORAGE", "PLANNING_DRAFT_INVALID" -> "Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию."
    else -> "Не удалось загрузить данные"
}

@Composable internal fun SharedSavedViewsScreen(gateway: SharedWorkspaceGateway, spaces: List<JSONObject>, prefs: UiPreferences,
    onClose: () -> Unit, onTask: (String, String) -> Unit) {
    val account = LocalGenesisUserId.current
    val state = remember(gateway, account) { SharedSavedViewsState(gateway) }
    val scope = rememberCoroutineScope()
    var detail by rememberSaveable(account) { mutableStateOf(false) }
    var conditions by rememberSaveable(account) { mutableStateOf(false) }
    var bulkOrigin by rememberSaveable(account) { mutableStateOf<String?>(null) }
    val conditionsOpen by rememberUpdatedState(conditions || bulkOrigin != null)
    var replace by remember { mutableStateOf<(() -> Unit)?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var leave by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    val active = lifecycle.isAtLeast(Lifecycle.State.STARTED) && LocalNavigationPageContext.current?.active != false
    fun close() { scope.launch { if (state.dirty) state.saveLocal(); if (state.dirty) leave = true else onClose() } }
    fun select(action: () -> Unit) { if (state.dirty) replace = action else action() }
    val newTitle = genesisTranslate("Представление")
    LaunchedEffect(state, active) {
        if (!active) { if (state.dirty) state.saveLocal(); state.pause(); return@LaunchedEffect }
        state.load(); if (state.edit != null) { detail = true; conditions = state.queryJson == null }
        while (isActive) { delay(5000); if (state.queryJson != null && !conditionsOpen) state.refreshResults() }
    }
    LaunchedEffect(state.version, state.busy) { if (state.dirty && !state.busy && !state.locked) { delay(250); state.saveLocal() } }
    DisposableEffect(state) { onDispose { scope.launch(NonCancellable) { try { if (state.dirty) state.saveLocal() } finally { state.pause() } } } }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler { if (conditions) conditions = false else if (detail) detail = false else close() }
        GenesisModalFrame(::close) {
            val wide = maxWidth >= 864.dp
                Column(Modifier.testTag("saved-views-screen")) {
                    AffairsDialogHeader("Сохранённые представления", onClose = ::close,
                        onBack = if (detail && !wide) ({ if (conditions) conditions = false else detail = false }) else null,
                        closeTag = "saved-views-close", backTag = "saved-views-back")
                    if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("saved-view-progress"))
                    HorizontalDivider()
                    if (state.error.isNotBlank()) Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(savedViewMessage(state.error), Modifier.weight(1f).testTag("saved-view-error")
                            .semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error)
                        AffairsIconButton("Обновить", AffairsAction.REFRESH, { scope.launch { state.load() } }, enabled = !state.busy)
                    }
                    Row(Modifier.weight(1f, fill = false)) {
                        if (wide || !detail) Column(Modifier.then(if (wide) Modifier.width(304.dp) else Modifier.fillMaxWidth())
                            .verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            if (!wide && !detail && state.edit != null) OutlinedButton({ detail = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Продолжить") }
                            SavedViewLibrary(state, prefs, newTitle, onNew = { definition, preset -> select {
                                scope.launch { if (preset) state.preset(definition) else state.begin(definition); detail = true; conditions = !preset }
                            } }, onSelect = { id -> select { scope.launch { state.select(id); detail = true; conditions = state.queryJson == null } } },
                                onRefresh = { scope.launch { state.load() } }, onMore = { scope.launch { state.moreViews() } })
                        }
                        if (wide) VerticalDivider()
                        if (wide || detail) Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).testTag("saved-view-detail-scroll").padding(16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                            if (state.edit == null) Text("Собирайте задачи из доступных проектов по нужным условиям. Представление сохраняет фильтры, а задачи остаются в своих проектах.")
                            else {
                                val title = state.definition?.getString("title") ?: newTitle
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    UntranslatedText(title, Modifier.weight(1f).testTag("saved-view-title"), style = MaterialTheme.typography.titleMedium)
                                    AffairsIconButton(if (conditions) "Свернуть" else "Изменить условия", if (conditions) AffairsAction.COLLAPSE else AffairsAction.EDIT,
                                        { conditions = !conditions }, Modifier.testTag("saved-view-conditions").semantics { stateDescription = if (conditions) "expanded" else "collapsed" })
                                }
                                if (state.phase == "pending") {
                                    Text(if (state.record?.optInt("attempts") == 0) {
                                        if (state.edit?.optString("kind") == "view-delete") "Удалить представление? Задачи сохранятся." else "Сохранить представление?"
                                    } else "Ответ о сохранении не получен. Черновик сохранён; повторите попытку.")
                                    Button({ scope.launch { state.send() } }, Modifier.heightIn(min = 48.dp).testTag("saved-view-send"), enabled = !state.busy) {
                                        Text(if (state.record?.optInt("attempts") == 0) "Подтвердить" else "Повторить запрос")
                                    }
                                    if (state.record?.optInt("attempts") == 0) TextButton({ scope.launch { state.cancelPrepared() } }, enabled = !state.busy) { Text("Вернуться к редактированию") }
                                } else if (state.phase == "received") {
                                    Text("Сохранено")
                                    Button({ scope.launch { state.finish() } }, Modifier.heightIn(min = 48.dp).testTag("saved-view-finish"), enabled = !state.busy) { Text("Продолжить") }
                                } else if (state.phase == "rejected") {
                                    Text(savedViewMessage(state.record?.optString("error").orEmpty()), color = MaterialTheme.colorScheme.error)
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (state.source != null) OutlinedButton({ scope.launch { state.rebase() } }, enabled = !state.busy) { Text("Обновить") }
                                        OutlinedButton({ scope.launch { state.copy() } }, enabled = !state.busy) { Text("Сохранить копию") }
                                    }
                                }
                                if (conditions) SavedViewConditions(gateway, state, spaces, prefs)
                                if (conditions && !state.locked) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button({ scope.launch { state.apply(); if (state.queryJson != null) conditions = false } }, Modifier.heightIn(min = 48.dp).testTag("saved-view-apply"),
                                        enabled = !state.busy && !state.locked && state.definition != null) { Text("Показать задачи") }
                                    if (state.source?.optBoolean("canEdit") != false) Button({ scope.launch { state.prepare() } }, Modifier.heightIn(min = 48.dp).testTag("saved-view-save"),
                                        enabled = !state.busy && !state.locked && state.definition != null) { Text("Сохранить") }
                                    AffairsIconButton("Сохранить копию", AffairsAction.TEMPLATE, { scope.launch { state.copy(); conditions = true } },
                                        Modifier.testTag("saved-view-copy"), enabled = !state.busy && state.phase in setOf("editing", "received", "rejected") && state.definition != null)
                                    if (state.source?.optBoolean("canEdit") == true) AffairsIconButton("Удалить представление", AffairsAction.DELETE, { confirmDelete = true },
                                        Modifier.testTag("saved-view-delete"), enabled = !state.busy && !state.locked)
                                    if (state.record != null && state.phase == "editing") AffairsIconButton("Сбросить", AffairsAction.UNDO, { replace = { scope.launch { state.cancel(); detail = false } } },
                                        Modifier.testTag("saved-view-reset"), enabled = !state.busy)
                                }
                                if (!conditions && state.queryJson != null && state.results.pageState.value?.optInt("total")?.let { it > 0 } == true) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                        AffairsIconButton("Массовые действия", AffairsAction.TASK, {
                                            bulkOrigin = JSONObject().put("filter", JSONObject(requireNotNull(state.queryJson))).put("sort", "position").put("title", title).toString()
                                        }, Modifier.testTag("saved-view-bulk"), enabled = !state.busy && !state.results.busy)
                                    }
                                }
                                SavedViewResults(state, onTask, { scope.launch { state.moreTasks() } })
                            }
                        }
                    }
                }
        }
    }
    bulkOrigin?.let { raw ->
        val origin = JSONObject(raw)
        SharedBulkScreen(gateway, SharedBulkProtocol.QUERY_SCOPE, origin.getJSONObject("filter"), origin.getString("sort"), prefs,
            onClose = { bulkOrigin = null; scope.launch { state.refreshResults() } },
            onLost = { bulkOrigin = null; state.pause() }, onChanged = {},
            onTask = { project, task -> bulkOrigin = null; onTask(project, task) }, origin = origin)
    }
    if (replace != null) AlertDialog(onDismissRequest = { replace = null }, title = { Text("Заменить несохранённые условия представления?") },
        confirmButton = { TextButton({ val action = replace; replace = null; action?.invoke() }) { Text("Продолжить") } },
        dismissButton = { TextButton({ replace = null }) { Text("Отмена") } })
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Удалить представление? Задачи сохранятся.") },
        confirmButton = { TextButton({ confirmDelete = false; scope.launch { state.prepare(true) } }, Modifier.testTag("saved-view-delete-confirm")) { Text("Удалить") } },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("Отмена") } })
    if (leave) AlertDialog(onDismissRequest = { leave = false }, title = { Text("Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию.") },
        confirmButton = { TextButton({ leave = false }) { Text("Вернуться к редактированию") } })
}

@Composable private fun SavedViewLibrary(state: SharedSavedViewsState, prefs: UiPreferences, newTitle: String,
    onNew: (JSONObject, Boolean) -> Unit, onSelect: (String) -> Unit, onRefresh: () -> Unit, onMore: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Быстрые подборки", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium)
        AffairsIconButton("Новое представление", AffairsAction.ADD, { onNew(freshSavedView(prefs, newTitle), false) }, Modifier.testTag("saved-view-new"), enabled = !state.busy && !state.locked)
        AffairsIconButton("Обновить", AffairsAction.REFRESH, onRefresh, Modifier.testTag("saved-view-refresh"), enabled = !state.busy)
    }
    val presets = listOf("Назначено мне", "Создано мной", "Просрочено", "На этой неделе", "Без исполнителя", "Ожидает утверждения")
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { presets.forEachIndexed { index, label ->
        val title = genesisTranslate(label)
        TextButton({ val definition = freshSavedView(prefs, title); val filter = definition.getJSONObject("filter")
            when (index) { 0 -> filter.put("assigneeIds", org.json.JSONArray().put("me")); 1 -> filter.put("createdBy", "me")
                2 -> definition.put("relative", "overdue"); 3 -> definition.put("relative", "this-week")
                4 -> filter.put("assigneeIds", org.json.JSONArray().put("unassigned")); 5 -> filter.put("approvalPending", true) }
            onNew(definition, true)
        }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("saved-view-preset-$index"), enabled = !state.busy && !state.locked) {
            Text(label, Modifier.fillMaxWidth())
        }
    } }
    HorizontalDivider()
    Text("Ваши подборки", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
    val rows = state.library?.getJSONArray("views")?.let(::importRows).orEmpty()
    if (rows.isEmpty() && !state.busy && state.error.isBlank()) Text("Пока нет сохранённых представлений.")
    rows.forEach { view ->
        Column(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(enabled = !state.busy && !state.locked) { onSelect(view.getString("id")) }
            .padding(vertical = 8.dp).testTag("saved-view-open-${view.getString("id")}"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            UntranslatedText(view.optJSONObject("definition")?.optString("title") ?: newTitle, style = MaterialTheme.typography.bodyLarge)
            Text(if (view.getBoolean("invalid")) "Условия недоступны" else if (view.getString("visibility") == "shared") "Общее" else "Личное", style = MaterialTheme.typography.bodySmall)
        }
    }
    if (state.library?.optBoolean("hasMore") == true) OutlinedButton(onMore, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !state.busy) { Text("Показать ещё") }
}

@Composable private fun SavedViewResults(state: SharedSavedViewsState, onTask: (String, String) -> Unit, onMore: () -> Unit) {
    if (state.queryJson == null) return
    val reader = state.results
    Text("Задачи", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
    if (reader.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
    if (reader.error.isNotBlank()) Text(savedViewMessage(reader.error), Modifier.testTag("saved-view-results-error"), color = MaterialTheme.colorScheme.error)
    val page = reader.pageState.value ?: return
    val rows = importRows(page.getJSONArray("tasks"))
    val locale = java.util.Locale.forLanguageTag(LocalGenesisLanguage.current)
    val numbers = java.text.NumberFormat.getIntegerInstance(locale)
    UntranslatedText(genesisTranslate("Показано: {shown} из {total}").replace("{shown}", numbers.format(rows.size)).replace("{total}", numbers.format(page.getInt("total"))), Modifier.testTag("saved-view-count"))
    if (rows.isEmpty()) Text("Задач пока нет")
    rows.forEach { task ->
        Surface(onClick = { onTask(task.getString("projectId"), task.getString("id")) }, shape = AffairsLayout.shape,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("saved-view-task-${task.getString("id")}")) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                UntranslatedText(task.getString("title"), style = MaterialTheme.typography.bodyLarge)
                UntranslatedText(task.optString("projectTitle"), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    if (page.getBoolean("hasMore")) OutlinedButton(onMore, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("saved-view-more-tasks"), enabled = !state.busy && !reader.busy) { Text("Показать ещё") }
}
