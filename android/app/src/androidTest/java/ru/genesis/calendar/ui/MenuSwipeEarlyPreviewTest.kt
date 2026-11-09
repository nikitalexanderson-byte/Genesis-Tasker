package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity

class MenuSwipeEarlyPreviewTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun previewStartsBeforeHalfPageAndCancellationRestoresSelection() {
        val current = mutableStateOf(SwipeDestination("Today"))
        val preview = mutableStateOf(SwipeDestination("Today"))
        val sequence = listOf(SwipeDestination("Today"), SwipeDestination("Affairs"))
        compose.setContent {
            MenuSwipePager(current.value, sequence, true,
                onNavigate = { current.value = it }, onPreview = { preview.value = it },
                modifier = Modifier.testTag("pager")) { destination -> Box { Text(destination.page) } }
        }
        compose.mainClock.autoAdvance = false
        try {
            compose.onNodeWithTag("pager").performTouchInput {
                down(center)
                advanceEventTime(32)
                moveTo(Offset(center.x - width * .20f, center.y))
            }
            compose.mainClock.advanceTimeBy(64)
            compose.runOnIdle {
                assertEquals(SwipeDestination("Affairs"), preview.value)
                assertEquals(SwipeDestination("Today"), current.value)
            }
            compose.onNodeWithTag("pager").performTouchInput {
                advanceEventTime(180)
                moveTo(center)
                advanceEventTime(180)
                up()
            }
        } finally { compose.mainClock.autoAdvance = true }
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(SwipeDestination("Today"), current.value)
            assertEquals(SwipeDestination("Today"), preview.value)
        }
    }
}
