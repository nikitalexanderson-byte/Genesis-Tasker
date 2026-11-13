package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
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
    interactive: Boolean = true, animationTrigger: Int = 0, headerControl: Boolean = false) {
    if (!LocalSacredFeaturesEnabled.current) return
    val scope = rememberCoroutineScope()
    val click = remember { Animatable(0f) }
    val ambientPhase = rememberIconPhase("calendar-icon-ambient", 4600)
    val ambient = ((1 - cos(ambientPhase * PI * 2)) / 2).toFloat()
    var animationJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    val name = genesisTranslate(when (mode) {
        CalendarMode.PROFANE -> "Григорианский"
        CalendarMode.SACRED -> "Сакральный"
        CalendarMode.LUNAR -> "Лунный"
    })
    val clickHint = genesisTranslate("Нажмите на иконку, чтобы сменить календарь")
    val gold = if(LocalEveningTheme.current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onPrimaryContainer
    LaunchedEffect(animationTrigger) {
        if (animationTrigger > 0 && ValueAnimator.areAnimatorsEnabled()) {
            click.snapTo(0f)
            click.animateTo(1f, tween(240))
        } else click.snapTo(0f)
    }
    val iconModifier = modifier.size(maxOf(48.dp, size)).testTag("calendar-mode-icon-${mode.wireValue}")
        .let { if (interactive) it.semantics { contentDescription = "$name. $clickHint" }
            else it }
    val evening = LocalEveningTheme.current
    val controlBackground = MaterialTheme.colorScheme.primaryContainer
    Surface(modifier = if (interactive) iconModifier.clickable {
        // Navigation happens now; decorative feedback never gates another tap.
        onNext()
        animationJob?.cancel()
        animationJob = scope.launch {
            click.snapTo(0f)
            if (ValueAnimator.areAnimatorsEnabled()) click.animateTo(1f, tween(240))
        }
    } else iconModifier,
        shape = RoundedCornerShape(10.dp),
        color = if (headerControl) controlBackground.copy(alpha = controlBackground.alpha * .5f) else controlBackground,
        border = if (headerControl) null else BorderStroke(1.dp, gold.copy(alpha = .55f))) {
        Canvas(Modifier.padding(7.dp)) {
            val center = Offset(this.size.width / 2f, this.size.height / 2f)
            val radius = this.size.minDimension * .34f
            val stroke = 2.dp.toPx()
            when (mode) {
                CalendarMode.SACRED -> {
                    val turn = -click.value * PI * 4
                    drawCircle(gold.copy(alpha = .13f + ambient * .08f), radius * 1.32f, center)
                    repeat(12) { ray ->
                        val angle = ray * PI / 6 + turn
                        val bend = -sin(click.value * PI).pow(2) * .8
                        val start = center + Offset((cos(angle) * radius * .64).toFloat(),
                            (sin(angle) * radius * .64).toFloat())
                        val control = center + Offset((cos(angle + bend) * radius * .98).toFloat(),
                            (sin(angle + bend) * radius * .98).toFloat())
                        val end = center + Offset((cos(angle + bend * 1.65) * radius * 1.36).toFloat(),
                            (sin(angle + bend * 1.65) * radius * 1.36).toFloat())
                        drawPath(Path().apply {
                            moveTo(start.x, start.y)
                            quadraticTo(control.x, control.y, end.x, end.y)
                        }, gold, style = Stroke(stroke, cap = StrokeCap.Round))
                    }
                    drawCircle(gold, radius * .57f, center)
                    drawCircle(controlBackground, radius * .28f, center)
                }
                CalendarMode.LUNAR -> {
                    val phase = click.value * PI * 2
                    val orbit = radius * (.68f + .97f * sin(phase / 2).pow(2).toFloat())
                    val shadowOffset = Offset((cos(phase) * orbit).toFloat(),
                        (sin(phase) * orbit * .72f).toFloat())
                    val disc = Path().apply { addOval(Rect(center.x - radius, center.y - radius,
                        center.x + radius, center.y + radius)) }
                    drawCircle(Color(0xffe6d8b4).copy(alpha = .25f + ambient * .1f), radius * 1.17f, center)
                    clipPath(disc) {
                        drawCircle(Color(0xffeee6ca), radius, center)
                        drawCircle(controlBackground, radius * 1.07f,
                            center + shadowOffset)
                    }
                    drawCircle(gold, radius, center, style = Stroke(1.2.dp.toPx()))
                }
                CalendarMode.PROFANE -> {
                    val raised = sin(click.value * PI).pow(2)
                    val tilt = (1 - raised) * .78
                    val shaftLength = radius * 1.42f
                    drawCircle(gold.copy(alpha = .1f + ambient * .07f), radius * 1.2f, center)
                    listOf(-1f, 1f).forEach { side ->
                        val head = center + Offset(side * radius * .48f, -radius * .55f)
                        val direction = Offset((-side * sin(tilt)).toFloat(), cos(tilt).toFloat())
                        val end = head + direction * shaftLength
                        val toothDirection = Offset(direction.y, -direction.x) * (side * radius)
                        drawLine(gold, head, end, stroke, cap = StrokeCap.Round)
                        drawCircle(gold, radius * .28f, head, style = Stroke(stroke))
                        drawLine(gold, end, end + toothDirection * .30f, stroke,
                            cap = StrokeCap.Round)
                        drawLine(gold, end - direction * (radius * .14f),
                            end - direction * (radius * .14f) + toothDirection * .22f, stroke,
                            cap = StrokeCap.Round)
                    }
                }
            }
        }
    }
}
