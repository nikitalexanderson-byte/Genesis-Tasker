package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Repeated offline edits remain durable while an earlier upload is unresolved.
 * Intermediate snapshots are retained locally even when their uploads coalesce.
 * Caller serials protect edits against another editor/account instance.
 */
class E2eeEditorQueue(private val device: E2eeScopeDevice, private val client: E2eeScopeClient,
    private val scopeId: String, private val domain: String, private val objectId: String) {
    class Opened(val bytes: ByteArray, val filename: String, val mediaType: String, val serial: Long, val remoteRevision: Long, val pending: Boolean) {
        override fun toString() = "E2eeEditorQueue.Opened([redacted])"
    }
    private class State(val value: JSONObject, val serial: Long)
    private val vault = device.vault
    private val stateId: String
    init {
        client.assertBinding(device, scopeId)
        listOf(scopeId, domain, objectId).forEach(E2eeKeys::technical)
        stateId = "editor:" + E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("$scopeId\u0000$domain\u0000$objectId".toByteArray()))
    }
    companion object { private const val MAX_HISTORY = 1024 }
    private fun strings(values: JSONArray) = (0 until values.length()).map { values.getString(it) }
    private fun drafts(values: JSONArray) = (0 until values.length()).map { values.getJSONObject(it) }
    private fun loadState(): State? {
        val row = vault.read("draft", stateId) ?: return null
        try {
            val value = JSONObject(row.bytes.toString(Charsets.UTF_8)); val history = drafts(value.getJSONArray("history")); val pending = strings(value.getJSONArray("pending"))
            check(E2eeCommands.integer(value.get("protocol")) == 1L && value.get("scopeId") == scopeId && value.get("domain") == domain && value.get("objectId") == objectId
                && E2eeCommands.integer(value.get("remoteRevision")) >= 0 && history.size in 1..MAX_HISTORY
                && history.map { it.getString("id") }.toSet().size == history.size && pending.toSet().size == pending.size
                && pending.all { id -> history.any { it.getString("id") == id } } && value.getJSONObject("latest").get("id") == history.last().get("id")) { "E2EE_CORRUPT_EDITOR" }
            for (draft in history) {
                E2eeKeys.technical(draft.getString("id")); val size = E2eeCommands.integer(draft.get("size"))
                check(size <= E2eeFiles.MAX_FILE_BYTES && E2eeCommands.integer(draft.get("parts")) == (size + E2eeFiles.CHUNK_BYTES - 1) / E2eeFiles.CHUNK_BYTES
                    && draft.getJSONObject("metadata").getString("filename").length <= 512 && draft.getJSONObject("metadata").getString("mediaType").length <= 128) { "E2EE_CORRUPT_EDITOR" }
            }
            return State(value, row.serial)
        } finally { row.bytes.fill(0) }
    }
    private fun save(value: JSONObject, serial: Long?, changes: List<UnlockedE2eeVault.Write> = emptyList()): Long {
        val bytes = value.toString().toByteArray()
        try { vault.write(changes + UnlockedE2eeVault.Write("draft", stateId, bytes, serial)) } finally { bytes.fill(0) }
        return (serial ?: 0) + 1
    }
    private fun bytes(draft: JSONObject): ByteArray {
        val result = ByteArray(draft.getInt("size")); var offset = 0
        try {
            for (part in 0 until draft.getInt("parts")) {
                val row = vault.read("draft", "${draft.getString("id")}:$part") ?: throw IllegalStateException("E2EE_CORRUPT_EDITOR")
                try {
                    check(row.bytes.size == minOf(E2eeFiles.CHUNK_BYTES, result.size - offset)) { "E2EE_CORRUPT_EDITOR" }
                    row.bytes.copyInto(result, offset); offset += row.bytes.size
                } finally { row.bytes.fill(0) }
            }
            vault.requireOpen(); return result
        } catch (error: Exception) { result.fill(0); throw error }
    }
    fun load(): Opened? {
        val state = loadState() ?: return null; val latest = state.value.getJSONObject("latest"); val metadata = latest.getJSONObject("metadata")
        return Opened(bytes(latest), metadata.getString("filename"), metadata.getString("mediaType"), state.serial,
            state.value.getLong("remoteRevision"), state.value.getJSONArray("pending").length() > 0)
    }
    fun stage(source: ByteArray, expectedSerial: Long?, baseRevision: Long, filename: String = "", mediaType: String = "application/json"): Long {
        return stageInternal(source,expectedSerial,baseRevision,filename,mediaType,"edit")
    }
    fun reconcile(source: ByteArray, expectedSerial: Long?, remoteRevision: Long, filename: String = "", mediaType: String = "application/json", cache: Boolean = false): Long {
        val copy=source.copyOf()
        try {
            val job=client.localJob(domain,objectId);check(job==null||job.complete){"E2EE_PENDING_SAVE_REQUIRED"}
            client.assertVerifiedRevision(domain,objectId,remoteRevision)
            return stageInternal(copy,expectedSerial,remoteRevision,filename,mediaType,if(cache)"cache" else "merge")
        } finally {copy.fill(0)}
    }
    private fun stageInternal(source: ByteArray, expectedSerial: Long?, baseRevision: Long, filename: String, mediaType: String, mode: String): Long {
        require(baseRevision in 0..9007199254740991L && source.size <= E2eeFiles.MAX_FILE_BYTES && filename.length <= 512 && mediaType.length <= 128) { "E2EE_INVALID_EDITOR_INPUT" }
        val copy = source.copyOf(); val changes = mutableListOf<UnlockedE2eeVault.Write>()
        try {
            device.ensureDurableKeys()
            val previous = loadState(); check(previous?.serial == expectedSerial) { "E2EE_LOCAL_CONFLICT" }
            check((previous == null || if(mode=="edit")previous.value.getLong("remoteRevision")==baseRevision else previous.value.getLong("remoteRevision")<=baseRevision)
                && (mode!="cache" || previous?.value?.getJSONArray("pending")?.length().let{it==null||it==0})) { "E2EE_EDITOR_CONFLICT" }
            val history = previous?.value?.getJSONArray("history") ?: JSONArray(); check(history.length() < MAX_HISTORY) { "E2EE_EDITOR_HISTORY_LIMIT" }
            val id = "edit:${UUID.randomUUID()}"; val parts = (copy.size + E2eeFiles.CHUNK_BYTES - 1) / E2eeFiles.CHUNK_BYTES
            val draft = JSONObject().put("id", id).put("size", copy.size).put("parts", parts).put("metadata", JSONObject().put("filename", filename).put("mediaType", mediaType))
            for (part in 0 until parts) changes += UnlockedE2eeVault.Write("draft", "$id:$part", copy.copyOfRange(part * E2eeFiles.CHUNK_BYTES, minOf((part + 1) * E2eeFiles.CHUNK_BYTES, copy.size)), null)
            val pending = previous?.value?.getJSONArray("pending") ?: JSONArray()
            val value = JSONObject().put("protocol", 1).put("scopeId", scopeId).put("domain", domain).put("objectId", objectId)
                .put("remoteRevision", baseRevision).put("latest", draft).put("history", history.put(draft)).put("pending", if(mode=="cache")JSONArray() else pending.put(id))
            return save(value, expectedSerial, changes)
        } finally { copy.fill(0); changes.forEach { it.bytes.fill(0) } }
    }
    private fun confirm(originId: String, revision: Long) {
        repeat(4) { attempt ->
            val saved = loadState() ?: throw IllegalStateException("E2EE_CORRUPT_EDITOR"); val value = saved.value
            val pending = strings(value.getJSONArray("pending")); val index = pending.indexOf(originId)
            if (index < 0) { check(value.getLong("remoteRevision") >= revision) { "E2EE_CORRUPT_EDITOR" }; return }
            value.put("remoteRevision", maxOf(revision,value.getLong("remoteRevision"))).put("pending", JSONArray(pending.drop(index + 1)))
            try { save(value, saved.serial); return } catch (error: IllegalStateException) { if (error.message != "E2EE_LOCAL_CONFLICT" || attempt == 3) throw error }
        }
    }
    fun flush(): Long {
        repeat(MAX_HISTORY) {
            val saved = loadState() ?: throw IllegalStateException("E2EE_EDITOR_EMPTY"); val pending = strings(saved.value.getJSONArray("pending"))
            val job = client.localJob(domain, objectId)
            if (job != null && !job.complete) {
                check(job.originId != null && job.originId in pending) { "E2EE_PENDING_EDITOR_MISMATCH" }
                val revision = client.flush(domain, objectId, job.originId); confirm(job.originId, revision)
            } else if (job?.complete == true && job.originId != null && job.originId in pending) confirm(job.originId, job.expectedRevision + 1)
            else {
                val selectedId = pending.lastOrNull() ?: return saved.value.getLong("remoteRevision")
                val selected = drafts(saved.value.getJSONArray("history")).firstOrNull { it.getString("id") == selectedId } ?: throw IllegalStateException("E2EE_CORRUPT_EDITOR")
                val content = bytes(selected); val metadata = selected.getJSONObject("metadata")
                try { client.prepare(domain, objectId, content, saved.value.getLong("remoteRevision"), metadata.getString("filename"), metadata.getString("mediaType"), selectedId) }
                finally { content.fill(0) }
            }
        }
        error("E2EE_EDITOR_BUSY")
    }
    fun rebasePending(expectedRemoteRevision: Long): String {
        val job = client.localJob(domain, objectId); val saved = loadState()
        check(job?.originId != null && saved != null && job.originId in strings(saved.value.getJSONArray("pending"))) { "E2EE_PENDING_EDITOR_MISMATCH" }
        val outcome = client.rebase(domain, objectId, expectedRemoteRevision, originId = job.originId)
        if (outcome == "already-confirmed") {
            val confirmed = client.localJob(domain, objectId)
            check(confirmed?.complete == true && confirmed.originId == job.originId) { "E2EE_PENDING_EDITOR_MISMATCH" }
            confirm(requireNotNull(job.originId), confirmed.expectedRevision + 1)
        }
        return outcome
    }
    override fun toString() = "E2eeEditorQueue([redacted])"
}
