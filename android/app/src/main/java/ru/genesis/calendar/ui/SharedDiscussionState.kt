package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway

/** One task owns this state. Reads and acknowledged sends cannot overwrite one another. */
internal class SharedDiscussionState(private val gateway: SharedWorkspaceGateway,
    private val project: String, private val task: String) {
    var comments by mutableStateOf(emptyList<JSONObject>()); private set
    var loading by mutableStateOf(false); private set
    var sending by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var sendError by mutableStateOf(false); private set
    var hasMore by mutableStateOf(false); private set
    var offline by mutableStateOf(false); private set
    private var before = ""
    private var active = true
    private val mutex = Mutex()
    fun close() { active = false; comments = emptyList() }
    private suspend fun checkActive() {
        currentCoroutineContext().ensureActive()
        if (!active) throw CancellationException()
    }
    private fun rows(page: JSONObject): List<JSONObject> {
        val array = page.getJSONArray("comments")
        return (0 until array.length()).map(array::getJSONObject).also { rows ->
            require(rows.all { it.optString("id").isNotBlank() && it.opt("body") is String } &&
                rows.map { it.getString("id") }.distinct().size == rows.size) { "SHARED_COMMENTS_PROTOCOL" }
        }
    }
    private fun merge(incoming: List<JSONObject>) {
        comments = (comments + incoming).associateBy { it.getString("id") }.values
            .sortedWith(compareBy({ it.optString("createdAt") }, { it.getString("id") }))
    }
    suspend fun refresh(older: Boolean = false) = mutex.withLock {
        checkActive()
        if (older && !hasMore) return@withLock
        loading = true
        try {
            val page = if (older) gateway.olderSharedComments(project, task, before) else gateway.sharedComments(project, task)
            checkActive()
            val incoming = rows(page)
            // Preserve an expanded history while refreshing the newest window.
            if (!loaded || older) {
                hasMore = page.optBoolean("hasMore")
                before = page.optString("nextBefore").takeUnless { it == "null" }.orEmpty()
                require(!hasMore || before.isNotBlank()) { "SHARED_COMMENTS_PROTOCOL" }
            }
            merge(incoming); loaded = true; offline = page.optBoolean("offlineCache"); error = ""
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            checkActive()
            if (workflowAccessLost(failure)) { comments = emptyList(); loaded = false; hasMore = false }
            error = failure.message ?: "NETWORK"
        } finally { loading = false }
    }
    suspend fun send(body: String, onAcknowledged: () -> Unit) {
        checkActive(); if (body.isBlank() || sending) return
        sending = true; sendError = false
        try { mutex.withLock {
            checkActive()
            val reply = gateway.addSharedComment(project, task, body.trim()).getJSONObject("comment")
            checkActive()
            require(reply.optString("id").isNotBlank() && reply.optString("body") == body.trim()) { "SHARED_COMMENTS_PROTOCOL" }
            merge(listOf(reply)); onAcknowledged()
        } } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { checkActive(); sendError = true }
        finally { sending = false }
    }
}
