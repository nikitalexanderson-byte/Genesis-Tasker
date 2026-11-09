package ru.genesis.calendar.ui

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.*

/** SAF file selection/export; all network bytes travel through the authenticated native gateway. */
@Composable
internal fun SharedTaskFilesPanel(gateway: SharedTaskFilesGateway, task: JSONObject, canEdit: Boolean,
    disabled: Boolean, onChanged: (JSONObject) -> Unit, onDirtyChange: (Boolean) -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val taskId = task.getString("id"); val project = task.getString("projectId")
    val account = LocalGenesisUserId.current
    val store = remember(account, project, taskId) { SharedTaskFilesDraftStore(context, account, project, taskId) }
    val parsed = remember(task.toString()) { runCatching { SharedTaskFilesProtocol.attachments(task) } }
    val files = parsed.getOrNull()
    var drafts by remember(taskId) { mutableStateOf(emptyList<SharedTaskFileDraft>()) }
    var removed by remember(taskId) { mutableStateOf(emptySet<String>()) }
    var revision by remember(taskId) { mutableLongStateOf(task.getLong("revision")) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var download by remember { mutableStateOf<JSONObject?>(null) }
    var removeCandidate by remember { mutableStateOf<JSONObject?>(null) }
    var restoring by remember(store) { mutableStateOf(true) }
    var discard by remember { mutableStateOf(false) }
    var expanded by rememberSaveable(taskId) { mutableStateOf(false) }
    LaunchedEffect(store) {
        try { withContext(Dispatchers.IO) { store.read() }?.let { drafts = it.files; removed = it.removed; revision = it.revision } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "Не удалось восстановить черновик файлов. Выберите файлы повторно." }
        finally { restoring = false }
    }
    LaunchedEffect(drafts, removed) { onDirtyChange(drafts.isNotEmpty() || removed.isNotEmpty()) }
    DisposableEffect(taskId) { onDispose { onDirtyChange(false) } }
    LaunchedEffect(task.getLong("revision")) { if (drafts.isEmpty() && removed.isEmpty()) revision = task.getLong("revision") }
    val stale = revision != task.getLong("revision")
    val archived = task.optString("archivedAt").let { it.isNotBlank() && it != "null" }
    val editable = canEdit && !disabled && !busy && !restoring && !task.optBoolean("pending") && !archived && !stale && files != null
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""; message = ""
        scope.launch { try { action() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskFilesError(failure.message) } finally { busy = false } }
    }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val file = download; download = null
        if (uri != null && file != null) run {
            val bytes = gateway.sharedTaskFile(taskId, file.getString("id"))
            try {
                require(bytes.size == file.getLong("size").toInt() && bytes.size <= SharedTaskFilesProtocol.limit) { "INVALID_TASK_FILE" }
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("FILE_WRITE_FAILED") }
                message = "Файл сохранён."
            } finally { bytes.fill(0) }
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty() && editable) run {
            val existing = files.orEmpty().filterNot { it.getString("id") in removed }
            require(existing.size + drafts.size + uris.size <= 5) { "TOO_MANY_TASK_FILES" }
            val selected = withContext(Dispatchers.IO) {
                var remaining = SharedTaskFilesProtocol.limit - existing.sumOf { it.getInt("size") } - drafts.sumOf { it.bytes.size }
                uris.map { uri ->
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    } ?: throw IllegalArgumentException("INVALID_TASK_FILENAME")
                    val draft = context.contentResolver.openInputStream(uri)?.use { SharedTaskFilesProtocol.read(name, it, remaining) }
                        ?: throw IllegalArgumentException("FILE_READ_FAILED")
                    remaining -= draft.bytes.size; draft
                }
            }
            drafts = drafts + selected
            withContext(Dispatchers.IO) { store.write(drafts, removed, revision) }
        }
    }
    Column(Modifier.fillMaxWidth().testTag("shared-task-files"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Text("Файлы задачи" + if (files.orEmpty().isNotEmpty() || drafts.isNotEmpty()) " · ${files.orEmpty().size + drafts.size - removed.size}" else "", Modifier.weight(1f))
            AffairsActionIcon(if (expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        if (expanded) {
        Text("До 5 файлов, суммарно до 10 МБ. Изображения, PDF и офисные документы. Файлы доступны участникам задачи.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (files == null) Text("Не удалось проверить список файлов. Обновите задачу.", color = MaterialTheme.colorScheme.error)
        files.orEmpty().filterNot { it.getString("id") in removed }.forEach { file ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    UntranslatedText(file.getString("name"), style = MaterialTheme.typography.bodyMedium)
                    Text("${(file.getLong("size") + 1023) / 1024} КБ", style = MaterialTheme.typography.bodySmall)
                }
                AffairsIconButton("Скачать файл: ${file.getString("name")}", AffairsAction.IMPORT,
                    { download = file; export.launch(file.getString("name")) }, enabled = !busy && !disabled)
                if (canEdit && !archived) AffairsIconButton("Убрать файл: ${file.getString("name")}", AffairsAction.DELETE,
                    { removeCandidate = file }, enabled = editable)
            }
        }
        drafts.forEachIndexed { index, draft ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    UntranslatedText(draft.name)
                    Text("Готов к прикреплению", style = MaterialTheme.typography.bodySmall)
                }
                AffairsIconButton("Убрать выбранный файл: ${draft.name}", AffairsAction.CLOSE,
                    { run { drafts = drafts.filterIndexed { current, _ -> current != index }; withContext(Dispatchers.IO) { store.write(drafts, removed, revision) } } }, enabled = !busy)
            }
        }
        if (stale) Text("Задача изменилась. Выбранные файлы сохранены на экране. Вернитесь к редактированию после обновления задачи.", color = MaterialTheme.colorScheme.error)
        if (stale && !disabled && !busy) OutlinedButton(onClick = { run {
            SharedTaskFilesProtocol.command(task, drafts, removed); revision = task.getLong("revision")
            withContext(Dispatchers.IO) { store.write(drafts, removed, revision) }
        } }) { Text("Продолжить с сохранённой задачей") }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary)
        if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        if (canEdit && !archived) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { picker.launch(arrayOf("image/*", "application/pdf", "application/*", "text/*")) }, enabled = editable,
                modifier = Modifier.testTag("shared-task-files-choose")) { Text("Выбрать файлы") }
            if (drafts.isNotEmpty() || removed.isNotEmpty()) Button(enabled = editable, onClick = { run {
                val command = SharedTaskFilesProtocol.command(JSONObject(task.toString()).put("revision", revision), drafts, removed)
                val result = gateway.saveSharedTaskFiles(project, taskId, command).getJSONObject("task")
                require(result.getString("id") == taskId && result.getString("projectId") == project && !result.optBoolean("pending"))
                SharedTaskFilesProtocol.attachments(result)
                withContext(Dispatchers.IO) { store.clear() }
                drafts = emptyList(); removed = emptySet(); revision = result.getLong("revision"); onChanged(result)
                message = "Файлы задачи сохранены."
            } }, modifier = Modifier.testTag("shared-task-files-save")) { Text("Сохранить") }
        }
        if (drafts.isNotEmpty() || removed.isNotEmpty()) TextButton(enabled = !busy, onClick = { discard = true }) { Text("Отменить изменения файлов") }
        }
    }
    removeCandidate?.let { file -> AlertDialog(onDismissRequest = { removeCandidate = null }, title = { Text("Убрать файл из задачи?") },
        text = { UntranslatedText(file.getString("name")) },
        confirmButton = { TextButton(onClick = { run { removed = removed + file.getString("id"); removeCandidate = null
            withContext(Dispatchers.IO) { store.write(drafts, removed, revision) } } }, enabled = !busy) { Text("Убрать") } },
        dismissButton = { TextButton(onClick = { removeCandidate = null }) { Text("Отмена") } }) }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Отменить изменения файлов?") },
        text = { Text("Выбранные файлы и отметки удаления будут убраны из черновика. Прикреплённые файлы задачи сохранятся.") },
        confirmButton = { TextButton(onClick = { run { withContext(Dispatchers.IO) { store.clear() }; drafts = emptyList(); removed = emptySet(); revision = task.getLong("revision"); discard = false } }) { Text("Отменить изменения") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить редактирование") } })
}

internal fun sharedTaskFilesError(code: String?): String = when (code) {
    "TASK_FILES_TOO_LARGE", "TOO_MANY_TASK_FILES" -> "До 5 файлов на задачу, суммарно до 10 МБ. Выберите файлы меньшего размера."
    "INVALID_TASK_FILE_REMOVAL", "SHARED_TASK_CONFLICT" -> "Задача или список файлов изменились. Обновите задачу. Выбранные файлы оставлены на экране."
    "INVALID_TASK_FILENAME", "UNSUPPORTED_TASK_FILE", "INVALID_TASK_FILE_CONTENT", "INVALID_TASK_FILE" -> "Не удалось прикрепить файл. Проверьте название, формат и содержимое."
    else -> "Операция с файлами не выполнена. Повторите после подключения."
}
