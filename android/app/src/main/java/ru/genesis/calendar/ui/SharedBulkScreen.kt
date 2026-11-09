package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedBulkProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

internal fun bulkKindLabel(kind: String) = when (kind) {
    "priority" -> "Приоритет"; "assignee" -> "Исполнитель"; "status" -> "Статус"; "due" -> "Срок"; "labels" -> "Метки"
    "move" -> "Перенести"; "archive" -> "В архив"; "trash" -> "В корзину"; else -> "Действие"
}
internal fun bulkStateLabel(state: String) = when (state) {
    "preview" -> "Предварительный просмотр"; "running" -> "Выполняется"; "done" -> "Завершено"; "cancelled" -> "Отменено"
    "failed" -> "Не удалось завершить"; "pending" -> "Ожидает"; "succeeded" -> "Выполнено"; "skipped" -> "Пропущено"; else -> "Ошибка"
}
internal fun bulkErrorText(code: String) = when {
    code == "BULK_LOCAL_QUEUE" -> "Сначала синхронизируйте изменения задач."
    code == "BULK_PREVIEW_EXPIRED" -> "Предварительный просмотр истёк. Создайте новую операцию."
    code in setOf("SHARED_QUERY_CHANGED", "SHARED_TASK_CONFLICT", "BULK_SCOPE_CHANGED", "BULK_RESELECT_REQUIRED") -> "Задачи изменились. Обновите выборку и выберите задачи заново."
    code == "BULK_TREE_CHANGED" -> "Состав подзадач изменился. Обновите выборку перед повтором."
    code == "BULK_NO_DUE" -> "У задачи нет срока для сдвига."
    code == "BULK_STATUS_REQUIRED" -> "Для проекта не выбран статус."
    code in setOf("BULK_NOT_ALLOWED", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "UNAUTHORIZED") -> "Недостаточно прав или задача недоступна."
    code == "INVALID_ASSIGNEE" -> "Исполнитель недоступен в этом проекте."
    code == "INVALID_STATUS" -> "Статус больше недоступен в этом проекте."
    code == "INVALID_LABEL" -> "Метка недоступна в этом пространстве."
    code == "TASK_APPROVAL_REQUIRED" -> "Сначала требуется утверждение результата."
    code == "CUSTOM_FIELD_MOVE_REQUIRES_MAPPING" -> "Перенос с пользовательскими полями требует сопоставления. Сохраните данные через экспорт."
    code == "PLANNING_DRAFT_CHANGED" -> "Операция изменена в другом окне. Откройте сохранённую операцию."
    code == "PLANNING_DRAFT_PENDING" -> "Результат отправки пока не подтверждён. Повторите ту же команду."
    code in setOf("NETWORK", "BULK_ONLINE_REQUIRED") -> "Нет связи. Подключитесь к интернету и обновите экран."
    code == "BULK_SCOPE_LIMIT" -> "Слишком много проектов. Уточните фильтры и повторите."
    code == "BULK_SELECTION_LIMIT" -> "Можно выбрать до 1000 задач или все результаты по фильтрам."
    code.startsWith("WORKFLOW_") -> "Переход недоступен по правилам процесса. Откройте задачу и проверьте условия."
    else -> "Не удалось получить ответ. Обновите отчёт или повторите запрос."
}

