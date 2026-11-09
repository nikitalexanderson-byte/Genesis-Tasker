package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.unit.dp

@Composable
internal fun EditorDialogHeader(title: String, closeTag: String, onClose: () -> Unit) {
    GenesisDialogHeader(closeTag, onClose) { Text(title, style = MaterialTheme.typography.titleLarge) }
}

/** Editors and confirmations share alignment, heading semantics and the same close target. */
@Composable
internal fun GenesisDialogHeader(closeTag: String = "dialog-close", onClose: (() -> Unit)?,
    enabled: Boolean = true, leading: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {}, title: @Composable () -> Unit) {
    val closeLabel = genesisTranslate("Закрыть")
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        leading?.invoke()
        Box(Modifier.weight(1f).heightIn(min = 48.dp).semantics { heading() }, contentAlignment = Alignment.CenterStart) { title() }
        actions()
        if (onClose != null) IconButton(onClick = onClose, enabled = enabled, modifier = Modifier.size(48.dp).testTag(closeTag)
            .semantics { contentDescription = closeLabel }) {
            GenesisLucideIcon("x", Modifier.size(22.dp))
        }
    }
}
