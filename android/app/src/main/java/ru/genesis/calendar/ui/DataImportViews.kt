package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable internal fun ImportCounts(value: JSONObject) {
    UntranslatedText(genesisTranslate("Проекты") + ": " + value.getInt("projectCount") + " · " + genesisTranslate("Задачи") + ": " + value.getInt("taskCount"),
        Modifier.testTag("import-counts"), style = MaterialTheme.typography.bodyMedium)
}

@Composable internal fun ImportPreview(preview: JSONObject, current: Boolean, enabled: Boolean) {
    Text("Предпросмотр", Modifier.testTag("import-preview"), style = MaterialTheme.typography.titleMedium)
    if (!current) Text("Настройки изменились. Обновите предпросмотр.", style = MaterialTheme.typography.bodyMedium)
    ImportCounts(preview)
    val data = preview.getJSONObject("data"); val calendar = data.getJSONObject("calendarContext")
    UntranslatedText(genesisTranslate("Календарь") + ": " + calendarModeLabel(CalendarMode.fromWire(data.getString("calendarMode"))) + " · " + calendar.getString("timeZone"), style = MaterialTheme.typography.bodyMedium)
    if (data.getString("calendarMode") == "profane") UntranslatedText(genesisTranslate("Начало года") + ": " + genesisTranslate(if (calendar.getString("gregorianYearStart") == "march") "Март" else "Январь"), style = MaterialTheme.typography.bodyMedium)
    val counts = preview.getJSONObject("sourceCounts")
    UntranslatedText(genesisTranslate("Комментарии") + ": " + counts.getInt("comments") + " · " + genesisTranslate("Вложения") + ": " + counts.getInt("attachments"), style = MaterialTheme.typography.bodyMedium)
    val titles = preview.optJSONObject("issueTitles")
    ImportIssues("Ошибки", preview.getJSONArray("blockers"), titles)
    ImportIssues("Замечания", preview.getJSONArray("notices"), titles)
    ImportBatch("Задачи в переносе", importRows(data.getJSONArray("tasks")), "import-task-sample") { row ->
        UntranslatedText(row.getString("title"), style = MaterialTheme.typography.bodyMedium)
    }
    if (preview.getInt("taskCount") > data.getJSONArray("tasks").length()) Text("Показаны первые 100 задач. Переносятся все задачи из предпросмотра.", style = MaterialTheme.typography.bodyMedium)
}

