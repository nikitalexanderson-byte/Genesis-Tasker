package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.SharedTemplateManifest
import ru.genesis.calendar.auth.SharedTemplateProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.util.UUID

internal fun sharedTemplateAccessDenied(failure: Exception): Boolean = when (failure) {
    is AuthApiError -> failure.code in setOf("UNAUTHORIZED", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_SPACE_FORBIDDEN", "SHARED_SPACE_NOT_FOUND")
    is AuthFailure -> failure.kind == AuthFailure.Kind.UNAUTHORIZED
    else -> false
}

/** One selected project owns one durable template editor; server catalogs and previews remain in memory. */
internal class SharedTemplateState(private val gateway: SharedWorkspaceGateway, private val account: String,
    val space: String, val project: String, val language: String) {
    var library by mutableStateOf<JSONObject?>(null); private set
    var source by mutableStateOf<JSONObject?>(null); private set
    var preview by mutableStateOf<JSONObject?>(null); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var edit by mutableStateOf<JSONObject?>(null); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var deleted by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var dirty by mutableStateOf(false); private set
    var conflicted by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var inputVersion by mutableStateOf(0); private set
    @Volatile private var active = true
    private var permissions: Pair<Boolean, Boolean>? = null
    private var contextPermissions: Pair<Boolean, Boolean>? = null
    private val mutex = Mutex()
    val phase get() = record?.optString("phase") ?: "editing"
    private val mutationAllowed get() = if (edit?.optString("kind") == "template-apply" && edit?.getJSONObject("request")?.isNull("projectId") == true)
        permissions?.second != false && contextPermissions?.second != false else permissions?.first != false && contextPermissions?.first != false
    val editable get() = loaded && !busy && !lost && !conflicted && edit != null && phase == "editing" && mutationAllowed
    val receipt get() = record?.optJSONObject("receipt")
    val previewCurrent get() = preview != null && edit?.opt("review") == preview?.opt("fingerprint") && !dirty
    val hasMore get() = library?.optBoolean("hasMore") == true
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun current() { if (!active || lost) throw CancellationException() }
    fun close() { active = false; source = null; preview = null; library = null; edit = null; record = null; copies = emptyList() }
    private suspend fun <T> checked(block: suspend () -> T): T {
        currentCoroutineContext().ensureActive(); current()
        return block().also { currentCoroutineContext().ensureActive(); current() }
    }
    private fun accept(value: JSONObject?) {
        record = value?.let(::copy); edit = value?.getJSONObject("edit")?.let(::copy)
        dirty = false; conflicted = false; preview = null; inputVersion++
    }
    private fun code(failure: Exception) = when (failure) {
        is AuthApiError -> failure.code
        is AuthFailure -> failure.kind.name
        else -> failure.message?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,99}")) } ?: "PROTOCOL"
    }
    private suspend fun operate(quiet: Boolean = false, block: suspend () -> Unit) = mutex.withLock {
        current(); if (!quiet) busy = true; error = ""
        try { block() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(); error = code(failure)
            if (error in setOf("UNAUTHORIZED", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_SPACE_FORBIDDEN", "SHARED_SPACE_NOT_FOUND", "TEMPLATE_FORBIDDEN", "TEMPLATE_PERMISSION_CHANGED", "TEMPLATE_UNAVAILABLE", "TEMPLATE_SOURCE_UNAVAILABLE", "TEMPLATE_SOURCE_SCOPE_UNAVAILABLE")) {
                invalidateAccess(error)
            } else {
                if (error == "PLANNING_DRAFT_CHANGED") conflicted = true
                try {
                    val latest = checked { gateway.sharedTemplateDraft(project) }
                    if (latest != null && latest.optString("phase") != "editing") accept(latest)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Own input remains visible when local storage cannot be read. */ }
            }
        } finally { if (active && !quiet) busy = false }
    }
    /** Invalidation hides server content immediately; only our last unsaved input may enter an encrypted copy. */
    suspend fun invalidateAccess(reason: String = "TEMPLATE_PERMISSION_CHANGED") {
        if (lost || !active) return
        val own = edit?.takeIf { dirty && phase == "editing" }?.let(::copy)
        lost = true; error = reason; dirty = false; busy = false
        source = null; preview = null; library = null; edit = null; record = null; copies = emptyList()
        if (own != null) try { gateway.saveSharedTemplateCopy(project, UUID.randomUUID().toString(), null, own) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* The existing journal is preserved if the account/storage is unavailable. */ }
    }
    suspend fun updatePermissions(canWrite: Boolean, canCreate: Boolean) {
        val previous = permissions; permissions = canWrite to canCreate
        if (previous != null && (previous.first && !canWrite || previous.second && !canCreate)) invalidateAccess()
    }
    private inline fun localEdit(action: () -> Unit): Boolean {
        if (!editable) return false
        return try { action(); true }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = code(failure); false }
    }
    suspend fun load() = operate {
        require(account.isNotBlank()) { "UNAUTHORIZED" }
        SharedTemplateProtocol.id(space); SharedTemplateProtocol.id(project); SharedTemplateProtocol.language(language)
        val context = checked { gateway.sharedProject(project) }.getJSONObject("project")
        require(context.getString("id") == project && context.getString("spaceId") == space) { "TEMPLATE_SCOPE_CHANGED" }
        contextPermissions = sharedTaskCanEdit(context) to (context.optJSONObject("permissions")?.optBoolean("createProjects") == true)
        accept(checked { gateway.sharedTemplateDraft(project) }); copies = checked { gateway.sharedTemplateCopies(project) }; loaded = true
        if (edit != null && !mutationAllowed) { invalidateAccess(); return@operate }
        library = SharedTemplateProtocol.library(space, checked { gateway.sharedTemplates(space, language, deleted, null) })
    }
    suspend fun loadLibrary(archive: Boolean = deleted, more: Boolean = false) = operate {
        require(!lost) { "TEMPLATE_SOURCE_UNAVAILABLE" }
        val previous = if (more) requireNotNull(library) else null
        val cursor = previous?.getString("nextCursor")
        val result = checked { gateway.sharedTemplates(space, language, archive, cursor) }
        library = SharedTemplateProtocol.library(space, result, previous, cursor); deleted = archive
    }
    suspend fun open(id: String) = operate {
        require(edit == null && !lost) { "TEMPLATE_OWN_DRAFT" }
        source = null; preview = null
        source = SharedTemplateProtocol.source(space, id, checked { gateway.sharedTemplate(space, id, language, deleted) })
    }
    fun showLibrary() { if (!dirty && !busy) { edit = null; source = null; preview = null } }
    fun resume() { if (!busy && !lost && record != null) { edit = copy(requireNotNull(record).getJSONObject("edit")); source = null; preview = null; dirty = false; inputVersion++ } }
    suspend fun start(value: JSONObject) = operate {
        require(loaded && !lost && record == null && edit == null) { "TEMPLATE_OWN_DRAFT" }
        val initial = SharedTemplateProtocol.edit(value)
        require(initial.getString("spaceId") == space && initial.getString("projectId") == project) { "TEMPLATE_SCOPE_CHANGED" }
        edit = copy(initial); dirty = true; inputVersion++; persist()
    }
    fun change(value: JSONObject, invalidateReview: Boolean = true): Boolean = localEdit { commitChange(value, invalidateReview) }
    private fun commitChange(value: JSONObject, invalidateReview: Boolean = true) {
        val next = SharedTemplateProtocol.edit(value)
        require(next.getString("spaceId") == space && next.getString("projectId") == project) { "TEMPLATE_SCOPE_CHANGED" }
        val previous = edit
        val oldRequest = previous?.optJSONObject("request"); val request = next.getJSONObject("request")
        val scopeChanged = previous?.opt("templateId") != next.opt("templateId") || previous?.opt("kind") != next.opt("kind") ||
            listOf("spaceId", "projectId", "parentProjectId").any { oldRequest?.opt(it) != request.opt(it) }
        edit = copy(next); dirty = true; inputVersion++; error = ""
        if (invalidateReview) { edit = copy(next).put("review", JSONObject.NULL); if (scopeChanged) preview = null }
    }
    fun changeDateInput(calendar: SharedCustomCalendar) {
        val next = edit?.let(::copy) ?: return
        next.put("dateInput", calendar.saved()); change(next, invalidateReview = false)
    }
    fun changeTitle(value: String) {
        val next = edit?.let(::copy) ?: return
        next.getJSONObject("request").put("title", if (next.getString("kind") == "template-apply" && value.isBlank()) JSONObject.NULL else value); change(next)
    }
    fun changeManifest(value: JSONObject): Boolean = localEdit { commitManifest(value) }
    fun proposeManifest(proposal: () -> JSONObject): Boolean = localEdit { commitManifest(proposal()) }
    /** Evaluate the helper inside the same boundary as validation; a rejected edit never replaces the draft. */
    fun mutateManifest(action: (JSONObject) -> JSONObject): Boolean = localEdit {
        commitManifest(action(copy(requireNotNull(edit).getJSONObject("request").getJSONObject("manifest"))))
    }
    fun addTask(project: String, parent: String?): String? {
        var chosen: String? = null
        mutateManifest { manifest -> SharedTemplateEdits.addTask(manifest, project, parent = parent).also { chosen = it.second }.first }
            .also { if (!it) chosen = null }
        return chosen
    }
    private fun commitManifest(value: JSONObject) {
        val next = copy(requireNotNull(edit))
        require(next.getString("kind") == "template-save")
        val manifest = SharedTemplateManifest.validate(value, complete = false)
        val tasks = SharedTemplateManifest.rows(manifest.getJSONArray("tasks")).associateBy { it.getString("key") }
        val projects = SharedTemplateManifest.rows(manifest.getJSONArray("projects"), 50).map { it.getString("key") }.toSet()
        val inputs = next.getJSONObject("inputs")
        inputs.keys().asSequence().toList().forEach { path ->
            val parts = path.split('/'); val task = parts.getOrNull(1)?.let(tasks::get)
            val removed = when {
                parts.firstOrNull() == "tagProject" -> parts.getOrNull(1).orEmpty() !in projects
                task == null -> parts.firstOrNull() in setOf("estimate", "offset", "checklistOffset", "tag")
                parts.firstOrNull() == "offset" -> task.optJSONObject(parts.getOrNull(2).orEmpty()) == null
                parts.firstOrNull() == "checklistOffset" -> SharedTemplateManifest.rows(task.getJSONArray("checklists"), 20)
                    .firstOrNull { it.getString("key") == parts.getOrNull(2) }?.let { list -> SharedTemplateManifest.rows(list.getJSONArray("items"), 300)
                        .firstOrNull { it.getString("key") == parts.getOrNull(3) }?.optJSONObject("due") } == null
                else -> false
            }
            if (removed) inputs.remove(path)
        }
        next.getJSONObject("request").put("manifest", manifest); commitChange(next)
    }
    fun changeEstimate(task: String, field: String, value: String) {
        require(field in setOf("storyPoints", "estimateHours"))
        changeInput("estimate/${SharedTemplateManifest.key(task)}/$field", value)
    }
    fun changeInput(path: String, value: String) {
        if (!editable) return
        val next = edit?.let(::copy) ?: return
        next.getJSONObject("inputs").put(path, value); change(next)
    }
    fun clearInput(path: String) {
        val next = edit?.let(::copy) ?: return
        next.getJSONObject("inputs").remove(path); change(next)
    }
    private suspend fun persist() {
        if (!dirty) return
        require(!lost && !conflicted && phase == "editing") { "PLANNING_DRAFT_PENDING" }
        val version = inputVersion; val snapshot = copy(requireNotNull(edit))
        val saved = checked { gateway.saveSharedTemplateDraft(project, record?.getString("stamp"), snapshot) }
        record = copy(saved)
        if (version == inputVersion) { edit = copy(saved.getJSONObject("edit")); dirty = false }
    }
    // A new keystroke cancels the debounce job, but a committed local write still owes us its CAS stamp.
    suspend fun save() = withContext(NonCancellable) { operate(quiet = true) { persist() } }
    suspend fun review() = operate {
        require(!lost && !conflicted && phase == "editing") { "PLANNING_DRAFT_PENDING" }; persist()
        var value = requireNotNull(edit); require(value.getString("kind") == "template-apply")
        val latestSource = SharedTemplateProtocol.source(space, value.getString("templateId"), checked {
            gateway.sharedTemplate(space, value.getString("templateId"), value.getJSONObject("request").getString("language"), false)
        })
        source = latestSource
        val options = value.getJSONObject("request")
        val baseOptions = copy(options).put("fieldValues", JSONObject())
        val catalog = SharedTemplateProtocol.preview(space, value.getString("templateId"), baseOptions,
            checked { gateway.previewSharedTemplate(space, value.getString("templateId"), baseOptions) })
        val normalized = SharedTemplateProtocol.fieldInputs(options, catalog, latestSource.getJSONObject("manifest"))
        val hasOverrides = normalized.getJSONObject("fieldValues").length() > 0
        if (ru.genesis.calendar.auth.PlanningLifecycle.canonical(options) != ru.genesis.calendar.auth.PlanningLifecycle.canonical(normalized)) {
            value = copy(value).put("request", normalized).put("review", JSONObject.NULL); edit = value; dirty = true; inputVersion++; persist()
        }
        val result = if (!hasOverrides) catalog else SharedTemplateProtocol.preview(space, value.getString("templateId"), normalized,
            checked { gateway.previewSharedTemplate(space, value.getString("templateId"), normalized) })
        require(result.getInt("revision") == latestSource.getInt("revision")) { "TEMPLATE_PREVIEW_CHANGED" }
        edit = copy(value).put("review", result.getString("fingerprint")); dirty = true; inputVersion++; persist(); preview = result
    }
    suspend fun prepare() = operate {
        require(!lost && !conflicted && phase == "editing") { "PLANNING_DRAFT_PENDING" }; persist()
        if (edit?.optString("kind") == "template-apply") require(previewCurrent && preview?.optBoolean("canApply") == true) { "TEMPLATE_REVIEW_REQUIRED" }
        val reviewed = preview?.let(::copy)
        val ready = checked { gateway.prepareSharedTemplateDraft(project, requireNotNull(record).getString("stamp")) }; accept(ready); preview = reviewed
    }
    suspend fun send() = operate {
        require(!lost && !dirty && !conflicted && phase in setOf("pending", "received")) { "PLANNING_DRAFT_PENDING" }
        accept(checked { gateway.sendSharedTemplateDraft(project, requireNotNull(record).getString("stamp")) })
    }
    suspend fun resumeEditing() = operate {
        val current = requireNotNull(record)
        require(!lost && (phase == "rejected" || phase == "pending" && current.getInt("attempts") == 0)) { "PLANNING_DRAFT_PENDING" }
        val snapshot = copy(current.getJSONObject("edit")).put("review", JSONObject.NULL)
        val ownCopy = checked { gateway.saveSharedTemplateCopy(project, UUID.randomUUID().toString(), null, snapshot) }
        copies = checked { gateway.sharedTemplateCopies(project) }
        val stamp = if (phase == "pending") {
            checked { gateway.removeSharedTemplateDraft(project, current.getString("stamp")) }
            record = null; edit = snapshot; dirty = true
            null
        } else current.getString("stamp")
        accept(checked { gateway.useSharedTemplateCopy(project, ownCopy.getString("id"), ownCopy.getString("stamp"), stamp) })
        copies = checked { gateway.sharedTemplateCopies(project) }
    }
    suspend fun discard() = operate {
        val value = record
        if (value != null) checked { gateway.removeSharedTemplateDraft(project, value.getString("stamp")) }
        accept(null); source = null
    }
    suspend fun saveOwnCopy() = operate {
        val value = requireNotNull(edit); require(!lost)
        checked { gateway.saveSharedTemplateCopy(project, UUID.randomUUID().toString(), null, value) }
        copies = checked { gateway.sharedTemplateCopies(project) }
        if (conflicted) dirty = false // Own input is now durable in a named copy; choosing a version remains explicit.
    }
    suspend fun useCopy(id: String) = operate {
        require(!dirty && !lost) { "TEMPLATE_OWN_DRAFT" }
        val selected = copies.single { it.getString("id") == id }
        val latest = checked { gateway.sharedTemplateDraft(project) }
        accept(checked { gateway.useSharedTemplateCopy(project, id, selected.getString("stamp"), latest?.getString("stamp")) })
        copies = checked { gateway.sharedTemplateCopies(project) }; source = null
    }
    suspend fun removeCopy(id: String) = operate {
        val selected = copies.single { it.getString("id") == id }
        checked { gateway.removeSharedTemplateCopy(project, id, selected.getString("stamp")) }; copies = checked { gateway.sharedTemplateCopies(project) }
    }
}
