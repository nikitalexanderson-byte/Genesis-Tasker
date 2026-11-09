package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import ru.genesis.calendar.domain.CalendarMode

/** One native page heading, based on the existing Settings heading. */
@Composable
internal fun GenesisPageHeader(title: String, description: String, symbol: String,
    modifier: Modifier = Modifier, animatedMandala: Boolean = false, subtitle: String? = null,
    icon: GenesisPageIcon = genesisPageIcon(title), calendarMode: CalendarMode? = null,
    onCalendarModeClick: (() -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null, compact: Boolean = false,
    showInformation: Boolean = true) {
    val calendarCopy = mobileCalendarCopy(LocalGenesisLanguage.current)
    val canSwitch = calendarMode != null && onCalendarModeClick != null &&
        LocalSacredFeaturesEnabled.current && LocalEnabledCalendars.current.size > 1
    val hint = genesisTranslate(calendarCopy.switchHint)
    if (compact && footer != null && calendarMode == null) {
        Surface(modifier.fillMaxWidth().testTag("genesis-page-header"), shape = AffairsLayout.shape,
            color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) { footer() }
                if (showInformation) PageInformationAction(title, description)
            }
        }
        return
    }
    Surface(modifier.fillMaxWidth().testTag("genesis-page-header"),
        shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
        Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (calendarMode != null && onCalendarModeClick != null) {
                    CalendarModeSwitcher(calendarMode, onCalendarModeClick,
                        size = 48.dp, interactive = canSwitch)
                } else GenesisVectorIcon(icon, Modifier.size(28.dp),
                    tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(title, style = MaterialTheme.typography.titleLarge)
                    subtitle?.let { Text(it, style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.testTag("genesis-page-subtitle")) }
                    if (calendarMode != null) Text(calendarCopy.calendarName(calendarMode),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (showInformation && description.isNotBlank() && calendarMode == null) {
                    PageInformationAction(title, description)
                }
            }
            footer?.let {
                Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) { it() }
            }
        }
    }
}

@Composable
internal fun PageInformationAction(title: String, description: String, inHeader: Boolean = false) {
    if (description.isBlank()) return
    var showDescription by remember { androidx.compose.runtime.mutableStateOf(false) }
    val infoLabel = genesisTranslate("О разделе")
    if (inHeader) WorkspaceHeaderButton(infoLabel, "workspace-information", onClick = { showDescription = true }) {
        GenesisLucideIcon("book-open", Modifier.size(20.dp))
    } else androidx.compose.material3.IconButton(onClick = { showDescription = true },
        modifier = Modifier.size(48.dp).semantics { contentDescription = infoLabel }) {
        GenesisLucideIcon("book-open", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (showDescription) AlertDialog(
        onDismissRequest = { showDescription = false }, title = { Text(title) }, text = { Text(description) },
        confirmButton = {})
}

/** Small native interpretation of the site's living SVG mandala; no WebView is needed. */
@Composable
private fun TheokyklosHeaderMandala() {
    val angle = rememberIconPhase("theokyklos-heading", 18_000) * 360f
    val pulse = rememberIconPhase("theokyklos-rays", 1_800)
    val gold = MaterialTheme.colorScheme.primary
    val background = eveningSurface(Color(0xff173b38))
    Canvas(Modifier.size(54.dp).testTag("genesis-theokyklos-mandala").clearAndSetSemantics { }) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val radius = size.minDimension * .39f
        drawCircle(background, radius = size.minDimension * .49f)
        drawCircle(gold.copy(alpha = .7f), radius, style = Stroke(width = 1.4.dp.toPx()))
        drawCircle(gold.copy(alpha = .45f), radius * .62f, style = Stroke(width = 1.dp.toPx()))
        repeat(8) { index ->
            val radians = index * PI / 4 - PI / 2
            val point = center + Offset((cos(radians) * radius).toFloat(),
                (sin(radians) * radius).toFloat())
            drawLine(gold.copy(alpha = .35f), center, point, strokeWidth = 1.dp.toPx())
            if (pulse > 0f) {
                val direction = point - center
                val tail = (pulse - .14f).coerceAtLeast(0f)
                drawLine(gold.copy(alpha = sin(pulse * PI).toFloat() * .8f),
                    center + direction * tail, center + direction * pulse,
                    strokeWidth = 1.1.dp.toPx(), cap = StrokeCap.Round)
            }
            drawCircle(gold, radius = 2.dp.toPx(), center = point)
        }
        drawArc(gold, startAngle = angle, sweepAngle = 80f, useCenter = false,
            topLeft = Offset(center.x - radius, center.y - radius),
            size = androidx.compose.ui.geometry.Size(radius * 2, radius * 2),
            style = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round))
        drawCircle(gold, radius = 4.dp.toPx(), center = center)
        drawCircle(background, radius = 1.5.dp.toPx(), center = center)
    }
}
