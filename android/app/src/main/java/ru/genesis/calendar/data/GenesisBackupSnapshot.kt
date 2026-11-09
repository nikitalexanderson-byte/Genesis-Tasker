package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.time.Instant
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.WorkspacePatch

/** Capture local state in a single Room transaction before any entitlement/network request. */
internal class GenesisBackupSnapshot(private val app: GenesisApplication) {
    private val scope = app.workspaceScope
    private val cipher = LocalCipher()
    private fun check(owner: String) = check(app.workspaceScope == scope && CloudAccountSnapshot.scopeFor(owner) == scope) { "BACKUP_OWNER" }
    suspend fun capture(owner: String): JSONObject = app.database.withTransaction {
        check(owner)
        val dao = app.database.dao()
        suspend fun document(kind: String) = dao.document(scope, kind)?.let { JSONObject(cipher.decrypt(it.encrypted, "$scope/$kind")) }
        val base = document("cloud-base") ?: WorkspacePatch.emptyDocument()
        val local = WorkspacePatch.localDocument(base, document("structure"), document("habits"), document("trackers"))
        val tasks = dao.backupTasks(scope)
        local.put("tasks", JSONArray(tasks.filterNot { it.deleted }.map { JSONObject(cipher.decrypt(it.encrypted, "$scope/${it.id}")) }))
        val pending = JSONArray(dao.outbox(scope).map { JSONObject().put("operationId", it.operationId).put("entityId", it.entityId).put("revision", it.revision).put("state", it.state) })
        val at = Instant.now().toString()
        val sections = JSONArray().put(JSONObject().put("id", "workspace").put("source", "device").put("capturedAt", at).put("count", tasks.size)
            .put("pending", pending.length()).put("revision", dao.document(scope, "cloud-base")?.revision ?: 0)
            .put("completeness", "partial").put("notices", JSONArray(listOf("DEVICE_GOOGLE_CACHE_ONLY", "ATTACHMENTS_EMBEDDED_ONLY")))
            .put("data", JSONObject().put("document", local).put("nativePreferences",LocalPreferences(app,scope).backupRaw()).put("sync", JSONObject().put("pending", pending).put("tombstones", JSONArray(tasks.filter { it.deleted }.map { it.id })))))
        fun addRecords(id: String, rows: JSONArray, original: Any) {
            var pendingCount=0
            for(index in 0 until rows.length())if(rows.getJSONObject(index).optBoolean("pending"))pendingCount++
            sections.put(JSONObject().put("id",id).put("source","device").put("capturedAt",at).put("count",rows.length())
                .put("pending",pendingCount).put("revision",JSONObject.NULL).put("completeness","partial")
                .put("notices",JSONArray(listOf("DEVICE_CACHE_ONLY","HISTORY_MAY_BE_INCOMPLETE")))
                .put("data",JSONObject().put("records",rows).put("frozenStorage",original)))
        }
        dao.document(scope,"mindmaps")?.let { cached ->
            val original=JSONArray(cipher.decrypt(cached.encrypted,"$scope/mindmaps"));val rows=JSONArray()
            for(index in 0 until original.length()) {
                val row=original.getJSONObject(index)
                for(field in listOf("document","pendingDocument"))row.optJSONObject(field)?.let { value ->
                    rows.put(JSONObject().put("id",value.getString("id")).put("revision",row.getLong("revision"))
                        .put("schemaVersion",1).put("document",value).put("pending",field=="pendingDocument"||row.optBoolean("dirty")))
                }
            }
            addRecords("mindmaps",rows,original)
        }
        DiaryRoomStore(app.database,scope).read()?.let { encrypted ->
            val original=JSONObject(DiaryKeystoreCipher(scope,owner).decrypt(encrypted));val rows=JSONArray()
            for(collection in listOf("records","drafts")) {
                val entries=original.optJSONArray(collection)?:JSONArray()
                for(index in 0 until entries.length()) {
                    val row=entries.getJSONObject(index)
                    for(field in listOf("note","pendingNote"))row.optJSONObject(field)?.let { value ->
                        rows.put(JSONObject().put("id",value.getString("id")).put("revision",row.getLong("revision"))
                            .put("schemaVersion",1).put("document",value).put("pending",field=="pendingNote"||collection=="drafts"||row.optBoolean("localOnly")))
                    }
                }
            }
            addRecords("diary",rows,original)
        }
        val aurora=JSONObject()
        for(kind in listOf("aurora-cache","aurora-pending"))dao.document(scope,kind)?.let {
            aurora.put(kind,JSONObject(cipher.decrypt(it.encrypted,"$scope/aurora/$owner/$kind")))
        }
        if(aurora.length()>0)sections.put(JSONObject().put("id","aurora").put("source","device").put("capturedAt",at)
            .put("count",1).put("pending",if(aurora.has("aurora-pending"))1 else 0).put("revision",JSONObject.NULL)
            .put("completeness","partial").put("notices",JSONArray(listOf("DEVICE_CACHE_ONLY")))
            .put("data",JSONObject().put("nativeEnvelopes",aurora)))
        val included=(0 until sections.length()).map { sections.getJSONObject(it).getString("id") }.toSet()
        // Unavailable sources are explicit; their separate protected data is never discarded by export.
        for (id in listOf("mindmaps", "diary", "stoicheion", "aurora", "physis", "shared-drafts").filterNot { it in included }) sections.put(JSONObject()
            .put("id", id).put("source", "device").put("capturedAt", at).put("count", 0).put("pending", 0).put("revision", JSONObject.NULL)
            .put("completeness", "unavailable").put("notices", JSONArray(listOf("DEVICE_SOURCE_UNAVAILABLE"))).put("data", JSONObject.NULL))
        check(owner)
        JSONObject().put("schema", 1).put("backupId", UUID.randomUUID().toString()).put("ownerId", owner).put("source", "device_snapshot")
            .put("createdAt", at).put("client", "android").put("billingEvidence", JSONObject.NULL).put("sections", sections)
    }
    /** Caller supplies a live server check; this method never starts synchronization. */
    suspend fun export(owner: String, recovery: String, retainProtected: suspend (JSONObject) -> Unit, authorize: suspend () -> Unit): String {
        val frozen = capture(owner)
        retainProtected(JSONObject(frozen.toString()))
        authorize(); check(owner)
        val result = GenesisBackupContainer.seal(frozen, recovery)
        authorize(); check(owner)
        return result
    }
    suspend fun inspect(owner: String, text: String, recovery: String, authorize: suspend () -> Unit): JSONObject {
        authorize(); check(owner)
        return GenesisBackupContainer.open(text, recovery).also { require(it.getString("ownerId") == owner) { "BACKUP_OWNER" }; check(owner) }
    }
}
