package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.SharedWorkspaceGateway

class SharedDiscussionStateTest {
    private fun comment(id: String, body: String = id) = JSONObject().put("id", id).put("body", body).put("createdAt", id)
    private fun page(vararg ids: String, more: Boolean = false) = JSONObject().put("comments", JSONArray(ids.map { comment(it) }))
        .put("hasMore", more).put("nextBefore", if (more) ids.first() else JSONObject.NULL)

    @Test fun repeatedTapWhileSendingDoesNotQueueADuplicateMessage() = runBlocking {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var sends = 0
        val state = SharedDiscussionState(object : SharedWorkspaceGateway {
            override suspend fun addSharedComment(projectId: String, taskId: String, body: String): JSONObject {
                sends++; entered.complete(Unit); release.await(); return JSONObject().put("comment", comment("01", body))
            }
        }, "p", "t")
        val first = async { state.send("Only once") {} }; entered.await()
        state.send("Only once") {}; release.complete(Unit); first.await()
        assertEquals(1, sends); assertEquals(1, state.comments.size)
    }

    @Test fun historyAndFreshArrivalsMergeWithoutDuplicatesOrLosingTheOlderCursor() = runBlocking {
        var fresh = page("06", "07", more = true)
        var cursor = ""
        val state = SharedDiscussionState(object : SharedWorkspaceGateway {
            override suspend fun sharedComments(projectId: String, taskId: String) = fresh
            override suspend fun olderSharedComments(projectId: String, taskId: String, before: String): JSONObject {
                cursor = before; return page("01", "02", "03", "04", "05")
            }
        }, "p", "t")
        state.refresh(); fresh = page("06", "07", "08", more = true); state.refresh(); state.refresh(true)
        assertEquals("06", cursor)
        assertEquals((1..8).map { "0$it" }, state.comments.map { it.getString("id") })
        assertFalse(state.hasMore)
        state.refresh(); assertFalse(state.hasMore)
    }

    @Test fun anAcknowledgedSendRemainsVisibleEvenWhenTheNextRefreshFails() = runBlocking {
        var acknowledged = false
        val state = SharedDiscussionState(object : SharedWorkspaceGateway {
            override suspend fun addSharedComment(projectId: String, taskId: String, body: String) =
                JSONObject().put("comment", comment("01", body))
            override suspend fun sharedComments(projectId: String, taskId: String): JSONObject = error("NETWORK")
        }, "p", "t")
        state.send("Draft") { acknowledged = true }; state.refresh()
        assertTrue(acknowledged); assertEquals("Draft", state.comments.single().getString("body"))
        assertTrue(state.error.isNotBlank()); assertFalse(state.sendError)
    }

    @Test fun failedOrMalformedAcknowledgementsPreserveTheDraftAndDoNotInventAMessage() = runBlocking {
        for (malformed in listOf(false, true)) {
            val state = SharedDiscussionState(object : SharedWorkspaceGateway {
                override suspend fun addSharedComment(projectId: String, taskId: String, body: String): JSONObject =
                    if (malformed) JSONObject().put("comment", comment("01", "another message")) else error("NETWORK")
            }, "p", "t")
            var cleared = false; state.send("Keep me") { cleared = true }
            assertFalse(cleared); assertTrue(state.sendError); assertTrue(state.comments.isEmpty()); assertFalse(state.sending)
        }
    }

    @Test fun aLateResponseCannotPopulateAClosedTask() = runBlocking {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val state = SharedDiscussionState(object : SharedWorkspaceGateway {
            override suspend fun sharedComments(projectId: String, taskId: String): JSONObject {
                entered.complete(Unit); release.await(); return page("01")
            }
        }, "p", "old")
        val request = async { runCatching { state.refresh() } }; entered.await(); state.close(); release.complete(Unit)
        assertTrue(request.await().exceptionOrNull() is CancellationException); assertTrue(state.comments.isEmpty())
    }
}
