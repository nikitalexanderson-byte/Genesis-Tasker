package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalDragScrollTest {
    @Test fun holdingAtEitherOuterEdgeCanPassAnIntermediateDestination() {
        assertEquals(1f, personalDragScrollDirection(992f, 0f, 1000f, 72f, true))
        assertEquals(-1f, personalDragScrollDirection(8f, 0f, 1000f, 72f, true))
    }
    @Test fun movingInwardSteadiesTheDestinationBeforeDrop() {
        assertEquals(0f, personalDragScrollDirection(950f, 0f, 1000f, 72f, true))
        assertEquals(0f, personalDragScrollDirection(50f, 0f, 1000f, 72f, true))
        assertEquals(0f, personalDragScrollDirection(500f, 0f, 1000f, 72f, false))
    }
    @Test fun emptyEdgeStillScrollsAndCoordinatesRespectTheViewportAndDock() {
        assertEquals(1f, personalDragScrollDirection(950f, 0f, 1000f, 72f, false))
        assertEquals(-1f, personalDragScrollDirection(50f, 0f, 1000f, 72f, false))
        assertEquals(1f, personalDragScrollDirection(1995f, 290f, 2020f, 189f, true))
    }
    @Test fun speedRampsWithEdgeProximityAndStopsOverAnInwardDestination() {
        val near = workspaceDragScrollVelocity(940f, 0f, 1000f, 72f, 720f)
        val far = workspaceDragScrollVelocity(990f, 0f, 1000f, 72f, 720f)
        assertTrue(near > 0f && near < far && far < 720f)
        assertEquals(-far, workspaceDragScrollVelocity(10f, 0f, 1000f, 72f, 720f), .001f)
        assertEquals(0f, workspaceDragScrollVelocity(950f, 0f, 1000f, 72f, 720f, true), 0f)
    }
    @Test fun sameGestureTravelsTheSameDistanceAt60And120Hz() {
        fun distance(fps: Int): Float {
            val motion = WorkspaceDragScrollMotion(2400f)
            return (0..fps * 2).sumOf { frame ->
                motion.step(frame * 1_000_000_000L / fps, 720f).toDouble()
            }.toFloat()
        }
        assertEquals(distance(60), distance(120), 4f)
    }
    @Test fun suspensionCannotJumpAndMovingInwardStopsImmediately() {
        val motion = WorkspaceDragScrollMotion(2400f)
        assertEquals(0f, motion.step(0L, 720f), 0f)
        repeat(60) { motion.step((it + 1) * 16_666_667L, 720f) }
        assertTrue(motion.step(9_000_000_000L, 720f) <= 720f * .032f)
        assertEquals(0f, motion.step(9_016_666_667L, 0f), 0f)
        assertTrue(motion.step(9_033_333_334L, -720f) in -1f..0f)
    }
    @Test fun invalidOrUnmeasuredViewportsDoNotMove() {
        assertEquals(0f, workspaceDragScrollVelocity(Float.NaN, 0f, 1000f, 72f, 720f), 0f)
        assertEquals(0f, workspaceDragScrollVelocity(990f, 0f, 0f, 72f, 720f), 0f)
        assertEquals(0f, workspaceDragScrollVelocity(990f, 0f, 1000f, 0f, 720f), 0f)
    }
    @Test fun eitherBoardCornerSelectsHorizontalScrolling() {
        assertTrue(WorkspaceBoardDragAxis().preferHorizontal(8f, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertTrue(WorkspaceBoardDragAxis().preferHorizontal(992f, 580f, 0f, 100f, 1000f, 600f, 72f))
    }
    @Test fun movingInwardToStopAndReleaseKeepsTheBoardSteady() {
        val axis = WorkspaceBoardDragAxis()
        assertTrue(axis.preferHorizontal(992f, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertTrue(axis.preferHorizontal(500f, 350f, 0f, 100f, 1000f, 600f, 72f))
        assertTrue(axis.preferHorizontal(650f, 120f, 0f, 100f, 1000f, 600f, 72f))
    }
    @Test fun leavingAboveTheBoardAllowsTheSameTaskToReachProjects() {
        val axis = WorkspaceBoardDragAxis()
        assertTrue(axis.preferHorizontal(992f, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertEquals(false, axis.preferHorizontal(500f, 99f, 0f, 100f, 1000f, 600f, 72f))
        assertEquals(false, axis.preferHorizontal(500f, 120f, 0f, 100f, 1000f, 600f, 72f))
    }
    @Test fun leavingBelowTheBoardAlsoRestoresPageScrolling() {
        val axis = WorkspaceBoardDragAxis()
        assertTrue(axis.preferHorizontal(8f, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertEquals(false, axis.preferHorizontal(500f, 601f, 0f, 100f, 1000f, 600f, 72f))
        assertTrue(axis.preferHorizontal(8f, 580f, 0f, 100f, 1000f, 600f, 72f))
    }
    @Test fun aVerticalGestureDoesNotAcquireHorizontalPriorityInTheBoardCenter() {
        assertEquals(false, WorkspaceBoardDragAxis().preferHorizontal(500f, 120f, 0f, 100f, 1000f, 600f, 72f))
    }
    @Test fun invalidBoardBoundsClearThePreviousAxis() {
        val axis = WorkspaceBoardDragAxis()
        assertTrue(axis.preferHorizontal(992f, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertEquals(false, axis.preferHorizontal(992f, 120f, 0f, 0f, 0f, 0f, 72f))
        assertEquals(false, axis.preferHorizontal(Float.NaN, 120f, 0f, 100f, 1000f, 600f, 72f))
        assertEquals(false, axis.preferHorizontal(500f, 350f, 0f, 100f, 1000f, 600f, 72f))
    }
}
