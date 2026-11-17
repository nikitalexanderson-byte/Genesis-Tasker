package ru.genesis.calendar.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.emergencySnapshot
import ru.genesis.calendar.security.EmergencyArchive

@Composable
internal fun EmergencyExportAction(app: GenesisApplication,copy: SecurityUpdateCopy) {
    val scope=rememberCoroutineScope()
    // Intentionally not saveable, copied to clipboard, written to disk or sent to a server.
    var key by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val launcher=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if(uri!=null)scope.launch {
            busy=true; error=false
            try { withContext(Dispatchers.IO) {
                val encrypted=emergencySnapshot(app,requireNotNull(key))
                requireNotNull(app.contentResolver.openOutputStream(uri,"wt")).use { it.write(encrypted.toByteArray(Charsets.UTF_8)) }
            } } catch(cancel:kotlinx.coroutines.CancellationException){throw cancel}
            catch(_:Exception){error=true} finally {busy=false}
        }
    }
    TextButton(enabled=!busy,onClick={key=EmergencyArchive.newKey();error=false}) { Text(copy.export,translate=false) }
    key?.let { value ->
        Text(copy.exportNote,translate=false)
        SelectionContainer { Text(value,translate=false) }
        TextButton(enabled=!busy,onClick={launcher.launch("GENESIS-emergency.genesisrescue")}) { Text(copy.save,translate=false) }
        if(error)Text(copy.error,translate=false)
    }
}
