package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedMindmapGateway
import ru.genesis.calendar.auth.SharedMindmapProtocol
import ru.genesis.calendar.auth.sharedMindmapAccessLost
import ru.genesis.calendar.security.WorkspaceCipher

/** Same adapter boundary as web sharedMindmapDocumentAccess: server JSON, member-encrypted local envelopes. */
internal class SharedMindmapTransport(private val gateway: SharedMindmapGateway, private val uid: String, private val space: String,
    private val onAccessLost: () -> Unit = {}, private val onAuthorizedMaps: (Set<String>) -> Unit = {}) : MindmapTransport {
    init { SharedMindmapProtocol.uid(uid, space) }
    override fun check() { try { gateway.checkSharedMindmapAccount(uid) } catch (failure: Exception) { onAccessLost(); throw failure } }
    private suspend fun remote(path: String, body: JSONObject?, method: String): JSONObject = try {
        gateway.sharedMindmapDocument(space, path, body, method)
    } catch (failure: Exception) { if (sharedMindmapAccessLost(failure)) onAccessLost(); throw failure }
    override suspend fun workspace(): JSONObject { check(); return gateway.sharedMindmapWorkspace().also { check() } }
    override suspend fun request(path: String, body: JSONObject?): JSONObject {
        check(); SharedMindmapProtocol.relativePath(path)
        val workspace = workspace().getJSONObject("workspace")
        require(workspace.getString("keyMode") == "account") { "WORKSPACE_KEY_UNAVAILABLE" }
        val key = WorkspaceCipher.decodeKey(workspace.getString("key"))
        try {
            if (body != null) {
                require(Regex("/mindmaps/[A-Za-z0-9_-]{1,100}").matches(path))
                val id = path.substringAfterLast('/'); val bytes = WorkspaceCipher.decrypt(
                    WorkspaceCipher.Envelope(body.getString("ciphertext"), body.getString("iv")), key, SharedMindmapProtocol.aad(uid, space, id))
                val document = try { MindmapDocument.parse(JSONObject(bytes.toString(Charsets.UTF_8))).json() } finally { bytes.fill(0) }
                require(document.getString("id") == id && body.getLong("expectedRevision") >= 0)
                SharedMindmapProtocol.mapId(body.getString("operationId"))
                val command = JSONObject().put("schemaVersion", 1).put("expectedRevision", body.getLong("expectedRevision"))
                    .put("operationId", body.getString("operationId")).put("document", document)
                check()
                return remote(path, command, "PUT").also { check(); require(it.getLong("revision") >= 1) }
            }
            val response = remote(path, null, "GET"); check()
            val field = if (path.endsWith("/history")) "versions" else "maps"
            val source = response.getJSONArray(field); require(source.length() <= if (field == "versions") 20 else 200)
            if (field == "maps") onAuthorizedMaps((0 until source.length()).map { source.getJSONObject(it).getString("id") }.toSet())
            val rows = (0 until source.length()).map { index -> val row = source.getJSONObject(index)
                require(row.getInt("schemaVersion") == 1 && row.getLong("revision") >= 1)
                val document = MindmapDocument.parse(row.getJSONObject("document")); require(document.id == row.getString("id"))
                if (field == "versions") require(document.id == path.split('/')[2])
                val bytes = document.json().toString().toByteArray()
                val encrypted = try { WorkspaceCipher.encrypt(bytes, key, SharedMindmapProtocol.aad(uid, space, document.id)) } finally { bytes.fill(0) }
                JSONObject().put("id", document.id).put("schemaVersion", 1).put("revision", row.getLong("revision"))
                    .put("iv", encrypted.iv).put("ciphertext", encrypted.ciphertext)
            }
            check(); return JSONObject().put(field, JSONArray(rows))
        } finally { key.fill(0) }
    }
}
