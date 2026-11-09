package ru.genesis.calendar.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*

@Composable internal fun HabitBackupPanel(app: GenesisApplication, workspace: LocalHabitWorkspace, inDialog: Boolean = false) {
    val service = remember(app, app.workspaceScope) { HabitBackupService(app) }
    val scope = rememberCoroutineScope(); val language = LocalGenesisLanguage.current
    val canExchange = LocalFeatureAccess.current.allows("data-export")
    val preferences = remember(app) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsState(initial = UiPreferences())
    var expanded by rememberSaveable { mutableStateOf(false) }
    var exportFormat by rememberSaveable { mutableStateOf("json") }
    var draft by remember { mutableStateOf<HabitRestoreDraft?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    suspend fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null; message = null
        try { action() }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            error = if (e.message == "FEATURE_SUBSCRIPTION_REQUIRED") e.message
                else if (e.message == "HABIT_RESTORE_STALE") "Данные изменились. Проверьте копию заново."
                else "Не удалось восстановить. Проверьте синхронизацию и повторите."
        } finally { busy = false }
    }
    LaunchedEffect(service) { run { draft = withContext(Dispatchers.IO) { service.load() }; if (draft != null) expanded = true } }
    fun export(uri: Uri?) {
        if (uri == null) return
        val format = exportFormat; val labels = HabitHistoryCsv.columns.values.associateWith { translateGenesisText(app, it, language) }
        scope.launch { run {
            withContext(Dispatchers.IO) {
                val text = service.export(format) { labels[it] ?: it }
                service.requireDataExchange()
                val stream = requireNotNull(app.contentResolver.openOutputStream(uri, "wt"))
                stream.use { it.write(text.toByteArray(Charsets.UTF_8)); it.flush() }
            }
            message = "Экспорт завершён."
        } }
    }
    val jsonPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"), ::export)
    val csvPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv"), ::export)
    val input = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch { run {
            draft = withContext(Dispatchers.IO) {
                service.requireDataExchange()
                val filename = app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else "JSON"
                } ?: "JSON"
                val text = requireNotNull(app.contentResolver.openInputStream(uri)).use { stream ->
                    val bytes = ByteArrayOutputStream(); val buffer = ByteArray(32_768)
                    while (true) {
                        val count = stream.read(buffer); if (count < 0) break
                        require(bytes.size() + count <= HabitBackups.MAX_BYTES) { "HABIT_BACKUP_TOO_LARGE" }
                        bytes.write(buffer, 0, count)
                    }
                    bytes.toString("UTF-8")
                }
                service.prepare(text, filename)
            }
        } }
    }
    Column(Modifier.fillMaxWidth().testTag("habit-backup-panel"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!inDialog) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Данные привычек", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            AffairsIconButton("Данные привычек", if (expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND,
                { expanded = !expanded }, Modifier.testTag("habit-backup-toggle"))
        }
        if (expanded || inDialog) {
            if (!canExchange) NativeAccessMessage("FEATURE_SUBSCRIPTION_REQUIRED", "data-export")
            Text("Включает всю историю, независимо от выбранного периода отчёта.", style = MaterialTheme.typography.bodySmall)
            Text("Подключения Google не переносятся.", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AffairsIconButton("Экспорт всей истории CSV", AffairsAction.REPORT, { exportFormat = "csv"; csvPicker.launch("GENESIS-habits-history-${LocalDate.now()}.csv") }, Modifier.testTag("habit-export-csv"), !busy && canExchange)
                    MaterialText("CSV", style = MaterialTheme.typography.labelSmall)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AffairsIconButton("Резервная копия JSON", AffairsAction.ARCHIVE, { exportFormat = "json"; jsonPicker.launch("GENESIS-habits-backup-${LocalDate.now()}.json") }, Modifier.testTag("habit-export-json"), !busy && canExchange)
                    MaterialText("JSON", style = MaterialTheme.typography.labelSmall)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AffairsIconButton("Выберите резервную копию JSON", AffairsAction.IMPORT, { input.launch(arrayOf("*/*")) }, Modifier.testTag("habit-restore-file"), !busy && canExchange)
                    Text("Восстановить", style = MaterialTheme.typography.labelSmall)
                }
            }
            draft?.let { value -> HabitRestorePreviewPanel(value, busy, prefs.use24,
                onChoice = { id, choice -> scope.launch { run { draft = withContext(Dispatchers.IO) { service.choose(value.id, id, choice) } } } },
                onRefresh = { scope.launch { run { draft = withContext(Dispatchers.IO) { service.refresh(value.id) } } } },
                onApply = { scope.launch { run { withContext(Dispatchers.IO) { service.apply(value.id) }; draft = null; message = "Восстановление завершено." } } },
                onCancel = { scope.launch { run { withContext(Dispatchers.IO) { service.cancel(value.id) }; draft = null } } },
                canExchange = canExchange) }
            if (workspace.habits.isEmpty() && draft == null) Text("Сначала проверьте копию. До применения данные не меняются.", style = MaterialTheme.typography.bodySmall)
            if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("habit-restore-error")) }
            message?.let { Text(it, Modifier.testTag("habit-backup-result")) }
        }
    }
}

