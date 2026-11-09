package ru.genesis.calendar.ui

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneId

internal typealias DataExportPicker = (String, String, (DataExportDestination?) -> Unit) -> Unit

@Composable internal fun SharedDataExportScreen(controller: SharedWorkspaceGateway, spaceId: String,
    projectId: String, projectTitle: String, onClose: () -> Unit, picker: DataExportPicker? = null) {
    key(LocalGenesisUserId.current, spaceId, projectId) {
        DataExportContent(controller, spaceId, projectId, projectTitle, onClose, picker)
    }
}

@Composable private fun DataExportContent(controller: SharedWorkspaceGateway, spaceId: String,
    projectId: String, projectTitle: String, onClose: () -> Unit, picker: DataExportPicker?) {
    val context = LocalContext.current; val account = LocalGenesisUserId.current
    val scope = rememberCoroutineScope()
    val saver = remember(controller, account, spaceId) { Saver<DataExportState, String>(
        save = { it.saved().orEmpty() }, restore = { DataExportState(controller, account, spaceId, it.takeIf(String::isNotEmpty)) }) }
    val state = rememberSaveable(controller, account, spaceId, saver = saver) { DataExportState(controller, account, spaceId) }
    DisposableEffect(state) { onDispose { state.close() } }
    val preferences by produceState<UiPreferences?>(null, account) {
        val app = context.applicationContext as? GenesisApplication
        value = if (app != null) LocalPreferences(context, app.workspaceScope).values.first() else UiPreferences()
    }
    var selection by rememberSaveable { mutableStateOf(if (projectId.isBlank()) "space" else "project") }
    var format by rememberSaveable { mutableStateOf("json") }
    var chosenMode by rememberSaveable { mutableStateOf<CalendarMode?>(null) }
    var timeZone by rememberSaveable { mutableStateOf(DataExportProtocol.timeZone(ZoneId.systemDefault().id)?.id ?: "UTC") }
    var from by rememberSaveable { mutableStateOf("") }; var to by rememberSaveable { mutableStateOf("") }
    var undated by rememberSaveable { mutableStateOf(true) }; var archived by rememberSaveable { mutableStateOf(true) }
    val modes = if (LocalSacredFeaturesEnabled.current) LocalEnabledCalendars.current else setOf(CalendarMode.PROFANE)
    val mode = (chosenMode ?: preferences?.input)?.takeIf { it in modes } ?: modes.firstOrNull() ?: CalendarMode.PROFANE
    val zone = DataExportProtocol.timeZone(timeZone.trim())
    val calculation = CalendarContext(timeZone = zone?.id ?: "UTC",
        gregorianYearStart = if (preferences?.gregorianYearStartsInMarch == true) "march" else "january")
    val invalidRange = from.isNotEmpty() && to.isNotEmpty() && from > to
    val titles = JSONObject()
    for ((key, label) in listOf("key" to "ID", "title" to "Название", "description" to "Описание", "project" to "Проект",
        "status" to "Статус", "done" to "Завершено", "assignee" to "Исполнитель", "priority" to "Приоритет", "labels" to "Метки",
        "dueDate" to "Срок", "startDate" to "Начало", "startTime" to "Время начала", "endTime" to "Время окончания",
        "parentKey" to "Родительская задача", "storyPoints" to "Оценка в баллах", "estimateHours" to "Оценка в часах")) titles.put(key, genesisTranslate(label))
    fun complete(uri: Uri?) { scope.launch { state.complete(uri?.let { AndroidDataExportDestination(context.contentResolver, it) }) } }
    val jsonPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"), ::complete)
    val csvPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv"), ::complete)
    fun close() { state.close(); onClose() }
    fun save() {
        val request = JSONObject().put("scope", selection).put("projectId", projectId.takeIf(String::isNotBlank) ?: JSONObject.NULL)
            .put("format", format).put("from", from.takeIf(String::isNotEmpty) ?: JSONObject.NULL).put("to", to.takeIf(String::isNotEmpty) ?: JSONObject.NULL)
            .put("undated", undated).put("archived", archived).put("calendarMode", mode.wireValue)
            .put("calendarContext", JSONObject().put("version", calculation.version).put("timeZone", calculation.timeZone).put("gregorianYearStart", calculation.gregorianYearStart))
            .put("titles", titles)
        val selectedFormat = state.prepare(request) ?: return
        val filename = "genesis-export-${LocalDate.now()}.$selectedFormat"
        try {
            if (picker != null) picker(selectedFormat, filename) { target -> scope.launch { state.complete(target) } }
            else if (selectedFormat == "csv") csvPicker.launch(filename) else jsonPicker.launch(filename)
        } catch (_: Exception) { state.pickerFailed() }
    }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
      BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Surface(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().padding(16.dp).heightIn(max = maxHeight * .94f).imePadding(), shape = AffairsLayout.shape) {
            Column(Modifier.testTag("data-export-screen")) {
                AffairsDialogHeader("Экспорт данных", projectTitle, ::close, closeTag = "export-close", titleTag = "export-heading")
                HorizontalDivider()
                Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)
                    .testTag("export-content"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Экспорт охватывает все разрешённые данные выбранного объёма, независимо от текущей страницы.", style = MaterialTheme.typography.bodyMedium)
                    ExportChoice("Объём", selection,
                        (if (projectId.isBlank()) emptyList() else listOf("project" to "Текущий проект", "tree" to "Проект с подпроектами")) +
                            listOf("space" to "Все доступные проекты пространства"), !state.busy, "export-scope") { selection = it }
                    ExportChoice("Формат", format, listOf("json" to "GENESIS JSON v1", "csv" to "CSV"), !state.busy, "export-format") { format = it }
                    AffairsDisclosure("Фильтры", Modifier.testTag("export-filters")) {
                        Text("Календарь", style = MaterialTheme.typography.titleSmall)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CalendarMode.entries.filter { it in modes }.forEach { option ->
                                FilterChip(mode == option, { chosenMode = option }, enabled = !state.busy,
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("export-calendar-${option.wireValue}"),
                                    label = { Text(calendarModeLabel(option), style = MaterialTheme.typography.labelMedium) })
                            }
                        }
                        OutlinedTextField(timeZone, { timeZone = it.take(200) }, label = { Text("Часовой пояс") },
                            modifier = Modifier.fillMaxWidth().testTag("export-time-zone"), enabled = !state.busy, singleLine = true, isError = zone == null)
                        Text("Без границ диапазона экспортируются все даты.", style = MaterialTheme.typography.bodyMedium)
                        ExportToggle("Начало диапазона", from.isNotEmpty(), !state.busy, "export-from-enabled") { from = if (it) LocalDate.now().toString() else "" }
                        if (from.isNotEmpty()) Box(Modifier.testTag("export-from")) { AuthorDatePicker(from, mode, calculationContext = calculation, enabled = !state.busy) { from = it } }
                        ExportToggle("Конец диапазона", to.isNotEmpty(), !state.busy, "export-to-enabled") { to = if (it) LocalDate.now().toString() else "" }
                        if (to.isNotEmpty()) Box(Modifier.testTag("export-to")) { AuthorDatePicker(to, mode, calculationContext = calculation, enabled = !state.busy) { to = it } }
                        ExportToggle("Включить задачи без даты", undated, !state.busy, "export-undated") { undated = it }
                        ExportToggle("Включить архивные данные", archived, !state.busy, "export-archived") { archived = it }
                    }
                    Text(exportIssueText(if (format == "csv") "DATA_CSV_LIMITATIONS" else "DATA_ATTACHMENTS_METADATA_ONLY"), style = MaterialTheme.typography.bodyMedium)
                    state.receipt?.let { receipt ->
                        val notices = receipt.getJSONArray("notices")
                        if (notices.length() > 0) AffairsDisclosure("Отчёт") {
                            (0 until notices.length()).map { exportIssueText(notices.getJSONObject(it).getString("code")) }.distinct().forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                HorizontalDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.busy) {
                        WorkspaceLoadingLine(Modifier.fillMaxWidth())
                        Text(if (state.working) "Выполнение…" else "Выберите место сохранения файла.", Modifier.testTag("export-working"), style = MaterialTheme.typography.bodyMedium)
                    }
                    if (invalidRange || zone == null) Text("Проверьте диапазон дат и часовой пояс.", Modifier.testTag("export-validation"),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    if (state.error.isNotEmpty()) Text(exportErrorText(state.error), Modifier.testTag("export-error").semantics { liveRegion = LiveRegionMode.Polite },
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    state.receipt?.let { receipt ->
                        Text("Файл сохранён.", Modifier.testTag("export-saved").semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.titleMedium)
                        Text(genesisTranslate("Проекты") + ": " + receipt.getInt("projectCount") + " · " + genesisTranslate("Задачи") + ": " + receipt.getInt("taskCount"),
                            Modifier.testTag("export-counts"), style = MaterialTheme.typography.bodyMedium)
                    }
                    Button(::save, enabled = !state.busy && preferences != null && !invalidRange && zone != null,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("export-save")) { Text("Сохранить файл") }
                }
            }
        }
      }
    }
}

