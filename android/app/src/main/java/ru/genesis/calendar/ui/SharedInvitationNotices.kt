package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController

internal data class SharedInvitationDestination(val spaceId: String, val projectId: String, val taskId: String = "")

@Composable
internal fun SharedInvitationNotices(controller: AuthController, userId: String, language: String,
    onAccepted: (SharedInvitationDestination) -> Unit) {
    val en = language == "en"
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val store = remember(context) { context.getSharedPreferences("genesis-hidden-invitations", 0) }
    val hidden = remember(userId) { store.getStringSet(userId, emptySet()).orEmpty().toMutableSet() }
    var invitations by remember(userId) { mutableStateOf(emptyList<JSONObject>()) }
    var pending by remember { mutableStateOf("") }
    var errorId by remember { mutableStateOf("") }
    fun hide(id: String) {
        hidden.add(id)
        store.edit().putStringSet(userId, hidden.takeLastIds()).apply()
        invitations = invitations.filterNot { it.optString("id") == id }
    }
    LaunchedEffect(controller, userId, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                try {
                    val array = controller.sharedInvitations().getJSONArray("invitations")
                    invitations = (0 until array.length()).map(array::getJSONObject)
                        .filterNot { it.optString("id") in hidden }
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) { /* Keep visible invitations for the next refresh. */ }
                delay(30_000)
            }
        }
    }
    if (invitations.isEmpty()) return
    Column(Modifier.widthIn(max = 360.dp).fillMaxWidth().heightIn(max = 360.dp)
        .verticalScroll(rememberScrollState()).testTag("shared-invitation-notices"),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        invitations.forEach { invitation ->
            val id = invitation.getString("id")
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth().testTag("shared-invitation-notice-$id")) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (en) "Workspace invitation" else "Приглашение в пространство",
                            modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                        TextButton(onClick = { hide(id) }, enabled = pending != id,
                            modifier = Modifier.testTag("shared-invitation-hide-$id")) {
                            Text(if (en) "Hide" else "Скрыть")
                        }
                    }
                    Text(invitation.optString("spaceTitle"), style = MaterialTheme.typography.titleMedium)
                    Text(invitation.optString("inviterName") + " · " +
                        if (en) "invites you to join" else "приглашает присоединиться",
                        style = MaterialTheme.typography.bodyMedium)
                    if (invitation.optString("projectTitle").isNotBlank()) Text(invitation.optString("projectTitle"))
                    if (errorId == id) Text(if (en) "Could not accept the invitation. Try again."
                        else "Не удалось принять приглашение. Повторите попытку.", color = MaterialTheme.colorScheme.error)
                    Button(enabled = pending.isEmpty(), modifier = Modifier.testTag("shared-invitation-notice-accept-$id"),
                        onClick = {
                            pending = id; errorId = ""
                            scope.launch {
                                try {
                                    val joined = controller.acceptSharedInvitation(id)
                                    hide(id)
                                    onAccepted(SharedInvitationDestination(joined.optString("spaceId"), joined.optString("projectId")))
                                    controller.refresh()
                                } catch (error: CancellationException) { throw error }
                                catch (_: Exception) { errorId = id }
                                finally { pending = "" }
                            }
                        }) { Text(if (pending == id) { if (en) "Accepting…" else "Принимаем…" }
                            else { if (en) "Accept" else "Принять" }) }
                }
            }
        }
    }
}

private fun Set<String>.takeLastIds() = toList().takeLast(1000).toSet()
