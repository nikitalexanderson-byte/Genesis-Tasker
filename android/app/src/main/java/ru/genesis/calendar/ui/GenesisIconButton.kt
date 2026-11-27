package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp

internal val LocalGenesisIconButtonTonal = compositionLocalOf { false }

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun GenesisIconButton(onClick: () -> Unit, modifier: Modifier = Modifier,
    enabled: Boolean = true, selected: Boolean? = null, tonal: Boolean = LocalGenesisIconButtonTonal.current,
    contentColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    interactionSource: MutableInteractionSource? = null, content: @Composable () -> Unit) {
    val interactions = interactionSource ?: remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val focused by interactions.collectIsFocusedAsState()
    val hovered by interactions.collectIsHoveredAsState()
    val colors = MaterialTheme.colorScheme
    val container = when {
        !tonal -> Color.Transparent
        pressed || focused -> colors.onSurface.copy(alpha = .12f)
        hovered -> colors.onSurface.copy(alpha = .08f)
        selected == true -> selectedControlColors().container
        else -> colors.scrim.copy(alpha = .08f)
    }
    val ink = when {
        !tonal && pressed -> colors.primary.copy(alpha = .75f)
        selected == true || (!tonal && (hovered || focused)) -> colors.primary
        else -> contentColor
    }
    CompositionLocalProvider(LocalRippleConfiguration provides if (tonal) LocalRippleConfiguration.current else null) {
        androidx.compose.material3.OutlinedIconButton(onClick = onClick, enabled = enabled,
            modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .semantics { if (selected != null) this.selected = selected },
            shape = AffairsLayout.controlShape,
            border = if (!tonal && focused && enabled) BorderStroke(2.dp, colors.primary) else null,
            colors = IconButtonDefaults.outlinedIconButtonColors(containerColor = container, contentColor = ink,
                disabledContainerColor = if (tonal) colors.scrim.copy(alpha = .025f) else Color.Transparent,
                disabledContentColor = colors.onSurface.copy(alpha = .38f)),
            interactionSource = interactions, content = content)
    }
}
