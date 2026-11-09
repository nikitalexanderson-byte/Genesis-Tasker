package ru.genesis.calendar.data

import androidx.room.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedMindmapProtocol
import ru.genesis.calendar.auth.SharedTaskLifecycleProtocol

/** Intent precedes task creation; receipt precedes the map mutation. Server mindmapSource deduplicates retries. */
internal class SharedMindmapConversionJournal(private val db: GenesisDatabase, private val scope: String) {
    private val cipher = LocalCipher()
    private val kind = "shared-mindmap-conversions"
    private val aad = "$scope/$kind"
    suspend fun entries(): List<JSONObject> = db.withTransaction { read() }
    private suspend fun read(): List<JSONObject> {
        val stored = db.dao().document(scope, kind) ?: return emptyList()
        val rows = JSONArray(cipher.decrypt(stored.encrypted, aad)); require(rows.length() <= 1000)
        return (0 until rows.length()).map { rows.getJSONObject(it).also { row ->
            SharedMindmapProtocol.mapId(row.getString("mapId")); SharedMindmapProtocol.mapId(row.getString("nodeId"))
            SharedTaskLifecycleProtocol.id(row.getString("projectId"))
        } }
    }
    private suspend fun write(rows: List<JSONObject>) {
        if (rows.isEmpty()) db.dao().deleteDocument(scope, kind)
        else db.dao().putDocument(DocumentRecord(scope, kind, cipher.encrypt(JSONArray(rows).toString(), aad), System.currentTimeMillis()))
    }
    suspend fun intent(map: String, node: String, project: String, fields: JSONObject) = db.withTransaction {
        SharedMindmapProtocol.mapId(map); SharedMindmapProtocol.mapId(node); SharedTaskLifecycleProtocol.id(project)
        val previous = read()
        val existing = previous.firstOrNull { it.getString("mapId") == map && it.getString("nodeId") == node }
        if (existing?.optString("taskId")?.isNotBlank() == true) return@withTransaction
        val entry = JSONObject().put("mapId", map).put("nodeId", node).put("projectId", project).put("fields", JSONObject(fields.toString()))
        write(previous.filterNot { it.getString("mapId") == map && it.getString("nodeId") == node } + entry)
    }
    suspend fun acknowledge(map: String, node: String, task: JSONObject) = db.withTransaction {
        require(!task.optBoolean("pending")); SharedTaskLifecycleProtocol.task(task)
        val rows = read()
        val current = rows.first { it.getString("mapId") == map && it.getString("nodeId") == node }
        require(task.getString("projectId") == current.getString("projectId")) { "MAP_REVISION_CONFLICT" }
        val next = JSONObject(current.toString()).put("taskId", task.getString("id"))
        write(rows.map { if (it.getString("mapId") == map && it.getString("nodeId") == node) next else it })
    }
    suspend fun clear(map: String, node: String) = db.withTransaction {
        write(read().filterNot { it.getString("mapId") == map && it.getString("nodeId") == node })
    }
}