@Composable private fun ImportIssues(title: String, rows: JSONArray, titles: JSONObject? = null) {
    if (rows.length() == 0) return
    AffairsDisclosure(title) {
        var limit by rememberSaveable { mutableIntStateOf(5) }
        importRows(rows).take(limit).forEach { issue ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(importIssueText(issue.getString("code")), style = MaterialTheme.typography.bodyMedium)
                val field = issue.getString("field")
                if (field.isNotBlank()) UntranslatedText(titles?.optString(field, field) ?: field, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (rows.length() > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
    }
}

@Composable internal fun ImportReceipt(receipt: JSONObject, enabled: Boolean, undo: () -> Unit, open: () -> Unit) {
    ImportIssues("Замечания", receipt.getJSONArray("notices"))
    val shown = receipt.getJSONArray("notices").length(); val total = receipt.optInt("noticeCount", shown)
    if (total > shown) {
        Text("Показаны первые 100 замечаний.", style = MaterialTheme.typography.bodyMedium)
        UntranslatedText(genesisTranslate("Замечания") + ": $total", style = MaterialTheme.typography.bodyMedium)
    }
    if (receipt.getString("state") == "active") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        AffairsIconButton("Открыть проект", AffairsAction.VIEW, open, Modifier.testTag("import-open-project"), enabled = enabled)
        if (receipt.getBoolean("canUndo")) AffairsIconButton("Отменить импорт", AffairsAction.UNDO, undo, Modifier.testTag("import-undo"), enabled = enabled)
    }
}

@Composable internal fun ImportHistory(state: DataImportState, undo: (JSONObject) -> Unit, onOpenProject: (String) -> Unit) {
    val scope = rememberCoroutineScope(); val language = LocalGenesisLanguage.current
    Text("Отмена доступна, пока созданные данные и связи не изменились. При конфликте последующие правки сохраняются.", style = MaterialTheme.typography.bodyMedium)
    if (state.pendingUndos.isNotEmpty()) ImportBatch("Ожидающие отмены", state.pendingUndos, "import-pending-undos") { receipt ->
            ImportCounts(receipt)
            OutlinedButton({ undo(receipt) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Повторить отмену") }
    }
    if (!state.historyLoaded) WorkspaceLoadingText() else if (state.history.isEmpty()) Text("Импортов пока нет.")
    var limit by rememberSaveable { mutableIntStateOf(5) }
    state.history.take(limit).forEach { receipt -> key(receipt.getString("importId")) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            receipt.optString("createdAt").takeIf { it.isNotBlank() }?.let { raw ->
                val date = runCatching { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(Locale.forLanguageTag(language)).withZone(ZoneId.systemDefault()).format(Instant.parse(raw)) }.getOrDefault(raw)
                UntranslatedText(date, style = MaterialTheme.typography.titleSmall)
            }
            ImportCounts(receipt)
            Text(when (receipt.getString("state")) { "undone" -> "Отменено"; "removed" -> "Удалено"; else -> "Применено" }, style = MaterialTheme.typography.bodyMedium)
            ImportReceipt(receipt, !state.busy, { undo(receipt) }, { onOpenProject(receipt.getString("rootProjectId")) })
            HorizontalDivider()
        }
    } }
    if (limit < state.history.size) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
    else if (state.cursor != null) OutlinedButton({ scope.launch { state.refreshHistory(more = true) } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
}

@Composable internal fun ImportCopies(state: DataImportState, enabled: Boolean) {
    val scope = rememberCoroutineScope()
    ImportBatch("Сохранённые версии", state.copies, "import-copies") { copy ->
            val edit = copy.getJSONObject("edit")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                UntranslatedText(edit.getJSONObject("source").getString("name"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                AffairsIconButton("Выбрать версию", AffairsAction.VIEW, { scope.launch { state.useCopy(copy) } }, enabled = enabled &&
                    (state.phase in setOf("editing", "rejected") || state.phase == "pending" && state.record?.optInt("attempts") == 0))
                AffairsIconButton("Удалить версию", AffairsAction.DELETE, { scope.launch { state.removeCopy(copy) } }, enabled = enabled)
            }
    }
}

internal fun importIssueText(code: String): String = when (code) {
    "DATA_ORGANIZE_REQUIRED" -> "Для импорта этих статусов нужно право перемещать задачи. Обратитесь к владельцу пространства."
    "DATA_MEMBER_MAPPING_REQUIRED" -> "Сопоставьте участника или явно выберите «Без исполнителя»."
    "DATA_MEMBER_UNAVAILABLE" -> "Участник недоступен в назначении."
    "DATA_MEMBER_UNASSIGNED" -> "Назначение участника не переносится."
    "DATA_STATUS_MAPPING_REQUIRED" -> "Сопоставьте статус с назначением."
    "DATA_STATUS_KIND_MISMATCH" -> "Выполненный статус можно сопоставить только с выполненным."
    "DATA_STATUS_UNAVAILABLE" -> "Статус недоступен в назначении."
    "DATA_TREE_DESTINATION_REQUIRED" -> "Для нескольких проектов выберите создание дерева проектов."
    "DATA_HISTORY_NO_REPLAY" -> "История сохраняется без запуска уведомлений, автоматизаций и наград."
    "DATA_DESTINATION_FIELDS_UNCHANGED" -> "Определение поля назначения сохраняется. Проверьте сопоставление вариантов."
    "DATA_FIELD_CREATE_FORBIDDEN" -> "Создавать поля может владелец или администратор пространства."
    "DATA_SPACE_FIELD_NARROWED" -> "Поле пространства будет создано отдельно в каждом новом проекте."
    "CUSTOM_FIELD_REQUIRED", "DATA_DESTINATION_REQUIRED_FIELD" -> "Заполните обязательные поля."
    "DATA_TRELLO_LIMITATIONS" -> "Trello: проверьте выполненные списки. Цвета, плагины и настройки доски не переносятся."
    "DATA_TRELLO_DATE_ONLY" -> "Срок Trello переведён в дату выбранного часового пояса; исходное время сохранено в истории."
    "DATA_MULTIPLE_ASSIGNEES" -> "У Trello-карточки несколько исполнителей. Выбран первый; проверьте назначение."
    "DATA_TRELLO_ACTIONS_UNSUPPORTED" -> "Часть событий Trello не поддерживается."
    "DATA_TRELLO_ARCHIVED_LIST" -> "Архивный список Trello восстановится как обычный статус."
    "DATA_PROJECT_SETTINGS_UNCHANGED" -> "Настройки существующего проекта сохраняются; импорт добавляет задачи и категории."
    "DATA_APPROVAL_HISTORY_ONLY" -> "Подтверждения источника сохраняются в истории. Новые подтверждения не выдаются от имени участников."
    "DATA_LABEL_EXCLUDED" -> "Метка не переносится."
    "DATA_LABEL_UNAVAILABLE" -> "Метка недоступна в назначении."
    "DATA_FIELD_UNSUPPORTED", "DATA_COLUMN_IGNORED" -> "Неподдерживаемое поле пропущено."
    "DATA_URL_REMOVED" -> "Небезопасная ссылка вложения удалена."
    "DATA_URL_QUERY_REMOVED" -> "Параметры ссылки удалены для защиты секретов."
    "DATA_CSV_LIMITATIONS", "DATA_ATTACHMENTS_METADATA_ONLY", "DATA_SCHEDULES_METADATA_ONLY", "DATA_VISUAL_ASSET_EXCLUDED", "DATA_EXTERNAL_REFERENCE_EXCLUDED", "DATA_INBOX_AS_PROJECT" -> exportIssueText(code)
    else -> "Проверьте файл, даты, поля и связи. Исправьте ошибки и обновите предпросмотр."
}
internal fun importErrorText(code: String): String = when (code) {
    "DATA_PREVIEW_CHANGED", "DATA_PREVIEW_REQUIRED" -> "Назначение изменилось. Обновите предпросмотр; настройки сохранены."
    "DATA_UNDO_CONFLICT" -> "Отмена недоступна: данные изменились или появились новые связи. Последующие изменения сохранены."
    "DATA_SOURCE_INVALID", "DATA_JSON_INVALID" -> "Не удалось прочитать файл. Выберите файл UTF-8 и повторите."
    "DATA_SOURCE_STORAGE", "DATA_SOURCE_QUOTA", "DATA_PICKER_FAILED" -> "Не удалось сохранить файл на устройстве. Освободите место и повторите."
    "DATA_FILE_TOO_LARGE", "REQUEST_TOO_LARGE" -> "Файл превышает лимит 20 МБ."
    "DATA_LOCAL_QUEUE" -> "Сначала синхронизируйте ожидающие изменения проекта."
    "DATA_CSV_MAPPING_REQUIRED" -> "Выберите колонку названия и проверьте сопоставление колонок."
    "DATA_CSV_INVALID" -> "Проверьте разделитель, кавычки и количество колонок CSV."
    "DATA_DATE_INVALID" -> "Проверьте даты и выбранный формат CSV."
    "DATA_RESOURCE_LIMIT" -> "Превышен лимит данных. Уменьшите объём и повторите."
    "PLANNING_DRAFT_CHANGED" -> "Черновик изменился в другом окне. Сохраните свою версию и обновите экран."
    "PLANNING_DRAFT_LIMIT", "DATA_UNDO_JOURNAL_LIMIT" -> "Достигнут лимит сохранённых версий. Удалите ненужную версию и повторите."
    "UNAUTHORIZED", "NOT_DEPLOYED" -> "Нет доступа"
    "NETWORK" -> "Нет подключения. Черновик сохранён на устройстве."
    "PLANNING_DRAFT_STORAGE", "DATA_UNDO_JOURNAL_INVALID", "DATA_IMPORT_INVALID" -> "Не удалось сохранить черновик. Проверьте поля и повторите."
    else -> if (code.startsWith("DATA_") || code.startsWith("CUSTOM_FIELD_")) importIssueText(code) else "Не удалось выполнить действие. Черновик сохранён; повторите попытку."
}
