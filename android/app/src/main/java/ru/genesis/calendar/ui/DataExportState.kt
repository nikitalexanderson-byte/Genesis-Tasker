package ru.genesis.calendar.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway

internal fun interface DataExportDestination {
    suspend fun write(content: String, current: () -> Unit)
}

/** Holds only a frozen selection while the system picker is open; file contents are never saved in UI state. */
internal class DataExportState(private val controller: SharedWorkspaceGateway, private val account: String,
    private val space: String, restored: String? = null) {
    var prepared by mutableStateOf<String?>(null); private set
    var working by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var receipt by mutableStateOf<JSONObject?>(null); private set
    @Volatile private var active = true
    @Volatile private var epoch = 0
    val busy: Boolean get() = working || prepared != null

    init {
        if (restored != null) runCatching {
            val value = JSONObject(restored)
            require(value.getString("account") == account && value.getString("space") == space)
            prepared = DataExportProtocol.command(space, value.getJSONObject("command")).toString()
        }.onFailure { error = "PROTOCOL" }
    }
    fun saved(): String? = prepared?.let { JSONObject().put("account", account).put("space", space).put("command", JSONObject(it)).toString() }
    fun prepare(command: JSONObject): String? {
        if (!active || busy) return null
        return try {
            if (account.isBlank()) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            val frozen = DataExportProtocol.command(space, command)
            prepared = frozen.toString(); receipt = null; error = ""
            frozen.getString("format")
        } catch (failure: Exception) {
            error = when (failure) { is AuthApiError -> failure.code; is AuthFailure -> failure.kind.name; else -> "PROTOCOL" }
            null
        }
    }
    fun pickerFailed() { prepared = null; error = "STORAGE" }
    fun close() { active = false; epoch++; prepared = null; receipt = null }
    suspend fun complete(destination: DataExportDestination?) {
        val command = prepared?.let(::JSONObject) ?: return
        if (!active || working) return
        prepared = null
        if (destination == null) return
        val own = ++epoch
        fun current() { if (!active || epoch != own) throw CancellationException() }
        working = true; error = ""; receipt = null
        try {
            current()
            val raw = controller.exportSharedData(space, command)
            currentCoroutineContext().ensureActive(); current()
            val result = withContext(Dispatchers.Default) { DataExportProtocol.snapshot(command.getString("format"), raw) }
            currentCoroutineContext().ensureActive(); current()
            destination.write(result.getString("content"), ::current)
            currentCoroutineContext().ensureActive(); current()
            receipt = JSONObject().put("projectCount", result.getInt("projectCount")).put("taskCount", result.getInt("taskCount"))
                .put("notices", result.getJSONArray("notices"))
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            if (active && epoch == own) error = when (failure) {
                is AuthApiError -> failure.code
                is AuthFailure -> failure.kind.name
                is java.io.IOException, is SecurityException -> "STORAGE"
                else -> "PROTOCOL"
            }
        } finally { if (active && epoch == own) working = false }
    }
}
