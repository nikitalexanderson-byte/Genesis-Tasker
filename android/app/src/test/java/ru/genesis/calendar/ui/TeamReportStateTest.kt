package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*

class TeamReportStateTest {
    private class Gateway : SharedWorkspaceGateway {
        var reportGate: CompletableDeferred<JSONObject>? = null; var pageGate: CompletableDeferred<JSONObject>? = null
        var failure: Exception? = null; var checkFailure: Exception? = null; var pageCalls = 0; var reads = 0; var checks = 0
        override suspend fun sharedTeamReport(options: JSONObject): JSONObject { failure?.let { throw it }; return reportGate?.await() ?: teamReportFixture("report") }
        override suspend fun checkSharedTeamReport(token: String): JSONObject { checks++; checkFailure?.let { throw it }; return JSONObject().put("unchanged", true) }
        override suspend fun sharedTeamReportTasks(token: String, metric: String, cursor: String?): JSONObject {
            pageCalls++; return pageGate?.await() ?: teamReportFixture(if (cursor == null) "first" else "last")
        }
        override suspend fun sharedSprintSourceTask(projectId: String, taskId: String, archived: Boolean): JSONObject {
            reads++; return JSONObject().put("task", JSONObject().put("id", taskId).put("projectId", projectId).put("title", "Synthetic source task"))
        }
    }
    @Test fun sourcePagingAndTaskReadsUseTheAcceptedTokenAndRecheckBeforeOpening() = runBlocking {
        val gateway = Gateway(); val state = TeamReportState(gateway, teamReportFixture("options")) {}
        state.refresh(); assertTrue(state.ready); state.choose("all"); state.choose("all", true)
        assertEquals(121, state.sources!!.getJSONArray("tasks").length()); assertEquals(2, gateway.pageCalls)
        state.openTask(state.sources!!.getJSONArray("tasks").getJSONObject(0)); assertNotNull(state.task)
        assertEquals(1, gateway.checks); assertEquals(1, gateway.reads)
        state.back(); assertNull(state.task); assertNotNull(state.sources); state.back(); assertNull(state.sources); assertTrue(state.ready)
    }
    @Test fun aLateReportCannotRestoreResultsAfterOptionsChangeOrScreenClose() = runBlocking {
        for (close in listOf(false, true)) {
            val gateway = Gateway().apply { reportGate = CompletableDeferred() }; val state = TeamReportState(gateway, teamReportFixture("options")) {}
            val request = launch { state.refresh() }; yield(); assertTrue(state.busy)
            if (close) state.close() else state.change(JSONObject(state.options.toString()).put("from", "2026-10-02"))
            gateway.reportGate!!.complete(teamReportFixture("report")); request.join()
            assertNull(state.report); assertFalse(state.busy); assertFalse(state.ready)
            if (!close) assertEquals("2026-10-02", state.options.getString("from"))
        }
    }
    @Test fun offlineDropsPendingPagesAndPreservesOnlyTheConditions() = runBlocking {
        val gateway = Gateway(); val state = TeamReportState(gateway, teamReportFixture("options")) {}
        state.refresh(); gateway.pageGate = CompletableDeferred(); val request = launch { state.choose("all") }; yield()
        state.goOffline(); gateway.pageGate!!.complete(teamReportFixture("first")); request.join()
        assertNull(state.report); assertNull(state.sources); assertEquals("NETWORK", state.error)
        assertEquals("sacred", state.options.getString("calendarMode")); assertFalse(state.ready)
    }
    @Test fun changedRightsOrSourceRevisionsClearPrivateDataBeforeAnyTaskRead() = runBlocking {
        for (reason in listOf(AuthApiError("REPORT_CHANGED"), AuthFailure(AuthFailure.Kind.UNAUTHORIZED))) {
            val gateway = Gateway(); var lost = 0; val state = TeamReportState(gateway, teamReportFixture("options")) { lost++ }
            state.refresh(); state.choose("all"); val reference = state.sources!!.getJSONArray("tasks").getJSONObject(0)
            gateway.checkFailure = reason; state.openTask(reference)
            assertEquals(0, gateway.reads); assertNull(state.report); assertNull(state.sources); assertNull(state.task)
            assertEquals(if (reason is AuthFailure) 1 else 0, lost)
        }
    }
    @Test fun unknownMetricCannotBecomeAnUnfilteredRequestAndErrorsKeepTheConditions() = runBlocking {
        val gateway = Gateway(); val state = TeamReportState(gateway, teamReportFixture("options")) {}
        state.refresh(); state.choose("untrusted:all"); assertEquals(0, gateway.pageCalls); assertEquals("REPORT_METRIC_INVALID", state.error)
        assertNull(state.report); assertEquals("2026-10-01", state.options.getString("from"))
        gateway.failure = AuthFailure(AuthFailure.Kind.NETWORK); state.refresh(); assertEquals("NETWORK", state.error); assertNull(state.sources)
    }
    @Test fun aControllerScopeCancellationPurgesAnAlreadyDisplayedReport() = runBlocking {
        val gateway = Gateway(); val state = TeamReportState(gateway, teamReportFixture("options")) {}
        state.refresh(); state.choose("all"); assertNotNull(state.catalog)
        gateway.checkFailure = CancellationException("Synthetic scope replaced")
        assertTrue(runCatching { state.check() }.exceptionOrNull() is CancellationException)
        assertNull(state.report); assertNull(state.sources); assertNull(state.catalog); assertFalse(state.ready)
        assertEquals("2026-10-01", state.options.getString("from"))
    }
}
