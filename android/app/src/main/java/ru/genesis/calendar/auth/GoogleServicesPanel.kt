package ru.genesis.calendar.auth

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import ru.genesis.calendar.ui.AlertDialog
import ru.genesis.calendar.ui.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import ru.genesis.calendar.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Text

/** Persistent settings card: authentication and Google service grants are separate states. */
@Composable
fun GoogleServicesConnectPanel(state: AuthPanelState, controller: AuthController,
    modifier: Modifier = Modifier, showWhenComplete: Boolean = false, embedded: Boolean = false) {
    val access = GoogleServiceAccess.primary(state.accountSettings)
    if (state.user == null || (access.complete && !showWhenComplete)) return
    val activity = LocalContext.current.activity()
    var confirm by remember { mutableStateOf(false) }

    val content: @Composable () -> Unit = {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (access.complete) "Google Calendar и Tasks подключены"
                else "Подключите синхронизацию Google", style = MaterialTheme.typography.titleMedium)
            Text("Google Calendar · " + if (access.calendar) "разрешение выдано" else "нужно разрешение",
                style = MaterialTheme.typography.bodySmall)
            Text("Google Tasks · " + if (access.tasks) "разрешение выдано" else "нужно разрешение",
                style = MaterialTheme.typography.bodySmall)
            Text("GENESIS запросит доступ отдельно от входа и сохранит токен фоновой синхронизации только на сервере.",
                style = MaterialTheme.typography.bodySmall)
            Button(onClick = { confirm = true }, enabled = !state.busy && activity != null,
                modifier = Modifier.fillMaxWidth().testTag("google-services-authorize")) {
                Text(if (access.complete) "Обновить разрешения" else "Подключить Calendar и Tasks")
            }
        }
    }
    if (embedded) Column(modifier.fillMaxWidth().testTag("google-services-connect")) { content() }
    else Card(modifier.fillMaxWidth().testTag("google-services-connect")) { content() }

    if (confirm) GoogleServicesConsentDialog(state, controller) { confirm = false }
}

/** One-time in-process offer after a successful sign-in; it never occupies the home layout. */
@Composable
fun GoogleServicesFirstRunModal(state: AuthPanelState, controller: AuthController) {
    val userId = state.user?.uid
    val access = GoogleServiceAccess.primary(state.accountSettings)
    val context = LocalContext.current
    val offers = remember(context) { context.getSharedPreferences("genesis.google.service-offer", 0) }
    var show by remember(userId) { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(state.ready, state.offerGoogleServices, userId, access.complete) {
        if (access.complete) show = false
        if (state.ready && state.offerGoogleServices && userId != null && !access.complete &&
            !offers.getBoolean(userId, false)) {
            // Record the offer before displaying it, including when the process is recreated.
            offers.edit().putBoolean(userId, true).apply()
            show = true
        }
    }
    if (show && userId != null) {
        GoogleServicesConsentDialog(state, controller) { show = false }
    }
}

@Composable
private fun GoogleServicesConsentDialog(state: AuthPanelState, controller: AuthController, onDismiss: () -> Unit) {
    val activity = LocalContext.current.activity()
    var attempted by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && activity != null) {
            controller.completeGoogleServicesAuthorization(activity, result.data, onCompleted = onDismiss)
        } else {
            controller.cancelGoogleServicesAuthorization()
        }
    }
    AlertDialog(
        // Keep the result launcher composed while config/authorization is in flight.
        // Otherwise an outside tap can unregister it before the Google resolution arrives.
        onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text("Разрешить синхронизацию Google?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Google Calendar")
                Text("GENESIS создаёт отдельный календарь и синхронизирует в нём события.",
                    style = MaterialTheme.typography.bodySmall)
                Text("Google Tasks")
                Text("GENESIS показывает и изменяет ваши списки и задачи по вашим действиям.",
                    style = MaterialTheme.typography.bodySmall)
                state.user?.email?.let { email ->
                    Text("В окне Google выберите тот же аккаунт: $email",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                }
                if (attempted) Text(if (state.busy) "Открываем окно Google…" else state.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state.busy) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (activity != null) {
                    attempted = true
                    controller.connectGoogleServices(activity,
                        launchResolution = { pendingIntent ->
                            launcher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
                        },
                        onCompletedWithoutResolution = onDismiss)
                }
            }, enabled = !state.busy && activity != null) { Text("Продолжить") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !state.busy) { Text("Не сейчас") } },
    )
}
