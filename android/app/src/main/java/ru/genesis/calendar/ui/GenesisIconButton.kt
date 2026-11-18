package ru.genesis.calendar.ui

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp

/** Workspace toolbars use a quiet surface; the global app header stays transparent. */
internal val LocalGenesisIconButtonTonal = compositionLocalOf { false }

/** Plain icon actions reveal their surface only while interacting; Material owns input and ripple. */
@Composable internal fun GenesisIconButton(onClick: () -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, selected: Boolean? = null, tonal: Boolean = LocalGenesisIconButtonTonal.current,
    contentColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    interactionSource: MutableInteractionSource? = null, content: @Composable () -> Unit) {
    val interactions = interactionSource ?: remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val focused by interactions.collectIsFocusedAsState()
    val hovered by interactions.collectIsHoveredAsState()
    val feedback = when {
        !enabled -> if (tonal) MaterialTheme.colorScheme.scrim.copy(alpha = .025f) else Color.Transparent
        pressed || focused -> MaterialTheme.colorScheme.onSurface.copy(alpha = .12f)
        hovered -> MaterialTheme.colorScheme.onSurface.copy(alpha = .08f)
        selected == true -> selectedControlColors().container
        tonal -> MaterialTheme.colorScheme.scrim.copy(alpha = .08f)
        else -> Color.Transparent
    }
    androidx.compose.material3.OutlinedIconButton(onClick = onClick, enabled = enabled,
        modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .semantics { if (selected != null) this.selected = selected },
        shape = AffairsLayout.controlShape, border = null,
        colors = IconButtonDefaults.outlinedIconButtonColors(containerColor = feedback,
            contentColor = if (selected == true) MaterialTheme.colorScheme.primary else contentColor,
            disabledContainerColor = if (tonal) MaterialTheme.colorScheme.scrim.copy(alpha = .025f) else Color.Transparent,
            disabledContentColor = MaterialTheme.colorScheme.onSurface.copy(alpha = .38f)),
        interactionSource = interactions, content = content)
}
