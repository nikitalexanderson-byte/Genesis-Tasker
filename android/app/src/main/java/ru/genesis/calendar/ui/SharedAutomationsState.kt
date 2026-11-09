package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.time.Instant

/** All names are live, account/project-scoped data. Only identifiers survive UI restoration. */
internal class SharedAutomationsState(private val gateway: SharedWorkspaceGateway, val projectId: String, val language: String,
    initialRule: String, initialDeleted: Boolean, private val onSelection: (String, Boolean) -> Unit,
    private val onLost: () -> Unit, private val onChanged: () -> Unit) {
    var ruleId by mutableStateOf(initialRule.takeIf { runCatching { SharedAutomationProtocol.id(it) }.isSuccess }.orEmpty()); private set
    var deleted by mutableStateOf(initialDeleted); private set
    var context by mutableStateOf<JSONObject?>(null); private set
    var page by mutableStateOf<JSONObject?>(null); private set
    var rule by mutableStateOf<JSONObject?>(null); private set
    var runs by mutableStateOf<JSONObject?>(null); private set
    var labels by mutableStateOf(emptyMap<String, String>()); private set
    var templates by mutableStateOf(emptyMap<String, String>()); private set
    private var templateInspections by mutableStateOf(emptyMap<String, SharedAutomationTemplateInspection>())
    var record by mutableStateOf<JSONObject?>(null); private set
    var cursor by mutableStateOf<String?>(null); private set
    var runCursor by mutableStateOf<String?>(null); private set
    var previousPages by mutableStateOf(emptyList<String>()); private set
    var previousRunPages by mutableStateOf(emptyList<String>()); private set
    var busy by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var observedAt by mutableStateOf(0L); private set
    private var closed = false; private var epoch = 0
    val project get() = context?.optJSONObject("project")
    val phase get() = record?.optString("phase").orEmpty()
    val canManage get() = rule?.optBoolean("canManage") == true && project?.optString("archivedAt").let { it.isNullOrBlank() || it == "null" }
    val canMutate get() = canManage && record == null && !busy
    val workerFresh get() = page?.optString("workerCompletedAt")?.takeUnless { it.isBlank() || it == "null" }?.let {
        val age = observedAt - Instant.parse(it).toEpochMilli(); age in -60000L..600000L
    } == true
    fun member(id: String?) = id?.let { target -> context?.optJSONArray("members")?.let(::importRows)?.firstOrNull { it.optString("userId") == target }?.optString("displayName") }
    fun status(id: String) = context?.optJSONArray("statuses")?.let(::importRows)?.firstOrNull { it.optString("id") == id }?.optString("title")
    fun field(id: String) = context?.optJSONArray("customFieldDefinitions")?.let(::importRows)?.firstOrNull { it.optString("id") == id }
    fun templateInspection(action: JSONObject) = if (action.optString("type") != "createTemplate" || action.optBoolean("unavailable") || !templates.containsKey(action.optString("templateId"))) null
        else templateInspections[SharedAutomationTemplateInspection.key(action)]?.takeIf { it.matches(action) }
    private fun current(ticket: Int) { if (closed || ticket != epoch) throw CancellationException() }
    private fun clearLive() { context = null; page = null; rule = null; runs = null; labels = emptyMap(); templates = emptyMap(); templateInspections = emptyMap(); observedAt = 0 }
    private fun adopt(saved: JSONObject?) {
        record = saved
        val target = saved?.getJSONObject("edit")?.getString("ruleId") ?: return
        if (ruleId != target) { ruleId = target; rule = null; runs = null; labels = emptyMap(); templates = emptyMap(); templateInspections = emptyMap(); runCursor = null; previousRunPages = emptyList(); onSelection(ruleId, deleted) }
    }
    fun close() { closed = true; epoch++; clearLive(); busy = false }
    fun pause() { epoch++; clearLive(); busy = false }
    private suspend fun work(action: suspend (Int) -> Unit) {
        if (closed || busy) return
        val ticket = epoch; busy = true; error = ""
        try { action(ticket); current(ticket) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(ticket); clearLive()
            error = when (failure) {
                is AuthApiError -> failure.code; is CustomFieldFailure -> failure.code; is WorkflowFailure -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "AUTOMATION_PROTOCOL"
            }
            try { val saved = gateway.sharedAutomationDraft(projectId); current(ticket); adopt(saved) }
            catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* A failed read never discards an earlier durable command. */ }
            if (workflowAccessLost(failure)) onLost()
        } finally { if (!closed && epoch == ticket) busy = false }
    }
    private suspend fun readContext(ticket: Int) {
        val raw = gateway.sharedProject(projectId); current(ticket)
        require(!raw.optBoolean("offlineCache")) { "AUTOMATION_ONLINE_REQUIRED" }
        val project = raw.getJSONObject("project"); require(project.optString("id") == projectId) { "AUTOMATION_SCOPE_CHANGED" }
        val fields = CustomFieldProtocol.definitions(project.getString("spaceId"), projectId, raw.optJSONArray("customFieldDefinitions") ?: JSONArray())
        val metadata = JSONObject().put("project", JSONObject(project.toString())).put("customFieldDefinitions", JSONArray(fields))
        for (key in listOf("members", "statuses")) {
            val rows = raw.optJSONArray(key) ?: JSONArray(); require(rows.length() <= 10000) { "AUTOMATION_PROTOCOL" }
            metadata.put(key, JSONArray(rows.toString()))
        }
        context = metadata
    }
    private suspend fun readList(ticket: Int, after: String?) {
        val fresh = SharedAutomationProtocol.list(gateway.sharedAutomations(projectId, deleted, after), projectId); current(ticket)
        require(importRows(fresh.getJSONArray("rules")).all { it.getBoolean("deleted") == deleted }) { "AUTOMATION_PROTOCOL" }
        require(after == null || fresh.optString("nextCursor") != after) { "AUTOMATION_PROTOCOL" }
        page = fresh; observedAt = System.currentTimeMillis()
    }
    private suspend fun readRule(ticket: Int) {
        val target = ruleId; require(target.isNotEmpty())
        val fresh = SharedAutomationProtocol.rule(gateway.sharedAutomation(projectId, target).getJSONObject("rule"), projectId); current(ticket)
        require(fresh.getString("id") == target) { "AUTOMATION_SCOPE_CHANGED" }; rule = fresh
        val history = SharedAutomationProtocol.runs(gateway.sharedAutomationRuns(projectId, target, runCursor), target); current(ticket)
        require(runCursor == null || history.optString("nextCursor") != runCursor) { "AUTOMATION_PROTOCOL" }; runs = history
        readNames(ticket, fresh.getJSONObject("definition"))
    }
    private suspend fun readNames(ticket: Int, definition: JSONObject) {
        val conditions = importRows(definition.getJSONArray("conditions")); val actions = importRows(definition.getJSONArray("actions"))
        val needed = conditions.filter { it.getString("field") == "label" }.map { it.getString("value") }.toMutableSet()
        actions.filter { it.getString("type") in setOf("addLabels", "removeLabels") }.forEach { action ->
            val ids = action.getJSONArray("value"); (0 until ids.length()).forEach { needed += ids.getString(it) }
        }
        val names = mutableMapOf<String, String>(); var next: String? = null; val seen = mutableSetOf<String>()
        if (needed.isNotEmpty()) for (index in 0 until 20) {
            val page = SharedBulkProtocol.options(gateway.sharedBulkOptions("labels", JSONObject().put("projectIds", JSONArray().put(projectId)), next)); current(ticket)
            importRows(page.getJSONArray("options")).filter { it.getString("id") in needed }.forEach { names[it.getString("id")] = it.getString("title") }
            if (names.keys.containsAll(needed) || !page.getBoolean("hasMore")) break
            val after = page.getString("nextCursor"); require(seen.add(after)) { "AUTOMATION_PROTOCOL" }; next = after
        }
        labels = names
        val sources = mutableMapOf<String, String>()
        val inspections = mutableMapOf<String, SharedAutomationTemplateInspection>()
        for (action in actions.filter { it.getString("type") == "createTemplate" && !it.optBoolean("unavailable") }) {
            val id = action.getString("templateId")
            try {
                if (!sources.containsKey(id)) {
                    val fresh = gateway.sharedAutomationTemplate(id, language); current(ticket)
                    require(fresh.optString("id") == id && fresh.opt("title") is String) { "AUTOMATION_PROTOCOL" }; sources[id] = fresh.getString("title")
                }
                if (action.getJSONObject("options").length() > 0) {
                    val key = SharedAutomationTemplateInspection.key(action)
                    if (!inspections.containsKey(key)) try {
                        inspections[key] = SharedAutomationTemplateInspection.read(gateway, requireNotNull(project).getString("spaceId"), projectId, definition, action, { current(ticket) })
                    } catch (invalid: IllegalArgumentException) {
                        current(ticket) // Unknown or incompatible options stay unreadable and cannot enable a rule.
                    } catch (invalid: AuthApiError) {
                        current(ticket)
                        // A changed mapping blocks execution, but the rule must remain editable and disableable.
                        // Access loss and transport failures still go through the outer guarded read.
                        if (invalid.code !in setOf("TEMPLATE_INVALID", "TEMPLATE_REFERENCE_INVALID", "TEMPLATE_DATE_INVALID",
                                "TEMPLATE_DATE_OUTSIDE_RANGE", "TEMPLATE_LANGUAGE_INVALID", "TEMPLATE_DESTINATION_INVALID",
                                "TEMPLATE_STATUS_MAPPING_INVALID", "TEMPLATE_CATEGORY_MAPPING_INVALID", "TEMPLATE_FIELD_MAPPING_INVALID",
                                "TEMPLATE_PREVIEW_CHANGED", "INVALID_CALENDAR_TIME_ZONE", "INVALID_BOARD_DISPLAY")) throw invalid
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                current(ticket)
                if (!(failure is AuthFailure && failure.httpStatus in setOf(403, 404) || failure is AuthApiError && failure.code in setOf("TEMPLATE_NOT_FOUND", "SHARED_FORBIDDEN", "TEMPLATE_FORBIDDEN", "TEMPLATE_UNAVAILABLE", "TEMPLATE_SOURCE_UNAVAILABLE", "TEMPLATE_SOURCE_SCOPE_UNAVAILABLE"))) throw failure
                sources.remove(id)
            }
        }
        templates = sources
        templateInspections = inspections
    }
    suspend fun load() = work { ticket ->
        clearLive(); val saved = gateway.sharedAutomationDraft(projectId); current(ticket); adopt(saved); loaded = true
        readContext(ticket); readList(ticket, cursor); if (ruleId.isNotEmpty()) readRule(ticket)
    }
    suspend fun refresh() = work { ticket ->
        clearLive(); cursor = null; runCursor = null; previousPages = emptyList(); previousRunPages = emptyList()
        val saved = gateway.sharedAutomationDraft(projectId); current(ticket); adopt(saved); loaded = true
        readContext(ticket); readList(ticket, null); if (ruleId.isNotEmpty()) readRule(ticket)
    }
    suspend fun poll() { if (loaded && !busy && cursor == null && runCursor == null && record == null) work { ticket ->
        readContext(ticket); readList(ticket, null); if (ruleId.isNotEmpty()) readRule(ticket)
    } }
    suspend fun choose(id: String) = work { ticket ->
        require(record == null) { "PLANNING_DRAFT_PENDING" }; ruleId = SharedAutomationProtocol.id(id); onSelection(ruleId, deleted)
        rule = null; runs = null; runCursor = null; previousRunPages = emptyList(); labels = emptyMap(); templates = emptyMap(); templateInspections = emptyMap()
        readContext(ticket); readRule(ticket)
    }
    suspend fun list(deleted: Boolean = this.deleted) = work { ticket ->
        require(record == null) { "PLANNING_DRAFT_PENDING" }; this.deleted = deleted; ruleId = ""; cursor = null; previousPages = emptyList()
        clearLive(); onSelection(ruleId, deleted); readContext(ticket); readList(ticket, null)
    }
    suspend fun page(history: Boolean, next: Boolean) = work { ticket ->
        val active = if (history) runs else page; val before = if (history) runCursor else cursor
        var stack = if (history) previousRunPages else previousPages
        val target = if (next) { val after = requireNotNull(active).getString("nextCursor"); SharedAutomationProtocol.id(after); stack = stack + before.orEmpty(); after }
            else { require(stack.isNotEmpty()); stack.last().ifEmpty { null }.also { stack = stack.dropLast(1) } }
        if (history) { runCursor = target; previousRunPages = stack; runs = null } else { cursor = target; previousPages = stack; page = null }
        readContext(ticket); if (history) readRule(ticket) else readList(ticket, target)
    }
    suspend fun apply(kind: String, value: Boolean? = null, runId: String? = null, expectedRule: String, expectedRevision: Int) = work { ticket ->
        val selected = requireNotNull(rule); require(record == null && selected.getBoolean("canManage")) { "SHARED_PROJECT_FORBIDDEN" }
        require(selected.getString("id") == expectedRule && selected.getInt("revision") == expectedRevision) { "AUTOMATION_CONFLICT" }
        if (kind == "retry" || kind == "enabled" && value == true) require(automationCanReadParameters(this)) { "AUTOMATION_STALE" }
        val edit = JSONObject().put("projectId", projectId).put("ruleId", selected.getString("id")).put("revision", selected.getInt("revision")).put("kind", kind)
            .apply { if (kind == "retry") put("runId", requireNotNull(runId)) else put("value", requireNotNull(value)) }
        val saved = gateway.saveSharedAutomationDraft(projectId, null, edit); current(ticket); record = saved
        send(ticket)
    }
    private suspend fun send(ticket: Int) {
        if (phase == "editing") { val prepared = gateway.prepareSharedAutomationDraft(projectId, record!!.getString("stamp")); current(ticket); record = prepared }
        require(phase == "pending") { "PLANNING_DRAFT_PENDING" }
        val result = gateway.sendSharedAutomationDraft(projectId, record!!.getString("stamp")); current(ticket); record = result
        require(phase == "received") { "AUTOMATION_RECEIPT_INVALID" }; onChanged(); readContext(ticket); readList(ticket, null); readRule(ticket)
    }
    suspend fun retry() = work { ticket -> send(ticket) }
    suspend fun finish() = work { ticket ->
        val saved = requireNotNull(record); gateway.removeSharedAutomationDraft(projectId, saved.getString("stamp")); current(ticket); record = null
        readContext(ticket); readList(ticket, null); if (ruleId.isNotEmpty()) readRule(ticket)
    }
    suspend fun openTask(id: String, onOpen: () -> Unit) = work { ticket ->
        val task = gateway.sharedTask(projectId, id); current(ticket)
        require(!task.optBoolean("offlineCache") && task.getJSONObject("task").optString("projectId") == projectId && task.getJSONObject("task").optString("id") == id) { "AUTOMATION_SCOPE_CHANGED" }
        onOpen()
    }
}
