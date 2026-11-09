package ru.genesis.calendar.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.activity

private val notificationAccessRevision = mutableIntStateOf(0)

@Composable internal fun rememberNotificationsAllowed(app: GenesisApplication): Boolean {
    val owner = LocalLifecycleOwner.current
    val revision = notificationAccessRevision.intValue
    DisposableEffect(owner, app) {
        val observer = LifecycleEventObserver { _, event ->
            if(event == Lifecycle.Event.ON_RESUME) notificationAccessRevision.intValue++
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return remember(app, revision) { app.scheduler.notificationsAllowed() }
}

@Composable internal fun rememberRequestNotificationAccess(app: GenesisApplication,
    onResult: (Boolean) -> Unit = {}): () -> Unit {
    val context = LocalContext.current
    val result by rememberUpdatedState(onResult)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationAccessRevision.intValue++; result(it)
    }
    val asked = remember(app) { app.getSharedPreferences("genesis.notification.access.v1", android.content.Context.MODE_PRIVATE) }
    return {
        if(app.scheduler.notificationsAllowed()) result(true)
        else if(Build.VERSION.SDK_INT >= 33 && (!asked.getBoolean("requested", false) ||
            context.activity()?.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) == true)) {
            asked.edit().putBoolean("requested", true).apply()
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName))
    }
}

@Composable internal fun HabitNotificationAccessNotice(app: GenesisApplication, active: Boolean) {
    val allowed = rememberNotificationsAllowed(app)
    val request = rememberRequestNotificationAccess(app)
    if(active && !allowed) {
        Card(Modifier.fillMaxWidth().testTag("habit-notification-permission-notice")) {
            Column(Modifier.padding(12.dp)) {
                Text("Android блокирует напоминания о привычках.", style=MaterialTheme.typography.bodyMedium)
                Text("Разрешите уведомления GENESIS, чтобы получать их при закрытом приложении.",
                    style=MaterialTheme.typography.bodySmall)
                TextButton(onClick=request) { Text("Разрешить уведомления") }
            }
        }
    }
}
