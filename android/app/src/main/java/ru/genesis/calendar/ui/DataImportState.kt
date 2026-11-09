package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.DataImportProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.io.InputStream
import java.util.UUID

/** The UI holds selections and compact results. File bytes live only in the protected source store. */
internal class DataImportState(private val gateway: SharedWorkspaceGateway, private val account: String,
    private val space: String, private val project: String, initial: JSONObject) {
    var selection by mutableStateOf(JSONObject(initial.toString())); private set
    var record by mutableStateOf<JSONObject?>(null); private set
    var preview by mutableStateOf<JSONObject?>(null); private set
    var previewCurrent by mutableStateOf(false); private set
    var headers by mutableStateOf(emptyList<String>()); private set
    var copies by mutableStateOf(emptyList<JSONObject>()); private set
    var history by mutableStateOf(emptyList<JSONObject>()); private set
    var pendingUndos by mutableStateOf(emptyList<JSONObject>()); private set
    var undoOutcomes by mutableStateOf(emptyList<JSONObject>()); private set
    var cursor by mutableStateOf<String?>(null); private set
    var historyLoaded by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var dirty by mutableStateOf(false); private set
    var revision by mutableStateOf(0); private set
    var error by mutableStateOf(""); private set
    var message by mutableStateOf(""); private set
    @Volatile private var active = true
    private val lock = Mutex()
    private val defaults = JSONObject(initial.toString())
    private var headerKey: String? = null
    val phase: String get() = record?.optString("phase") ?: "editing"
    val hostProject: String get() = project
    val editable: Boolean get() = loaded && !busy && phase == "editing"
    val receipt: JSONObject? get() = record?.optJSONObject("receipt")?.let { original ->
        undoOutcomes.find { it.optString("importId") == original.optString("importId") } ?: original
    }
    fun close() { active = false }
    fun pickerFailed() { if (active) error = "DATA_PICKER_FAILED" }
    private fun current() { if (!active) throw CancellationException() }
    private suspend fun <T> checked(action: suspend () -> T): T {
        currentCoroutineContext().ensureActive(); current()
        return action().also { currentCoroutineContext().ensureActive(); current() }
    }
    private fun accept(value: JSONObject?) {
        record = value; if (value != null) selection = JSONObject(value.getJSONObject("edit").getJSONObject("selection").toString())
        dirty = false
    }
    private fun failureCode(failure: Exception) = when (failure) {
        is AuthApiError -> failure.code
        is AuthFailure -> failure.kind.name
        is java.nio.charset.CharacterCodingException -> "DATA_SOURCE_INVALID"
        is java.io.IOException, is SecurityException -> "DATA_SOURCE_STORAGE"
        else -> failure.message?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,99}")) } ?: "PROTOCOL"
    }
    private suspend fun operate(quiet: Boolean = false, action: suspend () -> Unit) = lock.withLock {
        current(); if (!quiet) busy = true; error = ""; message = ""
        try { action() }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            current(); error = failureCode(failure)
            // A durable attempt may have advanced its stamp despite a lost HTTPS response.
            try { val latest = checked { gateway.sharedDataImportDraft(space, project) }; if (latest != null && latest.optString("phase") != "editing") accept(latest) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Keep the visible draft when storage cannot be read. */ }
            try { pendingUndos = checked { gateway.pendingSharedDataUndos(space) }; undoOutcomes = checked { gateway.sharedDataUndoOutcomes(space) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        } finally { if (active && !quiet) busy = false }
    }
    suspend fun load() = operate {
        require(account.isNotBlank()) { "UNAUTHORIZED" }
        accept(checked { gateway.sharedDataImportDraft(space, project) }); copies = checked { gateway.sharedDataImportCopies(space, project) }
        pendingUndos = checked { gateway.pendingSharedDataUndos(space) }; undoOutcomes = checked { gateway.sharedDataUndoOutcomes(space) }; loaded = true; readHeaders()
    }
    fun change(value: JSONObject) {
        if (!editable) return
        selection = JSONObject(value.toString()); dirty = record != null; previewCurrent = false; revision++; error = ""; message = ""
    }
    private suspend fun persist() {
        if (!dirty) return
        val version = revision
        val old = requireNotNull(record); val edit = JSONObject(old.getJSONObject("edit").toString()).put("selection", DataImportProtocol.selection(selection)).put("review", JSONObject.NULL)
        val saved = checked { gateway.saveSharedDataImportDraft(space, project, old.getString("stamp"), edit) }
        if (version == revision) accept(saved) else record = saved
        readHeaders()
    }
    private suspend fun readHeaders() {
        val key = record?.takeIf { selection.optString("format") == "csv" }?.getJSONObject("edit")?.getJSONObject("source")?.getString("id")
            ?.let { it + ":" + selection.getJSONObject("parse").getString("delimiter") }
        if (key == headerKey) return
        headerKey = null; headers = emptyList()
        headers = if (key != null) checked {
            gateway.sharedDataImportHeaders(space, project, requireNotNull(record).getString("stamp"), selection.getJSONObject("parse").getString("delimiter"))
        } else emptyList()
        headerKey = key
    }
    suspend fun save() = operate(quiet = true) { persist() }
    suspend fun pickerParameters(): String? {
        var result: String? = null
        operate {
            require(editable || phase == "editing") { "PLANNING_DRAFT_PENDING" }; persist()
            val value = JSONObject().put("account", account).put("space", space).put("project", project).put("stamp", record?.getString("stamp") ?: JSONObject.NULL)
            if (record == null) value.put("selection", DataImportProtocol.selection(selection))
            val raw = value.toString(); require(raw.toByteArray(Charsets.UTF_8).size <= 65_536) { "DATA_IMPORT_INVALID" }; result = raw
        }
        return result
    }
    suspend fun choose(parameters: String, name: String, open: () -> InputStream) = operate {
        val prepared = JSONObject(parameters)
        require(prepared.opt("account") == account && prepared.opt("space") == space && prepared.opt("project") == project) { "UNAUTHORIZED" }
        val stamp = prepared.opt("stamp").takeUnless { it == JSONObject.NULL } as String?
        val currentRecord = checked { gateway.sharedDataImportDraft(space, project) }
        require(currentRecord?.optString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        val selected = currentRecord?.getJSONObject("edit")?.getJSONObject("selection") ?: prepared.getJSONObject("selection")
        accept(checked { gateway.chooseSharedDataImportSource(space, project, stamp, name, selected, open) }); preview = null; previewCurrent = false; readHeaders()
    }
    suspend fun inspect() = operate {
        persist(); val old = requireNotNull(record) { "DATA_EMPTY" }
        val result = checked { gateway.inspectSharedDataImport(space, project, old.getString("stamp")) }
        accept(result.getJSONObject("record")); preview = result.getJSONObject("preview"); previewCurrent = true
    }
    suspend fun apply() = operate {
        require(previewCurrent && phase == "editing" && !dirty) { "DATA_PREVIEW_REQUIRED" }
        val old = requireNotNull(record)
        accept(checked { gateway.prepareSharedDataImport(space, project, old.getString("stamp")) })
        val pending = requireNotNull(record)
        accept(checked { gateway.sendSharedDataImport(space, project, pending.getString("stamp")) }); previewCurrent = false
    }
    suspend fun retry() = operate {
        val old = requireNotNull(record); require(old.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        accept(checked { gateway.sendSharedDataImport(space, project, old.getString("stamp")) })
    }
    suspend fun clear() = operate {
        persist()
        record?.let { old -> checked { gateway.removeSharedDataImportDraft(space, project, old.getString("stamp")) } }
        record = null; selection = JSONObject(defaults.toString()); preview = null; headers = emptyList(); dirty = false; previewCurrent = false; message = ""
        copies = checked { gateway.sharedDataImportCopies(space, project) }
    }
    suspend fun saveCopy() = operate {
        val old = requireNotNull(record); val edit = JSONObject(old.getJSONObject("edit").toString()).put("selection", DataImportProtocol.selection(selection))
        if (dirty) edit.put("review", JSONObject.NULL)
        checked { gateway.saveSharedDataImportCopy(space, project, UUID.randomUUID().toString(), null, edit) }
        copies = checked { gateway.sharedDataImportCopies(space, project) }; message = "Версия сохранена на устройстве."
    }
    suspend fun useCopy(copy: JSONObject) = operate {
        accept(checked { gateway.useSharedDataImportCopy(space, project, copy.getString("id"), copy.getString("stamp"), record?.getString("stamp")) })
        copies = checked { gateway.sharedDataImportCopies(space, project) }; preview = null; previewCurrent = false
        readHeaders()
    }
    suspend fun removeCopy(copy: JSONObject) = operate {
        checked { gateway.removeSharedDataImportCopy(space, project, copy.getString("id"), copy.getString("stamp")) }
        copies = checked { gateway.sharedDataImportCopies(space, project) }
    }
    suspend fun refreshHistory(more: Boolean = false) = operate {
        val response = checked { gateway.sharedDataImports(space, if (more) cursor else null) }
        val rows = response.getJSONArray("imports"); val incoming = (0 until rows.length()).map(rows::getJSONObject)
        history = ((if (more) history else emptyList()) + incoming).distinctBy { it.getString("importId") }
        cursor = response.opt("nextCursor").takeUnless { it == JSONObject.NULL } as String?; historyLoaded = true
        pendingUndos = checked { gateway.pendingSharedDataUndos(space) }
        undoOutcomes = checked { gateway.sharedDataUndoOutcomes(space) }
    }
    suspend fun undo(value: JSONObject) = operate {
        checked { gateway.undoSharedDataImport(space, value) }
        val id = value.getString("importId")
        history = history.map { if (it.optString("importId") == id) JSONObject(it.toString()).put("state", "undone").put("canUndo", false) else it }
        record?.optJSONObject("receipt")?.takeIf { it.optString("importId") == id }?.let {
            message = "Импорт отменён."
        }
        pendingUndos = checked { gateway.pendingSharedDataUndos(space) }; undoOutcomes = checked { gateway.sharedDataUndoOutcomes(space) }; message = "Импорт отменён."
    }
}
