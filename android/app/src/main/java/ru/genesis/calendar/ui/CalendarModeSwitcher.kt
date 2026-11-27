package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.genesis.calendar.domain.CalendarMode
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.pow

internal fun nextCalendarMode(mode: CalendarMode): CalendarMode = when (mode) {
    CalendarMode.PROFANE -> CalendarMode.SACRED
    CalendarMode.SACRED -> CalendarMode.LUNAR
    CalendarMode.LUNAR -> CalendarMode.PROFANE
}
internal val LocalEnabledCalendars = staticCompositionLocalOf { CalendarMode.entries.toSet() }
internal val LocalSacredFeaturesEnabled = staticCompositionLocalOf { true }

internal fun nextAvailableCalendarMode(mode: CalendarMode, enabled: Set<CalendarMode>): CalendarMode {
    var candidate = mode
    repeat(3) {
        candidate = nextCalendarMode(candidate)
        if (candidate in enabled) return candidate
    }
    return mode
}

/** The same accessible, animated calendar selector is used on Today, Month and Year. */
@Composable
internal fun CalendarModeSwitcher(mode: CalendarMode, onNext: () -> Unit,
    modifier: Modifier = Modifier, size: Dp = 54.dp,
    interactive: Boolean = true, animationTrigger: Int = 0) {
    if (!LocalSacredFeaturesEnabled.current) return
    val scope = rememberCoroutineScope()
    val click = remember { Animatable(0f) }
    var animationJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    val name = genesisTranslate(when (mode) {
        CalendarMode.PROFANE -> "Григорианский"
        CalendarMode.SACRED -> "Сакральный"
        CalendarMode.LUNAR -> "Лунный"
    })
    val clickHint = genesisTranslate("Нажмите на иконку, чтобы сменить календарь")
    LaunchedEffect(animationTrigger) {
        if (animationTrigger > 0 && ValueAnimator.areAnimatorsEnabled()) {
            click.snapTo(0f)
            click.animateTo(1f, tween(240))
        } else click.snapTo(0f)
    }
    val target = modifier.size(maxOf(48.dp, size)).testTag("calendar-mode-icon-${mode.wireValue}")
        .semantics { contentDescription = if (interactive) "$name. $clickHint" else name }
    val glyph: @Composable () -> Unit = {
        val ink = if (interactive) LocalContentColor.current else MaterialTheme.colorScheme.onSurface
        Canvas(Modifier.size((size * .54f).coerceIn(24.dp, 32.dp))) {
            val radius = this.size.minDimension * .36f
            val stroke = 1.85.dp.toPx()
            when (mode) {
                CalendarMode.SACRED -> {
                    val turn = -click.value * PI * 4
                    repeat(12) { ray ->
                        val angle = ray * PI / 6 + turn
                        val bend = -sin(click.value * PI).pow(2) * .8
                        val start = center + Offset((cos(angle) * radius * .78).toFloat(),
                            (sin(angle) * radius * .78).toFloat())
                        val control = center + Offset((cos(angle + bend) * radius).toFloat(),
                            (sin(angle + bend) * radius).toFloat())
                        val end = center + Offset((cos(angle + bend * 1.65) * radius * 1.26).toFloat(),
                            (sin(angle + bend * 1.65) * radius * 1.26).toFloat())
                        drawPath(Path().apply {
                            moveTo(start.x, start.y)
                            quadraticTo(control.x, control.y, end.x, end.y)
                        }, ink, style = Stroke(stroke, cap = StrokeCap.Round))
                    }
                    drawCircle(ink, radius * .49f, center, style = Stroke(stroke))
                }
                CalendarMode.LUNAR -> {
                    val disc = Path().apply { addOval(Rect(center, radius)) }
                    val cutout = Path().apply { addOval(Rect(center + Offset(radius * .57f, -radius * .42f), radius)) }
                    val crescent = Path.combine(PathOperation.Difference, disc, cutout)
                    rotate((sin(click.value * PI) * 40).toFloat()) {
                        drawPath(crescent, ink, style = Stroke(stroke, join = androidx.compose.ui.graphics.StrokeJoin.Round))
                    }
                }
                CalendarMode.PROFANE -> {
                    val tilt = (1 - sin(click.value * PI).pow(2)) * .78
                    listOf(-1f, 1f).forEach { side ->
                        val head = center + Offset(side * radius * .55f, -radius * .68f)
                        val direction = Offset((-side * sin(tilt)).toFloat(), cos(tilt).toFloat())
                        val end = head + direction * (radius * 1.88f)
                        val tooth = Offset(direction.y, -direction.x) * (side * radius)
                        val headRadius = radius * .29f
                        drawCircle(ink, headRadius, head, style = Stroke(stroke))
                        drawLine(ink, head + direction * headRadius, end, stroke, cap = StrokeCap.Round)
                        drawLine(ink, end, end + tooth * .33f, stroke, cap = StrokeCap.Round)
                        val secondTooth = end - direction * (radius * .26f)
                        drawLine(ink, secondTooth, secondTooth + tooth * .25f, stroke, cap = StrokeCap.Round)
                    }
                }
            }
        }
    }
    if (interactive) {
        GenesisIconButton(onClick = {
            onNext()
            animationJob?.cancel()
            animationJob = scope.launch {
                click.snapTo(0f)
                if (ValueAnimator.areAnimatorsEnabled()) click.animateTo(1f, tween(240))
            }
        }, modifier = target, tonal = false, contentColor = MaterialTheme.colorScheme.onSurface, content = glyph)
    } else Box(target, contentAlignment = Alignment.Center) { glyph() }
}
