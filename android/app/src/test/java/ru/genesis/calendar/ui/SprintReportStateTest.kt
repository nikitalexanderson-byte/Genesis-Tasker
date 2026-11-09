package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*

class SprintReportStateTest {
    private class Gateway : SharedWorkspaceGateway {
        var failure: Exception? = null
        var reply: suspend (String) -> JSONObject = { sprintReportFixture(it) }
        var source: suspend (String?) -> JSONObject = { cursor -> page(if (cursor == null) 0 else 100, if (cursor == null) 100 else 131) }
        var check: suspend () -> JSONObject = { JSONObject().put("unchanged", true) }
        var actual: suspend () -> JSONObject = { JSONObject().put("task", task(1)) }
        val reads = mutableListOf<Triple<String, String, Boolean>>()
        override suspend fun sharedSprintReport(projectId: String, sprintId: String, unit: String): JSONObject { failure?.let { throw it }; return reply(unit) }
        override suspend fun sharedSprintReportSources(projectId: String, sprintId: String, token: String, query: JSONObject, cursor: String?): JSONObject {
            failure?.let { throw it }; return source(cursor)
        }
        override suspend fun checkSharedSprintReport(projectId: String, sprintId: String, token: String): JSONObject { failure?.let { throw it }; return check() }
        override suspend fun sharedSprintSourceTask(projectId: String, taskId: String, archived: Boolean): JSONObject {
            reads.add(Triple(projectId, taskId, archived)); failure?.let { throw it }; return actual()
        }
    }
    companion object {
        private fun task(index: Int) = JSONObject().put("id", "task-$index").put("projectId", "current-project").put("title", "Текущая задача").put("revision", 2).put("archived", true)
        private fun page(from: Int, to: Int) = JSONObject().put("asOf", "2026-10-20T08:00:00Z").put("items", JSONArray((from until to).map(::task)))
            .put("total", 131).put("unavailable", 0).put("nextCursor", if (to < 131) "next" else JSONObject.NULL)
    }
    private fun state(gateway: Gateway, lost: () -> Unit = {}) = SprintReportState(gateway, "project", "sprint", "points", lost)
    @Test fun delayedUnitResponseCannotReplaceTheNewUnit() = runBlocking {
        val gateway = Gateway(); val delayed = CompletableDeferred<JSONObject>(); gateway.reply = { if (it == "points") delayed.await() else sprintReportFixture(it) }
        val state = state(gateway); val old = launch(start = CoroutineStart.UNDISPATCHED) { state.refresh() }
        state.refresh("hours"); delayed.complete(sprintReportFixture()); old.join()
        assertEquals("hours", state.unit); assertEquals("hours", state.report!!.getJSONObject("flow").getString("unit")); assertFalse(state.busy)
    }
    @Test fun networkKeepsOnlyTheOpenAggregateAndRequiresExplicitRefresh() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.refresh(); state.choose(SprintReportProtocol.query("tasks", "plan"))
        gateway.failure = AuthFailure(AuthFailure.Kind.NETWORK); state.check()
        assertTrue(state.offline); assertNull(state.sources); assertNull(state.task); assertFalse(state.report!!.has("token")); assertFalse(state.ready)
        gateway.failure = null; state.choose(SprintReportProtocol.query("events")); assertNull(state.sources)
        state.refresh(); assertTrue(state.ready); assertFalse(state.offline); assertTrue(state.report!!.has("token"))
    }
    @Test fun noColdOfflineReportCanBeInvented() = runBlocking {
        val gateway = Gateway().apply { failure = AuthFailure(AuthFailure.Kind.NETWORK) }; val state = state(gateway); state.refresh()
        assertNull(state.report); assertEquals("NETWORK", state.error)
    }
    @Test fun revokedAccessClearsAllNamesAndNotifiesParentExactlyOnce() = runBlocking {
        val gateway = Gateway(); var losses = 0; val state = state(gateway) { losses++ }; state.refresh(); state.choose(SprintReportProtocol.query("tasks"))
        gateway.failure = AuthFailure(AuthFailure.Kind.UNAUTHORIZED); state.check(); state.refresh()
        assertTrue(state.lost); assertNull(state.report); assertNull(state.sources); assertNull(state.selection); assertNull(state.task); assertEquals(1, losses)
    }
    @Test fun changedReportAndInvalidCheckDiscardEveryPart() = runBlocking {
        for (changed in listOf(true, false)) {
            val gateway = Gateway(); val state = state(gateway); state.refresh(); state.choose(SprintReportProtocol.query("tasks"))
            if (changed) gateway.failure = AuthApiError("REPORT_CHANGED") else gateway.check = { JSONObject().put("unchanged", false) }
            state.check(); assertNull(state.report); assertNull(state.sources); assertFalse(state.ready)
            assertEquals(if (changed) "REPORT_CHANGED" else "SPRINT_REPORT_INVALID", state.error)
        }
    }
    @Test fun sourcePagesAppendAll131RowsWithoutReissuingAMutation() = runBlocking {
        val state = state(Gateway()); val query = SprintReportProtocol.query("tasks", "plan"); state.refresh(); state.choose(query); state.choose(query, true)
        assertEquals(131, state.sources!!.getJSONArray("items").length()); assertTrue(state.sources!!.isNull("nextCursor"))
    }
    @Test fun delayedSourcesAreDiscardedAfterCloseOrRefresh() = runBlocking {
        for (close in listOf(true, false)) {
            val gateway = Gateway(); val delayed = CompletableDeferred<JSONObject>(); gateway.source = { delayed.await() }
            val state = state(gateway); state.refresh(); val reading = launch(start = CoroutineStart.UNDISPATCHED) { state.choose(SprintReportProtocol.query("tasks")) }
            if (close) state.closeSources() else state.refresh("tasks")
            delayed.complete(page(0, 100)); reading.join(); assertNull(state.sources); assertNull(state.selection); assertFalse(state.busy)
        }
    }
    @Test fun movedArchivedTaskIsReadFreshAfterTokenCheckAndIsNeverPersisted() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.refresh(); state.openTask(task(1))
        assertEquals(listOf(Triple("current-project", "task-1", true)), gateway.reads); assertEquals("Текущая задача", state.task!!.getString("title"))
        state.goOffline(); assertNull(state.task); assertNull(state.sources); assertFalse(state.report!!.has("token"))
    }
    @Test fun changedTokenPreventsAnyActualTaskRead() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); state.refresh(); gateway.failure = AuthApiError("REPORT_CHANGED"); state.openTask(task(1))
        assertTrue(gateway.reads.isEmpty()); assertNull(state.task); assertNull(state.report)
    }
    @Test fun wrongTaskIdentityAndCachedTaskAreRejected() = runBlocking {
        for (cached in listOf(true, false)) {
            val gateway = Gateway(); gateway.actual = { JSONObject().put("task", task(1).put("projectId", if (cached) "current-project" else "wrong")).put("offlineCache", cached) }
            val state = state(gateway); state.refresh(); state.openTask(task(1)); assertNull(state.task); assertEquals("SPRINT_REPORT_INVALID", state.error)
        }
    }
    @Test fun disposalDropsAllDataAndBlocksLateTaskAndReportReplies() = runBlocking {
        val gateway = Gateway(); val delayed = CompletableDeferred<JSONObject>(); gateway.actual = { delayed.await() }
        val state = state(gateway); state.refresh(); val reading = launch(start = CoroutineStart.UNDISPATCHED) { state.openTask(task(1)) }; state.close()
        delayed.complete(JSONObject().put("task", task(1))); reading.join(); state.refresh(); assertNull(state.task); assertNull(state.report)
    }
    @Test fun cancellationIsNotReportedAsServerFailure() = runBlocking {
        val gateway = Gateway().apply { reply = { throw CancellationException() } }; val state = state(gateway)
        assertTrue(runCatching { state.refresh() }.exceptionOrNull() is CancellationException); assertEquals("", state.error); assertFalse(state.busy)
    }
}
