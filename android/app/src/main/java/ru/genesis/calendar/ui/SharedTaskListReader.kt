package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.auth.*

/** One query identity owns its rows, counts and cursor. Late responses cannot cross it. */
internal class SharedTaskListReader(private val gateway: SharedWorkspaceGateway) {
    val pageState = mutableStateOf<JSONObject?>(null)
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var lost by mutableStateOf(false); private set
    private var identity = ""
    private var epoch = 0
    private var active = true
    private var filter = JSONObject()
    private var sort = "position"
    private val mutex = Mutex()
    fun configure(base: JSONObject, order: String, metadata: String): Int {
        val next = "$base:$order:$metadata"
        active = true
        if (identity != next) { epoch++; identity = next; pageState.value = null; busy = false; error = ""; lost = false }
        filter = JSONObject(base.toString()); sort = order
        return epoch
    }
    fun pause() { active = false; epoch++; busy = false; pageState.value = null }
    private suspend fun current(ticket: Int) {
        currentCoroutineContext().ensureActive()
        if (!active || ticket != epoch) throw CancellationException()
    }
    private suspend fun read(ticket: Int, cursor: String? = null): JSONObject {
        current(ticket)
        val result = gateway.sortedSharedTasks(JSONObject(filter.toString()), cursor, sort)
        current(ticket)
        val rows = result.getJSONArray("tasks")
        val projects = filter.optJSONArray("projectIds")?.let { ids -> (0 until ids.length()).map(ids::getString).toSet() }
        require(result.optString("queryVersion").isNotBlank() && result.opt("hasMore") is Boolean && result.getInt("total") >= rows.length()) { "SHARED_QUERY_PROTOCOL" }
        require(!result.getBoolean("hasMore") || !result.optString("nextCursor").let { it.isBlank() || it == "null" }) { "SHARED_QUERY_PROTOCOL" }
        val ids = mutableSetOf<String>()
        for (index in 0 until rows.length()) {
            val task = rows.getJSONObject(index)
            require(ids.add(task.getString("id")) && (projects == null || task.getString("projectId") in projects)) { "SHARED_QUERY_PROTOCOL" }
        }
        return JSONObject(result.toString())
    }
    private suspend fun operate(work: suspend (Int) -> Unit) = mutex.withLock {
        val ticket = epoch; current(ticket); busy = true
        try { work(ticket); current(ticket); error = "" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(ticket)
            error = when (failure) { is AuthApiError -> failure.code; else -> failure.message ?: "NETWORK" }
            // Never retain rows/counters after a rejected query or an access revocation.
            pageState.value = null
            lost = workflowAccessLost(failure) || error == "SHARED_SPACE_FORBIDDEN"
        } finally { if (ticket == epoch) busy = false }
    }
    suspend fun refresh() = operate { ticket ->
        val loaded = pageState.value?.optJSONArray("tasks")?.length() ?: 0
        var result = read(ticket)
        while (result.getBoolean("hasMore") && result.getJSONArray("tasks").length() < loaded) {
            val next = read(ticket, result.getString("nextCursor"))
            result = mergeSharedTaskPage(result, next, true)
        }
        current(ticket); pageState.value = result
    }
    suspend fun more() = operate { ticket ->
        val previous = pageState.value ?: return@operate
        if (!previous.getBoolean("hasMore")) return@operate
        try { pageState.value = mergeSharedTaskPage(previous, read(ticket, previous.getString("nextCursor")), true) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if ((failure as? AuthApiError)?.code != "SHARED_QUERY_CHANGED" && failure.message != "SHARED_QUERY_CHANGED") throw failure
            current(ticket); pageState.value = null
            pageState.value = read(ticket) // Restart using this query only; no cursor survives.
        }
    }
}

@Composable internal fun rememberSharedTaskListReader(gateway: SharedWorkspaceGateway): SharedTaskListReader {
    val account = LocalGenesisUserId.current
    val state = remember(gateway, account) { SharedTaskListReader(gateway) }
    DisposableEffect(state) { onDispose { state.pause() } }
    return state
}

@Composable internal fun ObserveSharedTaskList(state: SharedTaskListReader, filter: JSONObject, sort: String,
    metadata: String, active: Boolean, allowed: Boolean, onLost: () -> Unit) {
    val lost by rememberUpdatedState(onLost)
    val query = filter.toString()
    LaunchedEffect(state, query, sort, metadata, active, allowed) {
        if (!active || !allowed) { state.pause(); return@LaunchedEffect }
        state.configure(JSONObject(query), sort, metadata)
        try {
            while (isActive) { state.refresh(); if (state.lost) { lost(); break }; delay(5_000) }
        } finally { state.pause() }
    }
}

/** The month uses aggregate counts from the same predicates, not an unfiltered snapshot. */
@Composable internal fun rememberSharedTaskCalendarCounts(gateway: SharedWorkspaceGateway, filter: JSONObject,
    metadata: String, mode: ru.genesis.calendar.domain.CalendarMode, anchor: java.time.LocalDate, active: Boolean): SharedTaskListReader {
    val reader = rememberSharedTaskListReader(gateway)
    val range = ru.genesis.calendar.domain.GenesisCalendar().monthRange(anchor, mode)
    val month = JSONObject(filter.toString()).apply {
        remove("undated"); remove("dueFrom"); remove("dueTo")
        put("dueFrom", range.start.toString()); put("dueTo", range.end.toString())
    }
    ObserveSharedTaskList(reader, month, "position", metadata, active, active) {}
    return reader
}
