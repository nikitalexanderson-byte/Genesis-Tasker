package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.TeamReportProtocol

/** Read-only in-memory report; stale/offline responses never leave active task links behind. */
internal class TeamReportState(private val gateway: SharedWorkspaceGateway, initial: JSONObject, private val onLost: () -> Unit) {
    var options by mutableStateOf(JSONObject(initial.toString())); private set
    var report by mutableStateOf<JSONObject?>(null); private set
    var catalog by mutableStateOf<JSONObject?>(null); private set
    var sources by mutableStateOf<JSONObject?>(null); private set
    var task by mutableStateOf<JSONObject?>(null); private set
    var metric by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    private var generation = 0L; private var closed = false; private var checking = false
    val ready get() = !closed && !lost && !busy && report != null
    private fun current(version: Long) = !closed && !lost && generation == version
    private fun clear(privateData: Boolean = false) { report = null; sources = null; task = null; metric = null; if (privateData) catalog = null }
    private fun begin(): Long { generation++; checking = false; busy = true; error = ""; return generation }
    private fun cancelled(version: Long) {
        if (current(version)) { generation++; busy = false; checking = false; clear(privateData = true) }
    }
    private fun failure(reason: Exception) {
        if (reason is CancellationException) throw reason
        generation++; busy = false; checking = false; clear(privateData = true)
        error = when (reason) { is AuthFailure -> reason.kind.name; is AuthApiError -> reason.code; else -> reason.message?.takeIf { it in TeamReportProtocol.errors } ?: "REPORT_INVALID" }
        if (reason is AuthFailure && reason.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED)) { lost = true; onLost() }
    }
    fun change(next: JSONObject) {
        if (closed || lost) return
        generation++; checking = false; busy = false; clear(); options = JSONObject(next.toString()); error = ""
    }
    suspend fun refresh() {
        if (closed || lost) return
        val version = begin(); clear()
        try {
            val frozen = TeamReportProtocol.options(options)
            val result = gateway.sharedTeamReport(frozen)
            val parsed = withContext(Dispatchers.Default) { TeamReportProtocol.snapshot(frozen, result) }
            if (current(version)) {
                report = parsed
                catalog = parsed.getJSONObject("catalog")
            }
        } catch (reason: Exception) { if (reason is CancellationException) { cancelled(version); throw reason }; if (current(version)) failure(reason) }
        finally { if (current(version)) busy = false }
    }
    suspend fun check() {
        val live = report ?: return
        if (!ready || checking) return
        val version = generation; checking = true
        try { val result = gateway.checkSharedTeamReport(live.getString("token")); if (current(version)) TeamReportProtocol.check(result) }
        catch (reason: Exception) { if (reason is CancellationException) { cancelled(version); throw reason }; if (current(version)) failure(reason) }
        finally { if (current(version)) checking = false }
    }
    fun goOffline() { if (!closed && !lost) { generation++; busy = false; checking = false; clear(privateData = true); error = "NETWORK" } }
    suspend fun choose(key: String, more: Boolean = false) {
        val live = report ?: return
        if (!ready) return
        val previous = if (more && metric == key) sources?.takeUnless { it.isNull("nextCursor") } else null
        if (more && previous == null) return
        val version = begin(); metric = key; task = null; if (!more) sources = null
        try {
            val query = TeamReportProtocol.taskQuery(live, key, previous?.getString("nextCursor"))
            val result = gateway.sharedTeamReportTasks(query.getString("token"), key, previous?.getString("nextCursor"))
            val parsed = withContext(Dispatchers.Default) { TeamReportProtocol.sources(live, key, result, previous) }
            if (current(version)) sources = parsed
        } catch (reason: Exception) { if (reason is CancellationException) { cancelled(version); throw reason }; if (current(version)) failure(reason) }
        finally { if (current(version)) busy = false }
    }
    suspend fun openTask(reference: JSONObject) {
        val live = report ?: return; val page = sources ?: return
        if (!ready) return
        val id = reference.getString("id"); val project = reference.getString("projectId")
        require((0 until page.getJSONArray("tasks").length()).any { page.getJSONArray("tasks").getJSONObject(it).let { row -> row.getString("id") == id && row.getString("projectId") == project } })
        val version = begin(); task = null
        try {
            val checked = gateway.checkSharedTeamReport(live.getString("token")); if (!current(version)) return
            TeamReportProtocol.check(checked)
            val result = gateway.sharedSprintSourceTask(project, id, !reference.isNull("archivedAt"))
            val parsed = withContext(Dispatchers.Default) {
                require(!result.optBoolean("offlineCache")) { "REPORT_INVALID" }
                val value = result.getJSONObject("task"); require(value.opt("id") == id && value.opt("projectId") == project) { "REPORT_INVALID" }
                JSONObject(value.toString())
            }
            if (current(version)) task = parsed
        } catch (reason: Exception) { if (reason is CancellationException) { cancelled(version); throw reason }; if (current(version)) failure(reason) }
        finally { if (current(version)) busy = false }
    }
    fun back() { generation++; checking = false; busy = false; if (task != null) task = null else { sources = null; metric = null } }
    fun close() { closed = true; generation++; busy = false; checking = false; clear(privateData = true) }
}
