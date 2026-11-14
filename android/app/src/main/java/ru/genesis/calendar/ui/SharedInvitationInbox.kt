package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController

/** Team history lives with workspace invitations, alongside the shared work itself. */
@Composable
internal fun SharedTeamActivity(controller: AuthController, language: String) {
    val en = language == "en"
    AffairsDisclosure(if (en) "Team updates · history" else "События команды · история",
        Modifier.testTag("shared-team-history")) {
        val scope = rememberCoroutineScope()
        var notifications by remember(controller) { mutableStateOf(emptyList<JSONObject>()) }
        var pending by remember { mutableStateOf(false) }
        var loaded by remember { mutableStateOf(false) }
        var message by remember { mutableStateOf("") }
        LaunchedEffect(controller) {
            while (isActive) {
                try {
                    val team = controller.sharedNotifications().getJSONArray("notifications")
                    notifications = (0 until team.length()).map { team.getJSONObject(it) }
                    message = ""
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    message = error.message ?: "Ошибка сервера"
                } finally { loaded = true }
                delay(30_000)
            }
        }
        Text(if (en) "Changes in shared projects" else "Изменения в общих проектах",
            style = MaterialTheme.typography.bodySmall)
        if (!loaded) AffairsLoading()
        else if (notifications.isEmpty() && message.isEmpty())
            Text(if (en) "No team updates yet." else "Новых событий команды пока нет.")
        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (notifications.any { it.optInt("isRead") == 0 }) {
            OutlinedButton(onClick = { scope.launch {
                val ids = notifications.filter { it.optInt("isRead") == 0 }.map { it.optString("id") }
                pending = true
                try {
                    controller.readSharedNotifications(ids)
                    notifications = notifications.map { row -> JSONObject(row.toString()).put("isRead", 1) }
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    message = error.message ?: "Ошибка сервера"
                } finally { pending = false }
            } }, enabled = !pending) {
                Text(if (en) "Mark all as read" else "Отметить всё прочитанным")
            }
        }
        TeamEventRows(notifications, en)
    }
}

@Composable
internal fun TeamEventRows(notifications: List<JSONObject>, en: Boolean) {
    var visibleEvents by remember { mutableIntStateOf(5) }
        notifications.take(visibleEvents).forEach { item ->
            val action = item.optString("action")
            val verb = when {
                action.startsWith("task.") -> if (en) "updated a task" else "изменил(а) задачу"
                action == "comment.created" -> if (en) "added a comment" else "добавил(а) комментарий"
                else -> if (en) "updated the project" else "обновил(а) проект"
            }
            val detail = item.optString("taskTitle").takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""
            Surface(Modifier.fillMaxWidth().testTag("shared-team-event-${item.optString("id")}"),
                shape = MaterialTheme.shapes.medium,
                color = if (item.optInt("isRead") == 0) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow) {
                Text("${item.optString("actorName")} $verb$detail · ${item.optString("projectTitle")}",
                    Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (visibleEvents < notifications.size) OutlinedButton(onClick = { visibleEvents += 5 },
            modifier = Modifier.fillMaxWidth().testTag("shared-team-history-more")) {
            Text(if (en) "Show 5 more" else "Ещё 5 действий")
        }

}
