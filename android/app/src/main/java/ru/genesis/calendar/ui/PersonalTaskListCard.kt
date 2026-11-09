package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.data.*

/** A list opens in place, preserving its Google account and existing edit/delete flows. */
@Composable internal fun PersonalTaskListCard(list: GoogleTaskList, rows: List<LocalTask>,
    structure: WorkspaceStructure, use24: Boolean, onCreateTask: (GoogleTaskList) -> Unit,
    onComplete: (LocalTask) -> Unit, onOpen: (String) -> Unit,
    onUpdateList: suspend (GoogleTaskList, String) -> Unit,
    onDeleteList: suspend (GoogleTaskList) -> Unit,
    initialExpanded: Boolean = false, deleteTaskCount: Int = rows.size, voiceRequest: NativeVoiceAction? = null,
    onVoiceRequestConsumed: () -> Unit = {},
    taskWrapper: @Composable (LocalTask, @Composable () -> Unit) -> Unit = { _, content -> content() }) {
    var expanded by rememberSaveable(list.accountId, list.id) { mutableStateOf(initialExpanded) }
    var editing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf(list.title) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(initialExpanded) { if (initialExpanded) expanded = true }
    LaunchedEffect(voiceRequest) {
        when (voiceRequest) {
            is NativeVoiceAction.EditTaskList -> if (voiceRequest.id == list.id) {
                expanded = true; title = list.title; error = null; editing = true
                onVoiceRequestConsumed()
            }
            is NativeVoiceAction.DeleteTaskList -> if (voiceRequest.id == list.id) {
                expanded = true; error = null; deleting = true
                onVoiceRequestConsumed()
            }
            else -> Unit
        }
    }
    Card(Modifier.fillMaxWidth().testTag("personal-task-list-${list.id}"),
        shape = AffairsLayout.shape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).clickable { expanded = !expanded }.padding(4.dp)) {
                    Text(list.title, style = MaterialTheme.typography.titleMedium)
                    Text("${rows.count { it.done }} / ${rows.size}", style = MaterialTheme.typography.bodySmall)
                    if (list.accountEmail.isNotBlank()) Text(list.accountEmail,
                        style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = { expanded = !expanded },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("toggle-task-list-${list.id}")) {
                    Text(if (expanded) "Свернуть" else "Открыть")
                }
            }
            if (expanded) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { title = list.title; error = null; editing = true },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("edit-task-list-${list.id}")) {
                        Text("Изменить")
                    }
                    OutlinedButton(onClick = { error = null; deleting = true },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("delete-task-list-${list.id}"),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                        Text("Удалить")
                    }
                }
                if (rows.isEmpty()) Text("В списке пока нет задач.")
                rows.forEach { task -> taskWrapper(task) { NativeTaskCard(task, use24, structure, onComplete, onOpen) } }
                OutlinedButton(onClick = { onCreateTask(list) }, modifier = Modifier.fillMaxWidth()
                    .heightIn(min = 48.dp).testTag("add-list-task-${list.id}")) { Text("Добавить задачу") }
            }
        }
    }
    if (editing) AlertDialog(onDismissRequest = { if (!busy) editing = false },
        title = { Text("Изменить список задач") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it.take(300) }, label = { Text("Название списка") },
                    enabled = !busy, singleLine = true, modifier = Modifier.testTag("edit-task-list-title"))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = { TextButton(enabled = !busy && title.trim().isNotBlank(), onClick = {
            busy = true; error = null
            scope.launch {
                try { onUpdateList(list, title.trim()); editing = false }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { error = e.message ?: "Не удалось изменить список." }
                finally { busy = false }
            }
        }, modifier = Modifier.testTag("save-task-list-edit")) { Text("Сохранить") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { editing = false }) { Text("Отмена") } })
    if (deleting) AlertDialog(onDismissRequest = { if (!busy) deleting = false },
        title = { Text("Удалить список задач?") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("«${list.title}» и $deleteTaskCount задач будут удалены. Это действие нельзя отменить." +
                    if (list.accountId != null) " Список также удалится из Google Tasks." else "")
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = { TextButton(enabled = !busy, onClick = {
            busy = true; error = null
            scope.launch {
                try { onDeleteList(list); deleting = false }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { error = e.message ?: "Не удалось удалить список." }
                finally { busy = false }
            }
        }, modifier = Modifier.testTag("confirm-delete-task-list")) { Text("Удалить") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { deleting = false }) { Text("Отмена") } })
}
