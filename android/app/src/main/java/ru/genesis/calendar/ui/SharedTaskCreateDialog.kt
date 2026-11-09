package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.domain.CalendarMode
import java.time.LocalDate

/** A team task is created on GENESIS, independently of each member's optional Google copy. */
@Composable
internal fun SharedTaskCreateDialog(controller: AuthController, language: String,
    onDismiss: () -> Unit, onSwitchToPersonal: () -> Unit) {
    val en = language == "en"
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val preferences = remember(context) { context.getSharedPreferences("genesis-shared-projects", 0) }
    var calendarMode by rememberSaveable {
        mutableStateOf(CalendarMode.fromWire(preferences.getString("calendarMode", "profane") ?: "profane"))
    }
    var spaces by remember { mutableStateOf(emptyList<JSONObject>()) }
    var projects by remember { mutableStateOf(emptyList<JSONObject>()) }
    var snapshot by remember { mutableStateOf<JSONObject?>(null) }
    var spaceId by rememberSaveable { mutableStateOf("") }
    var projectId by rememberSaveable { mutableStateOf("") }
    var statusId by rememberSaveable { mutableStateOf("") }
    var categoryId by rememberSaveable { mutableStateOf("") }
    var assigneeId by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var dueDate by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var optionsExpanded by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            spaces = controller.sharedSpaces().getJSONArray("spaces").let { rows ->
                (0 until rows.length()).map(rows::getJSONObject)
            }
            if (spaces.none { it.optString("id") == spaceId }) spaceId = spaces.firstOrNull()?.optString("id").orEmpty()
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { message = error.message ?: if (en) "Could not load workspaces." else "Не удалось загрузить пространства." }
        finally { loading = false }
    }
    LaunchedEffect(spaceId) {
        projects = emptyList(); projectId = ""; snapshot = null
        if (spaceId.isBlank()) return@LaunchedEffect
        try {
            val rows = controller.sharedProjects(spaceId).getJSONArray("projects")
            projects = (0 until rows.length()).map(rows::getJSONObject).filter {
                it.optInt("isInbox") == 0 && it.optString("role") in setOf("owner", "manager", "member")
            }
            projectId = projects.firstOrNull()?.optString("id").orEmpty()
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { message = error.message ?: if (en) "Could not load projects." else "Не удалось загрузить проекты." }
    }
    LaunchedEffect(projectId) {
        snapshot = null; statusId = ""; categoryId = ""; assigneeId = ""
        if (projectId.isBlank()) return@LaunchedEffect
        try {
            val loaded = controller.sharedProject(projectId)
            snapshot = loaded
            statusId = ""
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { message = error.message ?: if (en) "Could not load task lists." else "Не удалось загрузить списки задач." }
    }

    fun rows(name: String): List<JSONObject> = snapshot?.optJSONArray(name)?.let { array ->
        (0 until array.length()).map(array::getJSONObject)
    }.orEmpty()
    val validDate = dueDate.isBlank() || runCatching { LocalDate.parse(dueDate) }.isSuccess
    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().widthIn(max = 700.dp).padding(8.dp),
            shape = AffairsLayout.shape) {
            Column(Modifier.padding(horizontal = 8.dp, vertical = 16.dp).imePadding()) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                EditorDialogHeader(if (en) "New task" else "Новая задача", "close-shared-task-editor") {
                    if (!busy) onDismiss()
                }
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = false, enabled = !busy, onClick = onSwitchToPersonal,
                            label = { Text(if (en) "Personal task" else "Личная задача") })
                        FilterChip(selected = true, onClick = {}, label = { Text(if (en) "Team task" else "Общая задача") })
                    }
                    if (loading) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                    else if (spaces.isEmpty()) Text(if (en)
                        "Create a workspace, then invite people and add a project."
                        else "Создайте пространство, затем добавьте проект и пригласите участников.")
                    else {
                        Text(if (en) "Workspace" else "Пространство", style = MaterialTheme.typography.titleSmall)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            spaces.forEach { item -> FilterChip(selected = spaceId == item.optString("id"),
                                onClick = { spaceId = item.optString("id") }, label = { Text(item.optString("title")) }) }
                        }
                        if (projects.isEmpty()) Text(if (en) "No project in this workspace allows you to add tasks."
                            else "В этом пространстве нет проекта, в который вы можете добавить задачу.")
                        else {
                            OutlinedTextField(title, { title = it.take(160) }, singleLine = true,
                                label = { Text(if (en) "Task name" else "Название задачи") },
                                modifier = Modifier.fillMaxWidth().testTag("shared-task-title"))
                            OutlinedTextField(description, { description = it.take(20000) },
                                label = { Text(if (en) "Description" else "Описание") },
                                modifier = Modifier.fillMaxWidth())
                            Text(if (en) "Calendar for project view and task dates" else "Календарь проекта и дат задач",
                                style = MaterialTheme.typography.labelMedium)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(CalendarMode.PROFANE, CalendarMode.SACRED, CalendarMode.LUNAR).forEach { mode ->
                                    FilterChip(selected = calendarMode == mode, onClick = {
                                        calendarMode = mode
                                        preferences.edit().putString("calendarMode", mode.wireValue).apply()
                                    }, label = { Text(when (mode) {
                                        CalendarMode.PROFANE -> if (en) "Gregorian" else "Григорианский"
                                        CalendarMode.SACRED -> if (en) "Sacred" else "Сакральный"
                                        CalendarMode.LUNAR -> if (en) "Lunar" else "Лунный"
                                    }) })
                                }
                            }
                            Text(if (en) "Due date" else "Срок", style = MaterialTheme.typography.titleSmall)
                            if (dueDate.isBlank()) TextButton(onClick = { dueDate = LocalDate.now().toString() }) {
                                Text(if (en) "Set due date" else "Установить срок")
                            } else {
                                AuthorDatePicker(dueDate, calendarMode) { dueDate = it }
                                TextButton(onClick = { dueDate = "" }) { Text(if (en) "Clear" else "Убрать срок") }
                            }
                            EditorOptionsDisclosure(optionsExpanded, { optionsExpanded = it }) {
                            Text(if (en) "Project" else "Проект", style = MaterialTheme.typography.titleSmall)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                projects.forEach { item ->
                                    FilterChip(selected = projectId == item.optString("id"),
                                        onClick = { projectId = item.optString("id") },
                                        label = { Text(if (item.optInt("isInbox") == 1)
                                            (if (en) "Shared inbox" else "Хаос-бокс") else item.optString("title")) })
                                }
                            }
                            if (snapshot != null) {
                                Text(if (en) "Board" else "Доска", style = MaterialTheme.typography.titleSmall)
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    FilterChip(selected = statusId.isBlank(), onClick = { statusId = "" }, label = { Text("Хаос-бокс проекта") })
                                    rows("statuses").forEach { item -> FilterChip(selected = statusId == item.optString("id"),
                                        onClick = { statusId = item.optString("id") },
                                        label = { Text(item.optString("title")) }) }
                                }
                                Text(if (en) "Category" else "Категория", style = MaterialTheme.typography.titleSmall)
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    (listOf<JSONObject?>(null) + rows("categories")).forEach { item ->
                                        val id = item?.optString("id").orEmpty()
                                        FilterChip(selected = categoryId == id, onClick = { categoryId = id },
                                            label = { Text(item?.optString("title") ?: if (en) "No category" else "Без категории") })
                                    }
                                }
                                Text(if (en) "Assigned to" else "Исполнитель", style = MaterialTheme.typography.titleSmall)
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    (listOf<JSONObject?>(null) + rows("members")).forEach { item ->
                                        val id = item?.optString("userId").orEmpty()
                                        FilterChip(selected = assigneeId == id, onClick = { assigneeId = id },
                                            label = { Text(item?.optString("displayName") ?: if (en) "Unassigned" else "Не назначен") })
                                    }
                                }
                            }
                            }
                        }
                    }
                    Text(if (en) "Team tasks are saved on GENESIS. Each member enables their own Google copy."
                        else "Общая задача хранится на сервере GENESIS. Каждый участник сам включает свою копию в Google.",
                        style = MaterialTheme.typography.bodySmall)
                    if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.testTag("shared-task-message"))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(enabled = !busy, onClick = onDismiss) { Text(if (en) "Close" else "Закрыть") }
                    Button(enabled = !busy && snapshot != null && projectId.isNotBlank() &&
                        title.trim().isNotBlank() && validDate,
                        modifier = Modifier.testTag("save-shared-task"), onClick = {
                            val destination = projectId
                            if (projects.none { it.optString("id") == destination && it.optInt("isInbox") == 0 }) return@Button
                            val fields = JSONObject().put("title", title.trim()).put("description", description.trim())
                                .put("statusId", statusId).put("dueDate", if (dueDate.isBlank()) JSONObject.NULL else dueDate)
                                .put("categoryId", if (categoryId.isBlank()) JSONObject.NULL else categoryId)
                                .put("assigneeId", if (assigneeId.isBlank()) JSONObject.NULL else assigneeId)
                            busy = true; message = ""
                            scope.launch {
                                try {
                                    val created = controller.createSharedTask(destination, fields)
                                    title = ""; description = ""; dueDate = ""
                                    message = if (created.getJSONObject("task").optBoolean("pending")) {
                                        if (en) "Task saved on this device and waiting for the connection."
                                        else "Задача сохранена на устройстве и ожидает подключения к сети."
                                    } else if (en) "Team task created." else "Общая задача создана."
                                } catch (error: CancellationException) { throw error }
                                catch (error: Exception) {
                                    message = error.message ?: if (en) "Could not create task." else "Не удалось создать задачу."
                                } finally { busy = false }
                            }
                        }) { Text(if (busy) (if (en) "Saving…" else "Сохраняем…")
                            else if (en) "Create team task" else "Создать общую задачу") }
                }
            }
        }
    }
}