@Composable internal fun HabitRestorePreviewPanel(draft: HabitRestoreDraft, busy: Boolean, use24: Boolean,
    onChoice: (String, String) -> Unit, onRefresh: () -> Unit, onApply: () -> Unit, onCancel: () -> Unit,
    canExchange: Boolean = true) {
    val changesEnabled = !busy && canExchange
    val preview = draft.preview; val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val number = java.text.NumberFormat.getIntegerInstance(locale)
    val at = Instant.parse(preview.backup.createdAt).atZone(ZoneId.systemDefault())
    var visible by rememberSaveable(draft.id) { mutableIntStateOf(5) }
    Column(Modifier.fillMaxWidth().testTag("habit-restore-preview"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Восстановить из JSON", style = MaterialTheme.typography.titleMedium)
        MaterialText(draft.filename, style = MaterialTheme.typography.bodySmall)
        MaterialText(genesisTranslate("Копия проверена") + " · " + at.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) +
            " · " + at.format(DateTimeFormatter.ofPattern(if (use24) "HH:mm" else "h:mm a", locale)), style = MaterialTheme.typography.bodySmall)
        Text(if (preview.empty) "В пустом пространстве восстановится сохранённый журнал наград без повторного начисления."
            else "В заполненном пространстве сохранятся текущие XP, Лавры, квесты и достижения. История из копии не начисляет награды.", style = MaterialTheme.typography.bodySmall)
        Text("Активные привычки восстановятся на паузе. Подключения Google не переносятся.", style = MaterialTheme.typography.bodySmall)
        for (row in preview.habits.take(visible)) {
            Column(Modifier.fillMaxWidth().testTag("habit-restore-row-${row.id}"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                MaterialText(row.title, style = MaterialTheme.typography.titleSmall)
                Text(mapOf("new" to "Новая привычка", "same" to "Без изменений", "conflict" to "Конфликт", "restored" to "Уже восстановлено").getValue(row.kind))
                MaterialText(genesisTranslate("Записи") + ": " + number.format(row.records), style = MaterialTheme.typography.bodySmall)
                if (row.kind == "conflict") {
                    MaterialText(genesisTranslate("Текущая привычка") + ": " + row.currentTitle + " · " + number.format(row.currentRecords), style = MaterialTheme.typography.bodySmall)
                    MaterialText(row.changes.map { genesisTranslate(it) }.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    Text("Выберите действие", style = MaterialTheme.typography.labelMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((choice, label) in listOf("keep" to "Оставить текущую", "copy" to "Копия")) {
                            val actionLabel = genesisTranslate(if (choice == "copy") "Восстановить отдельной копией" else label)
                            FilterChip(selected = draft.choices[row.id] == choice, onClick = { onChoice(row.id, choice) }, enabled = changesEnabled,
                                label = { Text(label) }, shape = AffairsLayout.controlShape,
                                modifier = Modifier.heightIn(min = 48.dp).testTag("habit-restore-$choice-${row.id}").semantics { contentDescription = actionLabel })
                        }
                    }
                }
                HorizontalDivider()
            }
        }
        if (preview.habits.size > visible) AffairsIconButton("Показать ещё", AffairsAction.EXPAND, { visible += 5 }, Modifier.testTag("habit-restore-more"))
        if (draft.stale) {
            Text("Данные изменились. Проверьте копию заново.", color = MaterialTheme.colorScheme.error)
            AffairsIconButton("Обновить", AffairsAction.REFRESH, onRefresh, Modifier.testTag("habit-restore-refresh"), changesEnabled)
        }
        FlowRow(Modifier.testTag("habit-restore-footer"), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onApply, enabled = changesEnabled && !draft.stale && preview.habits.none { it.kind == "conflict" && draft.choices[it.id] !in setOf("keep", "copy") }
                && preview.habits.any { it.kind == "new" || it.kind == "conflict" && draft.choices[it.id] == "copy" },
                modifier = Modifier.heightIn(min = 48.dp).testTag("habit-restore-apply")) { Text("Восстановить") }
            AffairsIconButton("Отмена", AffairsAction.CLOSE, onCancel, Modifier.testTag("habit-restore-cancel"), !busy)
            if (!draft.stale) AffairsIconButton("Обновить", AffairsAction.REFRESH, onRefresh, Modifier.testTag("habit-restore-refresh"), changesEnabled)
        }
    }
}
