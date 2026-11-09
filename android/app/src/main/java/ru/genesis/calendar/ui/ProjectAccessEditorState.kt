package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.util.UUID

/** The catalog/preview are transient; only scoped rules and the frozen command reach the journal. */
internal class ProjectAccessEditorState(private val gateway: SharedWorkspaceGateway, private val space: String, private val user: String,
    private val onLost: () -> Unit, private val onSaved: () -> Unit) {
    var data by mutableStateOf<JSONObject?>(null); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var edit by mutableStateOf<JSONObject?>(null); private set
    var preview by mutableStateOf<JSONObject?>(null); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var ready by mutableStateOf(false); private set
    var active by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var saved by mutableStateOf(true); private set
    var conflicted by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var notice by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var inputVersion by mutableIntStateOf(0); private set
    private val writes = Mutex(); private var ownCopy: JSONObject? = null; private var generation = 0L; private var closed = false
    val phase get() = record?.optString("phase") ?: "editing"
    val controls get() = !closed && !lost && ready && data != null && !busy
    val restrictedMember get() = data?.optString("memberRole") in setOf("member", "guest")
    val editable get() = controls && active && phase == "editing" && !conflicted && restrictedMember
    private fun copy(raw: JSONObject) = JSONObject(raw.toString())
    private fun current(ticket: Long) = !closed && !lost && generation == ticket
    fun close() { closed = true; generation++; data = null; preview = null; edit = null; copies = emptyList(); record = null; busy = false }
    fun offline() { if (!closed && !lost) { generation++; data = null; preview = null; busy = false; error = "NETWORK" } }
    private fun failure(failure: Exception) {
        if (failure is CancellationException) { data = null; preview = null; throw failure }
        preview = null
        error = when (failure) {
            is AuthApiError -> failure.code
            is AuthFailure -> sharedFailureCode(failure)
            else -> failure.message?.takeIf { it in ProjectAccessProtocol.errors || it.startsWith("PLANNING_DRAFT_") } ?: "INVALID_PROJECT_ACCESS"
        }
        if (error in setOf("UNAUTHORIZED", "NOT_DEPLOYED", "PROJECT_ACCESS_PERMISSION_CHANGED")) {
            lost = true; generation++; ready = false; active = false; data = null; edit = null; record = null; copies = emptyList(); ownCopy = null; onLost()
        } else if (error in setOf("NETWORK", "INVALID_PROJECT_ACCESS", "PROTOCOL")) data = null
    }
    private suspend fun fresh(): JSONObject {
        val raw = gateway.sharedProjectAccess(space, user)
        return withContext(Dispatchers.Default) { ProjectAccessProtocol.snapshot(space, user, raw) }
    }
    suspend fun load() {
        if (closed || busy || lost) return
        val ticket = ++generation; busy = true; error = ""
        try { writes.withLock {
            val local = gateway.sharedProjectAccessDraft(space, user); val versions = gateway.sharedProjectAccessCopies(space, user)
            if (!current(ticket)) return@withLock
            record = local; copies = versions; ownCopy = null; conflicted = false; saved = true; ready = true
            edit = local?.getJSONObject("edit")?.let(::copy); active = local != null && versions.isEmpty(); preview = null; inputVersion++
            val loaded = fresh(); if (!current(ticket)) return@withLock
            data = loaded
            if (record == null && restrictedMember) {
                val value = ProjectAccessProtocol.newEdit(loaded)
                val next = gateway.saveSharedProjectAccessDraft(space, user, null, value)
                if (current(ticket)) { record = next; edit = copy(next.getJSONObject("edit")); active = true; inputVersion++ }
            }
        } } catch (reason: Exception) { if (current(ticket)) failure(reason) else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    suspend fun refresh() {
        if (closed || busy || lost) return
        if (record == null && !active) { load(); return }
        val ticket = generation; busy = true; error = ""
        try {
            val loaded = fresh()
            if (current(ticket)) { data = loaded; if (preview?.getString("fingerprint") != loaded.getString("fingerprint")) preview = null }
        } catch (reason: Exception) { if (current(ticket)) failure(reason) else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    fun change(value: JSONObject) {
        if (!editable) return
        edit = copy(value).put("review", JSONObject.NULL); preview = null; saved = false; notice = false; error = ""; inputVersion++
    }
    private suspend fun persistLocked() {
        if (closed || lost || !active || phase != "editing") return
        val value = edit?.let(::copy) ?: return; val version = inputVersion
        if (!conflicted) {
            try {
                val next = gateway.saveSharedProjectAccessDraft(space, user, record?.getString("stamp"), value)
                if (!closed && !lost) { record = next; saved = version == inputVersion; error = "" }
                return
            } catch (reason: IllegalArgumentException) { if (reason.message != "PLANNING_DRAFT_CHANGED") throw reason; conflicted = true; preview = null }
        }
        val next = try { gateway.saveSharedProjectAccessCopy(space, user, ownCopy?.getString("id") ?: UUID.randomUUID().toString(), ownCopy?.getString("stamp"), value) }
        catch (reason: IllegalArgumentException) {
            if (reason.message != "PLANNING_DRAFT_CHANGED") throw reason
            gateway.saveSharedProjectAccessCopy(space, user, UUID.randomUUID().toString(), null, value)
        }
        if (!closed && !lost) { ownCopy = next; saved = version == inputVersion; error = "PLANNING_DRAFT_CHANGED" }
    }
    suspend fun persist(): Boolean = withContext(NonCancellable) { writes.withLock {
        try { if (!saved) persistLocked(); saved && !lost && !closed }
        catch (reason: Exception) {
            if (!closed && !lost) {
                failure(reason)
                if (error == "PLANNING_DRAFT_LIMIT") runCatching { gateway.sharedProjectAccessCopies(space, user) }.getOrNull()?.let { copies = it }
            }
            false
        }
    } }
    private suspend fun recover() {
        if (closed || lost || conflicted) return
        try { gateway.sharedProjectAccessDraft(space, user)?.let { next ->
            val sameCommand = record?.optString("command")?.takeUnless { it == "null" || it.isBlank() } == next.optString("command").takeUnless { it == "null" || it.isBlank() }
            val sameDraft = edit?.getJSONObject("draft")?.let { PlanningLifecycle.canonical(it) } == PlanningLifecycle.canonical(next.getJSONObject("edit").getJSONObject("draft"))
            if (!closed && !lost && (sameCommand && next.getString("phase") != "editing" || sameDraft)) {
                record = next
                if (saved) edit = copy(next.getJSONObject("edit"))
            }
        } } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Preserve input and the first diagnostic. */ }
    }
    suspend fun review() {
        if (!editable) return
        val ticket = generation; busy = true; error = ""
        try { writes.withLock {
            withContext(NonCancellable) { if (!saved) persistLocked() }
            require(saved && !conflicted) { "PLANNING_DRAFT_CHANGED" }
            val response = gateway.previewSharedProjectAccessDraft(space, user, requireNotNull(record).getString("stamp"))
            if (current(ticket)) {
                val next = response.getJSONObject("record"); val checked = ProjectAccessProtocol.preview(next.getJSONObject("edit"), response.getJSONObject("preview"))
                record = next; edit = copy(next.getJSONObject("edit")); preview = checked; saved = true
                data = data?.let(::copy)?.put("projects", checked.getJSONArray("projects"))?.put("fingerprint", checked.getString("fingerprint"))?.put("revision", checked.getLong("revision"))
            }
        } } catch (reason: Exception) { if (current(ticket)) { failure(reason); recover() } else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    private suspend fun accept(next: JSONObject, ticket: Long) {
        if (!current(ticket)) return
        record = next; gateway.removeSharedProjectAccessDraft(space, user, next.getString("stamp"))
        if (!current(ticket)) return
        record = null; edit = null; preview = null; active = false; saved = true; notice = true; onSaved()
        val loaded = fresh(); if (!current(ticket)) return
        data = loaded
        if (restrictedMember) {
            val created = gateway.saveSharedProjectAccessDraft(space, user, null, ProjectAccessProtocol.newEdit(loaded))
            if (current(ticket)) { record = created; edit = copy(created.getJSONObject("edit")); active = true; inputVersion++ }
        }
    }
    suspend fun apply() {
        if (!editable || preview == null || preview!!.getJSONArray("blockers").length() != 0 || !saved) return
        val ticket = generation; busy = true; error = ""
        try { writes.withLock {
            val prepared = gateway.prepareSharedProjectAccessDraft(space, user, requireNotNull(record).getString("stamp"))
            if (!current(ticket)) return@withLock
            record = prepared; preview = null
            accept(gateway.sendSharedProjectAccessDraft(space, user, prepared.getString("stamp")), ticket)
        } } catch (reason: Exception) { if (current(ticket)) { failure(reason); recover() } else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    suspend fun retry() {
        if (closed || lost || busy || !ready || phase !in setOf("pending", "received")) return
        val ticket = generation; val source = record ?: return; busy = true; error = ""
        try { writes.withLock { accept(if (phase == "received") source else gateway.sendSharedProjectAccessDraft(space, user, source.getString("stamp")), ticket) } }
        catch (reason: Exception) { if (current(ticket)) { failure(reason); recover() } else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    suspend fun rebase() {
        if (!controls || record == null || conflicted || phase !in setOf("editing", "rejected")) return
        val ticket = generation; busy = true; error = ""
        try { writes.withLock {
            withContext(NonCancellable) { if (!saved) persistLocked() }
            require(!conflicted) { "PLANNING_DRAFT_CHANGED" }
            val response = gateway.rebaseSharedProjectAccessDraft(space, user, requireNotNull(record).getString("stamp"))
            if (current(ticket)) { record = response.getJSONObject("record"); edit = copy(record!!.getJSONObject("edit")); data = response.getJSONObject("state"); preview = null; active = true; saved = true; inputVersion++ }
        } } catch (reason: Exception) { if (current(ticket)) failure(reason) else if (reason is CancellationException) throw reason }
        finally { if (current(ticket)) busy = false }
    }
    suspend fun versions() {
        if (busy || closed || lost) return
        if (!saved && !persist()) return
        busy = true
        try { writes.withLock {
            try { val latest = gateway.sharedProjectAccessDraft(space, user); val versions = gateway.sharedProjectAccessCopies(space, user)
                if (!closed && !lost) { record = latest; copies = versions; ownCopy = null; conflicted = false; edit = null; preview = null; active = false; saved = true } }
            catch (reason: Exception) { if (!closed && !lost) failure(reason) }
        } } finally { busy = false }
    }
    fun restore() { if (!busy && !lost && !closed) record?.let { edit = copy(it.getJSONObject("edit")); active = true; preview = null; saved = true; inputVersion++ } }
    suspend fun useCopy(copy: JSONObject) {
        if (!controls || active || phase in setOf("pending", "received")) return
        busy = true
        try { writes.withLock {
            val next = gateway.useSharedProjectAccessCopy(space, user, copy.getString("id"), copy.getString("stamp"), record?.getString("stamp"))
            if (!closed && !lost) { record = next; edit = copy(next.getJSONObject("edit")); copies = gateway.sharedProjectAccessCopies(space, user); active = true; saved = true; preview = null; inputVersion++ }
        } } catch (reason: Exception) { if (!closed && !lost) failure(reason) } finally { busy = false }
    }
    suspend fun removeCopy(value: JSONObject) {
        if (busy || closed || lost) return
        busy = true
        try { writes.withLock { gateway.removeSharedProjectAccessCopy(space, user, value.getString("id"), value.getString("stamp")); copies = gateway.sharedProjectAccessCopies(space, user) } }
        catch (reason: Exception) { if (!closed && !lost) failure(reason) } finally { busy = false }
        if (!closed && !lost && active && phase == "editing" && !saved) persist()
    }
    suspend fun discard() {
        if (busy || closed || lost || phase == "pending" && record?.optInt("attempts", 0) != 0) return
        busy = true
        try { writes.withLock {
            if (conflicted) ownCopy?.let { gateway.removeSharedProjectAccessCopy(space, user, it.getString("id"), it.getString("stamp")) }
            else record?.let { gateway.removeSharedProjectAccessDraft(space, user, it.getString("stamp")) }
            record = null; edit = null; preview = null; active = false; saved = true; conflicted = false; ownCopy = null
        } } catch (reason: Exception) { if (!closed && !lost) failure(reason) } finally { busy = false }
        if (!closed && !lost && record == null) load()
    }
}
