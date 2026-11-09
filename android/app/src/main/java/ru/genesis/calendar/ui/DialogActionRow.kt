package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

internal data class DialogIconAction(val label: String, val icon: AffairsAction, val onClick: () -> Unit,
    val enabled: Boolean = true, val destructive: Boolean = false, val modifier: Modifier = Modifier)

/** One action slot prevents Material's separate confirm/dismiss groups from wrapping. */
@Composable internal fun DialogActionRow(vararg actions: DialogIconAction, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        actions.forEach { action ->
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                AffairsIconButton(action.label, action.icon, action.onClick, action.modifier,
                    enabled = action.enabled, outlined = false,
                    contentColor = if (action.destructive) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        }
    }
}
