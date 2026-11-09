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
import androidx.compose.ui.text.style.TextOverflow
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
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.text.NumberFormat
import java.util.Locale

@Composable internal fun SharedAutomationEditorScreen(gateway: SharedWorkspaceGateway, projectId: String, rule: String?, asCopy: Boolean,
    preferences: UiPreferences, onClose: () -> Unit, onSaved: (String) -> Unit) {
    val account = LocalGenesisUserId.current; val language = LocalGenesisLanguage.current
    val state = remember(gateway, account, projectId, language) { SharedAutomationEditorState(gateway, account, projectId, language) }
    val scope = rememberCoroutineScope(); val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    val active = lifecycle.isAtLeast(Lifecycle.State.STARTED) && LocalNavigationPageContext.current?.active != false
    val calendar = SharedCustomCalendar.initial(if (LocalSacredFeaturesEnabled.current) preferences else preferences.copy(input = CalendarMode.PROFANE))
    var template by rememberSaveable { mutableStateOf<String?>(null) }; var leave by remember { mutableStateOf(false) }; var discard by remember { mutableStateOf(false) }
    val projectTitle = state.context?.optJSONObject("project")?.getString("title")
    val headerTitle = if (template != null) "Применение шаблона" else if (state.edit?.isNull("ruleId") != false) "Новое правило" else "Изменить правило"
    val noticeError = when { state.lost -> "AUTOMATION_PERMISSION_CHANGED"; state.stale -> "AUTOMATION_CONFLICT"; state.error.isNotBlank() -> state.error; else -> null }
    val canRefresh = state.loaded && !state.busy && !state.lost
    val canSaveCopy = state.edit != null && !state.busy && !state.lost
    val canCreateCopy = canSaveCopy && !state.conflict
    val canDiscard = state.record != null && !state.busy && !state.lost && !state.conflict
    fun close() { scope.launch {
        if (template != null) { template = null; return@launch }
        if (state.dirty) state.saveLocal()
        if (state.dirty || state.conflict) leave = true else onClose()
    } }
    LaunchedEffect(state, active) {
        if (!active) { if (state.dirty) state.saveLocal(); state.pause(); return@LaunchedEffect }
        state.load(rule, asCopy, calendar)
        while (isActive) { delay(30000); state.poll() }
    }
    LaunchedEffect(state.version) { if (state.dirty && state.phase == "editing") { delay(250); state.saveLocal() } }
    DisposableEffect(state) { onDispose { scope.launch(NonCancellable) { try { if (state.dirty) state.saveLocal() } finally { state.close() } } } }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = ::close)
        GenesisModalFrame(::close) {
            val compactIme = WindowInsets.ime.getBottom(LocalDensity.current) > 0 && maxHeight < 360.dp
                Column(Modifier.testTag("shared-automation-editor")) {
                    if (!compactIme) AutomationEditorHeader(headerTitle, projectTitle, false, ::close) { template = null; close() }
                    if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("automation-editor-progress"))
                    HorizontalDivider()
                    if (!compactIme) AutomationEditorNotice(noticeError)
                    val scroll = rememberScrollState()
                    LaunchedEffect(template) { scroll.scrollTo(0) }
                    Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = if (compactIme) 8.dp else 16.dp).testTag("automation-editor-content"),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (compactIme) {
                            AutomationEditorHeader(headerTitle, projectTitle, true, ::close) { template = null; close() }
                            AutomationEditorNotice(noticeError)
                        }
                        if (!state.loaded && !state.busy && !state.lost) TemplateOutlinedButton({ scope.launch { state.load(rule, asCopy, calendar) } }, Modifier.fillMaxWidth()) { Text("Повторить") }
                        if (state.edit != null && !state.lost) {
                            if (template != null) AutomationTemplateConfiguration(gateway, state, requireNotNull(template), preferences)
                            else {
                                BoxWithConstraints(Modifier.fillMaxWidth()) {
                                    val wide = maxWidth >= 720.dp
                                    if (wide) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { AutomationEditorBasics(state, preferences); AutomationEditorRows(state, false, preferences) { template = it } }
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { AutomationEditorRows(state, true, preferences) { template = it } }
                                    } else Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                        AutomationEditorBasics(state, preferences); AutomationEditorRows(state, false, preferences) { template = it }; AutomationEditorRows(state, true, preferences) { template = it }
                                    }
                                }
                                AutomationEditorDryRun(state)
                                AutomationEditorCopies(state)
                            }
                        }
                        if (compactIme && template == null && state.phase == "editing") AutomationEditorLocalActions(canRefresh, canSaveCopy, canCreateCopy, canDiscard,
                            { scope.launch { state.refresh() } }, { scope.launch { state.saveCopy() } }, { scope.launch { state.asNewCopy() } }, { discard = true })
                    }
                    HorizontalDivider()
                    Column(Modifier.fillMaxWidth().padding(if (compactIme) 8.dp else 16.dp).testTag("automation-editor-footer"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (template != null) {
                            Button({ template = null }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-template-done"), shape = AffairsLayout.controlShape) { Text("Готово") }
                        } else when (state.phase) {
                            "editing" -> {
                                if (!compactIme) AutomationEditorLocalActions(canRefresh, canSaveCopy, canCreateCopy, canDiscard,
                                    { scope.launch { state.refresh() } }, { scope.launch { state.saveCopy() } }, { scope.launch { state.asNewCopy() } }, { discard = true })
                                Button({ scope.launch { state.submit() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-editor-save"), enabled = state.canSubmit, shape = AffairsLayout.controlShape) { Text("Сохранить правило") }
                            }
                            "pending" -> {
                                Text("Ответ сервера ещё не подтверждён. Повторяется только сохранённый запрос; его параметры нельзя заменить.", style = MaterialTheme.typography.bodyMedium)
                                Button({ scope.launch { state.submit() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-editor-retry"), enabled = !state.busy && !state.lost, shape = AffairsLayout.controlShape) { Text("Повторить запрос") }
                                if (state.record?.optInt("attempts") == 0) TemplateOutlinedButton({ discard = true }, Modifier.fillMaxWidth(), !state.busy && !state.lost) { Text("Отменить") }
                            }
                            "rejected" -> {
                                Text("Правило не сохранено. Оставьте свою копию или загрузите актуальную версию.", style = MaterialTheme.typography.bodyMedium)
                                TemplateOutlinedButton({ scope.launch { state.asNewCopy() } }, Modifier.fillMaxWidth().testTag("automation-editor-conflict-copy"), !state.busy && !state.lost) { Text("Создать отдельную копию правила") }
                                Button({ discard = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !state.busy && !state.lost, shape = AffairsLayout.controlShape) { Text("Загрузить актуальную версию") }
                            }
                            "received" -> {
                                Text("Правило сохранено. Повторная отправка не требуется.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                                Button({ val id = state.record?.getJSONObject("receipt")?.getString("ruleId") ?: return@Button; scope.launch { state.discard(); if (state.record == null) onSaved(id) } },
                                    Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-editor-done"), enabled = !state.busy && !state.lost, shape = AffairsLayout.controlShape) { Text("Готово") }
                            }
                        }
                    }
                }
        }
    }
    if (leave) AlertDialog(onDismissRequest = { leave = false }, title = { Text("Несохранённые изменения") }, text = { Text("Не удалось сохранить последние изменения. Оставьте свою копию или вернитесь к редактированию.") },
        confirmButton = { TextButton({ leave = false; scope.launch { state.saveCopy(); if (state.error.isBlank()) onClose() } }, enabled = !state.busy) { Text("Сохранить мою копию") } },
        dismissButton = { TextButton({ leave = false }) { Text("Вернуться") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Удалить черновик?") }, text = { Text("Это удалит только сохранённый ввод. Правило на сервере не изменится.") },
        confirmButton = { TextButton({ discard = false; scope.launch { state.discard(); if (state.record == null) onClose() } }, enabled = !state.busy) { Text("Удалить") } },
        dismissButton = { TextButton({ discard = false }) { Text("Отмена") } })
}

@Composable private fun AutomationEditorHeader(title: String, projectTitle: String?, compact: Boolean,
    onBack: () -> Unit, onClose: () -> Unit) {
    AffairsDialogHeader(title, projectTitle.orEmpty(), onClose, onBack,
        closeTag = "automation-editor-close", backTag = "automation-editor-back", compact = compact)
}

@Composable private fun AutomationEditorNotice(error: String?) {
    if (error != null) Text(automationEditorErrorText(error),
        Modifier.fillMaxWidth().padding(16.dp).testTag("automation-editor-error").semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
}

@Composable private fun AutomationEditorLocalActions(canRefresh: Boolean, canSaveCopy: Boolean, canCreateCopy: Boolean, canDiscard: Boolean,
    onRefresh: () -> Unit, onSaveCopy: () -> Unit, onCreateCopy: () -> Unit, onDiscard: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TemplateIconButton("Обновить", AffairsAction.REFRESH, canRefresh, Modifier.weight(1f).testTag("automation-editor-refresh"), onClick = onRefresh)
        TemplateIconButton("Сохранить мою копию", AffairsAction.TEMPLATE, canSaveCopy, Modifier.weight(1f).testTag("automation-editor-copy"), onClick = onSaveCopy)
        TemplateIconButton("Создать отдельную копию правила", AffairsAction.ADD, canCreateCopy, Modifier.weight(1f).testTag("automation-editor-as-new"), onClick = onCreateCopy)
        TemplateIconButton("Удалить черновик", AffairsAction.DELETE, canDiscard, Modifier.weight(1f).testTag("automation-editor-discard"), onClick = onDiscard)
    }
}

@Composable private fun AutomationEditorDryRun(state: SharedAutomationEditorState) {
    val scope = rememberCoroutineScope(); val edit = state.edit ?: return; val trigger = edit.getJSONObject("definition").getJSONObject("trigger")
    AffairsDisclosure("Проверка без выполнения", Modifier.testTag("automation-editor-dry-run")) {
        Text("Проверка не изменяет задачи, не создаёт запуски и не отправляет уведомления. Результат зависит от текущих данных и прав.", style = MaterialTheme.typography.bodyMedium)
        if (trigger.getString("type") != "schedule" || trigger.getString("target") != "project") {
            ImportChoice("Задача для проверки", state.previewTask.ifEmpty { "@none" }, listOf("@none" to genesisTranslate("Выберите задачу")) + state.tasks.map { it.getString("id") to it.getString("title") }, state.editable, "automation-editor-preview-task") { state.changeTask(it.takeUnless { it == "@none" }.orEmpty()) }
            if (state.taskCursor != null) TemplateOutlinedButton({ scope.launch { state.moreTasks() } }, Modifier.fillMaxWidth().testTag("automation-editor-more-tasks"), state.editable) { Text("Показать ещё") }
        }
        TemplateOutlinedButton({ scope.launch { state.dryRun() } }, Modifier.fillMaxWidth().testTag("automation-editor-preview"), state.canSubmit) { AffairsActionIcon(AffairsAction.VIEW); Spacer(Modifier.width(8.dp)); Text("Проверить правило") }
        state.preview?.let { result ->
            Text(if (result.getBoolean("matches")) "Условия выполнены" else "Условия не выполнены", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("automation-editor-preview-result"))
            val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(state.language))
            if (!result.isNull("taskRevision")) UntranslatedText(genesisTranslate("Версия задачи: {revision}").replace("{revision}", number.format(result.getInt("taskRevision"))), style = MaterialTheme.typography.bodySmall)
            result.optJSONObject("effects")?.let { effect ->
                Text(if (effect.getBoolean("updated")) "Параметры задачи будут изменены." else "Параметры задачи не изменятся.", style = MaterialTheme.typography.bodyMedium)
                AutomationEditorEffects(state, effect)
                UntranslatedText(genesisTranslate("Будет создано задач: {count}").replace("{count}", number.format(effect.getInt("createdTaskCount"))), style = MaterialTheme.typography.bodyMedium)
                UntranslatedText(genesisTranslate("Получателей уведомления: {count}").replace("{count}", number.format(effect.getInt("notifications"))), style = MaterialTheme.typography.bodyMedium)
                val notices = effect.getJSONArray("notices"); for (index in 0 until notices.length()) Text(automationEditorErrorText(notices.getString(index)), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable private fun AutomationEditorCopies(state: SharedAutomationEditorState) {
    if (state.copies.isEmpty()) return
    val scope = rememberCoroutineScope()
    AffairsDisclosure("Мои копии", Modifier.testTag("automation-editor-copies")) {
        var limit by rememberSaveable { mutableIntStateOf(5) }
        state.copies.take(limit).forEach { entry ->
            UntranslatedText(entry.getJSONObject("edit").getString("title"), style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TemplateIconButton("Открыть копию", AffairsAction.VIEW, state.editable && !state.dirty, Modifier.weight(1f).testTag("automation-editor-copy-${entry.getString("id")}")) { scope.launch { state.useCopy(entry.getString("id")) } }
                TemplateIconButton("Удалить копию", AffairsAction.DELETE, state.editable, Modifier.weight(1f)) { scope.launch { state.removeCopy(entry.getString("id")) } }
            }
        }
        if (state.copies.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth()) { Text("Показать ещё") }
    }
}

internal fun automationEditorErrorText(code: String): String = when (code) {
    "PLANNING_DRAFT_INVALID", "PLANNING_DRAFT_SCOPE" -> "Черновик не удалось прочитать. Он сохранён на устройстве. Повторите загрузку или закройте окно."
    "PLANNING_DRAFT_STORAGE", "STORAGE" -> "Не удалось сохранить последние изменения. Попробуйте сохранить копию или закройте окно без них."
    "AUTOMATION_PERMISSION_CHANGED" -> "Доступ к проекту или редактированию правила изменился. Сохранённые черновики и неподтверждённые запросы остаются на этом устройстве. После восстановления прав откройте проект и автоматизации с тем же аккаунтом."
    "AUTOMATION_CONFLICT" -> "Правило изменилось. Ваш ввод сохранён. Обновите данные или создайте отдельную выключенную копию правила."
    "AUTOMATION_LOCAL_QUEUE" -> "Сначала синхронизируйте изменения задач этого устройства, затем повторите проверку или сохранение."
    "AUTOMATION_PROJECT_TARGET" -> "Для проекта по расписанию оставьте только условия проекта, создание из шаблона и уведомления. Остальные строки сохранены: измените или удалите их."
    "AUTOMATION_OWNER_REQUIRED" -> "Выберите действующего владельца правила."
    "AUTOMATION_TASK_REQUIRED" -> "Выберите задачу для проверки правила."
    "INVALID_TITLE" -> "Введите название правила."
    "INVALID_CALENDAR_CONTEXT" -> "Укажите действующий часовой пояс, например Europe/Moscow или UTC."
    "AUTOMATION_DRAFT_INVALID", "AUTOMATION_INVALID" -> "Проверьте поля правила: значения, условия, действия и расписание. Ваш ввод сохранён."
    "PLANNING_DRAFT_CHANGED" -> "Черновик изменился в другом окне. Сохраните свою копию и откройте редактор заново."
    "TEMPLATE_DATE_CLAMPED" -> "Дата сдвинута к последнему существующему дню месяца."
    else -> automationErrorText(code)
}
