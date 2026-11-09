package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
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
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.text.NumberFormat
import java.time.ZoneId
import java.util.Locale
import java.util.UUID

internal fun fieldTypeLabel(type: String) = when (type) {
    "text" -> "Текст"; "number" -> "Число"; "date" -> "Дата"; "select" -> "Одиночный выбор"
    "multi" -> "Множественный выбор"; "checkbox" -> "Флажок"; "url" -> "Ссылка"; else -> "Недоступно"
}
internal fun fieldEditorMessage(code: String, hasRecord: Boolean = true): String = customFieldMessage(code) ?: when (code) {
    "CUSTOM_FIELD_OPTIONS_LIMIT" -> "Лимит — 200 вариантов, включая архивные. Для новых вариантов создайте другое поле."
    "CUSTOM_FIELD_POSITION_INVALID" -> "Порядок должен быть целым числом от −100000 до 100000."
    "CUSTOM_FIELD_PREVIEW_REQUIRED" -> "Сначала проверьте изменения в предпросмотре."
    "CUSTOM_FIELD_LOCAL_QUEUE" -> "Сначала синхронизируйте изменения задач. Черновик поля сохранён."
    "CUSTOM_FIELD_ONLINE_REQUIRED", "NETWORK", "UNAUTHORIZED" -> if (hasRecord) "Для управления полями нужно подключение к сети. Черновик сохранён." else "Не удалось выполнить действие. Проверьте соединение и повторите."
    "SHARED_SPACE_FORBIDDEN", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_SPACE_NOT_FOUND", "CUSTOM_FIELD_SCOPE_CHANGED" -> "Управление полями доступно владельцу и администраторам пространства."
    "PLANNING_DRAFT_CHANGED" -> "Черновик изменён в другом окне. Сохраните свою копию и загрузите сохранённую версию."
    "PLANNING_DRAFT_LIMIT" -> "Сохранено слишком много копий. Удалите ненужную копию и повторите."
    "WORKFLOW_FIELD_IN_USE" -> "Поле используется в обязательных правилах workflow. Сначала измените правила."
    "INVALID_TITLE", "CUSTOM_FIELD_DRAFT_INVALID" -> "Проверьте название, тип и настройки поля."
    "PLANNING_DRAFT_STORAGE", "STORAGE" -> "Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию."
    "CUSTOM_FIELD_RECEIPT_INVALID" -> "Не удалось подтвердить результат. Черновик и исходный запрос сохранены."
    else -> "Не удалось выполнить действие. Проверьте соединение и повторите."
}