@Composable internal fun SharedBulkScreen(controller: SharedWorkspaceGateway, projectId: String, initialFilter: JSONObject, sort: String,
    preferences: UiPreferences, onClose: () -> Unit, onLost: () -> Unit, onChanged: () -> Unit, onTask: (String, String) -> Unit, origin: JSONObject? = null) {
    key(controller, LocalGenesisUserId.current, projectId) {
        var savedForm by rememberSaveable { mutableStateOf(SharedBulkForm.initial().saved()) }
        var savedOperation by rememberSaveable { mutableStateOf("") }
        var savedCalendar by rememberSaveable { mutableStateOf(SharedCustomCalendar.initial(preferences).saved().toString()) }
        val lost by rememberUpdatedState(onLost); val changed by rememberUpdatedState(onChanged)
        val state = remember { SharedBulkState(controller, projectId, JSONObject(initialFilter.toString()), sort, savedForm, savedOperation,
            { savedForm = it }, { savedOperation = it }, { lost() }, { changed() }, origin, JSONObject(savedCalendar)) }
        val calendar = runCatching { SharedCustomCalendar.restore(JSONObject(state.calendarJson ?: savedCalendar)) }.getOrElse { SharedCustomCalendar.initial(preferences) }
        val scope = rememberCoroutineScope(); val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
        val active = lifecycle.isAtLeast(Lifecycle.State.STARTED) && LocalNavigationPageContext.current?.active != false
        val night = LocalEveningTheme.current
        var stopWarning by remember { mutableStateOf(false) }
        var leaveWarning by remember { mutableStateOf(false) }
        fun close() { scope.launch { if (state.saveInput()) onClose() else leaveWarning = true } }
        DisposableEffect(state) { onDispose { scope.launch(NonCancellable) { try { state.saveInput() } finally { state.close() } } } }
        LaunchedEffect(state.version, state.busy) { if (state.dirty && !state.busy) { delay(250); state.saveInput() } }
        LaunchedEffect(state, active) {
            if (!active) { state.saveInput(); state.pause(); return@LaunchedEffect }
            state.load()
            while (isActive) { delay(5000); state.poll() }
        }
        Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            BackHandler { close() }
            val view = LocalView.current
            SideEffect { (view.parent as? DialogWindowProvider)?.window?.let { WindowInsetsControllerCompat(it, view).isAppearanceLightStatusBars = !night } }
            BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Surface(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().padding(12.dp).heightIn(max = maxHeight * .94f).imePadding(), shape = AffairsLayout.shape) {
                    Column(Modifier.testTag("shared-bulk-screen")) {
                        AffairsDialogHeader(if (state.pane == "history") "История операций" else "Массовые действия",
                            onClose = ::close, onBack = if (state.pane == "configure" && state.editable) ({ state.choose() }) else null,
                            backEnabled = !state.busy, closeTag = "bulk-close", backTag = "bulk-back") {
                                if (state.pane != "configure" || !state.editable) AffairsIconButton("История операций", AffairsAction.HISTORY, { scope.launch { state.showHistory() } }, Modifier.testTag("bulk-history"), enabled = !state.busy)
                                AffairsIconButton("Обновить", AffairsAction.REFRESH, { scope.launch { state.refresh() } }, Modifier.testTag("bulk-refresh"), enabled = !state.busy)
                        }
                        HorizontalDivider()
                        val scroll = rememberScrollState()
                        LaunchedEffect(state.pane, state.operationId, state.after) { scroll.scrollTo(0) }
                        Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(scroll).padding(16.dp).testTag("bulk-content"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (state.query && state.title.isNotBlank()) UntranslatedText(state.title, style = MaterialTheme.typography.titleMedium)
                            state.project?.let { UntranslatedText(it.optString("title"), style = MaterialTheme.typography.titleMedium) }
                            when {
                                state.inputInvalid -> Text("Не удалось восстановить выбор. Создайте новую операцию.")
                                !state.loaded -> WorkspaceLoadingText()
                                state.pane == "history" -> BulkHistory(state) { scope.launch { state.openOperation(it) } }
                                state.pane == "operation" -> state.report?.let { BulkReport(it, state.after, state.previousPages.isNotEmpty(), !state.busy,
                                    state.expired, { scope.launch { state.reportPage(it) } }, onTask) } ?: WorkspaceLoadingText("Загрузка отчёта…")
                                state.phase == "pending" -> Text("Результат отправки пока не подтверждён. Повторите ту же команду.")
                                state.phase == "rejected" -> Text("Задачи изменились. Обновите выборку и выберите задачи заново.")
                                state.pane == "configure" -> BulkActionForm(state, controller, calendar) { savedCalendar = it.saved().toString(); state.calendar(it.saved()) }
                                else -> BulkSelection(state)
                            }
                        }
                        HorizontalDivider()
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (controller.supportsSharedBulkInput && (state.dirty || state.inputSaved) && state.phase in setOf("", "editing"))
                                Text(if (state.dirty) "Сохранение…" else "Сохранено на устройстве", Modifier.testTag("bulk-save-state"), style = MaterialTheme.typography.bodySmall)
                            if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("bulk-working"))
                            if (state.error.isNotBlank()) Text(bulkErrorText(state.error), Modifier.testTag("bulk-error").semantics { liveRegion = LiveRegionMode.Polite },
                                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                            if (state.loaded && state.project != null && !state.canEdit) Text("Недостаточно прав или задача недоступна.", style = MaterialTheme.typography.bodySmall)
                            if (state.phase == "pending" && state.pane in setOf("history", "operation")) OutlinedButton({ scope.launch { state.recoverPending() } },
                                enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-recover")) { Text("Открыть сохранённую операцию") }
                            BulkFooter(state, { scope.launch { state.preview() } }, { stopWarning = true })
                        }
                    }
                }
            }
        }
        if (leaveWarning) AlertDialog(onDismissRequest = { leaveWarning = false }, title = { Text("Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию.") },
            confirmButton = { TextButton({ leaveWarning = false }) { Text("Вернуться к редактированию") } })
        if (stopWarning) AlertDialog(onDismissRequest = { stopWarning = false }, title = { Text("Остановить операцию?") },
            text = { Text("Отмена останавливает только оставшиеся задачи. Уже выполненные изменения сохранятся.") },
            confirmButton = { TextButton({ stopWarning = false; scope.launch { state.command("cancel") } }, Modifier.testTag("bulk-cancel-confirm")) { Text("Остановить") } },
            dismissButton = { TextButton({ stopWarning = false }) { Text("Назад") } })
    }
}

