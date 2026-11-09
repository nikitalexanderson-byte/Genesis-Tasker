package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min

/** Canvas translation of the original 30-step MoonPhaseIcon, not an emoji fallback. */
@Composable
fun MoonPhaseIcon(phaseStep: Int, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    val step = ((phaseStep % 30) + 30) % 30
    val shadow = if (LocalEveningTheme.current) MaterialTheme.colorScheme.surfaceContainerHigh else Color(0xff162c35)
    val light = Color(0xfff1dca9)
    val rim = Color(0xffb69b67)
    Canvas(modifier.size(size)) {
        val scale = min(this.size.width, this.size.height) / 100f
        withTransform({
            translate((this@Canvas.size.width - 100f * scale) / 2f,
                (this@Canvas.size.height - 100f * scale) / 2f)
            scale(scale, scale, pivot = Offset.Zero)
        }) {
            drawCircle(shadow, 46f, Offset(50f, 50f))
            if (step == 15) drawCircle(light, 46f, Offset(50f, 50f))
            else if (step != 0) {
                val waxing = step < 15
                val fraction = step / 30.0
                val quarter = if (waxing) fraction < .25 else fraction >= .75
                val half = Path().apply {
                    moveTo(50f, 4f)
                    arcTo(Rect(4f, 4f, 96f, 96f), -90f, if (waxing) 180f else -180f, false)
                    lineTo(50f, 96f)
                    close()
                }
                drawPath(half, light)
                val terminator = abs(cos(fraction * 2 * PI)).toFloat() * 46f
                drawOval(if (quarter) shadow else light,
                    topLeft = Offset(50f - terminator, 4f),
                    size = androidx.compose.ui.geometry.Size(terminator * 2, 92f))
            }
            drawCircle(rim, 46f, Offset(50f, 50f), style = Stroke(width = 1.6f))
        }
    }
}
