package ru.genesis.calendar.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** A moving highlight behind unchanged text; it never affects glyph layout. */
@Composable
internal fun BoxScope.CalendarPlaqueWave(trigger: Int) {
    val phase = remember { Animatable(0f) }
    LaunchedEffect(trigger) {
        if (trigger > 0) {
            phase.snapTo(0f)
            phase.animateTo(1f, tween(720))
        }
    }
    if (trigger > 0 && phase.value < 1f) Canvas(Modifier.matchParentSize()) {
        val center = size.width * (-.3f + phase.value * 1.6f)
        drawRect(Brush.horizontalGradient(
            listOf(Color.Transparent, Color(0x33ffe6a8), Color.Transparent),
            startX = center - size.width * .27f,
            endX = center + size.width * .27f,
        ))
    }
}
