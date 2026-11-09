package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.data.LocalTask

private fun JSONArray.projectRows(): List<JSONObject> = (0 until length()).map(::getJSONObject)

internal fun privateMoveRestriction(task: LocalTask, account: AccountSettings?, allowCategory: Boolean = false, allowTags: Boolean = false): Boolean {
    val source = runCatching { JSONObject(task.sourceFieldsJson) }.getOrDefault(JSONObject())
    fun hasText(key: String) = !source.isNull(key) && source.optString(key).let { it.isNotBlank() && it != "null" }
    fun hasItems(key: String) = (source.optJSONArray(key)?.length() ?: 0) > 0
    if (task.title != task.title.trim().replace(Regex("\\s+"), " ") || task.description != task.description.trim()) return true
    if (account?.calendarConnected != false || task.done || task.time.isNotBlank() || task.priority != 5 ||
        (!allowCategory && task.categoryId != null) || task.recurrence.enabled || task.reminderAt != null || task.reminders.orEmpty().isNotEmpty()) return true
    if (source.optString("calendarMode") != "profane" || hasText("calendarNote") ||
        source.optString("endDate").let { it.isNotBlank() && it != "null" && it != task.date }) return true
    if (hasText("googleEventId") || hasText("googleTaskId") || hasText("googleTaskListId") ||
        hasText("googleAccountId") || (source.optJSONObject("googleLinks")?.length() ?: 0) > 0 ||
        hasItems("syncAccountIds") || (!allowTags && hasItems("tags")) || hasItems("dependsOnIds") ||
        hasItems("yandexAttendees") || hasItems("yandexOptionalAttendees") || hasItems("yandexReminders") ||
        hasText("yandexLocation") || hasText("yandexTelemostUrl") ||
        source.optString("yandexEntryType") == "meeting" ||
        source.optString("createdIn", "genesis") != "genesis") return true
    return false
}

@Composable
internal fun PersonalTaskTransferDialog(task: LocalTask, controller: AuthController,
    account: AccountSettings?, language: String, onDismiss: () -> Unit, onMoved: suspend (LocalTask) -> Unit) {
    val en = language == "en"
    val scope = rememberCoroutineScope()
    var projects by remember(task.id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var projectId by remember(task.id) { mutableStateOf("") }
    var snapshot by remember(task.id) { mutableStateOf<JSONObject?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var includeDescription by remember { mutableStateOf(true) }
    var includeDate by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val canMove = !privateMoveRestriction(task, account) && includeDescription && includeDate
    val publishedTitle = task.title.trim().replace(Regex("\\s+"), " ")
    val publishedDescription = if (includeDescription) task.description.trim() else ""

    LaunchedEffect(task.id) {
        try {
            val spaces = controller.sharedSpaces().getJSONArray("spaces").projectRows()
            projects = spaces.flatMap { space ->
                controller.sharedProjects(space.getString("id")).getJSONArray("projects").projectRows()
            }.filter { it.optString("role") in setOf("owner", "manager", "member") }
            projectId = projects.firstOrNull()?.optString("id").orEmpty()
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { error = cause.message ?: "Не удалось загрузить общие проекты." }
    }
    LaunchedEffect(projectId) {
        snapshot = null
        if (projectId.isNotBlank()) try { snapshot = controller.sharedProject(projectId) }
        catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { error = cause.message ?: "Не удалось открыть проект." }
    }

    fun publish(move: Boolean) {
        val current = snapshot ?: return
        if (busy || (move && !canMove)) return
        val status = current.optJSONArray("statuses")?.projectRows()?.firstOrNull { it.optInt("isDone") == 0 }
        if (status == null) { error = if (en) "The destination has no open status." else "В проекте нет открытого статуса."; return }
        busy = true; error = ""
        scope.launch {
            try {
                val description = publishedDescription
                val dueDate = if (includeDate) task.date else null
                val fields = JSONObject().put("title", publishedTitle).put("description", description)
                    .put("dueDate", dueDate ?: JSONObject.NULL).put("statusId", status.getString("id"))
                if (move) fields.put("sourceTaskId", task.id)
                val published = controller.publishPrivateTask(projectId, fields).optJSONObject("task")
                if (published == null || published.optString("id").isBlank() ||
                    published.optString("projectId") != projectId || published.optString("title") != publishedTitle ||
                    published.optString("description") != description || published.optString("statusId") != status.getString("id") ||
                    (published.optString("dueDate").takeUnless { published.isNull("dueDate") } != dueDate)) {
                    error = if (en) "The server did not confirm the shared task." else "Сервер не подтвердил создание общей задачи."
                    return@launch
                }
                if (move) onMoved(task)
                onDismiss()
            } catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) { error = cause.message ?: if (en) "Could not publish the task." else "Не удалось опубликовать задачу." }
            finally { busy = false }
        }
    }

    AlertDialog(onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (en) "Move to shared projects" else "Переместить в общие") },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (en) "Review what project members will see. Shared data is processed by the GENESIS server."
                else "Проверьте, что увидят участники. Общие данные обрабатываются сервером GENESIS.")
            Box {
                TextButton(onClick = { menuOpen = true }, enabled = !busy && projects.isNotEmpty()) {
                    Text(projects.firstOrNull { it.optString("id") == projectId }?.optString("title")
                        ?: if (en) "Create a shared project first" else "Сначала создайте общий проект")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    projects.forEach { project -> DropdownMenuItem(text = { Text(project.optString("title")) }, onClick = {
                        projectId = project.getString("id"); menuOpen = false
                    }) }
                }
            }
            Text(if (en) "Members will see" else "Участники увидят", style = MaterialTheme.typography.titleSmall)
            Text(publishedTitle, style = MaterialTheme.typography.bodyLarge)
            if (task.description.isNotBlank()) Row {
                Checkbox(checked = includeDescription, onCheckedChange = { includeDescription = it })
                Text("${if (en) "Description" else "Описание"}: ${task.description.trim()}")
            }
            Row {
                Checkbox(checked = includeDate, onCheckedChange = { includeDate = it })
                Text("${if (en) "Due date" else "Срок"}: ${task.date}")
            }
            Text(if (en) "The shared copy starts open. Completion history, time, reminders, repetition, tags, priority, calendar settings and Google links are not transferred."
                else "Общая копия создаётся открытой. История завершения, время, напоминания, повторения, теги, приоритет, параметры календаря и связи Google не передаются.",
                style = MaterialTheme.typography.bodySmall)
            if (!canMove) Text(if (en) "This task can be copied; the personal original stays in place."
                else "Эту задачу можно скопировать; личный оригинал останется на месте.", style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { DialogActionRow(
            DialogIconAction("Отмена", AffairsAction.BACK, onDismiss, enabled = !busy),
            DialogIconAction("Копировать", AffairsAction.COPY, { publish(false) }, enabled = !busy && snapshot != null),
            DialogIconAction("Переместить", AffairsAction.MOVE, { publish(true) }, enabled = !busy && snapshot != null && canMove)
        ) })
}
