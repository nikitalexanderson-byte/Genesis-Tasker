package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.util.concurrent.CopyOnWriteArrayList

class SharedDiscussionUiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun fiveRecentEntriesStayVisibleAndCollapsedHistoryDoesNotCountAsRead() {
        val reads = CopyOnWriteArrayList<List<String>>()
        val fixture = object : SharedWorkspaceGateway {
            override suspend fun sharedComments(projectId: String, taskId: String) = JSONObject().put("comments", JSONArray((0..7).map {
                JSONObject().put("id", "c$it").put("body", "Message $it").put("authorName", "Author $it")
                    .put("createdAt", "2026-10-28T10:0${it}:00Z")
            }))
            override suspend fun readSharedTaskUpdates(projectId: String, taskId: String, commentIds: List<String>): JSONObject {
                reads.add(commentIds); return JSONObject().put("ok", true)
            }
        }
        compose.setContent {
            MaterialTheme(colorScheme = standart) { Surface {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    SharedTaskDiscussion(fixture, "p", "t", true, false, false, "", {})
                }
            } }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("shared-comment-c7").fetchSemanticsNodes().isNotEmpty() }
        (0..2).forEach { compose.onNodeWithTag("shared-comment-c$it").assertDoesNotExist() }
        (3..7).forEach { compose.onNodeWithTag("shared-comment-c$it").assertExists() }
        compose.onNodeWithTag("shared-comment-c7").performScrollTo()
        compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
        assertFalse(reads.flatten().any { it in listOf("c0", "c1", "c2") })
        compose.onNodeWithTag("shared-comments-history-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("shared-comment-c0").performScrollTo().assertExists()
        compose.mainClock.advanceTimeBy(1000)
        compose.waitUntil(5000) { reads.flatten().contains("c0") }
    }
}
