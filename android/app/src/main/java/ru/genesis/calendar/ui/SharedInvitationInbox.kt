package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding

import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController

@Composable
internal fun SharedInvitationInbox(controller: AuthController, language: String, sharedEnabled: Boolean) {
    val en = language == "en"
    val scope = rememberCoroutineScope()
    var invitations by remember { mutableStateOf(emptyList<JSONObject>()) }
    var notifications by remember { mutableStateOf(emptyList<JSONObject>()) }
    var pendingId by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }

    LaunchedEffect(controller, sharedEnabled) {
        while (isActive) {
            try {
                val array = controller.sharedInvitations().getJSONArray("invitations")
                invitations = (0 until array.length()).map { array.getJSONObject(it) }
                if (sharedEnabled) {
                    val team = controller.sharedNotifications().getJSONArray("notifications")
                    notifications = (0 until team.length()).map { team.getJSONObject(it) }
                } else notifications = emptyList()
            } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error;
                message = error.message ?: if (en) "Could not load invitations." else "Не удалось загрузить приглашения."
            }
            delay(30_000)
        }
    }

    HorizontalDivider()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(if (en) "Invitations" else "Приглашения", style = MaterialTheme.typography.titleSmall)
        Text(if (en) "Shared workspaces and projects" else "Общие пространства и проекты",
            style = MaterialTheme.typography.bodySmall)
        if (invitations.isEmpty()) Text(if (en) "You have no pending invitations." else "Новых приглашений нет.")
        invitations.forEach { invitation ->
            val id = invitation.optString("id")
            Surface(Modifier.fillMaxWidth().testTag("shared-invitation-$id"),
                shape = MaterialTheme.shapes.medium, tonalElevation = 2.dp) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (en)
                        "${invitation.optString("inviterName")} invites you to workspace «${invitation.optString("spaceTitle")}», project «${invitation.optString("projectTitle")}`."
                    else
                        "Вас ${invitation.optString("inviterName")} приглашает присоединиться к пространству «${invitation.optString("spaceTitle")}», проекту «${invitation.optString("projectTitle")}».")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            scope.launch {
                                pendingId = id; message = ""
                                try {
                                    controller.acceptSharedInvitation(id)
                                    invitations = invitations.filterNot { it.optString("id") == id }
                                    controller.refresh()
                                    message = if (en) "Invitation accepted." else "Приглашение принято."
                                } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
                                finally { pendingId = "" }
                            }
                        }, enabled = pendingId.isEmpty(), modifier = Modifier.testTag("shared-invitation-accept-$id")) {
                            Text(if (en) "Accept" else "Принять")
                        }
                        OutlinedButton(onClick = {
                            scope.launch {
                                pendingId = id; message = ""
                                try {
                                    controller.rejectSharedInvitation(id)
                                    invitations = invitations.filterNot { it.optString("id") == id }
                                    message = if (en) "Invitation declined." else "Приглашение отклонено."
                                } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
                                finally { pendingId = "" }
                            }
                        }, enabled = pendingId.isEmpty(), modifier = Modifier.testTag("shared-invitation-decline-$id")) {
                            Text(if (en) "Decline" else "Отклонить")
                        }
                    }
                }
            }
        }
        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (sharedEnabled) {
    HorizontalDivider()
    AffairsDisclosure(if (en) "Team updates · history" else "События команды · история",
        Modifier.testTag("shared-team-history")) {
        Text(if (en) "Changes in shared projects" else "Изменения в общих проектах",
            style = MaterialTheme.typography.bodySmall)
        if (notifications.isEmpty()) Text(if (en) "No team updates yet." else "Новых событий команды пока нет.")
        if (notifications.any { it.optInt("isRead") == 0 }) {
            OutlinedButton(onClick = { scope.launch {
                val ids = notifications.filter { it.optInt("isRead") == 0 }.map { it.optString("id") }
                pendingId = "team-read"
                try {
                    controller.readSharedNotifications(ids)
                    notifications = notifications.map { row -> JSONObject(row.toString()).put("isRead", 1) }
                } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
                finally { pendingId = "" }
            } }, enabled = pendingId.isEmpty()) {
                Text(if (en) "Mark all as read" else "Отметить всё прочитанным")
            }
        }
        TeamEventRows(notifications, en)
    }
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
