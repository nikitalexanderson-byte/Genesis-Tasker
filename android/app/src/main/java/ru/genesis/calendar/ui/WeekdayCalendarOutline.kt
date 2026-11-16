package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import java.time.DayOfWeek
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal data class WeekdayOutlineColors(val body: Color, val shade: Color, val highlight: Color, val glow: Color)

/** The outline belongs to the weekday, independently of the cell's theme. */
internal fun weekdayOutlineColors(day: DayOfWeek): WeekdayOutlineColors = when (day) {
    DayOfWeek.SUNDAY -> WeekdayOutlineColors(Color(0xffffd65b), Color(0xffa46d0f), Color(0xfffff5c4), Color(0xffffc83f))
    DayOfWeek.MONDAY -> WeekdayOutlineColors(Color(0xffd1dae7), Color(0xff65788d), Color.White, Color(0xffe7f2ff))
    DayOfWeek.TUESDAY -> WeekdayOutlineColors(Color(0xffff727e), Color(0xff962a3a), Color(0xffffe1e3), Color(0xffff596d))
    DayOfWeek.WEDNESDAY -> WeekdayOutlineColors(Color(0xff5cf5a1), Color(0xff19794b), Color(0xffd2ffe4), Color(0xff40eb91))
    DayOfWeek.THURSDAY -> WeekdayOutlineColors(Color(0xff6bafff), Color(0xff225dba), Color(0xffd8eeff), Color(0xff499cff))
    DayOfWeek.FRIDAY -> WeekdayOutlineColors(Color(0xffc890ff), Color(0xff6731a0), Color(0xfff2dfff), Color(0xffb86bff))
    DayOfWeek.SATURDAY -> WeekdayOutlineColors(Color(0xff27323e), Color(0xff080c12), Color(0xff91a2b3), Color(0xff485664))
}

/** Only active cells animate. State is read during drawing, without remeasuring the grid. */
@Composable
internal fun Modifier.weekdayCalendarOutline(day: DayOfWeek, enabled: Boolean, active: Boolean, shape: Shape): Modifier {
    if (!enabled) return this
    val view = LocalView.current
    var inViewport by remember { mutableStateOf(false) }
    val motion = ValueAnimator.areAnimatorsEnabled()
    val visibility = animateFloatAsState(if (active) 1f else 0f,
        if (motion) tween(160) else snap(), label = "weekday-outline-visibility")
    val phase = if (active && motion && inViewport) rememberInfiniteTransition(label = "weekday-metallic-outline").animateFloat(
        .12f, 1.12f, infiniteRepeatable(tween(4200, easing = LinearEasing)), label = "weekday-outline-glint")
        else rememberUpdatedState(.12f)
    val colors = remember(day) { weekdayOutlineColors(day) }
    val saturday = day == DayOfWeek.SATURDAY
    return onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        inViewport = bounds.width > 0f && bounds.height > 0f && bounds.right > 0f && bounds.bottom > 0f &&
            bounds.left < view.width && bounds.top < view.height
    }.drawWithCache {
        val stroke = 3.dp.toPx()
        val inset = stroke / 2f
        val bounds = Size((size.width - stroke).coerceAtLeast(0f), (size.height - stroke).coerceAtLeast(0f))
        val outline = shape.createOutline(bounds, layoutDirection, this)
        val bevelInset = .45.dp.toPx()
        val bevel = shape.createOutline(Size((size.width - bevelInset * 2).coerceAtLeast(0f),
            (size.height - bevelInset * 2).coerceAtLeast(0f)), layoutDirection, this)
        val glowStep = .9.dp.toPx()
        val bevelStroke = Stroke(.55.dp.toPx())
        onDrawWithContent {
            val strength = visibility.value
            // Feathered outer strokes stay within 3dp of the cell; no full-grid blur/layer.
            if (strength > 0f) translate(inset, inset) {
                for (spread in 6 downTo 1) drawOutline(outline, colors.glow,
                    alpha = strength * (if (saturday) .011f else .022f) * (7 - spread), style = Stroke(stroke + spread * glowStep))
            }
            drawContent()
            if (strength > 0f) {
                translate(inset, inset) {
                    val angle = phase.value * 2f * PI.toFloat()
                    val beam = Offset(cos(angle) * bounds.width, sin(angle) * bounds.height)
                    val center = Offset(bounds.width / 2f, bounds.height / 2f)
                    val brush = Brush.linearGradient(listOf(colors.shade, colors.body, colors.highlight, colors.body, colors.shade),
                        start = center - beam, end = center + beam)
                    if (saturday) drawOutline(outline, Color.Black, alpha = strength, style = Stroke(stroke + 1.dp.toPx()))
                    drawOutline(outline, brush, alpha = strength, style = Stroke(stroke))
                }
                // Saturday retains a dark edge with a quieter metallic highlight.
                translate(bevelInset, bevelInset) {
                    drawOutline(bevel, colors.highlight, alpha = strength * if (saturday) .25f else .60f, style = bevelStroke)
                }
            }
        }
    }
}
