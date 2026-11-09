package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable
internal fun SharedTaskSeriesPanel(gateway: SharedTaskSeriesGateway, task: JSONObject, preferences: UiPreferences,
    readOnly: Boolean, disabled: Boolean, onDirtyChange: (Boolean) -> Unit,
    onSaved: suspend () -> Unit, onOpen: (String, String) -> Unit) {
    val taskId = task.getString("id"); val project = task.getString("projectId")
    val scope = rememberCoroutineScope()
    val identity = remember(taskId) { SharedTaskCommandIdentity() }
    val initial = remember(taskId) {
        val start = task.optString("dueDate").takeIf { it.isNotBlank() && it != "null" } ?: LocalDate.now().toString()
        JSONObject().put("timing", "schedule").put("delayDays", 1).put("limit", 30).put("cloneChildren", false)
            .put("excludedDates", JSONArray()).put("recurrence", SharedTaskSeriesProtocol.recurrence(defaultTaskRecurrence(start, preferences.input).copy(enabled = true))).toString()
    }
    var settingsJson by rememberSaveable(taskId) { mutableStateOf(initial) }
    var paused by rememberSaveable(taskId) { mutableStateOf(false) }
    var refreshTemplate by rememberSaveable(taskId) { mutableStateOf(false) }
    var baseline by rememberSaveable(taskId) { mutableStateOf(initial + ":false") }
    var baseSeriesRevision by rememberSaveable(taskId) { mutableLongStateOf(0) }
    var baseTaskRevision by rememberSaveable(taskId) { mutableLongStateOf(task.getLong("revision")) }
    var initialized by rememberSaveable(taskId) { mutableStateOf(false) }
    var series by remember(taskId) { mutableStateOf<JSONObject?>(null) }
    var loaded by remember(taskId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var confirmation by remember { mutableStateOf("") }
    var excludedDate by rememberSaveable(taskId) { mutableStateOf("") }
    var expanded by rememberSaveable(taskId) { mutableStateOf(false) }
    var historyOpen by rememberSaveable(taskId) { mutableStateOf(false) }
    var zoneDraft by rememberSaveable(taskId) { mutableStateOf(JSONObject(initial).getJSONObject("recurrence").getJSONObject("calendarContext").getString("timeZone")) }
    var limitDraft by rememberSaveable(taskId) { mutableStateOf("30") }
    var delayDraft by rememberSaveable(taskId) { mutableStateOf("1") }
    val settings = JSONObject(settingsJson)
    val rule = SharedTaskSeriesProtocol.recurrence(settings.getJSONObject("recurrence"))
    val mode = when (rule.mode) { "classic" -> CalendarMode.PROFANE; "lunar" -> CalendarMode.LUNAR; else -> CalendarMode.SACRED }
    val dirty = settingsJson + ":$paused" != baseline || refreshTemplate || zoneDraft != rule.calendarContext!!.timeZone ||
        limitDraft != settings.getInt("limit").toString() || delayDraft != settings.getInt("delayDays").toString()
    val stale = initialized && ((series?.optLong("revision") ?: 0) != baseSeriesRevision || task.getLong("revision") != baseTaskRevision)
    val editable = !readOnly && (series == null || series?.optString("projectId") == project)
    val blocked = disabled || busy || !loaded || task.optBoolean("pending") || stale
    val zoneValid = runCatching { ZoneId.of(zoneDraft) }.isSuccess
    val valid = runCatching { SharedTaskSeriesProtocol.settings(settings) }.isSuccess && zoneValid &&
        limitDraft.toIntOrNull()?.let { it in 1..1000 } == true && delayDraft.toIntOrNull()?.let { it in 1..366 } == true
    fun change(next: JSONObject) { settingsJson = next.toString(); preview = null; message = ""; error = "" }
    fun apply(next: JSONObject?) {
        series = next
        if (next != null) { settingsJson = next.getJSONObject("settings").toString(); paused = next.getBoolean("paused") }
        zoneDraft = JSONObject(settingsJson).getJSONObject("recurrence").getJSONObject("calendarContext").getString("timeZone")
        limitDraft = JSONObject(settingsJson).getInt("limit").toString(); delayDraft = JSONObject(settingsJson).getInt("delayDays").toString()
        baseline = settingsJson + ":$paused"; refreshTemplate = false; preview = null; initialized = true
        baseSeriesRevision = next?.getLong("revision") ?: 0; baseTaskRevision = task.getLong("revision"); loaded = true
    }
    suspend fun reload() { apply(SharedTaskSeriesProtocol.series(gateway.sharedTaskSeries(project, taskId))) }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""; message = ""
        scope.launch { try { action() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskSeriesError(failure.message) } finally { busy = false } }
    }
    LaunchedEffect(taskId, project) {
        try {
            val next = SharedTaskSeriesProtocol.series(gateway.sharedTaskSeries(project, taskId))
            if (!initialized) apply(next) else { series = next; loaded = true }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = sharedTaskSeriesError(failure.message) }
    }
    LaunchedEffect(dirty) { onDirtyChange(dirty) }
    DisposableEffect(taskId) { onDispose { onDirtyChange(false) } }
    if (readOnly && loaded && series == null) return
    Column(Modifier.fillMaxWidth().testTag("shared-task-series"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Text("Серия общих задач" + if (paused) " · Пауза" else "", Modifier.weight(1f))
            AffairsActionIcon(if (expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        if (expanded) {
            Text("Настройки серии действуют на ещё не созданные задачи. Изменения этой задачи относятся только к этому повтору.", style = MaterialTheme.typography.bodySmall)
            series?.let { current ->
                Text("Создано или пропущено: ${current.getInt("generatedCount")} из ${current.getJSONObject("settings").getInt("limit")}")
                if (current.optBoolean("waitingForCompletion")) Text("Следующий повтор ждёт завершения и всех подтверждений. Архив или корзина приостанавливают ожидание.")
                val next = current.optJSONArray("nextDates") ?: JSONArray()
                if (next.length() > 0) Text("Следующие даты: " + (0 until next.length()).joinToString(" · ") { next.getString(it) }, style = MaterialTheme.typography.bodySmall)
                val healthy = runCatching { Instant.parse(current.getString("workerCompletedAt")).let { Instant.now().minusSeconds(900).isBefore(it) } }.getOrDefault(false)
                Text(if (healthy) "Фоновое выполнение работает." else "Фоновое выполнение пока не подтверждено. Задачи появятся после восстановления обработчика.", style = MaterialTheme.typography.bodySmall)
                if (!current.isNull("lastError") && current.optString("lastError").isNotBlank()) Text(sharedTaskSeriesError(current.getString("lastError")), color = MaterialTheme.colorScheme.error)
            }
            if (!loaded && error.isBlank()) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            if (stale) Text("Задача или серия изменились. Черновик сохранён на экране. Обновите данные перед сохранением.", color = MaterialTheme.colorScheme.error)
            if (stale && (series?.optLong("revision") ?: 0) == baseSeriesRevision && !disabled && !busy) OutlinedButton(onClick = {
                baseTaskRevision = task.getLong("revision"); preview = null
            }) { Text("Продолжить с сохранённой задачей") }
            if (editable && !blocked) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("schedule" to "По расписанию", "after-completion" to "После завершения").forEach { (id, title) ->
                        FilterChip(selected = settings.getString("timing") == id, onClick = { change(JSONObject(settingsJson).put("timing", id)) }, modifier = Modifier.heightIn(min = 48.dp), label = { Text(title) })
                    }
                }
                if (settings.getString("timing") == "after-completion") SeriesNumberField("Дней после завершения", delayDraft, 1..366) { raw ->
                    delayDraft = raw; raw.toIntOrNull()?.takeIf { it in 1..366 }?.let { change(JSONObject(settingsJson).put("delayDays", it)) }
                }
                Text("Начало серии", style = MaterialTheme.typography.titleSmall)
                AuthorDatePicker(rule.rangeStart, mode, calculationContext = rule.calendarContext!!) { date ->
                    if (date.isNotBlank()) {
                    change(JSONObject(settingsJson).put("recurrence", SharedTaskSeriesProtocol.recurrence(rule.copy(rangeStart = date,
                        rangeEnd = rule.rangeEnd.takeIf { it >= date } ?: LocalDate.parse(date).plusYears(1).minusDays(1).toString()))))
                    }
                }
                TaskRecurrenceEditor(rule, rule.rangeStart, mode, sharedSeries = true) { next -> change(JSONObject(settingsJson).put("recurrence", SharedTaskSeriesProtocol.recurrence(next.copy(enabled = true)))) }
                OutlinedTextField(zoneDraft, { zone -> zoneDraft = zone
                    runCatching { rule.calendarContext!!.copy(timeZone = ZoneId.of(zone).id) }.getOrNull()?.let {
                        change(JSONObject(settingsJson).put("recurrence", SharedTaskSeriesProtocol.recurrence(rule.copy(calendarContext = it))))
                    }
                }, label = { Text("Часовой пояс IANA") }, placeholder = { Text("Europe/Moscow") }, isError = !zoneValid, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("january" to "С января", "march" to "С марта").forEach { (id, title) ->
                        FilterChip(selected = rule.calendarContext!!.gregorianYearStart == id, onClick = { change(JSONObject(settingsJson).put("recurrence", SharedTaskSeriesProtocol.recurrence(rule.copy(calendarContext = rule.calendarContext!!.copy(gregorianYearStart = id))))) },
                            modifier = Modifier.heightIn(min = 48.dp), label = { Text(title) })
                    }
                }
                SeriesNumberField("Лимит повторов, включая исходный и пропуски", limitDraft, 1..1000) { raw ->
                    limitDraft = raw; raw.toIntOrNull()?.takeIf { it in 1..1000 }?.let { change(JSONObject(settingsJson).put("limit", it)) }
                }
                SeriesCheckbox("Пауза", paused) { paused = it; preview = null }
                SeriesCheckbox("Копировать подзадачи", settings.getBoolean("cloneChildren")) { change(JSONObject(settingsJson).put("cloneChildren", it)); if (series != null) refreshTemplate = true }
                if (series != null) SeriesCheckbox("Обновить образец из этой сохранённой задачи", refreshTemplate) { refreshTemplate = it; preview = null }
                Text("Исключения дат", style = MaterialTheme.typography.titleSmall)
                AuthorDatePicker(excludedDate, mode, calculationContext = rule.calendarContext!!,
                    placeholder = "Выберите дату") { excludedDate = it }
                OutlinedButton(enabled = excludedDate.isNotBlank() && (0 until settings.getJSONArray("excludedDates").length()).none { settings.getJSONArray("excludedDates").getString(it) == excludedDate }, onClick = {
                    val dates = settings.getJSONArray("excludedDates"); change(JSONObject(settingsJson).put("excludedDates", JSONArray((0 until dates.length()).map { dates.getString(it) }.plus(excludedDate).sorted()))); excludedDate = ""
                }) { Text("Пропустить дату") }
                val dates = settings.getJSONArray("excludedDates")
                (0 until dates.length()).forEach { index -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(dates.getString(index), Modifier.weight(1f)); AffairsIconButton("Убрать исключение", AffairsAction.CLOSE, {
                        change(JSONObject(settingsJson).put("excludedDates", JSONArray((0 until dates.length()).filter { it != index }.map { dates.getString(it) })))
                    })
                } }
                Text("Комментарии, файлы, изображения и внешние зависимости не копируются. Чек-листы начинаются заново.", style = MaterialTheme.typography.bodySmall)
                preview?.let { Text("В каждом повторе: задач — ${it.getInt("taskCount")}, чек-листов — ${it.getInt("checklistCount")}") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(enabled = valid, onClick = { run {
                        val command = JSONObject().put("preview", true).put("settings", SharedTaskSeriesProtocol.settings(JSONObject(settingsJson)))
                            .put("taskRevision", baseTaskRevision).put("refreshTemplate", refreshTemplate)
                        series?.let { command.put("seriesId", it.getString("id")) }
                        preview = gateway.sharedTaskSeriesCommand(project, taskId, command).getJSONObject("preview")
                    } }) { Text("Проверить") }
                    Button(enabled = valid && dirty, modifier = Modifier.testTag("shared-task-series-save"), onClick = { run {
                        val fingerprint = JSONObject().put("settings", JSONObject(settingsJson)).put("paused", paused).put("refreshTemplate", refreshTemplate)
                            .put("taskRevision", baseTaskRevision).put("seriesRevision", baseSeriesRevision)
                        val result = gateway.sharedTaskSeriesCommand(project, taskId, SharedTaskSeriesProtocol.save(task, JSONObject(settingsJson), paused, refreshTemplate, series, identity.forBody(fingerprint)))
                        apply(SharedTaskSeriesProtocol.series(result)); message = "Серия сохранена."; onSaved()
                    } }) { Text("Сохранить серию") }
                }
            }
            if (disabled || task.optBoolean("pending")) Text("Сначала сохраните задачу и дождитесь синхронизации.", style = MaterialTheme.typography.bodySmall)
            if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary)
            TextButton(enabled = !busy, onClick = { if (dirty) confirmation = "reload" else run { reload() } }) { Text("Обновить данные") }
            series?.let { current ->
                TextButton(onClick = { historyOpen = !historyOpen }) { Text("Последние 30 повторов") }
                if (historyOpen) { val instances = current.getJSONArray("instances")
                    (0 until instances.length()).forEach { index -> val item = instances.getJSONObject(index)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${item.getInt("ordinal")}. ${item.getString("date")}" + if (item.getString("state") == "skipped") " · Пропущено" else "", Modifier.weight(1f))
                            if (!item.isNull("taskId") && !item.isNull("projectId")) TextButton(enabled = !blocked && !dirty, onClick = { onOpen(item.getString("projectId"), item.getString("taskId")) }) { Text("Открыть") }
                        }
                    }
                }
                if (editable && task.optString("completedAt").let { it.isBlank() || it == "null" } && task.optString("archivedAt").let { it.isBlank() || it == "null" })
                    OutlinedButton(enabled = !blocked && !dirty, onClick = { confirmation = "skip" }) { Text("Пропустить этот повтор") }
            }
        }
    }
    if (confirmation.isNotBlank()) AlertDialog(onDismissRequest = { if (!busy) confirmation = "" },
        title = { Text(if (confirmation == "reload") "Отменить изменения черновика?" else "Пропустить этот повтор?") },
        text = { Text(if (confirmation == "reload") "Будут загружены сохранённые настройки серии." else "Задача и подзадачи сохранятся в архиве.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { run {
            if (confirmation == "reload") reload() else series?.let { current ->
                val command = SharedTaskSeriesProtocol.skip(task, current, identity.forBody(JSONObject().put("skip", taskId).put("revision", task.getLong("revision")).put("seriesRevision", current.getLong("revision"))))
                apply(SharedTaskSeriesProtocol.series(gateway.sharedTaskSeriesCommand(project, taskId, command))); onSaved()
            }
            confirmation = ""
        } }) { Text("Подтвердить") } }, dismissButton = { TextButton(enabled = !busy, onClick = { confirmation = "" }) { Text("Отмена") } })
}

