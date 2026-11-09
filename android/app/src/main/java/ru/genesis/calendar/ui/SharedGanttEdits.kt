package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Absolute local intents are visible immediately; each task persists in revision order. */
internal class SharedGanttEdits(private val scope: CoroutineScope) {
    val rows = mutableStateMapOf<String, JSONObject>()
    private val queues = mutableMapOf<String, MutableList<JSONObject>>()
    private val running = mutableStateMapOf<String, Boolean>()
    val saving: Boolean get() = running.isNotEmpty()
    var error by mutableStateOf(""); private set

    fun submit(task: JSONObject, changes: JSONObject,
        persist: suspend (JSONObject, JSONObject) -> JSONObject, refresh: suspend () -> Unit) {
        val id = task.getString("id")
        if (task.optBoolean("pending")) return
        val visible = rows[id] ?: task
        rows[id] = JSONObject(visible.toString()).apply { changes.keys().forEach { put(it, changes.get(it)) } }
        val queue = queues.getOrPut(id) { mutableListOf() }
        queue += JSONObject(changes.toString())
        error = ""
        if (running[id] == true) return
        running[id] = true
        scope.launch {
            var confirmed = task
            try {
                while (queue.isNotEmpty()) {
                    val patch = queue.removeAt(0)
                    val result = persist(confirmed, patch)
                    require(result.optString("id") == id && result.optString("projectId") == task.optString("projectId"))
                    confirmed = result
                    if (result.optBoolean("pending")) {
                        // The offline journal owns this revision; it must sync before another edit.
                        if (queue.isNotEmpty()) error = "Не удалось сохранить сроки. Обновите задачи и повторите попытку."
                        queue.clear()
                        rows[id] = result
                    } else if (queue.isEmpty()) rows[id] = result
                    else rows[id] = JSONObject(rows.getValue(id).toString()).put("revision", result.getInt("revision"))
                }
            } catch (cancelled: CancellationException) {
                rows.remove(id)
                throw cancelled
            } catch (_: Exception) {
                queue.clear()
                if (confirmed === task) rows.remove(id) else rows[id] = confirmed
                error = "Не удалось сохранить сроки. Обновите задачи и повторите попытку."
            } finally {
                queues.remove(id)
                running.remove(id)
            }
            // Reader refresh never blocks the visual acknowledgement or the next gesture.
            refresh()
        }
    }

    fun reconcile(authoritative: List<JSONObject>, dropMissing: Boolean = false) {
        if (dropMissing) {
            val ids = authoritative.map { it.optString("id") }.toSet()
            rows.keys.toList().filter { it !in ids && running[it] != true && rows[it]?.optBoolean("pending") != true }
                .forEach(rows::remove)
        }
        authoritative.forEach { task ->
            val id = task.optString("id")
            val local = rows[id] ?: return@forEach
            if (running[id] != true && !local.optBoolean("pending") && task.optInt("revision") >= local.optInt("revision")) rows.remove(id)
        }
    }
}