@Composable private fun ExportChoice(label: String, value: String, choices: List<Pair<String, String>>, enabled: Boolean,
    tag: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Box {
            OutlinedButton({ open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag)) {
                Text(choices.first { it.first == value }.second, Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
            }
            DropdownMenu(open, { open = false }) { choices.forEach { (id, title) ->
                DropdownMenuItem(text = { Text(title) }, modifier = Modifier.testTag("$tag-$id"), onClick = { open = false; onChange(id) })
            } }
        }
    }
}

@Composable private fun ExportToggle(label: String, value: Boolean, enabled: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).toggleable(value, enabled = enabled, role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Checkbox(value, null, enabled = enabled); Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    }
}

internal class AndroidDataExportDestination(private val resolver: ContentResolver, private val uri: Uri) : DataExportDestination {
    override suspend fun write(content: String, current: () -> Unit) = withContext(Dispatchers.IO) {
        currentCoroutineContext().ensureActive(); current()
        val output = resolver.openOutputStream(uri, "wt") ?: throw IOException()
        output.bufferedWriter(Charsets.UTF_8).use { writer ->
            var offset = 0
            while (offset < content.length) {
                currentCoroutineContext().ensureActive(); current()
                val count = minOf(8192, content.length - offset)
                writer.write(content, offset, count); offset += count
            }
            currentCoroutineContext().ensureActive(); current(); writer.flush()
        }
    }
}

