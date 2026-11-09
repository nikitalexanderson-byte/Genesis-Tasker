package ru.genesis.calendar.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.size
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** A direct, green entry point; motion follows the user's press, never an idle loop. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun SharedMindmapButton(onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val spread by animateFloatAsState(if (pressed && android.animation.ValueAnimator.areAnimatorsEnabled()) .78f else 1f,
        label = "mindmap-branches")
    val ink = MaterialTheme.colorScheme.primary
    val paper = MaterialTheme.colorScheme.primaryContainer
    val label = genesisTranslate("Общие майндмепы")
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text("Общие майндмепы") } }, state = rememberTooltipState()) {
        OutlinedIconButton(onClick, interactionSource = interaction, shape = AffairsLayout.controlShape,
            border = if (LocalAffairsControlOutlined.current) BorderStroke(1.dp, MaterialTheme.colorScheme.secondary.copy(alpha = .65f)) else null,
            colors = IconButtonDefaults.outlinedIconButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = ink),
            modifier = Modifier.size(width = LocalAffairsControlWidth.current, height = 48.dp).testTag("shared-mindmaps-open")
                .semantics { contentDescription = label }) {
            // A central idea with radiating branches, distinct from the board hierarchy icon.
            Canvas(Modifier.size(26.dp)) {
                val hub = Offset(size.width * .5f, size.height * .5f)
                val stroke = 1.8.dp.toPx()
                val nodes = listOf(Offset(-.34f, -.3f), Offset(.34f, -.3f), Offset(-.34f, .3f), Offset(.34f, .3f))
                nodes.forEach { offset ->
                    val node = hub + Offset(offset.x * size.width, offset.y * size.height) * spread
                    drawLine(ink, hub, node, strokeWidth = stroke, cap = StrokeCap.Round)
                    drawCircle(ink, 2.4.dp.toPx(), node)
                }
                drawCircle(paper, 4.dp.toPx(), hub)
                drawCircle(ink, 4.dp.toPx(), hub, style = Stroke(stroke))
            }
        }
    }
}
