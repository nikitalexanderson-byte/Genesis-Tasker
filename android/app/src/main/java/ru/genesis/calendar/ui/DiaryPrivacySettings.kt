package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.data.DiaryRecord
import ru.genesis.calendar.data.DiaryRepository
import ru.genesis.calendar.data.DiaryState

@Composable internal fun diaryText(key: String): String {
    val context = LocalContext.current; val language = LocalGenesisLanguage.current
    val copy = remember(context, language) { context.assets.open("originals/i18n/diary-copy.json").bufferedReader().use {
        JSONObject(it.readText()).let { root -> root.optJSONObject(language) ?: root.getJSONObject("en") }
    } }
    return copy.getString(key)
}

@Composable internal fun DiaryPrivacySettings(repository: DiaryRepository, state: DiaryState, onClose: () -> Unit) {
    var confirmation by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun change(enabled: Boolean) { scope.launch {
        if (busy) return@launch
        busy = true; error = false
        try { repository.setSyncEnabled(enabled); confirmation = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = true }
        finally { busy = false }
    } }
    AlertDialog({ if (!busy) onClose() }, title = { Text(diaryText("settings")) },
        modifier = Modifier.testTag("diary-settings-dialog"),
        properties = DialogProperties(dismissOnBackPress = !busy, dismissOnClickOutside = !busy),
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(diaryText("syncLabel"), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                Switch(state.syncEnabled, { confirmation = if (it) "enable" else "disable"; error = false },
                    enabled = state.ready && !busy && !state.protected, modifier = Modifier.sizeIn(minHeight = 48.dp).testTag("diary-sync-toggle"))
            }
            Text(diaryText(if (state.syncEnabled) "syncOn" else "localOnly"), Modifier.testTag("diary-sync-status"), color = MaterialTheme.colorScheme.primary)
            Text(diaryText("syncHint"), style = MaterialTheme.typography.bodySmall)
            Text(diaryText("localWarning"), style = MaterialTheme.typography.bodySmall)
            if (state.syncEnabled && state.pendingUploads > 0) {
                Text(diaryText("pendingUpload"), Modifier.testTag("diary-upload-pending"))
                Button({ change(true) }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("diary-retry-sync")) { Text(diaryText("retrySync")) }
            }
            TextButton({ confirmation = "purge"; error = false }, enabled = !busy && state.ready && !state.protected,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("diary-purge-server")) {
                AffairsActionIcon(AffairsAction.DELETE); Spacer(Modifier.width(8.dp)); Text(diaryText("purgeServer"))
            }
            Text(diaryText("backupRetention"), style = MaterialTheme.typography.bodySmall)
            if (busy) WorkspaceLoadingIndicator(Modifier.size(28.dp))
            if (error && confirmation == null) Text(diaryText("settingsError"), color = MaterialTheme.colorScheme.error)
        } }, confirmButton = {})
    confirmation?.let { action ->
        AlertDialog({ if (!busy) confirmation = null }, title = { Text(diaryText(when (action) { "enable" -> "enableTitle"; "purge" -> "purgeTitle"; else -> "disableTitle" })) },
            modifier = Modifier.testTag("diary-sync-confirmation"),
            properties = DialogProperties(dismissOnBackPress = !busy, dismissOnClickOutside = !busy),
            text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(diaryText(when (action) { "enable" -> "enableBody"; "purge" -> "purgeBody"; else -> "disableBody" }))
                if (error) Text(diaryText("settingsError"), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("diary-settings-error"))
                if (busy) WorkspaceLoadingIndicator(Modifier.size(28.dp))
            } },
            confirmButton = { Button({ change(action == "enable") }, enabled = !busy, modifier = Modifier.testTag("diary-sync-confirm")) { Text(if (action == "purge") genesisTranslate("Удалить") else diaryText("apply")) } },
            dismissButton = { TextButton({ confirmation = null }, enabled = !busy) { Text(diaryText("cancel")) } })
    }
}

@Composable internal fun DiaryDeleteConfirmation(repository: DiaryRepository, record: DiaryRecord, onClose: () -> Unit) {
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog({ if (!busy) onClose() }, title = { Text(diaryText("deleteTitle")) },
        properties = DialogProperties(dismissOnBackPress = !busy, dismissOnClickOutside = !busy),
        modifier = Modifier.testTag("diary-delete-confirmation"),
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(diaryText("deleteBody"))
            if (error) Text(diaryText("settingsError"), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("diary-delete-error"))
        } },
        confirmButton = { Button({ scope.launch {
            if (busy) return@launch
            busy = true; error = false
            try { repository.remove(record); onClose() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = true }
            finally { busy = false }
        } }, enabled = !busy, modifier = Modifier.testTag("diary-delete-confirm")) { Text(genesisTranslate("Удалить")) } },
        dismissButton = { TextButton(onClose, enabled = !busy) { Text(diaryText("cancel")) } })
}
