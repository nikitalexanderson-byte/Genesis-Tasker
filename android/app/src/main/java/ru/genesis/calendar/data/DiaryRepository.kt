package ru.genesis.calendar.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.DiaryGateway
import ru.genesis.calendar.auth.DiaryProtocol
import ru.genesis.calendar.auth.DiaryDeletion
import java.io.IOException
import java.util.UUID

internal data class DiaryRecord(val note: DiaryNote, val revision: Long, val draftKey: String? = null,
    internal val pendingJson: String? = null, internal val pendingNote: DiaryNote? = null,
    val localOnly: Boolean = false, internal val uploadId: String? = null) {
    val draft: Boolean get() = draftKey != null
    override fun toString() = "DiaryRecord([redacted])"
}
internal data class DiaryState(val records: List<DiaryRecord> = emptyList(), val offline: Boolean = false,
    val ready: Boolean = false, val protected: Boolean = false, val syncEnabled: Boolean = true, val pendingUploads: Int = 0,
    val dreamSettings: DreamSettings = DreamSettings())
internal class DiaryConflict : Exception("DIARY_REVISION_CONFLICT")

/** Serial account-scoped journal. Every write is encrypted on disk before any network request. */
internal class DiaryRepository(private val owner: String, private val gateway: DiaryGateway,
    private val store: DiaryStore, private val cacheCipher: DiaryCacheCipher) {
    private val mutex = Mutex()
    private val writer = UUID.randomUUID().toString()
    private var initialized = false
    private var hasCache = false
    private var protected = false
    private var committed = emptyList<DiaryRecord>()
    private var drafts = emptyList<DiaryRecord>()
    private var policySync = true
    private var policyRevision = 0L
    private var deviceLocalOnly = false
    private var snapshot = ""
    private var dreamSettings = DreamSettings()
    private var deletions = emptyMap<String, DiaryDeletion>()
    private val syncEnabled get() = policySync && !deviceLocalOnly
    private val mutable = MutableStateFlow(DiaryState())
    val state = mutable.asStateFlow()
    private fun check() = gateway.check()
    fun sealEditorState(value: String): String { check(); return cacheCipher.encrypt(value) }
    fun openEditorState(value: String): String { check(); return cacheCipher.decrypt(value) }

    private fun json(committed: List<DiaryRecord>, drafts: List<DiaryRecord>, cache: Boolean): JSONObject = JSONObject()
        .put("version", 1).put("owner", owner).put("hasCache", cache)
        .put("settings", JSONObject().put("syncEnabled", policySync).put("revision", policyRevision).put("deviceLocalOnly", deviceLocalOnly))
        .put("dreamSettings", dreamSettings.json())
        .put("deleted", JSONArray(deletions.values.map { it.json() }))
        .put("records", JSONArray(committed.map { rowJson(it) })).put("drafts", JSONArray(drafts.map { rowJson(it) }))
    private fun rowJson(row: DiaryRecord): JSONObject = JSONObject().put("note", row.note.json()).put("revision", row.revision)
        .put("draftKey", row.draftKey ?: JSONObject.NULL).put("pending", row.pendingJson?.let(::JSONObject) ?: JSONObject.NULL)
        .put("pendingNote", row.pendingNote?.json() ?: JSONObject.NULL)
        .put("localOnly", row.localOnly).put("uploadId", row.uploadId ?: JSONObject.NULL)
    private fun parseRow(row: JSONObject, draft: Boolean): DiaryRecord {
        val note = DiaryNote.parse(row.getJSONObject("note")); val revision = row.getLong("revision")
        val localOnly = row.optBoolean("localOnly")
        require(revision >= if (draft || localOnly) 0 else 1) { "DIARY_INVALID_CACHE" }
        val key = row.opt("draftKey") as? String
        require((key != null) == draft && (key == null || key.startsWith("draft:") && key.endsWith(":" + note.id))) { "DIARY_INVALID_CACHE" }
        val pending = row.optJSONObject("pending")?.let(DiaryProtocol::pending)
        val pendingNote = row.optJSONObject("pendingNote")?.let(DiaryNote::parse)
        require((pending == null) == (pendingNote == null) && (pendingNote == null || pendingNote.id == note.id) &&
            (pending == null || draft && pending.getLong("expectedRevision") == revision)) { "DIARY_INVALID_CACHE" }
        val uploadId = row.opt("uploadId") as? String
        require(uploadId == null || DiaryNote.idPattern.matches(uploadId)) { "DIARY_INVALID_CACHE" }
        return DiaryRecord(note, revision, key, pending?.toString(), pendingNote, localOnly, uploadId)
    }
    private suspend fun loadLocked() {
        if (initialized) return
        check()
        val encrypted = store.read(); check()
        if (encrypted != null) {
            // Parse everything before assigning: unknown or corrupted cache is never replaced by empty data.
            val source = JSONObject(cacheCipher.decrypt(encrypted))
            require(source.opt("version") is Number && source.getDouble("version") == 1.0 && source.optString("owner") == owner && source.opt("hasCache") is Boolean) { "DIARY_INVALID_CACHE" }
            fun rows(name: String, draft: Boolean): List<DiaryRecord> = source.getJSONArray(name).let { values ->
                require(values.length() <= if (draft) 40000 else 20000) { "DIARY_INVALID_CACHE" }
                (0 until values.length()).map { parseRow(values.getJSONObject(it), draft) }
            }
            val saved = rows("records", false); val kept = rows("drafts", true)
            require(saved.map { it.note.id }.distinct().size == saved.size && kept.map { it.draftKey }.distinct().size == kept.size) { "DIARY_INVALID_CACHE" }
            val settings = source.optJSONObject("settings")
            source.optJSONObject("dreamSettings")?.let { dreamSettings = DreamSettings.parse(it) }
            if (settings != null) { policySync = settings.getBoolean("syncEnabled"); policyRevision = settings.getLong("revision"); deviceLocalOnly = settings.optBoolean("deviceLocalOnly") }
            deletions = DiaryProtocol.deletions(source).associateBy { it.id }
            check(); committed = saved; drafts = kept; hasCache = source.getBoolean("hasCache")
        }
        initialized = true; publish()
    }
    private fun publish(offline: Boolean = mutable.value.offline) {
        check(); mutable.value = DiaryState(committed + drafts, offline, initialized, protected, syncEnabled, committed.count { it.localOnly }, dreamSettings)
    }
    private suspend fun persist(saved: List<DiaryRecord> = committed, kept: List<DiaryRecord> = drafts, cache: Boolean = hasCache,
        offline: Boolean = mutable.value.offline) {
        check(); require(initialized) { "DIARY_CACHE_NOT_READY" }
        val encrypted = cacheCipher.encrypt(json(saved, kept, cache).toString())
        check(); store.write(encrypted); check()
        committed = saved; drafts = kept; hasCache = cache; publish(offline)
    }
    suspend fun loadCached() = mutex.withLock { loadLocked() }
    private fun offline(error: Exception): Boolean = error is IOException || error is AuthFailure && error.kind == AuthFailure.Kind.NETWORK
    private fun acceptMetadata(response: JSONObject, activate: Boolean = false) {
        response.optJSONObject("dreamSettings")?.let { row ->
            val next = DreamSettings.parse(row); if (next.revision >= dreamSettings.revision) dreamSettings = next
        }
        DiaryProtocol.settings(response)?.let { (enabled, revision) ->
            if (revision >= policyRevision) {
                policySync = enabled; policyRevision = revision
                if (activate) deviceLocalOnly = !enabled else if (!enabled) deviceLocalOnly = true
                response.opt("snapshot")?.let { value -> require(value is String && value.matches(Regex("[a-f0-9]{64}"))) { "DIARY_INVALID_RESPONSE" }; snapshot = value }
            }
        }
        val next = deletions.toMutableMap()
        DiaryProtocol.deletions(response).forEach { row ->
            if (next[row.id]?.localOnly != false && (next[row.id]?.revision ?: 0) <= row.revision) next[row.id] = row
        }
        deletions = next
    }
    private fun retain(rows: List<DiaryRecord>): List<DiaryRecord> = rows.filter { deletions[it.note.id]?.localOnly != false }.map { row ->
        if (deletions[row.note.id]?.localOnly == true && !row.localOnly) row.copy(revision = 0, pendingJson = null, pendingNote = null, localOnly = true) else row
    }
    private suspend fun refreshLocked() {
        loadLocked(); check()
        if (!syncEnabled) {
            try { acceptMetadata(gateway.request("/diary/settings")); check(); persist(saved = retain(committed), kept = retain(drafts), cache = true, offline = false) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { if (offline(error) && hasCache) { publish(offline = true); return }; throw error }
            if (!syncEnabled) return
        }
        val result = try {
            val key = DiaryProtocol.key(gateway.workspace()); check()
            try {
                val response = gateway.request("/diary"); check()
                val envelopes = DiaryProtocol.envelopes(response)
                acceptMetadata(response)
                envelopes.map { DiaryRecord(DiaryProtocol.open(owner, it, key), it.revision) }
            } finally { key.fill(0) }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            check()
            if (offline(error) && hasCache) { publish(offline = true); return }
            if (!offline(error) && error !is AuthFailure) { protected = true; publish() }
            throw error
        }
        val byId = retain(result).associateBy { it.note.id }.toMutableMap()
        retain(committed).forEach { if ((byId[it.note.id]?.revision ?: -1) < it.revision) byId[it.note.id] = it }
        protected = false
        persist(byId.values.toList(), kept = retain(drafts), cache = true, offline = false)
    }
    suspend fun refresh() = mutex.withLock { refreshLocked() }
    suspend fun dreamToday(timeZone: String): String {
        check()
        val response=gateway.request("/diary/dream-clock?timeZone=" + java.net.URLEncoder.encode(timeZone, "UTF-8"))
        check(); require(response.getString("timeZone")==timeZone)
        return java.time.LocalDate.parse(response.getString("today")).toString()
    }
    suspend fun authorizeDreamVoice() { check(); require(gateway.request("/diary/dream-voice").getBoolean("allowed")); check() }

    private fun ownKey(id: String): String = "draft:$writer:$id"
    private suspend fun keepLocked(note: DiaryNote, revision: Long, key: String?): DiaryRecord {
        require(revision >= 0); check()
        require(deletions[note.id]?.localOnly != false) { "DIARY_NOTE_DELETED" }
        val draftKey = key ?: ownKey(note.id)
        require(draftKey.startsWith("draft:") && draftKey.endsWith(":" + note.id)) { "DIARY_INVALID_DRAFT" }
        val previous = drafts.firstOrNull { it.draftKey == draftKey }
        require(previous == null || previous.revision >= revision) { "DIARY_DRAFT_REVISION_CHANGED" }
        val draft = DiaryRecord(note, previous?.revision ?: revision, draftKey, previous?.pendingJson, previous?.pendingNote)
        persist(kept = drafts.filterNot { it.draftKey == draftKey } + draft)
        return draft
    }
    suspend fun keepDraft(note: DiaryNote, revision: Long = 0, draftKey: String? = null): DiaryRecord = mutex.withLock {
        loadLocked(); keepLocked(DiaryNote.parse(note.json()), revision, draftKey)
    }
    suspend fun discardDraft(draftKey: String) = mutex.withLock {
        loadLocked(); require(draftKey.startsWith("draft:")) { "DIARY_INVALID_DRAFT" }
        persist(kept = drafts.filterNot { it.draftKey == draftKey })
    }
    suspend fun discardEditorDraft(id: String, draftKey: String?) = mutex.withLock {
        loadLocked(); check()
        require(draftKey == null || draftKey.startsWith("draft:") && draftKey.endsWith(":" + id))
        persist(kept = drafts.filterNot { it.draftKey == ownKey(id) || draftKey != null && it.draftKey == draftKey })
    }
    suspend fun setDreamTodayMode(mode: String) = mutex.withLock {
        loadLocked(); check(); require(mode in setOf("off", "morning", "all-day"))
        try {
            val response = gateway.request("/diary/dream-settings", JSONObject().put("todayMode", mode).put("expectedRevision", dreamSettings.revision))
            check(); require(response.has("dreamSettings")); acceptMetadata(response); persist()
        } catch (cancel: CancellationException) { throw cancel }
        catch (error: Exception) { try { refreshLocked() } catch (cancel: CancellationException) { throw cancel } catch (_: Exception) { }; throw error }
    }
    private suspend fun send(row: DiaryRecord): DiaryRecord {
        val pending = DiaryProtocol.pending(JSONObject(requireNotNull(row.pendingJson)))
        val note = requireNotNull(row.pendingNote)
        note.json().optJSONObject("dream")?.let { pending.put("dream", JSONObject().put("day", it.getString("day")).put("timeZone", it.getString("timeZone"))) }
        if (gateway.featureAccess().enforcementEnabled && note.adviceId != null) pending.put("adviceId",note.adviceId)
        check()
        val response = try { gateway.request("/diary/${note.id}", pending) }
        catch (error: AuthFailure) { if (error.kind == AuthFailure.Kind.CONFLICT || error.httpStatus == 409) throw DiaryConflict(); throw error }
        check(); val revision = DiaryProtocol.receipt(response, pending.getLong("expectedRevision"))
        val acknowledged = DiaryRecord(note, revision)
        val unchanged = row.note.sameContent(note)
        val nextDraft = if (unchanged) null else DiaryRecord(row.note, revision, row.draftKey)
        persist(saved = committed.filterNot { it.note.id == note.id } + acknowledged,
            kept = drafts.filterNot { it.draftKey == row.draftKey } + listOfNotNull(nextDraft), cache = true, offline = false)
        return nextDraft ?: acknowledged
    }
    private suspend fun saveLocked(note: DiaryNote, revision: Long, key: String?): DiaryRecord {
        require(!protected) { "DIARY_PROTECTED_DATA" }
        if (note.dreamDay != null) require(gateway.featureAccess().allows("dream-journal")) { "FEATURE_SUBSCRIPTION_REQUIRED" }
        if (note.adviceId==null && committed.none { it.note.id==note.id }) require(gateway.featureAccess().canCreate("diary",committed.count { it.note.adviceId==null })) {
            "Достигнут лимит тарифа. Существующие данные сохраняются. Изменить тариф можно в настройках аккаунта."
        }
        var row = keepLocked(note, revision, key)
        if (!syncEnabled) {
            val saved = DiaryRecord(note, 0, localOnly = true)
            persist(saved = committed.filterNot { it.note.id == note.id } + saved,
                kept = drafts.filterNot { it.draftKey == row.draftKey }, cache = true)
            return saved
        }
        require(committed.none { it.note.id == note.id && it.localOnly }) { "DIARY_LOCAL_UPLOAD_PENDING" }
        // Recover a previously uncertain write using the exact original ciphertext before sending a newer edit.
        if (row.pendingJson != null) {
            row = send(row)
            if (!row.draft) return row
        }
        val workspaceKey = DiaryProtocol.key(gateway.workspace()); check()
        val pending = try { DiaryProtocol.seal(owner, row.note, row.revision, workspaceKey) } finally { workspaceKey.fill(0) }
        row = row.copy(pendingJson = pending.toString(), pendingNote = row.note)
        persist(kept = drafts.filterNot { it.draftKey == row.draftKey } + row)
        return send(row)
    }
    suspend fun save(note: DiaryNote, revision: Long = 0, draftKey: String? = null): DiaryRecord = mutex.withLock {
        loadLocked(); saveLocked(DiaryNote.parse(note.json()), revision, draftKey)
    }
    suspend fun saveCopy(note: DiaryNote, originalDraftKey: String?): DiaryRecord = mutex.withLock {
        loadLocked()
        val copyId = UUID.nameUUIDFromBytes("$owner:${originalDraftKey ?: ownKey(note.id)}:copy".toByteArray(Charsets.UTF_8)).toString()
        val prior = drafts.firstOrNull { it.note.id == copyId }
        val known = committed.firstOrNull { it.note.id == copyId }
        val original = prior ?: known
        val copy = note.asCopy(copyId).let { fresh -> if (original == null) fresh else DiaryNote.parse(fresh.json().put("createdAt", original.note.createdAt)) }
        val result = if (prior == null && known != null && known.note.sameContent(copy)) known
            else saveLocked(copy, original?.revision ?: 0, prior?.draftKey)
        if (originalDraftKey != null) persist(kept = drafts.filterNot { it.draftKey == originalDraftKey })
        result
    }
    suspend fun adviceId(adviceId: String): String = mutex.withLock {
        loadLocked(); adviceIdLocked(adviceId)
    }
    private suspend fun adviceIdLocked(adviceId: String): String {
        committed.firstOrNull { it.note.adviceId == adviceId }?.let { return it.note.id }
        if (!syncEnabled) {
            var generation = 0; var id: String
            do { id = UUID.nameUUIDFromBytes("$owner:diary-local-advice:$adviceId:$generation".toByteArray(Charsets.UTF_8)).toString(); generation++ } while (deletions.containsKey(id))
            return id
        }
        val key = DiaryProtocol.key(gateway.workspace()); check()
        return try {
            var generation = 0
            var id: String
            do { id = DiaryProtocol.privateAdviceId(key, owner, adviceId + if (generation == 0) "" else ":recreated:$generation"); generation++ } while (deletions.containsKey(id))
            id
        } finally { key.fill(0) }
    }
    suspend fun react(advice: JSONObject, reaction: String): DiaryRecord = mutex.withLock {
        loadLocked(); refreshLocked(); require(!protected) { "DIARY_PROTECTED_DATA" }
        val id = adviceIdLocked(advice.getString("id"))
        val current = committed.firstOrNull { it.note.id == id }
        saveLocked(DiaryNote.reaction(advice, id, reaction, current?.note), current?.revision ?: 0, "draft:reaction:$writer:$id")
    }
    suspend fun remove(record: DiaryRecord) = mutex.withLock {
        loadLocked(); check(); require(!record.draft && !protected) { "DIARY_INVALID_NOTE" }
        val marker = if (!syncEnabled || record.localOnly) DiaryDeletion(record.note.id, maxOf(2, record.revision + 1), java.time.Instant.now().toString(), false)
        else {
            val response = gateway.remove(record.note.id, record.revision); check()
            require(response.optBoolean("deleted") && response.optString("id") == record.note.id) { "DIARY_INVALID_RECEIPT" }
            val revision = DiaryProtocol.receipt(response, record.revision)
            DiaryDeletion(record.note.id, revision, response.getString("updatedAt"), false)
        }
        deletions = deletions + (marker.id to marker)
        persist(saved = retain(committed), kept = retain(drafts))
    }
    suspend fun setSyncEnabled(enabled: Boolean) = mutex.withLock {
        refreshLocked(); check(); require(!mutable.value.offline && snapshot.isNotBlank()) { "DIARY_ONLINE_REQUIRED" }
        // A failed device write prevents the destructive server request.
        persist()
        if (syncEnabled != enabled || !enabled) {
            val result = gateway.request("/diary/settings", JSONObject().put("syncEnabled", enabled)
                .put("expectedRevision", policyRevision).put("expectedSnapshot", snapshot)); check()
            acceptMetadata(result, activate = true)
            require(syncEnabled == enabled) { "DIARY_INVALID_RECEIPT" }
            persist(saved = retain(committed), kept = retain(drafts), cache = true, offline = false)
        }
        if (enabled) uploadLocalLocked()
    }
    private suspend fun uploadLocalLocked() {
        for (original in committed.filter { it.localOnly }) {
            val id = original.uploadId ?: UUID.randomUUID().toString()
            if (committed.none { it.note.id == id && !it.localOnly }) {
                persist(saved = committed.map { if (it.note.id == original.note.id) it.copy(uploadId = id) else it })
                val note = DiaryNote.parse(original.note.json().put("id", id))
                saveLocked(note, 0, "draft:upload:$id")
            } else {
                val intended = DiaryNote.parse(original.note.json().put("id", id))
                if (committed.first { it.note.id == id }.note.sameContent(intended))
                    persist(kept = drafts.filterNot { it.draftKey == "draft:upload:$id" })
            }
            persist(saved = committed.filterNot { it.note.id == original.note.id })
        }
    }
    companion object {
        // One journal/mutex/StateFlow per Room account, including multiple navigation entry points.
        // Weak values release an inactive workspace; no key or plaintext is kept in a process singleton.
        private val roomInstances = java.util.WeakHashMap<GenesisDatabase, MutableMap<String, java.lang.ref.WeakReference<DiaryRepository>>>()
        fun room(database: GenesisDatabase, scope: String, owner: String, gateway: DiaryGateway): DiaryRepository = synchronized(roomInstances) {
            val account = "$scope\u0000$owner"
            val entries = roomInstances.getOrPut(database) { mutableMapOf() }
            entries[account]?.get() ?: DiaryRepository(owner, gateway, DiaryRoomStore(database, scope), DiaryKeystoreCipher(scope, owner))
                .also { entries[account] = java.lang.ref.WeakReference(it) }
        }
    }
}
