package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.util.UUID

/** One editor serializes its local commits; the encrypted journal rejects other writers by CAS. */
internal class SharedPlanningEditorState(private val controller: SharedWorkspaceGateway, private val projectId: String,
    private val onLost: () -> Unit, private val onSaved: (JSONObject) -> Unit, private val onRefreshed: (JSONObject) -> Unit) {
    var record by mutableStateOf<JSONObject?>(null); private set
    var edit by mutableStateOf<JSONObject?>(null); private set
    var tasks by mutableStateOf(emptyList<JSONObject>()); private set
    var tasksVerified by mutableStateOf(false); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var conflicted by mutableStateOf(false); private set
    var active by mutableStateOf(false); private set
    var ready by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var saved by mutableStateOf(true); private set
    var notice by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var inputVersion by mutableIntStateOf(0); private set
    var lost by mutableStateOf(false); private set
    private val writes = Mutex()
    private var ownCopy: JSONObject? = null
    val phase: String get() = record?.optString("phase") ?: "editing"
    val editable: Boolean get() = active && phase == "editing" && !busy && !lost
    val pending: Boolean get() = phase == "pending"
    val completion: Boolean get() = active && edit?.optString("kind") == "transition" && edit?.optString("action") == "complete"
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    fun hide() { lost = true; ready = false; active = false; record = null; edit = null; tasks = emptyList(); tasksVerified = false; copies = emptyList(); ownCopy = null; conflicted = false; error = ""; notice = false }
    private fun failed(failure: Exception) {
        if (failure is CancellationException) throw failure
        if (planningAccessLost(failure)) { hide(); onLost(); return }
        error = when (failure) {
            is AuthApiError -> failure.code
            is AuthFailure -> failure.kind.name
            is org.json.JSONException -> "PLANNING_DRAFT_INVALID"
            else -> failure.message?.takeIf { it.startsWith("PLANNING_") || it.startsWith("SPRINT_") } ?: "PLANNING_DRAFT_STORAGE"
        }
    }
    suspend fun load() {
        writes.withLock {
            try {
                val next = controller.sharedPlanningDraft(projectId)
                val versions = controller.sharedPlanningCopies(projectId)
                lost = false; record = next; copies = versions; ownCopy = null; conflicted = false; edit = null; active = false; tasks = emptyList(); tasksVerified = false; ready = true; error = ""; saved = true
            } catch (failure: Exception) { failed(failure) }
        }
    }
    fun restore() {
        if (busy || lost) return
        val source = record ?: return
        edit = copy(source.getJSONObject("edit")); active = true; ownCopy = null; conflicted = false; tasks = emptyList(); tasksVerified = false; error = ""; saved = true; inputVersion++
    }
    suspend fun start(value: JSONObject) {
        if (!ready || busy || lost || record != null) return
        active = true; edit = copy(value); saved = false; error = ""; notice = false; inputVersion++
        persist()
    }
    fun change(value: JSONObject) {
        if (!editable) return
        edit = copy(value); saved = false; error = ""; notice = false; inputVersion++
    }
    fun changeSprintField(key: String, value: Any) {
        if (!editable) return
        require(key in setOf("title", "goal", "startDate", "endDate", "calendarMode"))
        val next = edit?.let(::copy) ?: return
        if (next.getJSONObject("draft").opt(key) == value) return
        next.getJSONObject("draft").put(key, value); change(next)
    }
    fun changeSetting(key: String, value: Any) {
        if (!editable) return
        require(key in setOf("enabled", "estimateUnit"))
        val next = edit?.let(::copy) ?: return
        if (next.opt(key) == value) return
        change(next.put(key, value))
    }
    fun chooseOutcome(target: String, taskId: String? = null) {
        if (!editable) return
        val next = edit?.let(::copy) ?: return
        val choices = next.getJSONObject("choices")
        val ids = planningRows(next.getJSONArray("tasks")).map { it.getString("id") }
        require(taskId == null || taskId in ids)
        for (id in if (taskId == null) ids else listOf(taskId)) choices.put(id, target)
        change(next)
    }
    private suspend fun persistLocked() {
        if (lost || !active || phase != "editing") return
        val value = edit?.let(::copy) ?: return
        val version = inputVersion
        if (!conflicted) {
            try {
                val next = controller.saveSharedPlanningDraft(projectId, record?.getString("stamp"), value)
                if (!lost) { record = next; saved = version == inputVersion; error = "" }
                return
            } catch (failure: IllegalArgumentException) {
                if (failure.message != "PLANNING_DRAFT_CHANGED") throw failure
                conflicted = true
            }
        }
        val next = try {
            controller.saveSharedPlanningCopy(projectId, ownCopy?.getString("id") ?: UUID.randomUUID().toString(), ownCopy?.getString("stamp"), value)
        } catch (failure: IllegalArgumentException) {
            if (failure.message != "PLANNING_DRAFT_CHANGED") throw failure
            controller.saveSharedPlanningCopy(projectId, UUID.randomUUID().toString(), null, value)
        }
        if (!lost) { ownCopy = next; saved = version == inputVersion; error = "PLANNING_DRAFT_CHANGED" }
    }
    suspend fun persist(): Boolean = withContext(NonCancellable) {
        writes.withLock {
            try { persistLocked(); saved && !lost }
            catch (failure: Exception) {
                failed(failure)
                if (error == "PLANNING_DRAFT_LIMIT") runCatching { controller.sharedPlanningCopies(projectId) }.getOrNull()?.let { copies = it }
                false
            }
        }
    }
    private suspend fun recoverAfterFailure() {
        // A new stamp can belong to another editor. Never use it to overwrite that editor's input.
        if (conflicted) return
        try { controller.sharedPlanningDraft(projectId)?.let { fresh ->
            if (!lost && record?.optString("command")?.takeIf { it.isNotBlank() && it != "null" } == fresh.optString("command").takeIf { it.isNotBlank() && it != "null" } &&
                fresh.getString("phase") != "editing") record = fresh
        } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* Preserve current input and the original persistence error. */ }
    }
    private suspend fun accepted(value: JSONObject) {
        record = value
        val receipt = copy(value.getJSONObject("receipt"))
        controller.removeSharedPlanningDraft(projectId, value.getString("stamp"))
        if (!lost) { record = null; edit = null; active = false; tasks = emptyList(); saved = true; error = ""; notice = true; onSaved(receipt) }
    }
    suspend fun submit() {
        if (!editable || conflicted) return
        busy = true; error = ""
        try {
            writes.withLock {
                withContext(NonCancellable) { persistLocked() }
                check(saved && !lost && !conflicted) { if (conflicted) "PLANNING_DRAFT_CHANGED" else "PLANNING_DRAFT_STORAGE" }
                val prepared = controller.prepareSharedPlanningDraft(projectId, requireNotNull(record).getString("stamp"))
                record = prepared
                val result = controller.sendSharedPlanningDraft(projectId, prepared.getString("stamp"))
                accepted(result)
            }
        } catch (failure: Exception) { failed(failure); recoverAfterFailure() }
        finally { busy = false }
    }
    suspend fun retry() {
        if (busy || lost) return
        val source = record ?: return
        if (source.getString("phase") !in setOf("pending", "received")) return
        busy = true; error = ""
        try { writes.withLock {
            val result = if (source.getString("phase") == "received") source else controller.sendSharedPlanningDraft(projectId, source.getString("stamp"))
            accepted(result)
        } } catch (failure: Exception) { failed(failure); recoverAfterFailure() }
        finally { busy = false }
    }
    suspend fun rebase() {
        if (busy || lost || record == null || conflicted) return
        busy = true; error = ""
        try { writes.withLock {
            if (phase == "editing") withContext(NonCancellable) { persistLocked() }
            check(!conflicted) { "PLANNING_DRAFT_CHANGED" }
            val response = controller.rebaseSharedPlanningDraft(projectId, requireNotNull(record).getString("stamp"))
            if (!lost) { record = response.getJSONObject("record"); edit = copy(record!!.getJSONObject("edit")); tasks = planningRows(response.optJSONArray("tasks")); tasksVerified = !response.isNull("tasks"); saved = true; active = true; inputVersion++; onRefreshed(response.getJSONObject("planning")) }
        } } catch (failure: Exception) { failed(failure) }
        finally { busy = false }
    }
    suspend fun complete(sprintId: String) {
        if (!ready || busy || lost || record != null) return
        busy = true; error = ""; notice = false
        try { writes.withLock {
            val response = controller.prepareSharedSprintCompletion(projectId, sprintId, null)
            if (!lost) { record = response.getJSONObject("record"); edit = copy(record!!.getJSONObject("edit")); tasks = planningRows(response.optJSONArray("tasks")); tasksVerified = true; active = true; saved = true; inputVersion++; onRefreshed(response.getJSONObject("planning")) }
        } } catch (failure: Exception) { failed(failure) }
        finally { busy = false }
    }
    suspend fun discard() {
        if (busy || lost || pending && record?.optInt("attempts", 0) != 0) return
        busy = true; error = ""
        try { writes.withLock {
            if (conflicted) ownCopy?.let { controller.removeSharedPlanningCopy(projectId, it.getString("id"), it.getString("stamp")) }
            else record?.let { controller.removeSharedPlanningDraft(projectId, it.getString("stamp")) }
            record = controller.sharedPlanningDraft(projectId); copies = controller.sharedPlanningCopies(projectId)
            edit = null; active = false; ownCopy = null; conflicted = false; tasks = emptyList(); saved = true; inputVersion++
        } } catch (failure: Exception) { failed(failure) }
        finally { busy = false }
    }
    suspend fun versions() {
        if (busy || lost) return
        busy = true
        try {
            if (active && phase == "editing" && !saved && !persist()) return
            load()
        } finally { busy = false }
    }
    suspend fun useCopy(value: JSONObject) {
        if (busy || lost || active) return
        busy = true; error = ""
        try { writes.withLock {
            val next = controller.useSharedPlanningCopy(projectId, value.getString("id"), value.getString("stamp"), record?.getString("stamp"))
            if (!lost) {
                record = next; copies = controller.sharedPlanningCopies(projectId); ownCopy = null; conflicted = false
                edit = copy(next.getJSONObject("edit")); active = true; tasks = emptyList(); tasksVerified = false; saved = true; inputVersion++
            }
        } } catch (failure: Exception) { failed(failure) }
        finally { busy = false }
    }
    suspend fun removeCopy(value: JSONObject) {
        if (busy || lost) return
        busy = true; error = ""
        try { writes.withLock {
            controller.removeSharedPlanningCopy(projectId, value.getString("id"), value.getString("stamp"))
            copies = controller.sharedPlanningCopies(projectId)
        } } catch (failure: Exception) { failed(failure) }
        finally { busy = false }
        if (active && phase == "editing" && !saved) persist()
    }
}
