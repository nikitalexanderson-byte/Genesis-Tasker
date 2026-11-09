package ru.genesis.calendar.ui

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

private class WorkspaceDragSource {
    var bounds = Rect.Zero
    var start: (Offset) -> Unit = {}
    var move: (Offset) -> Unit = {}
    var finish: (Boolean) -> Unit = {}
}

private class WorkspaceDragOwner {
    val sources = mutableSetOf<WorkspaceDragSource>()
    var origin = Offset.Zero
    var dragging by mutableStateOf(false)
    var generation by mutableIntStateOf(0)
}
private val LocalWorkspaceDragOwner = staticCompositionLocalOf<WorkspaceDragOwner?> { null }

/** The viewport owns the pointer, so recycling an offscreen lazy row cannot cancel its drag. */
@Composable internal fun WorkspaceDragHost(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val owner = remember { WorkspaceDragOwner() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, owner) {
        val observer = LifecycleEventObserver { _, event ->
            // Leaving the activity cancels a gesture; resuming must never commit a stale drop.
            if (event == Lifecycle.Event.ON_PAUSE) owner.generation++
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    BackHandler(enabled = owner.dragging) { owner.generation++ }
    CompositionLocalProvider(LocalWorkspaceDragOwner provides owner) {
        Box(modifier.onGloballyPositioned { owner.origin = it.boundsInRoot().topLeft }
            .pointerInput(owner, owner.generation) {
                var active: WorkspaceDragSource? = null
                fun finish(cancelled: Boolean) {
                    val source = active
                    // The callback may immediately move/recycle its card and dispose its modifier.
                    // Release ownership before it changes the tree, and finish every gesture once.
                    active = null
                    owner.dragging = false
                    source?.finish?.invoke(cancelled)
                }
                try {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val point = owner.origin + down.position
                        val source = owner.sources.toList().filter { it.bounds.contains(point) }
                            .minByOrNull { it.bounds.width * it.bounds.height } ?: return@awaitEachGesture
                        val held = awaitLongPressOrCancellation(down.id) ?: return@awaitEachGesture
                        active = source
                        owner.dragging = true
                        held.consume()
                        source.start(point - source.bounds.topLeft)
                        while (true) {
                            // Reserve the move before child scrollables, then let that event finish
                            // traversing children before callbacks can move/dispose their nodes.
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val change = event.changes.firstOrNull { it.id == down.id }
                            val cancelled = change == null || change.isConsumed
                            val delta = change?.let { it.position - it.previousPosition } ?: Offset.Zero
                            val pressed = change?.pressed == true
                            if (!cancelled) change?.consume()
                            awaitPointerEvent(PointerEventPass.Final)
                            if (cancelled) { finish(true); break }
                            if (!pressed) { finish(false); break }
                            if (delta.x.isFinite() && delta.y.isFinite()) active?.move?.invoke(delta)
                        }
                    }
                } finally { finish(true) }
            }, content = content)
    }
}

@Composable internal fun Modifier.workspaceDragSource(key: String, enabled: Boolean = true,
    onStart: (Offset) -> Unit, onMove: (Offset) -> Unit, onFinish: (Boolean) -> Unit): Modifier {
    val owner = LocalWorkspaceDragOwner.current
    val start by rememberUpdatedState(onStart)
    val move by rememberUpdatedState(onMove)
    val finish by rememberUpdatedState(onFinish)
    val source = remember(key) { WorkspaceDragSource() }
    source.start = { start(it) }; source.move = { move(it) }; source.finish = { finish(it) }
    DisposableEffect(owner, source, enabled) {
        if (enabled) owner?.sources?.add(source)
        // An active drag retains its source until release, independently of this hit-test registry.
        onDispose { owner?.sources?.remove(source) }
    }
    if (!enabled) return this
    return onGloballyPositioned { source.bounds = it.boundsInRoot() }
        .then(if (owner != null) Modifier else Modifier.pointerInput(source) {
            detectDragGesturesAfterLongPress(onDragStart = { source.start(it) },
                onDrag = { change, delta -> change.consume(); source.move(delta) },
                onDragEnd = { source.finish(false) }, onDragCancel = { source.finish(true) })
        })
}
