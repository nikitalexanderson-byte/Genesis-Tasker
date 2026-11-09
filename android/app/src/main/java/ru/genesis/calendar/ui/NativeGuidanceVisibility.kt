package ru.genesis.calendar.ui

import android.view.View
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** A composed/claimed item is not a shown item: require actual visible bounds and window focus. */
@Composable
internal fun Modifier.planGuidanceVisibility(key: String, onChanged: (Boolean) -> Unit): Modifier {
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val callback by rememberUpdatedState(onChanged)
    var inViewport by remember(view) { mutableStateOf(false) }
    LaunchedEffect(key, view, lifecycle, inViewport) {
        val report = callback
        withFrameNanos { }
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var reported = false
            try {
                while (isActive) {
                    val visible = inViewport && view.isShown && view.windowVisibility == View.VISIBLE && view.hasWindowFocus()
                    if (visible != reported) { reported = visible; report(visible) }
                    delay(200)
                }
            } finally { if (reported) report(false) }
        }
    }
    return onGloballyPositioned { coordinates ->
        val bounds = coordinates.boundsInWindow()
        val height = (minOf(bounds.bottom, view.height.toFloat()) - maxOf(bounds.top, 0f)).coerceAtLeast(0f)
        val width = (minOf(bounds.right, view.width.toFloat()) - maxOf(bounds.left, 0f)).coerceAtLeast(0f)
        inViewport = coordinates.isAttached && bounds.height > 0f && bounds.width > 0f &&
            height >= minOf(bounds.height * .5f, 120f * view.resources.displayMetrics.density) && width >= bounds.width * .5f
    }
}