@Composable private fun BulkSelection(state: SharedBulkState) {
    val tasks = state.tasks; val form = state.form; val rows = tasks?.optJSONArray("tasks")?.let(::importRows).orEmpty(); val scope = rememberCoroutineScope()
    Text("Выбор задач не изменяет их выполнение.", style = MaterialTheme.typography.bodyMedium)
    Text(if (form.all) "Выбраны все задачи по текущим фильтрам." else genesisTranslate("Выбрано") + ": ${form.selectionCount}", Modifier.testTag("bulk-selection-count"), style = MaterialTheme.typography.titleSmall)
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton({ state.change(form.selectPage(rows)) }, enabled = state.editable && !state.busy && rows.isNotEmpty(),
            modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("bulk-select-page")) { Text("На экране") }
        OutlinedButton({ state.selectAll() }, enabled = state.editable && !state.busy && tasks != null && tasks.optInt("total") > 0,
            modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("bulk-select-all")) { Text("Все результаты") }
    }
    if (form.all || form.selectionCount > 0) TextButton({ state.change(form.change("all", false).change("items", JSONArray())) },
        enabled = state.editable && !state.busy, modifier = Modifier.testTag("bulk-deselect")) { Text("Снять выбор") }
    if (tasks == null) Text(if (state.online) "Загрузка…" else "Нет связи. Подключитесь к интернету и обновите экран.")
    else if (rows.isEmpty()) Text("По вашему запросу ничего не найдено.")
    rows.forEach { task ->
        val selected = form.selected(task)
        val canSelect=state.editable && !state.busy && !form.all && (selected || form.selectionCount < 1000)
        Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape, color = selectedControlContainer(selected,canSelect,MaterialTheme.colorScheme.surface),
            contentColor = MaterialTheme.colorScheme.onSurface,
            border = selectedControlBorder(selected,canSelect,BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant))) {
            Row(Modifier.fillMaxWidth().toggleable(selected, enabled = canSelect,
                role = Role.Checkbox, onValueChange = { state.change(form.toggle(task)) }).padding(12.dp).heightIn(min = 48.dp).testTag("bulk-task-${task.getString("id")}"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(selected, null, enabled=canSelect)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(task.getString("title"), style = MaterialTheme.typography.bodyLarge)
                    if (state.query) UntranslatedText(task.getString("projectTitle"), style = MaterialTheme.typography.bodySmall)
                    val due = task.optString("dueDate").takeUnless { it == "null" }.orEmpty()
                    if (due.isNotEmpty()) UntranslatedText(due, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (tasks != null) {
        Text(genesisTranslate("Показано: {loaded} из {total}").replace("{loaded}", rows.size.toString()).replace("{total}", tasks.optInt("total").toString()), style = MaterialTheme.typography.bodySmall)
        if (tasks.optBoolean("hasMore")) OutlinedButton({ scope.launch { state.moreTasks() } }, enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-more-tasks")) { Text("Показать ещё") }
    }
}

@Composable private fun BulkActionForm(state: SharedBulkState, gateway: SharedWorkspaceGateway, calendar: SharedCustomCalendar, onCalendar: (SharedCustomCalendar) -> Unit) {
    val form = state.form; val enabled = state.editable && !state.busy && state.canEdit; val project = state.projectId
    val projectFilter = if (state.query) JSONObject().put("projectIds", JSONArray(state.scopeProjects.map { it.getString("id") })) else remember(project) { JSONObject().put("projectIds", JSONArray().put(project)) }
    fun update(key: String, value: Any) = state.change(state.form.change(key, value))
    Text(if (form.all) "Выбраны все задачи по текущим фильтрам." else genesisTranslate("Выбрано") + ": ${form.selectionCount}", style = MaterialTheme.typography.bodyMedium)
    ImportChoice("Действие", form.kind, SharedBulkProtocol.kinds.map { it to genesisTranslate(bulkKindLabel(it)) }, enabled, "bulk-kind") { update("kind", it) }
    when (form.kind) {
        "priority" -> ImportChoice("Приоритет", form.int("priority").toString(), listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")
            .mapIndexed { index, label -> index.toString() to genesisTranslate(label) }, enabled, "bulk-priority") { update("priority", it.toInt()) }
        "assignee" -> BulkOptionChoice(gateway, "assignees", projectFilter, "Исполнитель", listOfNotNull(form.text("assigneeId").takeIf { it.isNotEmpty() }), enabled,
            state.optionEpoch, "bulk-assignee", allowEmpty = true) { update("assigneeId", it.firstOrNull().orEmpty()) }
        "status" -> if (state.query) {
            Text("Выберите статус для каждого проекта.", style = MaterialTheme.typography.bodySmall)
            state.scopeProjects.forEach { row ->
                val id = row.getString("id")
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    UntranslatedText(row.getString("title"), style = MaterialTheme.typography.titleSmall)
                    ImportChoice("Статус", form.status(id), listOf("" to genesisTranslate("Выберите")) + importRows(row.getJSONArray("statuses"))
                        .map { it.getString("id") to it.getString("title") }, enabled, "bulk-status-$id") { state.change(state.form.status(id, it)) }
                }
            }
        } else BulkOptionChoice(gateway, "statuses", projectFilter, "Статус", listOfNotNull(form.text("statusId").takeIf { it.isNotEmpty() }), enabled,
            state.optionEpoch, "bulk-status") { update("statusId", it.firstOrNull().orEmpty()) }
        "due" -> {
            ImportChoice("Действие со сроком", form.text("dueMode"), listOf("set" to genesisTranslate("Задать дату"), "shift" to genesisTranslate("Сдвинуть"), "clear" to genesisTranslate("Очистить срок")), enabled, "bulk-due-mode") { update("dueMode", it) }
            when (form.text("dueMode")) {
                "set" -> {
                    val sacred = LocalSacredFeaturesEnabled.current
                    val mode = if (sacred) calendar.mode else CalendarMode.PROFANE
                    AuthorDatePicker(form.text("date"), mode, calculationContext = calendar.context, enabled = enabled,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-date"), placeholder = "Выберите дату", onChange = { update("date", it) })
                    if (sacred) AffairsDisclosure("Календарь ввода", Modifier.testTag("bulk-calendar")) {
                        EditorCalendarModePicker(calendar.mode, { onCalendar(calendar.copy(mode = it)) }, enabled, preferredMode = calendar.mode, tag = "bulk-input-mode")
                    }
                }
                "shift" -> OutlinedTextField(form.text("days"), { update("days", it.take(7)) }, label = { Text("Сдвиг, дней") }, enabled = enabled, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = form.text("days").toIntOrNull()?.let { it == 0 || it !in -36600..36600 } != false,
                    modifier = Modifier.fillMaxWidth().testTag("bulk-days"))
            }
        }
        "labels" -> {
            ImportChoice("Действие с метками", form.text("labelMode"), listOf("add" to genesisTranslate("Добавить"), "remove" to genesisTranslate("Убрать")), enabled, "bulk-label-mode") { update("labelMode", it) }
            BulkOptionChoice(gateway, "labels", projectFilter, "Метки", form.ids("labelIds"), enabled, state.optionEpoch, "bulk-labels", multiple = true) { update("labelIds", JSONArray(it)) }
        }
        "move" -> {
            BulkOptionChoice(gateway, "projects", JSONObject(), "Проект назначения", listOfNotNull(form.text("destinationId").takeIf { it.isNotEmpty() }), enabled,
                state.optionEpoch, "bulk-destination") { ids -> state.change(form.change("destinationId", ids.firstOrNull().orEmpty()).change("destinationStatusId", "")) }
            if (form.text("destinationId").isNotEmpty()) BulkOptionChoice(gateway, "statuses", JSONObject().put("projectIds", JSONArray().put(form.text("destinationId"))),
                "Статус назначения", listOfNotNull(form.text("destinationStatusId").takeIf { it.isNotEmpty() }), enabled, state.optionEpoch, "bulk-destination-status") { update("destinationStatusId", it.firstOrNull().orEmpty()) }
        }
        "trash" -> ImportChoice("Хранение в корзине, дней", form.int("retentionDays").toString(), listOf(1, 7, 30).map { it.toString() to it.toString() }, enabled, "bulk-retention") { update("retentionDays", it.toInt()) }
    }
    if (form.kind in setOf("archive", "trash")) Text("Будут затронуты также подзадачи. Проверьте их количество в предпросмотре.", style = MaterialTheme.typography.bodyMedium)
}

@Composable private fun BulkOptionChoice(gateway: SharedWorkspaceGateway, kind: String, filter: JSONObject, label: String, selected: List<String>, enabled: Boolean,
    epoch: Int, tag: String, allowEmpty: Boolean = false, multiple: Boolean = false, onChange: (List<String>) -> Unit) {
    val identity = filter.toString(); val scope = rememberCoroutineScope()
    key(gateway, kind, identity, epoch) {
        var page by remember { mutableStateOf<JSONObject?>(null) }; var options by remember { mutableStateOf(emptyList<JSONObject>()) }
        var failure by remember { mutableStateOf(false) }; var loading by remember { mutableStateOf(false) }
        var refresh by remember { mutableIntStateOf(0) }; var limit by rememberSaveable { mutableIntStateOf(5) }
        val scopes = remember(identity) {
            val source = JSONObject(identity); val projects = source.optJSONArray("projectIds")
            if (projects == null || projects.length() <= 100) listOf(source) else (0 until projects.length()).map(projects::getString).chunked(100)
                .map { ids -> JSONObject(identity).put("projectIds", JSONArray(ids)) }
        }
        var batch by remember { mutableIntStateOf(0) }
        LaunchedEffect(refresh) {
            page = null; options = emptyList(); batch = 0; loading = true; failure = false
            try { page = SharedBulkProtocol.options(gateway.sharedBulkOptions(kind, scopes[0])); options = importRows(page!!.getJSONArray("options")) }
            catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { failure = true } finally { loading = false }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!multiple) ImportChoice(label, selected.firstOrNull().orEmpty(),
                (if (allowEmpty) listOf("" to genesisTranslate("Без исполнителя")) else listOf("" to genesisTranslate("Выберите"))) +
                    selected.filter { id -> options.none { it.optString("id") == id } }.map { it to genesisTranslate("Выбрано") } + options.map { it.getString("id") to it.getString("title") },
                enabled && !loading && !failure, tag) { onChange(listOfNotNull(it.takeIf { it.isNotEmpty() })) }
            else AffairsDisclosure(label, Modifier.testTag(tag)) {
                options.take(limit).forEach { item ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(item.getString("id") in selected, enabled, Role.Checkbox) {
                        onChange(if (item.getString("id") in selected) selected - item.getString("id") else selected + item.getString("id"))
                    }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(item.getString("id") in selected, null); UntranslatedText(item.getString("title"), Modifier.weight(1f))
                    }
                }
                if (options.size > limit) OutlinedButton({ limit += 5 }, Modifier.fillMaxWidth()) { Text("Показать ещё") }
            }
            if (loading) WorkspaceLoadingText()
            if (failure) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Не удалось загрузить данные", Modifier.weight(1f), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                AffairsIconButton("Обновить", AffairsAction.REFRESH, { refresh++ }, enabled = !loading)
            }
            if (page != null && (page!!.getBoolean("hasMore") || batch + 1 < scopes.size)) OutlinedButton({ scope.launch {
                loading = true; failure = false
                try {
                    val nextBatch = if (page!!.getBoolean("hasMore")) batch else batch + 1
                    val cursor = if (nextBatch == batch && page!!.getBoolean("hasMore")) page!!.getString("nextCursor") else null
                    val next = SharedBulkProtocol.options(gateway.sharedBulkOptions(kind, scopes[nextBatch], cursor))
                    options = (options + importRows(next.getJSONArray("options"))).distinctBy { it.getString("id") }; batch = nextBatch; page = next; limit += 5
                }
                catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { page = null; options = emptyList(); failure = true } finally { loading = false }
            } }, enabled = !loading && enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-more")) { Text("Загрузить ещё варианты") }
        }
    }
}

@Composable private fun BulkCounts(counts: JSONObject, preview: Boolean) {
    (listOf("selected" to "Выбрано", "affected" to "Будет затронуто") + if (preview) emptyList() else listOf("pending" to "Ожидает", "succeeded" to "Выполнено", "skipped" to "Пропущено", "failed" to "Ошибка", "cancelled" to "Отменено"))
        .forEach { (key, label) -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            UntranslatedText(counts.getInt(key).toString(), style = MaterialTheme.typography.titleSmall)
        } }
}

@Composable private fun BulkReport(report: JSONObject, after: Long, hasPrevious: Boolean, enabled: Boolean, expired: Boolean, onPage: (Boolean) -> Unit, onTask: (String, String) -> Unit) {
    val state = report.getString("state"); val action = report.getJSONObject("action"); var limit by rememberSaveable(report.getString("id"), after) { mutableIntStateOf(5) }
    Text(bulkStateLabel(state), Modifier.testTag("bulk-operation-state").semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.titleMedium)
    Text(bulkKindLabel(action.getString("kind")), style = MaterialTheme.typography.titleSmall)
    when (action.getString("kind")) {
        "priority" -> Text(listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")[action.getInt("priority")])
        "due" -> Text(when (action.getString("mode")) { "set" -> action.getString("date"); "shift" -> genesisTranslate("Сдвиг, дней") + ": " + action.getInt("days"); else -> "Очистить срок" })
        "trash" -> Text(genesisTranslate("Хранение в корзине, дней") + ": " + action.getInt("retentionDays"))
    }
    val info = report.getJSONObject("actionInfo")
    if (info.optBoolean("unavailable")) Text("Недостаточно прав или задача недоступна.")
    for (key in listOf("projectTitle", "statusTitle", "assigneeName")) if (!info.isNull(key)) UntranslatedText(info.getString(key))
    if (action.getString("kind") == "assignee" && action.isNull("assigneeId")) Text("Без исполнителя")
    for (key in listOf("labels", "statuses")) info.optJSONArray(key)?.let { rows -> importRows(rows).forEach { row ->
        UntranslatedText(if (key == "labels") row.getString("title") else row.getString("projectTitle") + " · " + row.getString("statusTitle"))
    } }
    BulkCounts(report.getJSONObject("counts"), state == "preview")
    if (state == "preview") Text(if (expired) "Предварительный просмотр истёк. Создайте новую операцию." else "Проверьте выборку и действие перед применением.", Modifier.testTag("bulk-preview-note"), style = MaterialTheme.typography.bodyMedium)
    if (!report.isNull("errorCode")) Text(bulkErrorText(report.getString("errorCode")), color = MaterialTheme.colorScheme.error)
    if (!report.isNull("retryAt")) Text("Сервер повторит обработку позже. Отчёт можно обновить.", style = MaterialTheme.typography.bodySmall)
    AffairsDisclosure("Результаты по задачам", Modifier.testTag("bulk-results")) {
        val items = importRows(report.getJSONArray("items"))
        items.take(limit).forEach { item -> Column(Modifier.fillMaxWidth().testTag("bulk-result-${item.getLong("cursor")}"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (item.has("title")) UntranslatedText(item.getString("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge) else Text("Задача недоступна", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                if (item.optBoolean("available") && item.has("id") && item.has("projectId")) AffairsIconButton("Открыть", AffairsAction.VIEW,
                    { onTask(item.getString("projectId"), item.getString("id")) }, Modifier.testTag("bulk-open-${item.getLong("cursor")}"), enabled = enabled)
            }
            if (item.has("projectTitle")) UntranslatedText(item.getString("projectTitle"), style = MaterialTheme.typography.bodySmall)
            Text(bulkStateLabel(item.getString("state")), style = MaterialTheme.typography.bodySmall)
            if (!item.isNull("code")) Text(bulkErrorText(item.getString("code")), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()
        } }
        if (items.size > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-more-results")) { Text("Показать ещё") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (hasPrevious) OutlinedButton({ onPage(false) }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("bulk-previous-report")) { Text("Назад") }
            if (report.getBoolean("hasMore")) OutlinedButton({ onPage(true) }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("bulk-next-report")) { Text("Следующая страница") }
        }
    }
}

@Composable private fun BulkHistory(state: SharedBulkState, onOpen: (String) -> Unit) {
    val page = state.history; val scope = rememberCoroutineScope()
    val language = LocalGenesisLanguage.current
    val zone = java.time.ZoneId.systemDefault()
    if (page == null) WorkspaceLoadingText() else {
        val rows = importRows(page.getJSONArray("operations"))
        if (rows.isEmpty()) Text("Операций пока нет.")
        rows.forEach { item -> OutlinedButton({ onOpen(item.getString("id")) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-history-${item.getString("id")}")) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.optJSONObject("action")?.optString("kind")?.let(::bulkKindLabel) ?: "Действие", style = MaterialTheme.typography.titleSmall)
                Text(bulkStateLabel(item.getString("state")), style = MaterialTheme.typography.bodyMedium)
                UntranslatedText(bulkHistoryTimestamp(item.getString("createdAt"), language, zone), style = MaterialTheme.typography.bodySmall)
            }
        } }
        if (page.getBoolean("hasMore")) OutlinedButton({ scope.launch { state.showHistory(page.getString("nextCursor")) } }, enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-next-history")) { Text("Следующая страница") }
    }
}

@Composable private fun BulkFooter(state: SharedBulkState, onPreview: () -> Unit, onCancel: () -> Unit) {
    val scope = rememberCoroutineScope(); val enabled = !state.busy
    when {
        state.inputInvalid -> Button({ state.resetInvalid() }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Новая операция") }
        state.error == "PLANNING_DRAFT_CHANGED" -> Button({ scope.launch { state.recoverPending() } }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Открыть сохранённую операцию") }
        state.pane == "history" -> OutlinedButton({ scope.launch { if (state.operationId.isNotEmpty()) state.openOperation(state.operationId) else state.newOperation() } }, enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-history-back")) { Text(if (state.operationId.isNotEmpty()) "Открыть сохранённую операцию" else "Выбрать задачи") }
        state.pane == "operation" -> {
            val report = state.report
            if (report != null) {
                val status = report.getString("state")
                when {
                    status == "preview" && !state.expired -> Button({ scope.launch { state.command("confirm") } }, enabled = enabled && state.canEdit && state.online && !report.getJSONObject("actionInfo").getBoolean("unavailable"),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-confirm")) { Text("Применить") }
                    status == "failed" && report.optString("errorCode") == "BACKGROUND_RETRY" -> Button({ scope.launch { state.command("resume") } }, enabled = enabled && state.online,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-resume")) { Text("Продолжить обработку") }
                    status !in setOf("preview", "running") || state.expired -> Button({ scope.launch { state.newOperation() } }, enabled = enabled,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-new")) { Text("Новая операция") }
                }
                if (status in setOf("preview", "running")) OutlinedButton(onCancel, enabled = enabled && state.online,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-cancel")) { Text("Остановить") }
            }
        }
        state.phase == "pending" -> Button({ scope.launch { state.retry() } }, enabled = enabled && state.online,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-retry")) { Text("Повторить отправку") }
        state.phase == "rejected" -> Button({ scope.launch { state.newOperation() } }, enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-reselect")) { Text("Выбрать задачи заново") }
        state.pane == "configure" -> Button(onPreview, enabled = enabled && state.ready && state.online,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-preview")) { Text("Предварительный просмотр") }
        else -> Button({ if (state.query) scope.launch { state.configureQuery() } else state.configure() }, enabled = enabled && state.editable && state.selectionReady && state.canEdit && state.online,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bulk-configure")) { Text("Выбрать действие") }
    }
}