/** One management surface: list/detail on phones, simultaneous catalog and settings on large windows. */
@Composable internal fun SharedFieldsScreen(gateway: SharedWorkspaceGateway, space: String, project: String, onClose: () -> Unit, onChanged: () -> Unit, onLost: () -> Unit) {
    val account = LocalGenesisUserId.current; val language = LocalGenesisLanguage.current
    val state = remember(gateway, account, space, project) { SharedFieldEditorState(gateway, account, space, project) }
    val scope = rememberCoroutineScope()
    var detail by rememberSaveable(account, space, project) { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }; var leave by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    val active = lifecycle.isAtLeast(Lifecycle.State.STARTED) && LocalNavigationPageContext.current?.active != false
    fun close() { scope.launch {
        if (state.dirty) state.saveLocal()
        if (state.dirty) leave = true else { if (state.saved || state.phase == "received") onChanged(); onClose() }
    } }
    fun back() { if (detail) { scope.launch { if (state.dirty) state.saveLocal(); if (!state.dirty) detail = false else leave = true } } else close() }
    LaunchedEffect(state, active) {
        if (!active) { if (state.dirty) state.saveLocal(); state.pause(); return@LaunchedEffect }
        state.load(); if (state.record != null) detail = true
        while (isActive) { delay(30000); state.poll() }
    }
    LaunchedEffect(state.version) { if (state.dirty && state.phase == "editing") { delay(250); state.saveLocal() } }
    LaunchedEffect(state.lost) { if (state.lost) onLost() }
    LaunchedEffect(state.saved) { if (state.saved) onChanged() }
    DisposableEffect(state) { onDispose { scope.launch(NonCancellable) { try { if (state.dirty) state.saveLocal() } finally { state.close() } } } }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = ::back)
        GenesisModalFrame(::close) {
            val compactIme = WindowInsets.ime.getBottom(LocalDensity.current) > 0 && maxHeight < 360.dp
            val wideWindow = maxWidth >= 864.dp && !compactIme
                Column(Modifier.testTag("shared-fields-screen")) {
                    if (!compactIme) FieldScreenHeader(state, detail, ::back, ::close) { scope.launch { state.load() } }
                    if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("field-progress"))
                    HorizontalDivider()
                    BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth()) {
                        val wide = maxWidth >= 840.dp && !compactIme
                        val editor: @Composable () -> Unit = {
                            val scroll = rememberScrollState()
                            LaunchedEffect(state.edit?.getJSONObject("draft")?.optString("id")) { scroll.scrollTo(0) }
                            Column(Modifier.fillMaxWidth().verticalScroll(scroll).padding(16.dp).testTag("field-editor-content"), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                                if (compactIme) FieldScreenHeader(state, detail, ::back, ::close) { scope.launch { state.load() } }
                                FieldNotice(state)
                                if (state.edit != null && !state.lost) FieldEditor(state, language) { discard = true }
                                else if (state.loaded && !state.lost) Text("Выберите поле или добавьте новое.")
                                if (!state.loaded && !state.lost) FieldRetry(state) { scope.launch { state.load() } }
                            }
                        }
                        if (wide) Row(Modifier.fillMaxWidth().testTag("field-two-pane")) {
                            Column(Modifier.width(288.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                FieldLibrary(state, { id -> scope.launch { state.choose(id); if (state.edit != null) detail = true } }, { detail = true })
                            }
                            VerticalDivider(Modifier.heightIn(min = 240.dp))
                            Box(Modifier.weight(1f)) { editor() }
                        } else if (detail) editor()
                        else Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp).testTag("field-library-content"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (compactIme) FieldScreenHeader(state, detail, ::back, ::close) { scope.launch { state.load() } }
                            FieldNotice(state)
                            FieldLibrary(state, { id -> scope.launch { state.choose(id); if (state.edit != null) detail = true } }, { detail = true })
                            if (!state.loaded && !state.lost) FieldRetry(state) { scope.launch { state.load() } }
                        }
                    }
                    if (state.edit != null && (detail || wideWindow)) {
                        HorizontalDivider()
                        FieldFooter(state, { scope.launch { state.preview() } }, { scope.launch { state.submit() } },
                            { scope.launch { state.rebase() } }, { scope.launch { state.discard(); if (state.record == null) { detail = false; onChanged() } } }, { discard = true })
                    }
                }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Удалить черновик?") },
        text = { Text("Это удалит только сохранённый ввод. Поле на сервере не изменится.") },
        confirmButton = { TextButton({ discard = false; scope.launch { state.discard(); if (state.record == null) detail = false } }, enabled = !state.busy) { Text("Удалить") } },
        dismissButton = { TextButton({ discard = false }) { Text("Отмена") } })
    if (leave) AlertDialog(onDismissRequest = { leave = false }, title = { Text("Несохранённые изменения") },
        text = { Text("Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию.") },
        confirmButton = { TextButton({ scope.launch { state.saveCopy(); if (state.error.isBlank()) { leave = false; onClose() } } }, enabled = !state.busy) { Text("Сохранить мою копию") } },
        dismissButton = { TextButton({ leave = false }) { Text("Вернуться") } })
}

