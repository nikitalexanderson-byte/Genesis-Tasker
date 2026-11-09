package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences

internal fun freshSavedView(prefs: UiPreferences, title: String): JSONObject {
    val calendar = SharedCustomCalendar.initial(prefs)
    return JSONObject().put("version", 1).put("title", title).put("filter", JSONObject()).put("sort", "position").put("relative", "none")
        .put("calendarMode", calendar.mode.wireValue).put("calendarContext", calendar.saved().apply { remove("mode") })
}

/** Only own input is durable. Server metadata and task rows are cleared when reads fail or the screen pauses. */
internal class SharedSavedViewsState(private val gateway: SharedWorkspaceGateway) {
    var library by mutableStateOf<JSONObject?>(null); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var editJson by mutableStateOf<String?>(null); private set
    var dirty by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var version by mutableIntStateOf(0); private set
    var selection by mutableIntStateOf(0); private set
    var queryJson by mutableStateOf<String?>(null); private set
    val results = SharedTaskListReader(gateway)
    val edit get() = editJson?.let(::JSONObject)
    val definition get() = edit?.optJSONObject("definition")?.let { runCatching { SavedViewProtocol.definition(it) }.getOrNull() }
    val source get() = edit?.optJSONObject("source")
    val phase get() = record?.getString("phase") ?: "editing"
    val locked get() = phase != "editing"
    private var epoch = 0
    private var active = true
    private val mutex = Mutex()
    private suspend fun current(ticket: Int) {
        currentCoroutineContext().ensureActive(); if (!active || epoch != ticket) throw CancellationException()
    }
    private suspend fun <T> checked(ticket: Int, work: suspend () -> T): T { current(ticket); return work().also { current(ticket) } }
    fun pause() { epoch++; active = false; busy = false; library = null; results.pause() }
    private suspend fun perform(work: suspend (Int) -> Unit) = mutex.withLock {
        val ticket = epoch; current(ticket); busy = true
        try { work(ticket); current(ticket); error = "" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(ticket); error = when (failure) { is AuthApiError -> failure.code; is AuthFailure -> sharedFailureCode(failure); else -> failure.message ?: "NETWORK" }
            library = null; queryJson = null; results.pause()
            // An attempted request may already be committed. Always reload its exact durable command.
            try { record = checked(ticket) { gateway.sharedSavedViewDraft() } } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
        } finally { if (ticket == epoch) busy = false }
    }
    private fun accept(next: JSONObject?) { record = next; editJson = next?.getJSONObject("edit")?.toString(); dirty = false; selection++; version++ }
    suspend fun load() {
        active = true
        perform { ticket ->
            if (!dirty) accept(checked(ticket) { gateway.sharedSavedViewDraft() })
            library = checked(ticket) { gateway.sharedSavedViews() }
            queryJson?.let { query -> results.configure(JSONObject(query), "position", "saved-views"); results.refresh(); requireResults() }
        }
    }
    suspend fun moreViews() = perform { ticket ->
        val old = library ?: return@perform; val cursor = old.optString("nextCursor").takeUnless { it == "null" || it.isBlank() } ?: return@perform
        try {
            val next = checked(ticket) { gateway.sharedSavedViews(cursor) }
            val rows = (importRows(old.getJSONArray("views")) + importRows(next.getJSONArray("views"))).distinctBy { it.getString("id") }
            library = next.put("views", JSONArray(rows))
        } catch (failure: AuthApiError) { if (failure.code != "VIEW_LIST_CHANGED") throw failure; library = checked(ticket) { gateway.sharedSavedViews() } }
    }
    fun change(work: (JSONObject) -> Unit) {
        if (locked) return
        val value = edit ?: return; work(value); editJson = SavedViewProtocol.edit(value).toString(); dirty = true; version++
        queryJson = null; results.pause()
    }
    fun criteria(work: (JSONObject) -> Unit) = change { value ->
        val definition = value.getJSONObject("definition"); val filter = SavedViewProtocol.filter(definition.get("filter")); work(filter); definition.put("filter", filter)
    }
    private suspend fun save(ticket: Int) {
        if (!dirty) return
        val own = requireNotNull(edit); val savedVersion = version
        val next = checked(ticket) { gateway.saveSharedSavedViewDraft(record?.getString("stamp"), own) }
        record = next
        if (savedVersion == version) { editJson = next.getJSONObject("edit").toString(); dirty = false }
    }
    suspend fun saveLocal() = mutex.withLock {
        val ticket = epoch; current(ticket)
        try { if (!locked) save(ticket) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { current(ticket); error = failure.message ?: "PLANNING_DRAFT_STORAGE" }
    }
    private suspend fun replace(ticket: Int, value: JSONObject) {
        require(phase == "editing" || phase == "received" || phase == "rejected") { "PLANNING_DRAFT_PENDING" }
        if (phase != "editing") { checked(ticket) { gateway.removeSharedSavedViewDraft(requireNotNull(record).getString("stamp")) }; record = null }
        accept(checked(ticket) { gateway.saveSharedSavedViewDraft(record?.getString("stamp"), value) })
        queryJson = null; results.pause()
    }
    suspend fun begin(definition: JSONObject) = perform { ticket -> replace(ticket, SavedViewProtocol.newEdit(definition)) }
    suspend fun select(id: String) = perform { ticket ->
        val view = checked(ticket) { gateway.sharedSavedView(id) }
        replace(ticket, SavedViewProtocol.newEdit(view.optJSONObject("definition"), view))
        if (!view.getBoolean("invalid")) apply(ticket, JSONObject().put("savedViewId", id))
        else error("VIEW_FILTER_UNAVAILABLE")
    }
    private suspend fun apply(ticket: Int, filter: JSONObject) {
        current(ticket); queryJson = filter.toString(); results.configure(filter, "position", "saved-views"); results.refresh(); current(ticket); requireResults()
    }
    private fun requireResults() { if (results.error.isNotBlank()) throw AuthApiError(results.error) }
    suspend fun apply() = perform { ticket ->
        save(ticket)
        val value = requireNotNull(definition) { "VIEW_INVALID" }
        apply(ticket, JSONObject().put("viewDefinition", SavedViewProtocol.ready(value)))
    }
    suspend fun preset(definition: JSONObject) = perform { ticket ->
        replace(ticket, SavedViewProtocol.newEdit(definition)); apply(ticket, JSONObject().put("viewDefinition", SavedViewProtocol.ready(definition)))
    }
    suspend fun copy() = perform { ticket ->
        val value = requireNotNull(edit)
        value.put("kind", "view-save").put("source", JSONObject.NULL).put("visibility", "personal")
        replace(ticket, value)
    }
    suspend fun prepare(deleting: Boolean = false) = perform { ticket ->
        if (deleting) change { it.put("kind", "view-delete") }
        save(ticket)
        val next = checked(ticket) { gateway.prepareSharedSavedViewDraft(requireNotNull(record).getString("stamp")) }; accept(next)
    }
    suspend fun send() = perform { ticket ->
        val next = checked(ticket) { gateway.sendSharedSavedViewDraft(requireNotNull(record).getString("stamp")) }; accept(next)
        library = checked(ticket) { gateway.sharedSavedViews() }
        next.getJSONObject("receipt").optJSONObject("view")?.let { view -> apply(ticket, JSONObject().put("savedViewId", view.getString("id"))) }
    }
    suspend fun finish() = perform { ticket ->
        val previous = requireNotNull(record); require(previous.getString("phase") == "received")
        val view = previous.getJSONObject("receipt").optJSONObject("view")
        checked(ticket) { gateway.removeSharedSavedViewDraft(previous.getString("stamp")) }; accept(null)
        if (view != null) replace(ticket, SavedViewProtocol.newEdit(view.getJSONObject("definition"), view))
    }
    suspend fun rebase() = perform { ticket ->
        val next = checked(ticket) { gateway.rebaseSharedSavedViewDraft(requireNotNull(record).getString("stamp")) }; accept(next)
    }
    suspend fun cancelPrepared() = perform { ticket ->
        val old = requireNotNull(record); require(old.getString("phase") == "pending" && old.getInt("attempts") == 0) { "PLANNING_DRAFT_PENDING" }
        val own = old.getJSONObject("edit").put("kind", "view-save")
        checked(ticket) { gateway.removeSharedSavedViewDraft(old.getString("stamp")) }; record = null
        accept(checked(ticket) { gateway.saveSharedSavedViewDraft(null, own) })
    }
    suspend fun cancel() = perform { ticket ->
        val old = requireNotNull(record)
        checked(ticket) { gateway.removeSharedSavedViewDraft(old.getString("stamp")) }; accept(null); queryJson = null; results.pause()
    }
    suspend fun refreshResults() = perform { ticket ->
        queryJson?.let { results.configure(JSONObject(it), "position", "saved-views"); results.refresh(); current(ticket); requireResults() }
    }
    suspend fun moreTasks() = perform { ticket -> results.more(); current(ticket); requireResults() }
}
