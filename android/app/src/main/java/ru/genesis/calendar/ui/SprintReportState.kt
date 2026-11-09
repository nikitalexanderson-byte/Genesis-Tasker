package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.SprintReportProtocol

/** Only aggregates survive a temporary disconnection, in this screen's memory. */
internal class SprintReportState(private val controller: SharedWorkspaceGateway, private val project: String,
    private val sprint: String, initialUnit: String, private val onLost: () -> Unit) {
    var unit by mutableStateOf(initialUnit.takeIf { it in SprintReportProtocol.units } ?: "tasks"); private set
    var report by mutableStateOf<JSONObject?>(null); private set
    var sources by mutableStateOf<JSONObject?>(null); private set
    var selection by mutableStateOf<JSONObject?>(null); private set
    var task by mutableStateOf<JSONObject?>(null); private set
    var busy by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var pane by mutableStateOf("overview")
    private var generation = 0L
    private var closed = false
    private var checking = false
    val offline get() = report?.optBoolean("offlineCache") == true
    val ready get() = !closed && !lost && !busy && report != null && !offline
    private fun current(version: Long) = !closed && generation == version
    private fun clearSources() { sources = null; selection = null; task = null }
    private fun begin(): Long { generation++; checking = false; busy = true; error = ""; return generation }
    private fun code(failure: Exception) = when (failure) {
        is AuthApiError -> failure.code.takeIf { it in SprintReportProtocol.errors } ?: "SPRINT_REPORT_INVALID"
        is AuthFailure -> failure.kind.name
        else -> failure.message?.takeIf { it in SprintReportProtocol.errors } ?: "SPRINT_REPORT_INVALID"
    }
    private fun fail(failure: Exception, stale: JSONObject? = report, sourceTask: Boolean = false) {
        if (failure is CancellationException) throw failure
        generation++; checking = false; busy = false; clearSources(); error = code(failure)
        when {
            sourceTask && failure is AuthFailure && failure.kind == AuthFailure.Kind.NOT_DEPLOYED -> { report = null; error = "SOURCE_UNAVAILABLE" }
            failure is AuthFailure && failure.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED) -> {
                report = null; lost = true; onLost()
            }
            failure is AuthFailure && failure.kind == AuthFailure.Kind.NETWORK -> report = stale?.let(SprintReportProtocol::offline)
            else -> report = null
        }
    }
    suspend fun refresh(nextUnit: String = unit) {
        if (closed || lost) return
        require(nextUnit in SprintReportProtocol.units)
        val stale = report?.takeIf { it.getJSONObject("flow").getString("unit") == nextUnit }
        val version = begin(); unit = nextUnit; report = null; clearSources()
        try {
            val result = controller.sharedSprintReport(project, sprint, nextUnit)
            if (current(version)) {
                require(!result.optBoolean("offlineCache")) { "SPRINT_REPORT_INVALID" }
                report = SprintReportProtocol.snapshot(project, sprint, nextUnit, result)
            }
        } catch (failure: Exception) { if (current(version)) fail(failure, stale) else if (failure is CancellationException) throw failure }
        finally { if (current(version)) busy = false }
    }
    fun goOffline() {
        if (closed || lost) return
        generation++; checking = false; busy = false; clearSources(); error = "NETWORK"
        report = report?.let(SprintReportProtocol::offline)
    }
    suspend fun check() {
        val live = report ?: return
        if (!ready || checking) return
        val version = generation; checking = true
        try {
            val result = controller.checkSharedSprintReport(project, sprint, live.getString("token"))
            if (current(version)) require(result.opt("unchanged") == true) { "SPRINT_REPORT_INVALID" }
        } catch (failure: Exception) { if (current(version)) fail(failure) else if (failure is CancellationException) throw failure }
        finally { if (current(version)) checking = false }
    }
    suspend fun choose(query: JSONObject, more: Boolean = false) {
        val live = report ?: return
        if (closed || lost || offline) return
        val normalized = SprintReportProtocol.query(query.getString("kind"), query.optString("metric", "scope"), query.optString("date").takeIf { it.isNotEmpty() })
        val previous = if (more) sources else null
        if (more && (previous == null || previous.isNull("nextCursor"))) return
        val version = begin(); selection = normalized; task = null; pane = "sources"
        if (!more) sources = null
        try {
            val result = controller.sharedSprintReportSources(project, sprint, live.getString("token"), normalized, previous?.optString("nextCursor"))
            if (current(version)) sources = SprintReportProtocol.sources(live, normalized, result, previous)
        } catch (failure: Exception) { if (current(version)) fail(failure) else if (failure is CancellationException) throw failure }
        finally { if (current(version)) busy = false }
    }
    suspend fun openTask(reference: JSONObject) {
        val live = report ?: return
        if (closed || lost || offline) return
        val targetProject = reference.getString("projectId"); val target = reference.getString("id"); val archived = reference.getBoolean("archived")
        val version = begin(); task = null; var readingTask = false
        try {
            val checked = controller.checkSharedSprintReport(project, sprint, live.getString("token"))
            if (!current(version)) return
            require(checked.opt("unchanged") == true) { "SPRINT_REPORT_INVALID" }
            readingTask = true
            val response = controller.sharedSprintSourceTask(targetProject, target, archived)
            require(!response.optBoolean("offlineCache")) { "SPRINT_REPORT_INVALID" }
            val result = response.getJSONObject("task")
            if (current(version)) {
                require(result.getString("projectId") == targetProject && result.getString("id") == target) { "SPRINT_REPORT_INVALID" }
                task = JSONObject(result.toString())
            }
        } catch (failure: Exception) { if (current(version)) fail(failure, sourceTask = readingTask) else if (failure is CancellationException) throw failure }
        finally { if (current(version)) busy = false }
    }
    fun backToSources() { task = null }
    fun closeSources() { generation++; checking = false; busy = false; clearSources(); pane = "overview" }
    fun close() { closed = true; generation++; checking = false; busy = false; report = null; clearSources() }
}
