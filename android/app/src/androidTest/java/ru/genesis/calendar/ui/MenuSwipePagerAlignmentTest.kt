package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity

class MenuSwipePagerAlignmentTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun hidingEarlierMenuItemKeepsTheCurrentDestination() {
        val current = mutableStateOf(SwipeDestination("Settings"))
        val sequence = mutableStateOf(listOf(SwipeDestination("Today"),
            SwipeDestination("Tasks"), SwipeDestination("Settings")))
        val navigation = mutableStateListOf<SwipeDestination>()
        compose.setContent {
            MenuSwipePager(current.value, sequence.value, true,
                onNavigate = { navigation.add(it); current.value = it },
                modifier = Modifier.testTag("menu-pager")) { destination ->
                Box { Text(destination.page, Modifier.testTag("page-${destination.page}")) }
            }
        }
        compose.onNodeWithTag("page-Settings").assertExists()
        compose.runOnIdle {
            sequence.value = listOf(SwipeDestination("Today"), SwipeDestination("Settings"))
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(SwipeDestination("Settings"), current.value)
            assertEquals(emptyList<SwipeDestination>(), navigation.toList())
        }
        compose.onNodeWithTag("page-Settings").assertExists()
        compose.onNodeWithTag("menu-pager").performTouchInput { swipeRight() }
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(SwipeDestination("Today"), current.value) }
    }
}
