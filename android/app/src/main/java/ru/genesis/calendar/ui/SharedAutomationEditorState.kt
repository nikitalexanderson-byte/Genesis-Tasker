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
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.util.UUID

/** Own input is recoverable; all server names, catalogs and dry-run effects are memory-only. */
internal class SharedAutomationEditorState(private val gateway: SharedWorkspaceGateway, val account: String,
    val projectId: String, val language: String) {
    var context by mutableStateOf<JSONObject?>(null); private set
    var labels by mutableStateOf(emptyList<JSONObject>()); private set
    var templates by mutableStateOf<JSONObject?>(null); private set
    var templateNames by mutableStateOf(emptyMap<String, String>()); private set
    var tasks by mutableStateOf(emptyList<JSONObject>()); private set
    var taskCursor by mutableStateOf<String?>(null); private set
    var previewTask by mutableStateOf(""); private set
    var preview by mutableStateOf<JSONObject?>(null); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var edit by mutableStateOf<JSONObject?>(null); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var busy by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var lost by mutableStateOf(false); private set
    var conflict by mutableStateOf(false); private set
    var stale by mutableStateOf(false); private set
    var dirty by mutableStateOf(false); private set
    var version by mutableStateOf(0); private set
    var error by mutableStateOf(""); private set
    private var active = true; private var epoch = 0
    private val mutex = Mutex()
    val project get() = context?.optJSONObject("project")
    val space get() = project?.getString("spaceId")
    val fields get() = importRows(context?.optJSONArray("customFieldDefinitions")).filter { !it.getBoolean("archived") }
    val statuses get() = importRows(context?.optJSONArray("statuses"))
    val members get() = importRows(context?.optJSONArray("members"))
    val phase get() = record?.optString("phase") ?: "editing"
    val editable get() = active && loaded && !busy && !lost && !conflict && edit != null && phase == "editing"
    val canSubmit get() = editable && !stale
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun current(ticket: Int) { if (!active || ticket != epoch) throw CancellationException() }
    private suspend fun <T> checked(ticket: Int, block: suspend () -> T): T {
        currentCoroutineContext().ensureActive(); current(ticket)
        return block().also { currentCoroutineContext().ensureActive(); current(ticket) }
    }
    private fun code(error: Exception) = when (error) {
        is AuthApiError -> error.code; is CustomFieldFailure -> error.code; is WorkflowFailure -> error.code
        is AuthFailure -> sharedFailureCode(error)
        else -> error.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "AUTOMATION_PROTOCOL"
    }
    private fun clearLive() { context = null; labels = emptyList(); templates = null; templateNames = emptyMap(); tasks = emptyList(); preview = null; taskCursor = null }
    fun close() { active = false; epoch++; clearLive(); edit = null; record = null; copies = emptyList(); busy = false }
    fun pause() { epoch++; clearLive(); edit = null; record = null; copies = emptyList(); busy = false; loaded = false }
    private fun accept(saved: JSONObject?) { record = saved?.let(::copy); edit = saved?.getJSONObject("edit")?.let(::copy); dirty = false; preview = null; version++ }
    private suspend fun operate(quiet: Boolean = false, action: suspend (Int) -> Unit) = mutex.withLock {
        val ticket = epoch; current(ticket); if (!quiet) { busy = true; error = "" }
        try { action(ticket) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(ticket); error = code(failure)
            if (workflowAccessLost(failure) || error in setOf("AUTOMATION_PERMISSION_CHANGED", "SHARED_PROJECT_FORBIDDEN")) {
                val own = edit?.takeIf { dirty && phase == "editing" }?.let(::copy)
                lost = true; clearLive(); edit = null; record = null; copies = emptyList(); dirty = false
                if (own != null) try { checked(ticket) { gateway.saveSharedAutomationEditorCopy(projectId, UUID.randomUUID().toString(), null, own) } }
                catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
            } else {
                if (error == "PLANNING_DRAFT_CHANGED") conflict = true
                try { val latest = checked(ticket) { gateway.sharedAutomationEditor(projectId) }; if (latest != null && latest.optString("phase") != "editing") accept(latest) }
                catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
            }
        } finally { if (active && ticket == epoch && !quiet) busy = false }
    }
    private suspend fun readContext(ticket: Int) {
        val raw = checked(ticket) { gateway.sharedProject(projectId) }
        require(!raw.optBoolean("offlineCache")) { "AUTOMATION_ONLINE_REQUIRED" }
        val project = raw.getJSONObject("project"); require(project.optString("id") == projectId) { "AUTOMATION_SCOPE_CHANGED" }
        require(project.getJSONObject("permissions").optBoolean("editTasks") && project.optString("archivedAt") in setOf("", "null")) { "AUTOMATION_PERMISSION_CHANGED" }
        val catalog = CustomFieldProtocol.definitions(project.getString("spaceId"), projectId, raw.getJSONArray("customFieldDefinitions"))
        context = copy(raw).put("customFieldDefinitions", JSONArray(catalog))
        val draft = edit
        if (draft != null) {
            require(project.getString("spaceId") == draft.getString("spaceId")) { "AUTOMATION_SCOPE_CHANGED" }
            if (!draft.isNull("ruleId")) {
                val rule = SharedAutomationProtocol.rule(checked(ticket) { gateway.sharedAutomation(projectId, draft.getString("ruleId")) }.getJSONObject("rule"), projectId)
                require(rule.getBoolean("canManage") && !rule.getBoolean("deleted")) { "AUTOMATION_PERMISSION_CHANGED" }
                stale = rule.getInt("revision") != draft.getInt("revision")
            } else stale = false
        }
    }
    suspend fun load(requestedRule: String?, copyRule: Boolean, calendar: SharedCustomCalendar) = operate { ticket ->
        require(account.isNotBlank()) { "UNAUTHORIZED" }; clearLive(); lost = false; conflict = false
        accept(checked(ticket) { gateway.sharedAutomationEditor(projectId) }); copies = checked(ticket) { gateway.sharedAutomationEditorCopies(projectId) }
        readContext(ticket)
        if (record == null) {
            val source = requestedRule?.let { SharedAutomationProtocol.rule(checked(ticket) { gateway.sharedAutomation(projectId, it) }.getJSONObject("rule"), projectId) }
            require(source == null || copyRule || source.getBoolean("canManage") && !source.getBoolean("deleted")) { "SHARED_PROJECT_FORBIDDEN" }
            var next = SharedAutomationEditorProtocol.newEdit(requireNotNull(space), projectId, account, SharedAutomationEditorEdits.initial(calendar), source)
            if (copyRule) next = next.put("ruleId", JSONObject.NULL).put("revision", JSONObject.NULL).put("ownerId", account).put("enabled", false)
            edit = next; dirty = true; persist(ticket)
        }
        loaded = true; readCatalogs(ticket); readTasks(ticket, false)
        if (hasTemplateActions()) readTemplateLibrary(ticket, false)
    }
    private suspend fun readCatalogs(ticket: Int) {
        val filter = JSONObject().put("projectIds", JSONArray().put(projectId)); val all = mutableListOf<JSONObject>(); var cursor: String? = null; val seen = mutableSetOf<String>()
        for (index in 0 until 100) {
            val page = SharedBulkProtocol.options(checked(ticket) { gateway.sharedBulkOptions("labels", filter, cursor) })
            all += importRows(page.getJSONArray("options"))
            if (!page.getBoolean("hasMore")) { labels = all.distinctBy { it.getString("id") }; return }
            cursor = page.getString("nextCursor"); require(seen.add(cursor!!)) { "AUTOMATION_PROTOCOL" }
        }
        error("AUTOMATION_SIZE_LIMIT")
    }
    private suspend fun readTemplateLibrary(ticket: Int, more: Boolean) {
        val before = if (more) templates else null; val after = before?.getString("nextCursor")
        templates = SharedTemplateProtocol.library(requireNotNull(space), checked(ticket) { gateway.sharedTemplates(requireNotNull(space), language, false, after) }, before, after)
        templateNames = emptyMap()
        val visible = (importRows(templates?.getJSONArray("templates")) + importRows(templates?.getJSONArray("systemTemplates"))).map { it.getString("id") }.toSet()
        val selected = importRows(edit?.getJSONObject("definition")?.getJSONArray("actions")).filter { it.optString("type") == "createTemplate" && !it.optBoolean("unavailable") && it.optString("templateId").isNotEmpty() }
        val resolved = linkedMapOf<String, String>()
        for (id in selected.map { it.getString("templateId") }.distinct().filterNot { it in visible }) {
            try {
                val source = SharedTemplateProtocol.source(requireNotNull(space), id, checked(ticket) { gateway.sharedTemplate(requireNotNull(space), id, language, false) })
                if (source.getString("kind") == "task") resolved[id] = source.getString("title")
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                current(ticket)
                val code = code(failure)
                if (code !in SharedTemplateProtocol.errors && !workflowAccessLost(failure)) throw failure
            }
        }
        templateNames = resolved
    }
    private fun hasTemplateActions() = importRows(edit?.getJSONObject("definition")?.getJSONArray("actions")).any { it.optString("type") == "createTemplate" }
    private suspend fun readTasks(ticket: Int, more: Boolean) {
        val after = if (more) taskCursor else null
        val page = checked(ticket) { gateway.querySharedTasks(JSONObject().put("projectIds", JSONArray().put(projectId)), after) }
        require(!page.optBoolean("offlineCache")) { "AUTOMATION_ONLINE_REQUIRED" }
        val rows = importRows(page.getJSONArray("tasks")); require(rows.size <= 100 && rows.all { it.optString("projectId") == projectId }) { "AUTOMATION_PROTOCOL" }
        tasks = ((if (more) tasks else emptyList()) + rows).distinctBy { it.getString("id") }
        taskCursor = page.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }; require(after == null || after != taskCursor) { "AUTOMATION_PROTOCOL" }
    }
    suspend fun moreTasks() = operate { readTasks(it, true) }
    suspend fun templateLibrary(more: Boolean = false) = operate { readTemplateLibrary(it, more) }
    suspend fun refresh() = operate { ticket -> readContext(ticket); readCatalogs(ticket); if (hasTemplateActions()) readTemplateLibrary(ticket, false); readTasks(ticket, false); preview = null }
    suspend fun poll() { if (loaded && !busy && !lost) operate(quiet = true) { ticket ->
        readContext(ticket); preview = null
        if (hasTemplateActions()) { templates = null; templateNames = emptyMap(); readTemplateLibrary(ticket, false) }
    } }
    fun changeTask(id: String) { if (editable) { previewTask = id; preview = null } }
    fun mutate(action: (JSONObject) -> Unit): Boolean {
        if (!editable) return false
        return try {
            val next = copy(requireNotNull(edit)); action(next); edit = SharedAutomationEditorProtocol.edit(next)
            dirty = true; version++; preview = null; error = ""; true
        } catch (failure: Exception) { error = code(failure); false }
    }
    private suspend fun persist(ticket: Int) {
        if (!dirty) return
        require(!lost && !conflict && phase == "editing") { "PLANNING_DRAFT_PENDING" }
        val captured = version; val saved = checked(ticket) { gateway.saveSharedAutomationEditor(projectId, record?.getString("stamp"), copy(requireNotNull(edit))) }
        record = copy(saved); if (captured == version) { edit = copy(saved.getJSONObject("edit")); dirty = false }
    }
    suspend fun saveLocal() { if (dirty) withContext(NonCancellable) { operate(quiet = true) { persist(it) } } }
    suspend fun dryRun() = operate { ticket -> persist(ticket); readContext(ticket); require(!stale) { "AUTOMATION_CONFLICT" }
        preview = checked(ticket) { gateway.previewSharedAutomationEditor(projectId, requireNotNull(record).getString("stamp"), previewTask.takeIf(String::isNotEmpty)) }
    }
    suspend fun submit() = operate { ticket ->
        if (phase == "editing") { persist(ticket); readContext(ticket); require(!stale) { "AUTOMATION_CONFLICT" }; accept(checked(ticket) { gateway.prepareSharedAutomationEditor(projectId, requireNotNull(record).getString("stamp")) }) }
        require(phase == "pending") { "PLANNING_DRAFT_PENDING" }
        accept(checked(ticket) { gateway.sendSharedAutomationEditor(projectId, requireNotNull(record).getString("stamp")) })
        require(phase == "received") { "AUTOMATION_RECEIPT_INVALID" }
    }
    suspend fun saveCopy() = operate { ticket ->
        checked(ticket) { gateway.saveSharedAutomationEditorCopy(projectId, UUID.randomUUID().toString(), null, requireNotNull(edit)) }
        copies = checked(ticket) { gateway.sharedAutomationEditorCopies(projectId) }
    }
    suspend fun useCopy(id: String) = operate { ticket ->
        require(!dirty) { "PLANNING_DRAFT_CHANGED" }; val entry = copies.single { it.getString("id") == id }
        accept(checked(ticket) { gateway.useSharedAutomationEditorCopy(projectId, id, entry.getString("stamp"), record?.getString("stamp")) }); readContext(ticket)
    }
    suspend fun removeCopy(id: String) = operate { ticket ->
        val entry = copies.single { it.getString("id") == id }; checked(ticket) { gateway.removeSharedAutomationEditorCopy(projectId, id, entry.getString("stamp")) }
        copies = checked(ticket) { gateway.sharedAutomationEditorCopies(projectId) }
    }
    suspend fun asNewCopy() = operate { ticket ->
        require(phase in setOf("editing", "rejected")) { "PLANNING_DRAFT_PENDING" }
        val next = copy(requireNotNull(edit)).put("ruleId", JSONObject.NULL).put("revision", JSONObject.NULL).put("ownerId", account).put("enabled", false)
        val own = checked(ticket) { gateway.saveSharedAutomationEditorCopy(projectId, UUID.randomUUID().toString(), null, next) }
        accept(checked(ticket) { gateway.useSharedAutomationEditorCopy(projectId, own.getString("id"), own.getString("stamp"), record?.getString("stamp")) })
        copies = checked(ticket) { gateway.sharedAutomationEditorCopies(projectId) }; stale = false; conflict = false; readContext(ticket)
    }
    suspend fun discard() = operate { ticket ->
        record?.let { checked(ticket) { gateway.removeSharedAutomationEditor(projectId, it.getString("stamp")) } }; accept(null)
    }
}