@Composable private fun FieldScreenHeader(state: SharedFieldEditorState, detail: Boolean, back: () -> Unit, close: () -> Unit, refresh: () -> Unit) {
    AffairsDialogHeader("Пользовательские поля", state.projectTitle, close,
        onBack = if (detail) back else null, enabled = !state.busy,
        closeTag = "field-close", backTag = "field-back") {
        AffairsIconButton("Обновить", AffairsAction.REFRESH, refresh, Modifier.testTag("field-refresh"), enabled = !state.busy)
    }
}
@Composable private fun FieldNotice(state: SharedFieldEditorState) {
    val code = if (state.lost) "SHARED_SPACE_FORBIDDEN" else if (state.conflict) "PLANNING_DRAFT_CHANGED" else if (state.stale) "CUSTOM_FIELD_CONFLICT" else state.error
    if (code.isNotBlank()) Text(fieldEditorMessage(code, state.record != null), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.testTag("field-error").semantics { liveRegion = LiveRegionMode.Polite })
    if (state.phase == "pending") Text("Ответ сервера ещё не подтверждён. Повторяется только сохранённый запрос; его параметры нельзя заменить.", style = MaterialTheme.typography.bodyMedium)
    if (state.phase == "received") Text("Поле сохранено.", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.testTag("field-saved").semantics { liveRegion = LiveRegionMode.Polite })
}
@Composable private fun FieldRetry(state: SharedFieldEditorState, retry: () -> Unit) {
    if (!state.busy) TemplateOutlinedButton(retry, Modifier.testTag("field-reload")) { Text("Повторить") }
}
@Composable private fun FieldLibrary(state: SharedFieldEditorState, select: (String?) -> Unit, resume: () -> Unit) {
    var archive by rememberSaveable { mutableStateOf(false) }; var query by rememberSaveable { mutableStateOf("") }; var limit by rememberSaveable(archive, query) { mutableIntStateOf(5) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Поля", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        TemplateIconButton("Добавить поле", AffairsAction.ADD, state.loaded && !state.busy && !state.lost && (state.record == null || state.removable), Modifier.size(48.dp).testTag("field-add")) { select(null) }
    }
    TemplateField("Поиск", query, state.loaded && !state.busy, "field-search", maxLength = 160) { query = it }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(!archive, { archive = false }, label = { Text("Действующие") }, shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("field-active-filter"))
        FilterChip(archive, { archive = true }, label = { Text("Архив") }, shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("field-archive-filter"))
    }
    val visible = state.fields.filter { it.getBoolean("archived") == archive && (query.isBlank() || it.getString("title").contains(query, ignoreCase = true)) }
    visible.take(limit).forEach { field -> key(field.getString("id")) {
        val selected = state.edit?.getJSONObject("draft")?.optString("id") == field.getString("id")
        val canSelect=state.loaded && !state.busy && (selected || state.record == null || state.removable)
        Surface(onClick = { if (selected) resume() else select(field.getString("id")) }, enabled = canSelect,
            shape = AffairsLayout.shape, color = selectedControlContainer(selected,canSelect,MaterialTheme.colorScheme.surface),
            border = selectedControlBorder(selected,canSelect),
            modifier = Modifier.fillMaxWidth().testTag("field-row-${field.getString("id")}").semantics { this.selected=selected }) {
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(field.getString("title"), style = MaterialTheme.typography.bodyLarge)
                    Text(fieldTypeLabel(field.getString("type")), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(if (field.isNull("projectId")) "Всё пространство" else "Этот проект", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                AffairsActionIcon(AffairsAction.EDIT)
            }
        }
        HorizontalDivider()
    } }
    if (state.loaded && visible.isEmpty()) Text(if (query.isNotBlank()) "Ничего не найдено" else if (archive) "В архиве пока нет полей." else "Добавьте первое поле для задач проекта.", style = MaterialTheme.typography.bodyMedium)
    if (visible.size > limit) TemplateIconButton("Показать ещё", AffairsAction.EXPAND, !state.busy, Modifier.size(48.dp).testTag("field-more")) { limit += 5 }
    if (state.record != null) TemplateOutlinedButton(resume, Modifier.testTag("field-resume")) { Text("Продолжить") }
    Text("Поля доступны читателям задачи. Видимость в карточке и списке меняет отображение, а не права доступа.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun FieldBlock(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        content()
    }
}
@Composable private fun FieldEditor(state: SharedFieldEditorState, language: String, discard: () -> Unit) {
    val edit = requireNotNull(state.edit); val draft = edit.getJSONObject("draft"); val enabled = state.editable; val scope = rememberCoroutineScope()
    FieldBlock("Настройки поля") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TemplateIconButton("Сохранить мою копию", AffairsAction.TEMPLATE, !state.busy && !state.lost, Modifier.size(48.dp).testTag("field-copy")) { scope.launch { state.saveCopy() } }
            if (!edit.isNull("base")) TemplateIconButton("История поля", AffairsAction.HISTORY, state.loaded && !state.busy, Modifier.size(48.dp).testTag("field-history")) { scope.launch { state.readHistory() } }
            TemplateIconButton("Удалить черновик", AffairsAction.DELETE, !state.busy && state.removable, Modifier.size(48.dp).testTag("field-discard"), onClick = discard)
            if (state.stale || state.conflict) TemplateIconButton("Обновить", AffairsAction.REFRESH, !state.busy, Modifier.size(48.dp).testTag("field-rebase")) { scope.launch { if (state.conflict) state.reloadSaved() else state.rebase() } }
        }
        TemplateField("Название", draft.getString("title"), enabled, "field-title") { value -> state.change { it.getJSONObject("draft").put("title", value) } }
        FieldChoice("Тип поля", draft.getString("type"), CustomFieldProtocol.types.toList(), enabled, "field-type", ::fieldTypeLabel) { value -> state.change { it.getJSONObject("draft").put("type", value).put("options", JSONArray()) } }
        FieldChoice("Область поля", if (draft.isNull("projectId")) "space" else "project", listOf("project", "space"), enabled, "field-scope", { if (it == "project") "Этот проект" else "Всё пространство" }) { value ->
            state.change { it.getJSONObject("draft").put("projectId", if (value == "project") state.project else JSONObject.NULL) }
        }
        TemplateField("Порядок", edit.getString("positionInput"), enabled, "field-position", number = true, maxLength = 8) { value -> state.change { it.put("positionInput", value) } }
    }
    HorizontalDivider()
    FieldBlock("Отображение и заполнение") {
        for ((key, label) in listOf("required" to "Обязательное поле", "showCard" to "Показывать в карточке", "showList" to "Показывать в списке", "archived" to "Архивировать поле"))
            TemplateToggle(label, draft.getBoolean(key), enabled, "field-$key") { value -> state.change { it.getJSONObject("draft").put(key, value) } }
        Text("Архив сохраняет значения. Снимите отметку, чтобы восстановить поле. Новые обязательные поля проверяются при создании, заполнении полей или завершении задачи.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (draft.getString("type") in setOf("select", "multi")) { HorizontalDivider(); FieldOptions(state, draft) }
    state.review?.let { review -> HorizontalDivider(); FieldReview(state, review, language) }
    if (state.history.isNotEmpty()) { HorizontalDivider(); FieldHistory(state, language) }
    if (state.copies.isNotEmpty()) { HorizontalDivider(); FieldCopies(state) }
}
@Composable private fun FieldChoice(label: String, value: String, options: List<String>, enabled: Boolean, tag: String, title: (String) -> String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            TemplateOutlinedButton({ open = true }, Modifier.fillMaxWidth().testTag(tag), enabled) {
                Text(title(value), Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
            }
            DropdownMenu(open, { open = false }) { options.forEach { option -> DropdownMenuItem(text = { Text(title(option)) }, modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-$option"), onClick = { open = false; onChange(option) }) } }
        }
    }
}
@Composable private fun FieldOptions(state: SharedFieldEditorState, draft: JSONObject) {
    val options = importRows(draft.getJSONArray("options")); var limit by rememberSaveable(draft.getString("id")) { mutableIntStateOf(5) }
    FieldBlock("Варианты списка") {
        options.take(limit).forEachIndexed { index, option -> key(option.getString("id")) {
            TemplateField("Вариант списка", option.getString("title"), state.editable, "field-option-$index") { value -> state.change { it.getJSONObject("draft").getJSONArray("options").getJSONObject(index).put("title", value) } }
            TemplateToggle("Архив", option.getBoolean("archived"), state.editable, "field-option-archive-$index") { value -> state.change { it.getJSONObject("draft").getJSONArray("options").getJSONObject(index).put("archived", value) } }
            if (index < options.lastIndex) HorizontalDivider()
        } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TemplateIconButton("Добавить вариант", AffairsAction.ADD, state.editable && options.size < 200, Modifier.size(48.dp).testTag("field-option-add")) {
                state.change { it.getJSONObject("draft").getJSONArray("options").put(JSONObject().put("id", UUID.randomUUID().toString()).put("title", "").put("archived", false)) }; limit = options.size + 1
            }
            if (options.size > limit) TemplateIconButton("Показать ещё", AffairsAction.EXPAND, !state.busy, Modifier.size(48.dp)) { limit += 5 }
        }
        Text("Архивный вариант сохраняется в старых задачах и недоступен для новых назначений.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable private fun FieldReview(state: SharedFieldEditorState, review: JSONObject, language: String) {
    val next = review.getJSONObject("field"); val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    AffairsDisclosure("Предпросмотр изменений", Modifier.testTag("field-review"), initiallyExpanded = true) {
        UntranslatedText(next.getString("title"), style = MaterialTheme.typography.titleMedium)
        Text(fieldTypeLabel(next.getString("type"))); Text(if (next.isNull("projectId")) "Всё пространство" else "Этот проект")
        UntranslatedText(genesisTranslate("Задач со значением: {count}").replace("{count}", number.format(review.getInt("valueCount"))))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text("Порядок"); UntranslatedText(number.format(next.getInt("position"))) }
        CompositionLocalProvider(LocalTemplateInspection provides true) {
            for ((key, label) in listOf("required" to "Обязательное поле", "showCard" to "Показывать в карточке", "showList" to "Показывать в списке", "archived" to "Архив"))
                TemplateToggle(label, next.getBoolean(key), false, "field-reviewed-$key") { }
        }
        val options = importRows(next.getJSONArray("options")); var limit by rememberSaveable(review.getString("fingerprint")) { mutableIntStateOf(5) }
        options.take(limit).forEach { option ->
            UntranslatedText(option.getString("title"), style = MaterialTheme.typography.bodyMedium)
            if (option.getBoolean("archived")) Text("Архив", style = MaterialTheme.typography.labelMedium)
        }
        if (options.size > limit) TemplateIconButton("Показать ещё", AffairsAction.EXPAND, !state.busy, Modifier.size(48.dp)) { limit += 5 }
        if (review.getBoolean("replaceType")) TemplateToggle("Создать поле нового типа. Прежнее поле и все его значения останутся в архиве.", state.edit!!.getBoolean("confirmReplacement"), state.editable,
            "field-confirm-replacement") { state.confirmReplacement(it) }
    }
}
@Composable private fun FieldHistory(state: SharedFieldEditorState, language: String) {
    val scope = rememberCoroutineScope(); var limit by rememberSaveable(state.edit?.getJSONObject("draft")?.getString("id")) { mutableIntStateOf(5) }
    AffairsDisclosure("История поля", Modifier.testTag("field-history-content"), initiallyExpanded = true) {
        state.history.take(limit).forEach { row -> val field = row.getJSONObject("field")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(field.getString("title"), style = MaterialTheme.typography.bodyLarge)
                    UntranslatedText(bulkHistoryTimestamp(row.getString("createdAt"), language, ZoneId.systemDefault()), style = MaterialTheme.typography.bodySmall)
                    Text(fieldTypeLabel(field.getString("type"))); Text(if (field.getBoolean("archived")) "Архив" else "Действующее поле", style = MaterialTheme.typography.bodySmall)
                }
                TemplateIconButton("Использовать эти настройки", AffairsAction.UNDO, state.editable && (field.isNull("projectId") || field.optString("projectId") == state.project), Modifier.size(48.dp).testTag("field-restore-${field.getInt("revision")}")) { scope.launch { state.restore(field) } }
            }
            HorizontalDivider()
        }
        if (state.history.size > limit) TemplateIconButton("Показать ещё", AffairsAction.EXPAND, !state.busy, Modifier.size(48.dp).testTag("field-history-more")) { limit += 5 }
    }
}
@Composable private fun FieldCopies(state: SharedFieldEditorState) {
    val scope = rememberCoroutineScope()
    AffairsDisclosure("Мои копии", Modifier.testTag("field-copies")) {
        state.copies.forEach { copy ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(copy.getJSONObject("edit").getJSONObject("draft").getString("title").ifBlank { genesisTranslate("Без названия") }, Modifier.weight(1f))
                TemplateIconButton("Использовать эти настройки", AffairsAction.UNDO, !state.busy && (state.record == null || state.phase in setOf("editing", "rejected")), Modifier.size(48.dp)) { scope.launch { state.useCopy(copy) } }
                TemplateIconButton("Удалить", AffairsAction.DELETE, !state.busy, Modifier.size(48.dp)) { scope.launch { state.removeCopy(copy) } }
            }
        }
    }
}
@Composable private fun FieldFooter(state: SharedFieldEditorState, preview: () -> Unit, submit: () -> Unit, rebase: () -> Unit, done: () -> Unit, discard: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(12.dp).testTag("field-footer"), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        when (state.phase) {
            "editing" -> {
                TemplateIconButton("Предпросмотр изменений", AffairsAction.VIEW, state.canPreview, Modifier.size(48.dp).testTag("field-preview"), onClick = preview)
                Spacer(Modifier.weight(1f))
                Button(submit, enabled = state.canSave, shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("field-save")) { Text("Применить") }
            }
            "pending" -> {
                if (state.record?.getInt("attempts") == 0) TemplateIconButton("Отмена", AffairsAction.UNDO, !state.busy && state.loaded, Modifier.size(48.dp), onClick = discard)
                Spacer(Modifier.weight(1f))
                Button(submit, enabled = !state.busy && state.loaded && !state.lost, shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("field-retry")) { Text("Повторить") }
            }
            "rejected" -> {
                Text("Изменения не сохранены", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                TemplateIconButton("Обновить", AffairsAction.REFRESH, !state.busy && state.loaded, Modifier.size(48.dp).testTag("field-rejected-rebase"), onClick = rebase)
            }
            "received" -> {
                Spacer(Modifier.weight(1f))
                Button(done, enabled = !state.busy && !state.lost, shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("field-done")) { Text("Готово") }
            }
        }
    }
}
