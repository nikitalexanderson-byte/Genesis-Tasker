package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import ru.genesis.calendar.data.moveTodayBlock
import ru.genesis.calendar.data.normalizeTodayBlockOrder

internal data class TodayBlock(val id: String, val title: String, val content: @Composable () -> Unit)

/** Stable keys preserve drafts and card state while a viewport-owned gesture moves blocks. */
@Composable internal fun SortableTodayWorkspace(savedOrder: String, blocks: List<TodayBlock>,
    onOrder: (List<String>) -> Unit, editing: Boolean = false, header: @Composable () -> Unit) {
    var order by remember(savedOrder) { mutableStateOf(normalizeTodayBlockOrder(savedOrder)) }
    var dragging by remember { mutableStateOf<String?>(null) }
    var originalOrder by remember { mutableStateOf(order) }
    var pointer by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(Rect.Zero) }
    var lastTarget by remember { mutableStateOf<String?>(null) }
    val bounds = remember { mutableMapOf<String, Rect>() }
    val state = rememberLazyGridState()
    val visible = order.mapNotNull { id -> blocks.find { it.id == id } }
    fun moveAtPointer() {
        val source = dragging ?: return
        val target = visible.firstOrNull { it.id != source && bounds[it.id]?.contains(pointer) == true }?.id
        if (target == null) { lastTarget = null; return }
        if (target != lastTarget) { order = moveTodayBlock(order, source, target); lastTarget = target }
    }
    LaunchedEffect(dragging) {
        if (dragging == null) return@LaunchedEffect
        while (isActive) {
            val edge = 72f
            val distance = when {
                pointer.y < viewport.top + edge -> -18f
                pointer.y > viewport.bottom - edge -> 18f
                else -> 0f
            }
            if (distance != 0f) { state.scrollBy(distance); moveAtPointer() }
            delay(16)
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        WorkspaceDragHost(Modifier.fillMaxSize().onGloballyPositioned { viewport = it.boundsInRoot() }) {
            LazyVerticalGrid(columns = GridCells.Fixed(if (wide) 2 else 1), state = state,
                modifier = Modifier.fillMaxSize().testTag(if (wide) "today-two-pane" else "today-list"),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item(key = "today-fixed-header", span = { GridItemSpan(maxLineSpan) }) {
                    header()
                }
                items(visible, key = { it.id }) { block ->
                    DisposableEffect(block.id) { onDispose { bounds.remove(block.id) } }
                    Column(Modifier.fillMaxWidth().testTag("today-block-${block.id}")
                        .onGloballyPositioned { bounds[block.id] = it.boundsInRoot() }
                        .graphicsLayer { alpha = if (dragging == block.id) .65f else 1f }) {
                        if (editing) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            val translatedTitle=genesisTranslate(block.title)
                            Text(block.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            val index = visible.indexOfFirst { it.id == block.id }
                            listOf(-1 to "arrow-up", 1 to "arrow-down").forEach { (step, icon) ->
                                val label = genesisTranslate(if (step < 0) "Переместить выше" else "Переместить ниже")
                                IconButton(onClick = {
                                    order = moveTodayBlock(order, block.id, visible[index + step].id)
                                    onOrder(order)
                                }, enabled = dragging == null && index + step in visible.indices,
                                    modifier = Modifier.size(48.dp).testTag("today-${block.id}-$icon")
                                        .semantics { contentDescription = "$label: ${translatedTitle}" }) {
                                    GenesisLucideIcon(icon, Modifier.size(20.dp))
                                }
                            }
                            var origin by remember(block.id) { mutableStateOf(Offset.Zero) }
                            val dragLabel = genesisTranslate("Переместить и упорядочить")
                            val ink = MaterialTheme.colorScheme.onSurfaceVariant
                            Box(Modifier.size(48.dp).testTag("today-drag-${block.id}")
                                .onGloballyPositioned { origin = it.boundsInRoot().topLeft }
                                .semantics { contentDescription = "$dragLabel: ${translatedTitle}" }
                                .workspaceDragSource("today-${block.id}",
                                    onStart = { offset ->
                                        originalOrder = order; dragging = block.id; pointer = origin + offset; lastTarget = null
                                    }, onMove = { delta -> pointer += delta; moveAtPointer() },
                                    onFinish = { cancelled ->
                                        if (dragging == block.id) {
                                            if (cancelled) order = originalOrder else onOrder(order)
                                            dragging = null; lastTarget = null
                                        }
                                    }), contentAlignment = Alignment.Center) {
                                Canvas(Modifier.size(20.dp)) {
                                    for (x in listOf(.35f, .65f)) for (y in listOf(.2f, .5f, .8f))
                                        drawCircle(ink, radius = 1.5.dp.toPx(), center = Offset(size.width * x, size.height * y))
                                }
                            }
                        }
                        block.content()
                    }
                }
            }
        }
    }
}
