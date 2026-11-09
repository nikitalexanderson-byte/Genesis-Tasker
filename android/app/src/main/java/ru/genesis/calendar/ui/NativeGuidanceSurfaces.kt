package ru.genesis.calendar.ui

import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput

/** Passive registration never changes existing dialog focus, dismissal or editor state. */
internal class NativeGuidanceSurfaces {
    private val surfaces = mutableStateMapOf<Any, Unit>()
    var lastInteractionAt: Long = SystemClock.elapsedRealtime()
    fun open(owner: Any) { surfaces[owner] = Unit }
    fun close(owner: Any) { surfaces.remove(owner) }
    fun hasOther(owner: Any): Boolean = surfaces.keys.any { it !== owner }
    fun hasAny(): Boolean = surfaces.isNotEmpty()
}

internal val LocalNativeGuidanceSurfaces = staticCompositionLocalOf<NativeGuidanceSurfaces?> { null }
internal val LocalNativeGuidanceSurfaceOwner = staticCompositionLocalOf<Any?> { null }

@Composable
internal fun NativeGuidanceBlockingSurface() {
    val registry = LocalNativeGuidanceSurfaces.current
    val generated = remember { Any() }
    val owner = LocalNativeGuidanceSurfaceOwner.current ?: generated
    DisposableEffect(registry, owner) {
        registry?.open(owner)
        onDispose { registry?.close(owner) }
    }
}

internal fun Modifier.nativeGuidanceInteraction(registry: NativeGuidanceSurfaces): Modifier = pointerInput(registry) {
    awaitPointerEventScope {
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            if (event.changes.any { it.pressed }) registry.lastInteractionAt = SystemClock.elapsedRealtime()
        }
    }
}
