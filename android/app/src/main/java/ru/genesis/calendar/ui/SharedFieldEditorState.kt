package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.util.UUID

/** Catalog/history are ephemeral; only own input and a frozen command enter the account journal. */
internal class SharedFieldEditorState(private val gateway: SharedWorkspaceGateway, val account: String, val space: String, val project: String) {
    var projectTitle by mutableStateOf(""); private set
    var fields by mutableStateOf(emptyList<JSONObject>()); private set
    var history by mutableStateOf(emptyList<JSONObject>()); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var edit by mutableStateOf<JSONObject?>(null); private set
    var loaded by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var stale by mutableStateOf(false); private set
    var conflict by mutableStateOf(false); private set
    var dirty by mutableStateOf(false); private set
    var version by mutableStateOf(0); private set
    var error by mutableStateOf(""); private set
    var saved by mutableStateOf(false); private set
    private var epoch = 0; private var active = true; private val mutex = Mutex()
    val phase get() = record?.optString("phase") ?: "editing"
    val editable get() = active && loaded && !busy && !lost && !conflict && phase == "editing" && edit != null
    val review get() = edit?.optJSONObject("review")
    val canPreview get() = editable && !stale && runCatching { CustomFieldEditorProtocol.request(requireNotNull(edit)) }.isSuccess
    val canSave get() = canPreview && review != null && (!review!!.getBoolean("replaceType") || edit!!.getBoolean("confirmReplacement"))
    val removable get() = record != null && (phase in setOf("editing", "rejected", "received") || phase == "pending" && record!!.getInt("attempts") == 0)
    private fun copy(raw: JSONObject) = JSONObject(raw.toString())
    private fun current(ticket: Int) { if (!active || ticket != epoch) throw CancellationException() }
    private suspend fun <T> checked(ticket: Int, work: suspend () -> T): T {
        currentCoroutineContext().ensureActive(); current(ticket)
        return work().also { currentCoroutineContext().ensureActive(); current(ticket) }
    }
    private fun clearLive() { fields = emptyList(); history = emptyList(); projectTitle = ""; copies = emptyList() }
    fun pause() { epoch++; loaded = false; busy = false; clearLive(); record = null; edit = null; dirty = false }
    fun close() { pause(); active = false }
    private fun accept(value: JSONObject?) { record = value?.let(::copy); edit = value?.getJSONObject("edit")?.let(::copy); dirty = false; version++ }
    private fun failureCode(failure: Exception) = when (failure) {
        is AuthApiError -> failure.code; is CustomFieldFailure -> failure.code; is WorkflowFailure -> failure.code
        is AuthFailure -> sharedFailureCode(failure)
        else -> failure.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "CUSTOM_FIELD_PROTOCOL"
    }
    private suspend fun operate(quiet: Boolean = false, work: suspend (Int) -> Unit) = mutex.withLock {
        val ticket = epoch; current(ticket); if (!quiet) busy = true
        error = ""
        try { work(ticket) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(ticket); error = failureCode(failure)
            if (workflowAccessLost(failure) || error in setOf("SHARED_SPACE_FORBIDDEN", "CUSTOM_FIELD_SCOPE_CHANGED")) {
                // Preserve unsaved own input before clearing every visible cached definition/history.
                val own = edit?.takeIf { dirty && phase == "editing" }?.let(::copy)
                if (own != null) try { checked(ticket) { gateway.saveSharedFieldEditorCopy(project, UUID.randomUUID().toString(), null, own) } }
                catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
                lost = true; loaded = false; clearLive(); record = null; edit = null; dirty = false
            } else {
                if (error == "PLANNING_DRAFT_CHANGED") conflict = true
                if (error in setOf("NETWORK", "CUSTOM_FIELD_ONLINE_REQUIRED", "UNAUTHORIZED")) { loaded = false; clearLive() }
                try {
                    val latest = checked(ticket) { gateway.sharedFieldEditor(project) }
                    if (latest != null && latest.getString("phase") != "editing") accept(latest)
                } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
            }
        } finally { if (active && epoch == ticket && !quiet) busy = false }
    }
    private suspend fun catalog(ticket: Int) {
        val raw = checked(ticket) { gateway.sharedProject(project) }
        val child = raw.getJSONObject("project")
        val context = JSONObject().put("project", child).put("space", JSONObject().put("id", child.getString("spaceId")).put("role", child.getString("spaceRole")))
            .put("offlineCache", raw.optBoolean("offlineCache"))
        require(!raw.optBoolean("offlineCache")) { "CUSTOM_FIELD_ONLINE_REQUIRED" }
        CustomFieldEditorProtocol.authorize(space, project, context)
        val catalog = checked(ticket) { gateway.sharedFieldDefinitions(space, project, true) }
        val rows = CustomFieldProtocol.definitions(space, project, catalog.getJSONArray("fields"))
        fields = rows; projectTitle = child.getString("title")
        val base = edit?.optJSONObject("base")
        stale = phase in setOf("editing", "rejected") && base != null && rows.find { it.getString("id") == base.getString("id") }?.getInt("revision") != base.getInt("revision")
    }
    suspend fun load() = operate { ticket ->
        require(account.isNotBlank()) { "UNAUTHORIZED" }; lost = false; clearLive()
        catalog(ticket)
        if (dirty) persist(ticket) else accept(checked(ticket) { gateway.sharedFieldEditor(project) })
        edit?.let { require(it.getString("spaceId") == space && it.getString("projectId") == project) { "CUSTOM_FIELD_SCOPE_CHANGED" } }
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }; catalog(ticket); loaded = true
    }
    suspend fun refresh() = operate { ticket ->
        if (dirty) persist(ticket)
        catalog(ticket)
        val latest = checked(ticket) { gateway.sharedFieldEditor(project) }
        if (record?.optString("stamp") != latest?.optString("stamp")) { conflict = record != null; if (!conflict) accept(latest) }
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }; loaded = true
    }
    suspend fun poll() { if (active && loaded && !busy && !dirty) refresh() }
    private fun changedFromBase(value: JSONObject): Boolean {
        val base = value.optJSONObject("base") ?: return value.getJSONObject("draft").getString("title").isNotBlank() || value.getJSONObject("draft").getJSONArray("options").length() > 0
        val old = CustomFieldEditorProtocol.newEdit(space, project, base)
        return PlanningLifecycle.canonical(old.getJSONObject("draft")) != PlanningLifecycle.canonical(value.getJSONObject("draft")) || old.getString("positionInput") != value.getString("positionInput")
    }
    private suspend fun preserve(ticket: Int) {
        edit?.takeIf { phase != "received" && changedFromBase(it) }?.let { checked(ticket) { gateway.saveSharedFieldEditorCopy(project, UUID.randomUUID().toString(), null, it) } }
    }
    suspend fun choose(id: String?) = operate { ticket ->
        require(record == null || removable) { "PLANNING_DRAFT_PENDING" }
        if (dirty) persist(ticket)
        catalog(ticket); preserve(ticket)
        record?.let { checked(ticket) { gateway.removeSharedFieldEditor(project, it.getString("stamp")) } }
        val source = id?.let { key -> fields.find { it.getString("id") == key } ?: error("CUSTOM_FIELD_UNAVAILABLE") }
        val next = CustomFieldEditorProtocol.newEdit(space, project, source)
        accept(checked(ticket) { gateway.saveSharedFieldEditor(project, null, next) }); history = emptyList(); stale = false; conflict = false; saved = false
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }
    }
    fun change(work: (JSONObject) -> Unit) {
        if (!editable) return
        val next = copy(requireNotNull(edit)); work(next)
        edit = CustomFieldEditorProtocol.changed(next); dirty = true; saved = false; version++
    }
    fun confirmReplacement(value: Boolean) {
        if (!editable) return
        edit = CustomFieldEditorProtocol.edit(copy(requireNotNull(edit)).put("confirmReplacement", value)); dirty = true; version++
    }
    private suspend fun persist(ticket: Int) = withContext(NonCancellable) {
        val own = edit?.let(::copy) ?: return@withContext; if (!dirty) return@withContext
        val inputVersion = version; val stored = checked(ticket) { gateway.saveSharedFieldEditor(project, record?.getString("stamp"), own) }
        record = copy(stored)
        if (inputVersion == version) { edit = stored.getJSONObject("edit").let(::copy); dirty = false }
    }
    suspend fun saveLocal() = operate(true) { persist(it) }
    suspend fun preview() = operate { ticket ->
        persist(ticket); val saved = requireNotNull(record)
        accept(checked(ticket) { gateway.previewSharedFieldEditor(project, saved.getString("stamp")) })
    }
    suspend fun submit() = operate { ticket ->
        persist(ticket); var saved = requireNotNull(record)
        if (saved.getString("phase") == "editing") {
            saved = checked(ticket) { gateway.prepareSharedFieldEditor(project, saved.getString("stamp")) }; accept(saved)
        }
        accept(checked(ticket) { gateway.sendSharedFieldEditor(project, saved.getString("stamp")) }); this.saved = phase == "received"
        catalog(ticket)
    }
    suspend fun rebase() = operate { ticket ->
        if (dirty) persist(ticket)
        accept(checked(ticket) { gateway.rebaseSharedFieldEditor(project, requireNotNull(record).getString("stamp")) }); catalog(ticket); stale = false; conflict = false
    }
    suspend fun readHistory() = operate { ticket ->
        catalog(ticket)
        val id = requireNotNull(edit).getJSONObject("draft").getString("id")
        history = PlanningLifecycle.rows(CustomFieldDefinitionProtocol.history(space, id, checked(ticket) { gateway.sharedFieldHistory(space, id) }).getJSONArray("versions"))
    }
    suspend fun restore(historical: JSONObject) = operate { ticket ->
        require(phase == "editing" && !conflict) { "PLANNING_DRAFT_PENDING" }; persist(ticket); catalog(ticket); preserve(ticket)
        val current = fields.find { it.getString("id") == historical.getString("id") } ?: error("CUSTOM_FIELD_UNAVAILABLE")
        val next = CustomFieldEditorProtocol.restore(CustomFieldEditorProtocol.newEdit(space, project, current), historical)
        accept(checked(ticket) { gateway.saveSharedFieldEditor(project, requireNotNull(record).getString("stamp"), next) }); stale = false
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }
    }
    suspend fun saveCopy() = operate { ticket ->
        checked(ticket) { gateway.saveSharedFieldEditorCopy(project, UUID.randomUUID().toString(), null, requireNotNull(edit)) }
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }
    }
    suspend fun reloadSaved() = operate { ticket ->
        preserve(ticket); catalog(ticket); accept(checked(ticket) { gateway.sharedFieldEditor(project) })
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }; conflict = false; loaded = true
    }
    suspend fun useCopy(copy: JSONObject) = operate { ticket ->
        accept(checked(ticket) { gateway.useSharedFieldEditorCopy(project, copy.getString("id"), copy.getString("stamp"), record?.getString("stamp")) })
        conflict = false; history = emptyList(); catalog(ticket)
    }
    suspend fun removeCopy(copy: JSONObject) = operate { ticket ->
        checked(ticket) { gateway.removeSharedFieldEditorCopy(project, copy.getString("id"), copy.getString("stamp")) }
        copies = checked(ticket) { gateway.sharedFieldEditorCopies(project) }
    }
    suspend fun discard() = operate { ticket ->
        record?.let { checked(ticket) { gateway.removeSharedFieldEditor(project, it.getString("stamp")) } }
        accept(null); conflict = false; stale = false; saved = false; history = emptyList(); catalog(ticket)
    }
}
