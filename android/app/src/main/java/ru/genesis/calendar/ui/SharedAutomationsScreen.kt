package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import java.time.ZoneId
import java.util.Locale

@Composable private fun automationTranslator(): (String) -> String {
    val context = LocalContext.current; val language = LocalGenesisLanguage.current
    return remember(context, language) { { source -> translateGenesisText(context, source, language) } }
}

@Composable internal fun SharedAutomationsScreen(gateway: SharedWorkspaceGateway, projectId: String,
    onClose: () -> Unit, onLost: () -> Unit, onChanged: () -> Unit, onTask: (String) -> Unit, preferences: UiPreferences = UiPreferences()) {
    val language = LocalGenesisLanguage.current
    key(gateway, LocalGenesisUserId.current, projectId, language) {
        var savedRule by rememberSaveable { mutableStateOf("") }; var savedDeleted by rememberSaveable { mutableStateOf(false) }
        var writerMode by rememberSaveable { mutableStateOf<String?>(null) }; var writerRule by rememberSaveable { mutableStateOf("") }
        var libraryVersion by remember { mutableIntStateOf(0) }
        val lost by rememberUpdatedState(onLost); val changed by rememberUpdatedState(onChanged)
        val state = remember(libraryVersion) { SharedAutomationsState(gateway, projectId, language, savedRule, savedDeleted,
            { id, deleted -> savedRule = id; savedDeleted = deleted }, { lost() }, { changed() }) }
        val scope = rememberCoroutineScope(); val t = automationTranslator()
        val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
        val active = lifecycle.isAtLeast(Lifecycle.State.STARTED) && LocalNavigationPageContext.current?.active != false && writerMode == null
        val night = LocalEveningTheme.current
        var confirmation by remember { mutableStateOf<JSONObject?>(null) }
        DisposableEffect(state) { onDispose { state.close() } }
        LaunchedEffect(state, active) {
            if (!active) { state.pause(); return@LaunchedEffect }
            state.load(); while (isActive) { delay(30000); state.poll() }
        }
        if (writerMode != null) SharedAutomationEditorScreen(gateway, projectId, writerRule.takeIf(String::isNotBlank), writerMode == "copy", preferences,
            onClose = { writerMode = null }, onSaved = { id -> savedRule = id; savedDeleted = false; libraryVersion++; writerMode = null; onChanged() })
        if (writerMode == null) Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            val view = LocalView.current
            SideEffect { (view.parent as? DialogWindowProvider)?.window?.let { WindowInsetsControllerCompat(it, view).isAppearanceLightStatusBars = !night } }
            BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Surface(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().padding(12.dp).heightIn(max = maxHeight * .94f), shape = AffairsLayout.shape) {
                    Column(Modifier.testTag("shared-automations-screen")) {
                        AutomationHeader(state, { scope.launch { state.list() } }, { scope.launch { state.refresh() } }, onClose)
                        HorizontalDivider()
                        val scroll = rememberScrollState()
                        LaunchedEffect(state.ruleId, state.cursor, state.runCursor, state.deleted) { scroll.scrollTo(0) }
                        Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(scroll).padding(16.dp).testTag("automation-content"),
                            verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            state.project?.let { UntranslatedText(it.getString("title"), style = MaterialTheme.typography.titleMedium) }
                            if (!state.loaded) WorkspaceLoadingText()
                            else if (state.ruleId.isEmpty()) state.page?.let { page ->
                                AutomationLibrary(state, page, onSelect = { id -> scope.launch { state.choose(id) } },
                                    onCreate = { writerRule = ""; writerMode = "new" },
                                    onFilter = { deleted -> scope.launch { state.list(deleted) } },
                                    onPage = { next -> scope.launch { state.page(false, next) } })
                            }
                            else state.rule?.let { rule -> key(rule.getString("id")) { AutomationDetails(state, rule, t, preferences,
                                { kind, value, run -> confirmation = JSONObject().put("kind", kind).put("value", value ?: JSONObject.NULL).put("runId", run ?: JSONObject.NULL)
                                    .put("ruleId", rule.getString("id")).put("revision", rule.getInt("revision")) },
                                { id -> scope.launch { state.openTask(id) { onTask(id) } } },
                                { copy -> writerRule = rule.getString("id"); writerMode = if (copy) "copy" else "edit" }) } }
                            state.page?.let { page ->
                                AffairsDisclosure("Фоновая обработка", Modifier.testTag("automation-worker")) {
                                    if (!page.isNull("workerCompletedAt")) UntranslatedText(bulkHistoryTimestamp(page.getString("workerCompletedAt"), language, ZoneId.systemDefault()), style = MaterialTheme.typography.bodySmall)
                                    Text(if (state.workerFresh) "Фоновый обработчик отвечает." else "Нет свежего подтверждения фоновой обработки. Запуски могут задерживаться.", style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                        if (state.busy || state.error.isNotBlank() || state.record != null) {
                        HorizontalDivider()
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("automation-working"))
                            if (state.error.isNotBlank()) Text(automationErrorText(state.error), Modifier.testTag("automation-error").semantics { liveRegion = LiveRegionMode.Polite },
                                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                            when (state.phase) {
                                "pending", "editing" -> {
                                    Text("Результат отправки пока не подтверждён. Повторите ту же команду.", style = MaterialTheme.typography.bodyMedium)
                                    Button({ scope.launch { state.retry() } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-retry-command")) { Text("Повторить запрос") }
                                    if (state.phase == "editing" || state.record?.optInt("attempts") == 0) OutlinedButton({ scope.launch { state.finish() } }, enabled = !state.busy,
                                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-discard-command")) { Text("Отменить") }
                                }
                                "rejected" -> Button({ scope.launch { state.finish() } }, enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-discard-command")) { Text("Загрузить актуальную версию") }
                                "received" -> {
                                    Text("Команда подтверждена сервером.", Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodyMedium)
                                    Button({ scope.launch { state.finish() } }, enabled = !state.busy,
                                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-done")) { Text("Готово") }
                                }
                            }
                        }
                        }
                    }
                }
            }
        }
        confirmation?.let { command ->
            val kind = command.getString("kind"); val enabling = kind == "enabled" && command.getBoolean("value")
            val deleting = kind == "deleted" && command.getBoolean("value")
            val label = when (kind) { "enabled" -> if (enabling) "Включить правило" else "Выключить правило"; "deleted" -> if (deleting) "Удалить правило" else "Восстановить правило"; else -> "Повторить запуск" }
            AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(label) }, text = {
                Text(when (kind) {
                    "enabled" -> if (enabling) "Правило будет выполнять действия по заданным условиям." else "Запуски будут остановлены. Уже выполненные изменения сохранятся."
                    "deleted" -> if (deleting) "Журнал запусков сохранится." else "Правило восстановится выключенным."
                    else -> "Правило повторит действия для выбранного запуска."
                })
            }, confirmButton = { TextButton({ confirmation = null; scope.launch { state.apply(kind,
                command.opt("value").takeIf { it is Boolean } as Boolean?, command.optString("runId").takeUnless { it == "null" || it.isEmpty() },
                command.getString("ruleId"), command.getInt("revision")) } },
                Modifier.testTag("automation-confirm-command"), enabled = state.canMutate) { Text(label) } },
                dismissButton = { TextButton({ confirmation = null }) { Text("Отмена") } })
        }
    }
}

@Composable private fun AutomationHeader(state: SharedAutomationsState, onList: () -> Unit, onRefresh: () -> Unit, onClose: () -> Unit) {
    AffairsDialogHeader("Автоматизации", onClose = onClose,
        onBack = if (state.ruleId.isNotEmpty()) onList else null, closeTag = "automation-close",
        backTag = "automation-back", backEnabled = !state.busy && state.record == null) {
        AffairsIconButton("Обновить", AffairsAction.REFRESH, onRefresh, Modifier.testTag("automation-refresh"), enabled = !state.busy)
    }
}

@Composable private fun AutomationLibrary(state: SharedAutomationsState, page: JSONObject, onSelect: (String) -> Unit,
    onCreate: () -> Unit, onFilter: (Boolean) -> Unit, onPage: (Boolean) -> Unit) {
    if (page.getBoolean("canCreate")) Button(onCreate, enabled = !state.busy && state.record == null, shape = AffairsLayout.controlShape,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-create")) {
        AffairsActionIcon(AffairsAction.ADD); Spacer(Modifier.width(8.dp)); Text("Создать правило")
    }
    ImportChoice("Показывать", state.deleted.toString(), listOf("false" to genesisTranslate("Действующие правила"), "true" to genesisTranslate("Удалённые правила")),
        !state.busy && state.record == null, "automation-filter") { onFilter(it.toBooleanStrict()) }
    val rows = importRows(page.getJSONArray("rules")); var limit by rememberSaveable(state.cursor, state.deleted) { mutableIntStateOf(5) }
    if (rows.isEmpty()) Text("Правил пока нет.")
    rows.take(limit).forEach { rule -> OutlinedButton({ onSelect(rule.getString("id")) }, enabled = !state.busy && state.record == null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-rule-${rule.getString("id")}")) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            UntranslatedText(rule.getString("title"), style = MaterialTheme.typography.titleSmall)
            Text(if (rule.getBoolean("deleted")) "Удалено" else if (rule.getBoolean("enabled")) "Включено" else "Выключено", style = MaterialTheme.typography.bodyMedium)
        }
    } }
    if (rows.size > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-more-rules")) { Text("Показать ещё") }
    AutomationPages(!page.isNull("nextCursor"), state.previousPages.size, !state.busy, "automation-rules", onPage)
}

@Composable private fun AutomationFact(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        UntranslatedText(value, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable private fun AutomationDetails(state: SharedAutomationsState, rule: JSONObject, t: (String) -> String, preferences: UiPreferences,
    onCommand: (String, Boolean?, String?) -> Unit, onTask: (String) -> Unit, onEdit: (Boolean) -> Unit) {
    val definition = rule.getJSONObject("definition"); val parameters = automationCanReadParameters(state)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        UntranslatedText(rule.getString("title"), Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        if (state.canManage) AffairsIconButton(if (rule.getBoolean("deleted")) "Восстановить правило" else "Удалить правило", if (rule.getBoolean("deleted")) AffairsAction.UNDO else AffairsAction.DELETE,
            { onCommand("deleted", !rule.getBoolean("deleted"), null) }, Modifier.testTag("automation-delete-restore"), enabled = state.canMutate)
    }
    if (!rule.getBoolean("deleted") && state.project?.optJSONObject("permissions")?.optBoolean("editTasks") == true) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TemplateIconButton("Изменить правило", AffairsAction.EDIT, state.canMutate, Modifier.weight(1f).testTag("automation-edit")) { onEdit(false) }
        TemplateIconButton("Копировать правило", AffairsAction.TEMPLATE, !state.busy && state.record == null, Modifier.weight(1f).testTag("automation-copy")) { onEdit(true) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (rule.getBoolean("deleted")) "Удалено" else if (rule.getBoolean("enabled")) "Включено" else "Выключено", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
        if (!rule.getBoolean("deleted")) Switch(rule.getBoolean("enabled"), { onCommand("enabled", it, null) },
            enabled = state.canMutate && (rule.getBoolean("enabled") || parameters), modifier = Modifier.testTag("automation-enabled")
                .semantics { contentDescription = t(if (rule.getBoolean("enabled")) "Выключить правило" else "Включить правило") })
    }
    if (!parameters && state.canManage) Text("Не все параметры доступны. Включение и повторный запуск здесь заблокированы.", style = MaterialTheme.typography.bodyMedium)
    AutomationFact("Владелец", state.member(rule.optString("ownerId")) ?: t("Удалённый участник"))
    val trigger = definition.getJSONObject("trigger")
    AutomationFact("Триггер", t(automationTriggerLabel(trigger.getString("type"))))
    if (trigger.has("leadDays")) AutomationFact("За сколько дней", trigger.getInt("leadDays").toString())
    if (trigger.has("time")) AutomationFact("Время", trigger.getString("time"))
    AutomationFact("Календарь правила", t(when (definition.getString("calendarMode")) { "sacred" -> "Солнечный календарь"; "lunar" -> "Лунный календарь"; else -> "Григорианский календарь" }))
    AutomationFact("Часовой пояс", definition.getJSONObject("calendarContext").getString("timeZone"))
    if (trigger.getString("type") == "schedule") AutomationSchedule(trigger, state.language, t)
    AffairsDisclosure("Условия", Modifier.testTag("automation-conditions")) {
        val conditions = importRows(definition.getJSONArray("conditions")); var count by rememberSaveable { mutableIntStateOf(5) }
        if (conditions.isEmpty()) Text("Без условий")
        conditions.take(count).forEach { condition ->
            val fieldId = condition.optString("fieldId").takeIf(String::isNotEmpty)
            val label = if (condition.getString("field") == "custom") state.field(fieldId.orEmpty())?.getString("title") ?: t("Недоступно") else t(automationFieldLabel(condition.getString("field")))
            val operator = condition.getString("operator")
            val value = if (operator in setOf("missing", "present")) "" else automationReference(state, condition.getString("field"), condition.get("value"), fieldId, t).text
            UntranslatedText(label + " · " + t(automationOperatorLabel(operator)) + value.takeIf(String::isNotEmpty)?.let { ": $it" }.orEmpty(), style = MaterialTheme.typography.bodyMedium)
        }
        if (conditions.size > count) OutlinedButton({ count += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
    }
    AffairsDisclosure("Действия", Modifier.testTag("automation-actions")) {
        val actions = importRows(definition.getJSONArray("actions")); var count by rememberSaveable { mutableIntStateOf(5) }
        actions.take(count).forEachIndexed { index, action ->
            AutomationFact(automationActionLabel(action.getString("type")), automationActionValue(state, action, t).text)
            state.templateInspection(action)?.let { inspection ->
                AffairsDisclosure("Предпросмотр применения", Modifier.testTag("automation-template-parameters-$index")) {
                    AutomationFact("Место создания", state.project?.getString("title").orEmpty())
                    AutomationFact("Язык", Locale.forLanguageTag(inspection.language).getDisplayLanguage(Locale.forLanguageTag(state.language)))
                    AutomationFact("Базовая дата", automationCivilDate(inspection.anchorDate, state.language))
                    CompositionLocalProvider(LocalTemplateInspection provides true) {
                        SharedTemplateApplyEditor(inspection.form(SharedCustomCalendar.initial(preferences)), preferences, listOfNotNull(state.project), automationRun = true)
                    }
                }
            }
        }
        if (actions.size > count) OutlinedButton({ count += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
    }
    AffairsDisclosure("Журнал запусков", Modifier.testTag("automation-runs")) {
        val scope = rememberCoroutineScope(); val page = state.runs
        if (page == null) WorkspaceLoadingText() else {
            val rows = importRows(page.getJSONArray("runs")); var count by rememberSaveable(state.runCursor) { mutableIntStateOf(5) }
            if (rows.isEmpty()) Text("Запусков пока нет.")
            rows.take(count).forEach { run -> Column(Modifier.fillMaxWidth().testTag("automation-run-${run.getString("id")}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(bulkStateLabel(run.getString("state")), style = MaterialTheme.typography.titleSmall)
                UntranslatedText(bulkHistoryTimestamp(run.getString("createdAt"), state.language, ZoneId.systemDefault()), style = MaterialTheme.typography.bodySmall)
                if (!run.isNull("taskTitle")) OutlinedButton({ onTask(run.getString("taskId")) }, enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-run-task-${run.getString("id")}")) { UntranslatedText(run.getString("taskTitle")) }
                AutomationFact("Попытки", run.getInt("attempts").toString())
                if (!run.isNull("errorCode")) Text(automationErrorText(run.getString("errorCode")), style = MaterialTheme.typography.bodyMedium)
                run.optJSONObject("result")?.let { result ->
                    AutomationFact("Создано задач", result.getInt("createdTaskCount").toString()); AutomationFact("Уведомления", result.getInt("notifications").toString())
                    val notices = result.getJSONArray("notices"); (0 until notices.length()).forEach { Text(automationErrorText(notices.getString(it)), style = MaterialTheme.typography.bodySmall) }
                }
                if (state.canManage && run.getString("state") == "failed") AffairsIconButton("Повторить запуск", AffairsAction.REFRESH,
                    { onCommand("retry", null, run.getString("id")) }, Modifier.testTag("automation-retry-run-${run.getString("id")}"),
                    enabled = state.canMutate && parameters && rule.getBoolean("enabled") && !rule.getBoolean("deleted") && run.getInt("revision") == rule.getInt("revision") && run.getInt("retryCount") < 3)
                HorizontalDivider()
            } }
            if (rows.size > count) OutlinedButton({ count += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-more-runs")) { Text("Показать ещё") }
            AutomationPages(!page.isNull("nextCursor"), state.previousRunPages.size, !state.busy, "automation-runs") { next -> scope.launch { state.page(true, next) } }
        }
    }
}

@Composable private fun AutomationSchedule(trigger: JSONObject, language: String, t: (String) -> String) {
    AffairsDisclosure("Расписание", Modifier.testTag("automation-schedule")) {
        val recurrence = trigger.getJSONObject("recurrence"); val pattern = recurrence.getString("pattern")
        AutomationFact("Повторение", t(when (pattern) {
            "daily" -> "Каждый день"; "weekdays" -> "Дни недели"; "monthly" -> "Ежемесячно"; "yearly" -> "Ежегодно"
            "pyata-days" -> "Дни пяты"; "month-days" -> "Дни месяца"; "lunar-days" -> "Лунные дни"; "lunar-decades" -> "Лунные декады"
            "lunar-decade-days" -> "Дни лунной декады"; "lunar-phases" -> "Лунные фазы"; else -> "Лунный год"
        }))
        AutomationFact("Интервал", recurrence.getInt("interval").toString())
        for ((key, label) in listOf("days" to "Дни", "months" to "Месяцы", "pyatas" to "Пяты")) {
            val values = recurrence.getJSONArray(key)
            if (values.length() > 0 && (key != "days" || pattern !in setOf("daily", "monthly", "yearly"))) {
                val content = (0 until values.length()).joinToString(", ") { index ->
                    if (key == "days" && pattern == "weekdays") java.time.DayOfWeek.of(values.getInt(index)).getDisplayName(java.time.format.TextStyle.SHORT, Locale.forLanguageTag(language))
                    else values.getInt(index).toString()
                }
                AutomationFact(label, content)
            }
        }
        AutomationFact("Начало", automationCivilDate(recurrence.getString("rangeStart"), language))
        AutomationFact("Окончание", recurrence.getString("rangeEnd").takeIf(String::isNotEmpty)?.let { automationCivilDate(it, language) } ?: t("Без окончания"))
        AutomationFact("Применять к", t(if (trigger.getString("target") == "project") "Проект" else "Задачи"))
    }
}

@Composable private fun AutomationPages(next: Boolean, previous: Int, enabled: Boolean, tag: String, onPage: (Boolean) -> Unit) {
    if (next || previous > 0) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        AffairsIconButton("Предыдущая страница", AffairsAction.BACK, { onPage(false) }, Modifier.testTag("$tag-previous"), enabled = enabled && previous > 0)
        UntranslatedText(genesisTranslate("Страница") + " ${previous + 1}", style = MaterialTheme.typography.bodyMedium)
        AffairsIconButton("Следующая страница", AffairsAction.BACK, { onPage(true) }, Modifier.rotate(180f).testTag("$tag-next"), enabled = enabled && next)
    }
}
