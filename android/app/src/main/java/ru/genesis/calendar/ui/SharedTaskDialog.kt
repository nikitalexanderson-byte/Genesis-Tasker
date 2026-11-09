package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate

private data class SharedTaskEditControl(val enabled: Boolean, val onEdit: () -> Unit)
private val LocalSharedTaskEditControl = compositionLocalOf<SharedTaskEditControl?> { null }

/** Reading is the entry state; only an explicit action exposes the editor. */
@Composable internal fun SharedTaskDialog(title: String, editing: Boolean, canEdit: Boolean, busy: Boolean,
    onEdit: () -> Unit, onClose: () -> Unit, footer: @Composable () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (!busy) onClose() }) {
        GenesisModalFrame({ if (!busy) onClose() }) {
            Column(Modifier.fillMaxWidth().testTag("shared-task-dialog")) {
                AffairsDialogHeader(title, onClose = onClose, enabled = !busy, closeTag = "shared-task-close")
                Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    CompositionLocalProvider(LocalSharedTaskEditControl provides
                        if (canEdit && !editing) SharedTaskEditControl(!busy, onEdit) else null) {
                        content()
                    }
                }
                footer()
            }
        }
    }
}

@Composable internal fun SharedTaskReadSummary(task: JSONObject, members: List<JSONObject>, statuses: List<JSONObject>, mode: CalendarMode) {
    val rows = listOf(
        "Доска" to statuses.firstOrNull { it.optString("id") == task.optString("statusId") }?.optString("title"),
        "Исполнитель" to members.firstOrNull { it.optString("userId") == task.optString("assigneeId") }?.optString("displayName"),
        "Срок" to task.optString("dueDate").takeUnless { it.isBlank() || it == "null" }?.let {
            runCatching { GenesisCalendar().formatDate(LocalDate.parse(it), mode) }.getOrDefault(it)
        },
        "Создатель" to members.firstOrNull { it.optString("userId") == task.optString("createdBy") }?.optString("displayName"),
    )
    Row(Modifier.fillMaxWidth().testTag("shared-task-read-summary"), verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            rows.forEach { (label, value) -> if (!value.isNullOrBlank()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                UntranslatedText(value, Modifier.weight(2f), style = MaterialTheme.typography.bodyMedium)
            } }
        }
        LocalSharedTaskEditControl.current?.let { control ->
            AffairsIconButton("Редактировать", AffairsAction.EDIT, control.onEdit, enabled = control.enabled,
                outlined = false, modifier = Modifier.testTag("shared-task-edit"))
        }
    }
}
