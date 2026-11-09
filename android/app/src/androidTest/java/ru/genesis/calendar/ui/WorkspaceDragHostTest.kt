package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.test.uiautomator.UiDevice
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity

class WorkspaceDragHostTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun movingCardOutOfItsSourceBoardFinishesOnceWithoutDispatchingToDetachedNodes() {
        var moved by mutableStateOf(false)
        var finishes = 0
        compose.setContent {
            MaterialTheme {
                WorkspaceDragHost(Modifier.fillMaxSize().testTag("drag-host")) {
                    Row {
                        for (board in 0..1) key(board) {
                            Box(Modifier.width(140.dp).height(180.dp).testTag("board-$board")) {
                                if ((board == 1) == moved) key("task") {
                                    Box(Modifier.size(100.dp).testTag("drag-task").workspaceDragSource("task",
                                        onStart = {}, onMove = {}, onFinish = { cancelled ->
                                            if (!cancelled) { finishes++; moved = true }
                                        }))
                                }
                            }
                        }
                    }
                }
            }
        }
        val start=compose.onNodeWithTag("drag-task").fetchSemanticsNode().boundsInRoot.center
        val end=compose.onNodeWithTag("board-1").fetchSemanticsNode().boundsInRoot.center
        compose.onNodeWithTag("drag-host").performTouchInput {
            down(start); advanceEventTime(700); moveBy(Offset(1f,0f)); moveTo(end,300); up()
        }
        compose.onNodeWithTag("board-1").onChildren().filter(hasTestTag("drag-task")).assertCountEquals(1)
        compose.runOnIdle { assertEquals(1, finishes) }
    }

    @Test fun cancellationReleasesTheSourceWithoutCommittingAMove() {
        val completions=mutableListOf<Boolean>()
        compose.setContent {
            WorkspaceDragHost(Modifier.fillMaxSize().testTag("drag-host")) {
                Box(Modifier.size(100.dp).testTag("drag-task").workspaceDragSource("task",
                    onStart={},onMove={},onFinish={completions+=it}))
            }
        }
        val start=compose.onNodeWithTag("drag-task").fetchSemanticsNode().boundsInRoot.center
        compose.onNodeWithTag("drag-host").performTouchInput {
            down(start);advanceEventTime(700);moveBy(Offset(20f,0f));cancel()
        }
        compose.runOnIdle { assertEquals(listOf(true),completions) }
    }

    @Test fun pausingTheViewportCancelsExactlyOnceAndResumeCannotCommitTheOldPointer() {
        val completions = mutableListOf<Boolean>()
        val owner = object : LifecycleOwner { override val lifecycle = LifecycleRegistry(this) }
        compose.runOnUiThread { owner.lifecycle.currentState = Lifecycle.State.RESUMED }
        compose.setContent { CompositionLocalProvider(LocalLifecycleOwner provides owner) {
            WorkspaceDragHost(Modifier.fillMaxSize().testTag("drag-host")) {
                Box(Modifier.size(100.dp).testTag("drag-task").workspaceDragSource("task",
                    onStart = {}, onMove = {}, onFinish = { completions += it }))
            }
        } }
        val start = compose.onNodeWithTag("drag-task").fetchSemanticsNode().boundsInRoot.center
        compose.onNodeWithTag("drag-host").performTouchInput { down(start); advanceEventTime(700); moveBy(Offset(10f, 0f)) }
        compose.runOnIdle { owner.lifecycle.currentState = Lifecycle.State.STARTED }
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(listOf(true), completions); owner.lifecycle.currentState = Lifecycle.State.RESUMED }
        compose.onNodeWithTag("drag-host").performTouchInput { up() }
        compose.runOnIdle { assertEquals(listOf(true), completions) }
    }

    @Test fun backCancelsTheGestureInsteadOfClosingTheActivity() {
        val completions = mutableListOf<Boolean>()
        compose.setContent {
            WorkspaceDragHost(Modifier.fillMaxSize().testTag("drag-host")) {
                Box(Modifier.size(100.dp).testTag("drag-task").workspaceDragSource("task",
                    onStart = {}, onMove = {}, onFinish = { completions += it }))
            }
        }
        val start = compose.onNodeWithTag("drag-task").fetchSemanticsNode().boundsInRoot.center
        compose.onNodeWithTag("drag-host").performTouchInput { down(start); advanceEventTime(700); moveBy(Offset(10f, 0f)) }
        compose.waitForIdle()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitForIdle()
        compose.onNodeWithTag("drag-host").assertIsDisplayed()
        compose.onNodeWithTag("drag-host").performTouchInput { up() }
        compose.runOnIdle { assertEquals(listOf(true), completions) }
    }
}