@Composable private fun SeriesNumberField(title: String, value: String, range: IntRange, onChange: (String) -> Unit) {
    val number = value.toIntOrNull()
    OutlinedTextField(value, { onChange(it.take(4)) },
        label = { Text(title) }, isError = number == null || number !in range, singleLine = true, modifier = Modifier.fillMaxWidth())
}
@Composable private fun SeriesCheckbox(title: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val label = genesisTranslate(title)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Checkbox(checked, onChange, Modifier.size(48.dp).semantics { contentDescription = label }); Text(title) }
}
internal fun sharedTaskSeriesError(code: String?): String = when (code) {
    "SERIES_CONFLICT", "SHARED_TASK_CONFLICT", "SERIES_EXISTS" -> "Задача или серия изменилась. Обновите данные; черновик сохранён."
    "SERIES_TEMPLATE_LIMIT" -> "В одном повторе допускается до 20 задач. Уменьшите дерево подзадач."
    "SERIES_COMPLETED_INSTANCE" -> "Завершённый повтор нельзя пропустить. Сначала верните задачу в работу."
    "SERIES_TEMPLATE_UNAVAILABLE", "INVALID_ASSIGNEE", "INVALID_TASK_APPROVER", "SERIES_SOURCE_UNAVAILABLE" -> "Проверьте доску, исполнителей и утверждающих участников, затем обновите образец серии."
    "SERIES_INVALID", "INVALID_CALENDAR_TIME_ZONE", "INVALID_CALENDAR_DATE", "SERIES_REFRESH_REQUIRED" -> "Проверьте даты, часовой пояс, лимит и обновление образца серии."
    "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECT_FORBIDDEN", "AUTH_REQUIRED" -> "Нет доступа к настройке этой серии."
    else -> "Серия не сохранена. Черновик оставлен на экране; повторите после подключения."
}
