package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties

/** Project management uses the same usable frame and spacing as the other project tools. */
@Composable internal fun SharedManagementDialog(title: String, onClose: () -> Unit, enabled: Boolean,
    content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (enabled) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GenesisModalFrame({ if (enabled) onClose() }) {
            Column(Modifier.fillMaxWidth().testTag("shared-management-dialog")) {
                AffairsDialogHeader(title, onClose = onClose, enabled = enabled, closeTag = "shared-management-close")
                HorizontalDivider()
                Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
            }
        }
    }
}

/** A role has one visible value; every option remains readable without sideways scrolling. */
@Composable internal fun SharedMemberRoleField(label: String, value: String, roles: List<String>, en: Boolean,
    enabled: Boolean, tag: String, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton({ expanded = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag), enabled = enabled) {
                Text(sharedRoleLabel(value, en), Modifier.weight(1f))
                AffairsActionIcon(AffairsAction.EXPAND)
            }
            DropdownMenu(expanded, { expanded = false }) {
                roles.forEach { role -> DropdownMenuItem(
                    text = { Text(sharedRoleLabel(role, en)) },
                    trailingIcon = if (role == value) ({ GenesisLucideIcon("check") }) else null,
                    onClick = { expanded = false; if (role != value) onChange(role) },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-$role")) }
            }
        }
    }
}
