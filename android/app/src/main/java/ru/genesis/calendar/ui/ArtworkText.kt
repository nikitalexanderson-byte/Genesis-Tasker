package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** Photo captions keep their own contrast without painting a panel over the artwork. */
internal val LocalArtworkTextShadow = staticCompositionLocalOf<Shadow?> { null }

@Composable internal fun artworkTextShadow(): Shadow = with(LocalDensity.current) {
    Shadow(Color.Black.copy(alpha = .9f), Offset(0f, 1.dp.toPx()), 3.dp.toPx())
}