internal fun exportIssueText(code: String): String = when (code) {
    "DATA_CSV_LIMITATIONS" -> "CSV переносит таблицу задач и типовые поля. Комментарии, чек-листы, связи, история и вложения требуют JSON."
    "DATA_ATTACHMENTS_METADATA_ONLY" -> "Вложения: сохраняются только названия, размеры и безопасные ссылки. Файлы не скачиваются."
    "DATA_SCHEDULES_METADATA_ONLY" -> "Серии и шаблоны сохраняются как метаданные; они не включаются автоматически."
    "DATA_VISUAL_ASSET_EXCLUDED" -> "Изображение не включено в перенос данных."
    "DATA_EXTERNAL_REFERENCE_EXCLUDED" -> "Связь за пределами выбранной выборки не переносится."
    "DATA_INBOX_AS_PROJECT" -> "Общий входящий список переносится как обычный проект; входящий список назначения сохраняется."
    else -> "Есть замечания к экспорту."
}

internal fun exportErrorText(code: String): String = when (code) {
    "FEATURE_SUBSCRIPTION_REQUIRED" -> "Экспорт и импорт доступны начиная с тарифа Standard."
    "STORAGE" -> "Не удалось сохранить файл. Выберите другое место и повторите."
    "UNAUTHORIZED", "NOT_DEPLOYED" -> "Нет доступа"
    "DATA_EMPTY" -> "Нет данных для экспорта. Проверьте выбранный диапазон и фильтры."
    "DATA_DATE_INVALID", "INVALID_CALENDAR_TIME_ZONE" -> "Проверьте диапазон дат и часовой пояс."
    "DATA_FILE_TOO_LARGE" -> "Файл превышает лимит 20 МБ."
    "DATA_RESOURCE_LIMIT" -> "Применение превысит доступный лимит проектов или задач."
    "NETWORK" -> "Нет сети. Повторите действие после подключения."
    "RATE_LIMIT" -> "Слишком много запросов. Повторите позже."
    else -> "Не удалось выполнить действие. Черновик сохранён; повторите попытку."
}
