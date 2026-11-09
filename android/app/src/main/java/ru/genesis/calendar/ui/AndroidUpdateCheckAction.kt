package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ru.genesis.calendar.BuildConfig

/** Foreground entry retries a failed background check without depending on account sync. */
@Composable
internal fun rememberUpdateResumeEpoch(): Int {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var epoch by remember(lifecycle) { mutableIntStateOf(0) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) epoch++
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return epoch
}

/** Manual checks remain available when reminders are off or account sign-in has expired. */
@Composable
internal fun AndroidUpdateCheckAction(iconOnly: Boolean = true,
    check: () -> AndroidRelease? = ::fetchAndroidRelease, plainIcon: Boolean = false,
    onStatus: (String?) -> Unit = {}) {
    val context = LocalContext.current
    val currentCheck by rememberUpdatedState(check)
    var request by remember { mutableIntStateOf(0) }
    var visible by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var release by remember { mutableStateOf<AndroidRelease?>(null) }
    var storeFailed by remember { mutableStateOf(false) }
    val begin: () -> Unit = {
        if (BuildConfig.PLAY_DISTRIBUTION) {
            storeFailed = runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=ru.genesis.calendar"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.isFailure
            failed = storeFailed
            visible = storeFailed
        } else {
            visible = true
            checking = true
            failed = false
            release = null
            request++
        }
    }
    LaunchedEffect(visible, request) {
        if (!visible || request == 0 || BuildConfig.PLAY_DISTRIBUTION) return@LaunchedEffect
        val result = withContext(Dispatchers.IO) { runCatching { currentCheck() } }
        checking = false
        failed = result.isFailure
        release = result.getOrNull()
    }
    val label = genesisTranslate(if (checking) "Проверяем обновления…" else "Проверить обновления")
    val status = when {
        checking -> "Проверяем обновления…"
        storeFailed -> "Не удалось открыть Google Play. Проверьте соединение и повторите попытку."
        failed -> "Не удалось проверить обновления. Проверьте интернет и повторите попытку."
        else -> "Установлена актуальная версия"
    }
    val reportStatus by rememberUpdatedState(onStatus)
    LaunchedEffect(visible, checking, release, status, plainIcon) {
        if (plainIcon) reportStatus(if (visible && release == null) status else null)
    }
    if (iconOnly && plainIcon) androidx.compose.material3.IconButton(onClick = begin, enabled = !checking,
        modifier = Modifier.size(48.dp).testTag("app-update-check").semantics { contentDescription = label },
        colors = androidx.compose.material3.IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant)) {
        GenesisLucideIcon("download", Modifier.size(22.dp))
    }
    else if (iconOnly) WorkspaceHeaderButton(label, "app-update-check", enabled = !checking,
        onClick = begin) { GenesisLucideIcon("download") }
    else Button(begin, Modifier.fillMaxWidth().testTag("app-update-check-settings"), enabled = !checking) {
        GenesisLucideIcon("download")
        androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
        Text("Проверить обновления")
    }
    if (visible) {
        val available = release
        if (available != null) AndroidUpdateDialog(context, available) { visible = false }
        else if (!plainIcon) AlertDialog(onDismissRequest = { visible = false }, title = { Text("Обновления приложения") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (checking) WorkspaceLoadingIndicator(Modifier.size(24.dp).testTag("app-update-check-progress"), strokeWidth = 2.dp)
                        Text(when {
                            checking -> "Проверяем обновления…"
                            storeFailed -> "Не удалось открыть Google Play. Проверьте соединение и повторите попытку."
                            failed -> "Не удалось проверить обновления. Проверьте интернет и повторите попытку."
                            else -> "Установлена актуальная версия"
                        }, Modifier.testTag("app-update-check-status").semantics { liveRegion = LiveRegionMode.Polite })
                    }
                    Text("GENESIS ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
            }, confirmButton = {
                if (failed) Button(begin, Modifier.testTag("app-update-check-retry")) { Text("Повторить") }
                else TextButton({ visible = false }, enabled = !checking) { Text("Закрыть") }
            }, dismissButton = {
                if (checking || failed) TextButton({ visible = false }) { Text("Отмена") }
            }, modifier = Modifier.testTag("app-update-check-dialog"))
    }
}
