package ru.genesis.calendar.ui

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

/** Hovering a destination steadies it for a drop, except at the outer edge where
 * holding the pointer must still make distant destinations reachable. */
internal fun personalDragScrollDirection(pointerY: Float, top: Float, bottom: Float,
    edge: Float, overDestination: Boolean): Float {
    if (!pointerY.isFinite() || !top.isFinite() || !bottom.isFinite() || !edge.isFinite() ||
        edge <= 0f || bottom <= top) return 0f
    val continueEdge = edge / 3f
    return when {
        pointerY < top + continueEdge -> -1f
        pointerY > bottom - continueEdge -> 1f
        overDestination -> 0f
        pointerY < top + edge -> -1f
        pointerY > bottom - edge -> 1f
        else -> 0f
    }
}

/** Pixels per second, independent of density and frame rate. Move inward to stop on a destination. */
internal fun workspaceDragScrollVelocity(pointer: Float, start: Float, end: Float,
    edge: Float, maxSpeed: Float, overDestination: Boolean = false): Float {
    if (!maxSpeed.isFinite() || maxSpeed <= 0f) return 0f
    val safeEdge = min(edge, (end - start) / 2f)
    val direction = personalDragScrollDirection(pointer, start, end, safeEdge, overDestination)
    if (direction == 0f) return 0f
    val distance = if (direction < 0) pointer - start else end - pointer
    val penetration = (1f - distance / safeEdge).coerceIn(0f, 1f)
    return direction * maxSpeed * penetration * penetration
}

/** A horizontal board gesture stays on that axis while moving inward to drop.
 * Leaving the board vertically releases it so the same held task can reach projects. */
internal class WorkspaceBoardDragAxis {
    private var horizontal = false

    fun preferHorizontal(x: Float, y: Float, left: Float, top: Float, right: Float,
        bottom: Float, edge: Float): Boolean {
        if (!x.isFinite() || !y.isFinite() || !left.isFinite() || !top.isFinite() ||
            !right.isFinite() || !bottom.isFinite() || !edge.isFinite() || edge <= 0f ||
            right <= left || bottom <= top || y < top || y > bottom) {
            horizontal = false
            return false
        }
        val safeEdge = min(edge, (right - left) / 2f)
        if (x < left + safeEdge || x > right - safeEdge) horizontal = true
        return horizontal
    }
}

/** A delayed frame cannot cause a large jump. Stopping is immediate so the drop target stays put. */
internal class WorkspaceDragScrollMotion(private val acceleration: Float) {
    private var velocity = 0f
    private var previousFrame: Long? = null

    fun step(frameNanos: Long, targetVelocity: Float): Float {
        val previous = previousFrame
        previousFrame = frameNanos
        if (!targetVelocity.isFinite() || targetVelocity == 0f) { velocity = 0f; return 0f }
        if (previous == null || frameNanos <= previous) return 0f
        val seconds = ((frameNanos - previous) / 1_000_000_000f).coerceAtMost(.032f)
        if (velocity.sign != targetVelocity.sign) velocity = 0f
        val distance = targetVelocity - velocity
        velocity += distance.sign * min(abs(distance), acceleration * seconds)
        return velocity * seconds
    }
}
