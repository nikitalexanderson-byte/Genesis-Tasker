package ru.genesis.calendar.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.auth.MessagingProtocol
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.security.*
import java.net.URLEncoder
import java.io.IOException
import java.util.UUID

internal data class MessagingPeer(val id: String, val name: String, val viewing: Boolean, val keyId: String?, val publicJson: String?)
internal data class MessagingNotice(val id: String, val spaceId: String, val peerId: String, val peerName: String, val spaceTitle: String = "", val unread: Int = 0)
internal data class MessagingRow(val seq: Long, val id: String, val senderId: String, val revision: Long, val content: PrivateMessageContent?, val deleted: Boolean, val failed: Boolean = false) {
    override fun toString() = "MessagingRow([redacted])"
}
internal data class MessagingDraft(val id: String, val text: String = "", val files: List<PrivateFileMetadata> = emptyList(), val revision: Long = 0, val seq: Long = 0) {
    override fun toString() = "MessagingDraft([redacted])"
}
internal data class MessagingState(val initialized: Boolean = false, val keyReady: Boolean = false, val restoreRequired: Boolean = false,
    val conversations: List<MessagingNotice> = emptyList(), val invitations: List<MessagingNotice> = emptyList(), val contacts: List<MessagingNotice> = emptyList(),
    val contactsCursor: String? = null, val contactsQuery: String = "", val participants: List<MessagingPeer> = emptyList(), val selected: MessagingNotice? = null,
    val accepted: Boolean = false, val declined: Boolean = false, val accessBlocked: Boolean = false, val offline: Boolean = false,
    val initiator: String? = null, val securityCode: String? = null, val messages: List<MessagingRow> = emptyList(),
    val before: Long? = null, val draft: MessagingDraft? = null, val pending: Boolean = false, val pendingDelete: Boolean = false, val keyChanged: Boolean = false)

/** Account-scoped identity, trust pins and durable exact-ciphertext command journal. No plaintext on disk. */
internal class MessagingRepository(private val owner: String, private val gateway: MessagingGateway, private val store: MessagingStore) {
    private val mutex = Mutex()
    private var identity: MessagingIdentity? = null
    private var initialized = false
    private var currentPeer: MessagingPeer? = null
    private var currentKey: ByteArray? = null
    private var pins = JSONObject()
    private val mutable = MutableStateFlow(MessagingState())
    val state = mutable.asStateFlow()
    val ownerUid get() = owner
    private fun check() = gateway.check()
    private suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        check(); require(MessagingProtocol.allowedRoute(method, path)) { "MESSAGING_ROUTE_BLOCKED" }
        return gateway.request(method, path, body).also { check() }
    }
    private suspend fun read(key: String) = store.read(key).also { check() }
    private suspend fun write(key: String, value: String) { check(); store.write(key, value); check() }
    private suspend fun delete(key: String) { check(); store.delete(key); check() }
    private fun publish(value: MessagingState) { check(); mutable.value = value }
    private fun uuid(value: String): String = value.also { require(it.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))) { "MESSAGING_INVALID_RESPONSE" } }
    private fun notices(rows: JSONArray): List<MessagingNotice> {
        require(rows.length() <= 2000)
        return (0 until rows.length()).map { index -> rows.getJSONObject(index).let {
            MessagingNotice(uuid(it.getString("id")), uuid(it.getString("spaceId")), it.getString("peerId"), it.getString("peerName"), it.optString("spaceTitle"), it.optInt("unread", 0).coerceAtLeast(0))
        } }
    }
    private suspend fun initializeLocked() {
        if (initialized) return
        check()
        val saved = read("identity")
        identity = saved?.let { MessagingCrypto.importIdentity(JSONObject(it)) }
        pins = read("pins")?.let(::JSONObject) ?: JSONObject()
        val registered = request("GET", "/shared/messaging/key")
        val serverId = registered.opt("keyId") as? String
        if (serverId != null) {
            require(serverId == MessagingCrypto.fingerprint(registered.getJSONObject("publicKey"))) { "MESSAGING_KEY_MISMATCH" }
            require(identity == null || identity!!.keyId == serverId) { "MESSAGING_KEY_MISMATCH" }
        } else {
            if (identity == null) {
                identity = MessagingCrypto.createIdentity()
                // Persist BEFORE registration: a lost reply must not generate a replacement identity.
                write("identity", MessagingCrypto.privateJwk(identity!!))
            }
            val result = request("POST", "/shared/messaging/key", JSONObject().put("publicKey", JSONObject(identity!!.publicJson)))
            require(result.getString("keyId") == identity!!.keyId) { "MESSAGING_KEY_MISMATCH" }
        }
        initialized = true
        publish(mutable.value.copy(initialized = true, keyReady = identity != null, restoreRequired = identity == null))
    }
    suspend fun initialize() = mutex.withLock { initializeLocked(); inboxLocked() }
    private suspend fun inboxLocked() {
        val result = request("GET", "/shared/messaging/inbox")
        publish(mutable.value.copy(conversations = notices(result.getJSONArray("conversations")), invitations = notices(result.getJSONArray("invitations"))))
    }
    suspend fun refreshInbox() = mutex.withLock { initializeLocked(); inboxLocked() }
    suspend fun contacts(query: String, cursor: String? = null) = mutex.withLock {
        initializeLocked(); require(query.length <= 200)
        if (cursor != null && mutable.value.contactsQuery != query) return@withLock
        val path = "/shared/messaging/contacts?q=" + URLEncoder.encode(query, "UTF-8") + (cursor?.let { "&cursor=${uuid(it)}" } ?: "")
        val result = request("GET", path)
        currentCoroutineContext().ensureActive()
        val rows = notices(result.getJSONArray("contacts")); val next = result.opt("nextCursor") as? String
        if (next != null) uuid(next)
        publish(mutable.value.copy(contacts = if (cursor == null) rows else (mutable.value.contacts + rows).distinctBy { it.id }, contactsCursor = next, contactsQuery = query))
    }
    private suspend fun peersLocked(space: String, active: Boolean? = null, clientId: String? = null): List<MessagingPeer> {
        val result = request(if (active == null) "GET" else "POST", "/shared/spaces/${uuid(space)}/participants",
            active?.let { JSONObject().put("active", it).put("clientId", requireNotNull(clientId)) })
        val rows = result.getJSONArray("members"); require(rows.length() <= 5000)
        return (0 until rows.length()).map { index -> rows.getJSONObject(index).let {
            val public = it.optJSONObject("publicKey"); val keyId = it.opt("keyId") as? String
            require((public == null) == (keyId == null) && (public == null || MessagingCrypto.fingerprint(public) == keyId)) { "MESSAGING_KEY_MISMATCH" }
            MessagingPeer(it.getString("userId"), it.getString("displayName"), it.optBoolean("viewing"), keyId, public?.let(MessagingCrypto::canonicalPublicKey))
        } }
    }
    suspend fun participants(space: String, active: Boolean? = null, clientId: String? = null) = mutex.withLock {
        initializeLocked(); val peers = peersLocked(space, active, clientId)
        publish(mutable.value.copy(participants = peers))
    }
    suspend fun open(space: String, peerId: String) = mutex.withLock {
        initializeLocked(); require(identity != null) { "MESSAGING_BACKUP_REQUIRED" }
        val peers = peersLocked(space); val peer = requireNotNull(peers.firstOrNull { it.id == peerId && it.id != owner }) { "MESSAGING_PEER_UNAVAILABLE" }
        val result = request("POST", "/shared/spaces/${uuid(space)}/private-conversations", JSONObject().put("userId", peerId))
        val status = result.getString("status"); require(status in setOf("pending", "accepted", "declined"))
        selectLocked(MessagingNotice(uuid(result.getString("id")), space, peerId, peer.name), status == "accepted", result.opt("initiatorId") as? String, peer, status == "declined")
    }
    suspend fun select(notice: MessagingNotice) = mutex.withLock {
        initializeLocked()
        val peers = peersLocked(notice.spaceId)
        val peer = requireNotNull(peers.firstOrNull { it.id == notice.peerId }) { "MESSAGING_PEER_UNAVAILABLE" }
        // Opening an existing pair retrieves invitation status without creating a second conversation.
        val conversation = request("POST", "/shared/spaces/${uuid(notice.spaceId)}/private-conversations", JSONObject().put("userId", notice.peerId))
        require(conversation.getString("id") == notice.id) { "MESSAGING_INVALID_RESPONSE" }
        val status = conversation.getString("status"); require(status in setOf("pending", "accepted", "declined"))
        selectLocked(notice, status == "accepted", conversation.opt("initiatorId") as? String, peer, status == "declined")
    }
    private suspend fun selectLocked(notice: MessagingNotice, accepted: Boolean, initiator: String?, peer: MessagingPeer, declined: Boolean = false) {
        currentKey?.fill(0); currentKey = null; currentPeer = peer
        val pin = pins.opt(peer.id) as? String
        val changed = pin != null && pin != peer.keyId
        if (!changed && peer.keyId != null && identity != null) {
            if (pin == null) { val next = JSONObject(pins.toString()).put(peer.id, peer.keyId); write("pins", next.toString()); pins = next }
            currentKey = MessagingCrypto.conversationKey(identity!!, JSONObject(peer.publicJson!!), notice.id, notice.spaceId)
        }
        val savedDraft = read("draft/${notice.id}")
        val draft = savedDraft?.let { parseDraft(JSONObject(it)) } ?: MessagingDraft(UUID.randomUUID().toString())
        if (savedDraft == null) write("draft/${notice.id}", draftJson(draft).toString())
        val pending = read("pending/${notice.id}")?.let(::JSONObject)
        publish(mutable.value.copy(selected = notice, accepted = accepted, declined = declined, accessBlocked = false, offline = false, initiator = initiator, keyChanged = changed,
            securityCode = if (identity != null && peer.keyId != null) MessagingCrypto.securityCode(listOf(identity!!.keyId, peer.keyId)) else null,
            messages = emptyList(), before = null, draft = draft, pending = pending != null, pendingDelete = pending?.optString("method") == "DELETE"))
        if (accepted && currentKey != null) messagesLocked(0)
    }
    suspend fun respond(accept: Boolean) = mutex.withLock {
        val current = requireNotNull(mutable.value.selected)
        require(identity != null && !mutable.value.keyChanged)
        request("POST", "/shared/private-conversations/${current.id}/invitation", JSONObject().put("accept", accept))
        publish(mutable.value.copy(accepted = accept, declined = !accept))
        if (accept) messagesLocked(0) else publish(mutable.value.copy(selected = null, messages = emptyList(), draft = null))
        inboxLocked()
    }
    private fun ids(): Map<String, String> = mapOf(owner to requireNotNull(identity).keyId, requireNotNull(currentPeer).id to requireNotNull(currentPeer!!.keyId))
    private suspend fun verifyPeerLocked() {
        val current = requireNotNull(mutable.value.selected)
        val peer = peersLocked(current.spaceId).firstOrNull { it.id == current.peerId }
        val expected = pins.opt(current.peerId) as? String
        if (peer?.keyId == null || peer.keyId != expected) {
            currentKey?.fill(0); currentKey = null
            publish(mutable.value.copy(keyChanged = true, securityCode = peer?.keyId?.let { MessagingCrypto.securityCode(listOf(requireNotNull(identity).keyId, it)) })); error("MESSAGING_KEY_MISMATCH")
        }
    }
    private fun context(id: String, sender: String, revision: Long): MessageContext {
        val current = requireNotNull(mutable.value.selected)
        return MessageContext(current.spaceId, current.id, id, sender, revision)
    }
    private suspend fun messagesLocked(before: Long, preserveHistory: Boolean = false) {
        val current = requireNotNull(mutable.value.selected); val key = requireNotNull(currentKey)
        val result = request("GET", "/shared/private-conversations/${current.id}/messages?before=$before")
        val rows = result.getJSONArray("messages"); require(rows.length() <= 50)
        val parsed = (0 until rows.length()).map { index -> rows.getJSONObject(index).let { row ->
            val id = uuid(row.getString("id")); val seq = row.getLong("seq"); val revision = row.getLong("revision"); val sender = row.getString("senderId")
            require(seq > 0 && revision > 0 && sender in ids().keys)
            val deleted = row.opt("deletedAt") is String
            val content = if (deleted) null else runCatching { MessagingCrypto.content(MessagingCrypto.decryptMessage(key, context(id, sender, revision), row.getJSONObject("payload"), ids())) }.getOrNull()
            MessagingRow(seq, id, sender, revision, content, deleted, !deleted && content == null)
        } }
        val next = (result.opt("nextCursor") as? Number)?.toLong()
        require(next == null || next > 0 && (before == 0L || next < before))
        val retained = if (before == 0L && preserveHistory && next != null && parsed.isNotEmpty()) mutable.value.messages.filter { it.seq < parsed.first().seq } else emptyList()
        val merged = if (before == 0L) retained + parsed else (parsed + mutable.value.messages).distinctBy { it.id }.sortedBy { it.seq }
        publish(mutable.value.copy(messages = merged, before = if (retained.isNotEmpty()) mutable.value.before else next, offline = false))
        // Unread cursor advances only for content actually decrypted and displayed without errors.
        if (before == 0L && parsed.isNotEmpty() && parsed.none { it.failed }) request("POST", "/shared/private-conversations/${current.id}/read", JSONObject().put("seq", parsed.maxOf { it.seq }))
    }
    suspend fun messages(older: Boolean = false) = mutex.withLock { messagesLocked(if (older) mutable.value.before ?: return@withLock else 0) }
    suspend fun refreshConversation(conversationId: String) = mutex.withLock {
        check()
        if (mutable.value.selected?.id != conversationId || !mutable.value.accepted || mutable.value.accessBlocked || mutable.value.keyChanged) return@withLock
        try { verifyPeerLocked(); messagesLocked(0, preserveHistory = true) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (failure is AuthFailure && (failure.httpStatus in setOf(401, 403, 404) || failure.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED))) {
                currentKey?.fill(0); currentKey = null
                publish(mutable.value.copy(messages = emptyList(), accepted = false, accessBlocked = true, securityCode = null, offline = false))
            } else if (failure is IOException || failure is AuthFailure && failure.kind == AuthFailure.Kind.NETWORK) {
                // Keep the displayed history and the encrypted draft/command cache intact during a temporary outage.
                publish(mutable.value.copy(offline = true))
            } else throw failure
        }
    }
    private fun draftJson(draft: MessagingDraft) = JSONObject().put("version", 1).put("id", draft.id).put("text", draft.text).put("files", JSONArray(draft.files.map { it.json() })).put("revision", draft.revision).put("seq", draft.seq)
    private fun parseDraft(json: JSONObject): MessagingDraft {
        require(json.getInt("version") == 1 && json.getLong("revision") >= 0 && json.getLong("seq") >= 0)
        val files = json.getJSONArray("files"); require(files.length() <= 5)
        return MessagingDraft(uuid(json.getString("id")), json.getString("text"), (0 until files.length()).map { MessagingCrypto.file(files.getJSONObject(it)) }, json.getLong("revision"), json.getLong("seq"))
    }
    private suspend fun draftLocked(draft: MessagingDraft) {
        val current = requireNotNull(mutable.value.selected); require(!mutable.value.pending) { "MESSAGING_PENDING_COMMAND" }
        require(draft.text.toByteArray(Charsets.UTF_8).size <= 30000)
        write("draft/${current.id}", draftJson(draft).toString()); publish(mutable.value.copy(draft = draft))
    }
    suspend fun saveDraft(text: String, conversationId: String? = null, draftId: String? = null, revision: Long? = null) = mutex.withLock {
        check(); require(text.toByteArray(Charsets.UTF_8).size <= 30000)
        val target = uuid(conversationId ?: requireNotNull(mutable.value.selected).id)
        val selected = mutable.value.selected?.id == target
        val draft = if (selected) mutable.value.draft else read("draft/$target")?.let { parseDraft(JSONObject(it)) }
        if (draft == null || draftId != null && draft.id != draftId || revision != null && draft.revision != revision || read("pending/$target") != null) return@withLock
        val next = draft.copy(text = text)
        write("draft/$target", draftJson(next).toString())
        if (selected) publish(mutable.value.copy(draft = next))
    }
    suspend fun edit(row: MessagingRow) = mutex.withLock {
        require(row.senderId == owner && row.content != null && !row.deleted && !row.failed)
        val existing = mutable.value.draft
        require(existing == null || existing.text.isEmpty() && existing.files.isEmpty() && existing.revision == 0L) { "MESSAGING_DRAFT_EXISTS" }
        draftLocked(MessagingDraft(row.id, row.content.text, row.content.files, row.revision, row.seq))
    }
    private suspend fun removeChunks(files: List<PrivateFileMetadata>) {
        files.forEach { file -> repeat(file.chunks) { delete("file/${file.id}/$it") } }
    }
    suspend fun cancelEdit() = mutex.withLock {
        val previous = mutable.value.draft
        draftLocked(MessagingDraft(UUID.randomUUID().toString()))
        removeChunks(previous?.files.orEmpty())
    }
    suspend fun removeFile(id: String) = mutex.withLock {
        val previous = requireNotNull(mutable.value.draft)
        draftLocked(previous.copy(files = previous.files.filterNot { file -> file.id == id }))
        removeChunks(previous.files.filter { it.id == id })
    }
    suspend fun attach(name: String, type: String, data: ByteArray) = mutex.withLock {
        val draft = requireNotNull(mutable.value.draft); require(draft.files.size < 5 && !mutable.value.pending)
        val file = MessagingCrypto.encryptFile(requireNotNull(currentKey), context(draft.id, owner, draft.revision + 1), UUID.randomUUID().toString(), name, type, data)
        // Persist chunks first; filenames and all metadata are also encrypted by the Room adapter.
        file.second.forEachIndexed { index, chunk -> write("file/${file.first.id}/$index", chunk) }
        draftLocked(draft.copy(files = draft.files + file.first))
    }
    private suspend fun acknowledge(current: MessagingNotice, command: JSONObject) {
        // A durable done marker makes disk-cleanup failures safe to replay without re-uploading bound files.
        write("pending/${current.id}", JSONObject(command.toString()).put("done", true).toString())
        // Deleting a sent row is independent from a new unsent composition.
        val next = if (command.getString("method") == "DELETE") mutable.value.draft ?: MessagingDraft(UUID.randomUUID().toString()) else MessagingDraft(UUID.randomUUID().toString())
        write("draft/${current.id}", draftJson(next).toString())
        delete("pending/${current.id}")
        publish(mutable.value.copy(pending = false, pendingDelete = false, draft = next))
        val files = command.optJSONArray("uploads") ?: JSONArray()
        for (index in 0 until files.length()) {
            val file = MessagingCrypto.file(files.getJSONObject(index))
            repeat(file.chunks) { delete("file/${file.id}/$it") }
        }
    }
    private fun samePayload(a: JSONObject, b: JSONObject): Boolean = a.optInt("version") == b.optInt("version") && a.optString("iv") == b.optString("iv") && a.optString("ciphertext") == b.optString("ciphertext") && a.getJSONObject("keyIds").keys().asSequence().all { a.getJSONObject("keyIds").getString(it) == b.getJSONObject("keyIds").optString(it) }
    private suspend fun commandRow(current: MessagingNotice, command: JSONObject): JSONObject? {
        val seq = command.getLong("seq")
        var before = if (seq == 0L) 0 else seq + 1
        // A known sequence needs one page. A new message can have moved beyond the newest page after a lost reply.
        repeat(4096) {
            val page = request("GET", "/shared/private-conversations/${current.id}/messages?before=$before")
            val rows = page.getJSONArray("messages"); require(rows.length() <= 50)
            (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.getString("id") == command.getString("id") }?.let { return it }
            val next = (page.opt("nextCursor") as? Number)?.toLong()
            if (seq != 0L || next == null) return null
            require(next > 0 && (before == 0L || next < before)) { "MESSAGING_INVALID_RESPONSE" }; before = next
        }
        error("MESSAGING_RECONCILIATION_LIMIT") // Do not assume absence when a bounded scan cannot prove it.
    }
    private fun provenRow(row: JSONObject?, command: JSONObject): Boolean {
        if (row == null) return false
        if (row.getLong("revision") != command.getLong("revision") + 1) return false
        return if (command.getString("method") == "DELETE") row.opt("deletedAt") is String else row.optJSONObject("payload")?.let { samePayload(it, command.getJSONObject("body").getJSONObject("payload")) } == true
    }
    private suspend fun uploadChunks(current: MessagingNotice, command: JSONObject, reconcileBound: Boolean = false) {
        val uploads = command.getJSONArray("uploads")
        for (index in 0 until uploads.length()) {
            val file = MessagingCrypto.file(uploads.getJSONObject(index))
            repeat(file.chunks) { part ->
                val chunk = requireNotNull(read("file/${file.id}/$part")) { "MESSAGING_UPLOAD_MISSING" }
                val path = "/shared/private-conversations/${current.id}/files/${file.id}/$part"
                val alreadyBound = if (!reconcileBound) false else try {
                    require(request("GET", path).getString("ciphertext") == chunk) { "PRIVATE_FILE_CONFLICT" }; true
                } catch (error: AuthFailure) {
                    if (error.httpStatus != 404) throw error
                    false // GET intentionally excludes unattached uploads; same-ciphertext PUT is idempotent for those.
                } catch (error: AuthApiError) {
                    if (error.code != "PRIVATE_FILE_NOT_FOUND") throw error
                    false
                }
                if (!alreadyBound) request("PUT", path, JSONObject().put("ciphertext", chunk).put("chunks", file.chunks).put("bytes", file.size + 16))
            }
        }
    }
    private suspend fun submit(current: MessagingNotice, command: JSONObject, path: String) {
        val method = command.getString("method")
        try { request(method, path, command.getJSONObject("body")) }
        catch (error: Exception) {
            if (error is CancellationException) throw error
            val row = commandRow(current, command)
            if (provenRow(row, command)) return
            // Only a definitive missing-file reply permits expiry recovery. Keep IDs, ciphertext and expected revision unchanged.
            if (error !is AuthApiError || error.code != "PRIVATE_FILE_NOT_READY" || command.getJSONArray("uploads").length() == 0) throw error
            require(if (method == "POST") row == null else row != null && row.getLong("revision") == command.getLong("revision") && row.opt("deletedAt") !is String) { "MESSAGE_REVISION_CONFLICT" }
            uploadChunks(current, command, reconcileBound = true)
            try { request(method, path, command.getJSONObject("body")) }
            catch (retry: Exception) { if (retry is CancellationException || !provenRow(commandRow(current, command), command)) throw retry }
        }
    }
    private suspend fun finishRecoveredCopy(current: MessagingNotice, command: JSONObject) {
        val next = parseDraft(command.getJSONObject("recoveryDraft"))
        write("draft/${current.id}", draftJson(next).toString())
        delete("pending/${current.id}")
        publish(mutable.value.copy(pending = false, pendingDelete = false, draft = next))
        val old = command.getJSONArray("recoverySourceFiles")
        removeChunks((0 until old.length()).map { MessagingCrypto.file(old.getJSONObject(it)) })
        messagesLocked(0)
    }
    /** Explicit recovery after a real remote CAS conflict. Reconcile first; preserve original journal until the new draft is durable. */
    suspend fun recoverPending() = mutex.withLock {
        val current = requireNotNull(mutable.value.selected)
        val command = JSONObject(requireNotNull(read("pending/${current.id}")))
        require(command.getInt("version") == 1 && command.getString("conversation") == current.id)
        if (command.has("recoveryDraft")) { finishRecoveredCopy(current, command); return@withLock }
        if (command.optBoolean("done") || provenRow(commandRow(current, command), command)) {
            acknowledge(current, command); messagesLocked(0); return@withLock
        }
        if (command.getString("method") == "DELETE") {
            // Cancelling a retry cannot undo a deletion that already happened on the server.
            delete("pending/${current.id}"); publish(mutable.value.copy(pending = false, pendingDelete = false)); messagesLocked(0); return@withLock
        }
        verifyPeerLocked()
        val key = requireNotNull(currentKey)
        val original = MessagingCrypto.content(MessagingCrypto.decryptMessage(key,
            context(command.getString("id"), owner, command.getLong("revision") + 1), command.getJSONObject("body").getJSONObject("payload"), ids()))
        val copyId = UUID.nameUUIDFromBytes(("genesis-messaging-copy-v1:$owner:${current.id}:${command.getString("id")}:${command.getJSONObject("body").getJSONObject("payload").getString("iv")}").toByteArray(Charsets.UTF_8)).toString()
        val copyFiles = original.files.map { file ->
            val chunks = (0 until file.chunks).map { part -> read("file/${file.id}/$part")
                ?: request("GET", "/shared/private-conversations/${current.id}/files/${file.id}/$part").getString("ciphertext") }
            val plain = MessagingCrypto.decryptFile(key, context(command.getString("id"), owner, command.getLong("revision") + 1), file, chunks)
            val fileId = UUID.nameUUIDFromBytes(("genesis-messaging-copy-file-v1:$copyId:${file.id}").toByteArray(Charsets.UTF_8)).toString()
            val encrypted = try { MessagingCrypto.encryptFile(key, context(copyId, owner, 1), fileId, file.name, file.type, plain) } finally { plain.fill(0) }
            encrypted.second.forEachIndexed { index, chunk -> write("file/$fileId/$index", chunk) }
            encrypted.first
        }
        val next = MessagingDraft(copyId, original.text, copyFiles)
        val transition = JSONObject(command.toString()).put("recoveryDraft", draftJson(next)).put("recoverySourceFiles", JSONArray(original.files.map { it.json() }))
        write("pending/${current.id}", transition.toString())
        finishRecoveredCopy(current, transition)
    }
    private suspend fun sendPendingLocked() {
        val current = requireNotNull(mutable.value.selected)
        val command = JSONObject(requireNotNull(read("pending/${current.id}")))
        require(command.getInt("version") == 1 && command.getString("conversation") == current.id)
        if (command.has("recoveryDraft")) { finishRecoveredCopy(current, command); return }
        require(!mutable.value.keyChanged && currentKey != null && mutable.value.accepted)
        if (command.optBoolean("done")) { acknowledge(current, command); messagesLocked(0); return }
        verifyPeerLocked()
        val method = command.getString("method"); val suffix = if (method == "POST") "" else "/${uuid(command.getString("id"))}"
        val path = "/shared/private-conversations/${current.id}/messages$suffix"
        // Try the message first after all chunks were acknowledged. Lost receipts must never re-upload bound chunks.
        if (command.optBoolean("uploaded")) {
            submit(current, command, path)
        } else {
            uploadChunks(current, command)
            command.put("uploaded", true); write("pending/${current.id}", command.toString())
            submit(current, command, path)
        }
        acknowledge(current, command); messagesLocked(0)
    }
    suspend fun send(text: String? = null) = mutex.withLock {
        val current = requireNotNull(mutable.value.selected)
        require(mutable.value.accepted && currentKey != null && !mutable.value.keyChanged)
        if (read("pending/${current.id}") != null) { publish(mutable.value.copy(pending = true)); sendPendingLocked(); return@withLock }
        if (text != null) draftLocked(requireNotNull(mutable.value.draft).copy(text = text))
        val draft = requireNotNull(mutable.value.draft)
        val content = MessagingCrypto.encodeContent(PrivateMessageContent(draft.text, draft.files))
        val payload = MessagingCrypto.encryptMessage(currentKey!!, context(draft.id, owner, draft.revision + 1), content, ids())
        val body = JSONObject().put("id", draft.id).put("payload", payload).put("attachmentIds", JSONArray(draft.files.map { it.id }))
        if (draft.revision > 0) body.put("expectedRevision", draft.revision)
        val uploads = draft.files.filter { read("file/${it.id}/0") != null }
        val command = JSONObject().put("version", 1).put("conversation", current.id).put("method", if (draft.revision == 0L) "POST" else "PATCH").put("id", draft.id).put("revision", draft.revision).put("seq", draft.seq).put("body", body).put("uploads", JSONArray(uploads.map { it.json() })).put("uploaded", uploads.isEmpty())
        write("pending/${current.id}", command.toString()); publish(mutable.value.copy(pending = true, pendingDelete = false)); sendPendingLocked()
    }
    suspend fun delete(row: MessagingRow) = mutex.withLock {
        val current = requireNotNull(mutable.value.selected)
        require(row.senderId == owner && !row.deleted && !mutable.value.pending)
        val command = JSONObject().put("version", 1).put("conversation", current.id).put("method", "DELETE").put("id", row.id).put("revision", row.revision).put("seq", row.seq).put("body", JSONObject().put("expectedRevision", row.revision)).put("uploads", JSONArray()).put("uploaded", true)
        write("pending/${current.id}", command.toString()); publish(mutable.value.copy(pending = true, pendingDelete = true)); sendPendingLocked()
    }
    suspend fun download(row: MessagingRow, file: PrivateFileMetadata): ByteArray = mutex.withLock {
        val current = requireNotNull(mutable.value.selected); require(row.content?.files?.any { it == file } == true && !mutable.value.keyChanged)
        verifyPeerLocked()
        val chunks = (0 until file.chunks).map { request("GET", "/shared/private-conversations/${current.id}/files/${uuid(file.id)}/$it").getString("ciphertext") }
        MessagingCrypto.decryptFile(requireNotNull(currentKey), context(row.id, row.senderId, row.revision), file, chunks).also { check() }
    }
    suspend fun clear() = mutex.withLock {
        val current = requireNotNull(mutable.value.selected); require(!mutable.value.pending)
        // Non-idempotent across new messages: never replay clear automatically after a lost receipt.
        request("DELETE", "/shared/private-conversations/${current.id}/messages", JSONObject())
        publish(mutable.value.copy(messages = emptyList(), before = null)); inboxLocked()
    }
    fun requireDataExchange() { check(); gateway.featureAccess().requireDataExchange() }
    suspend fun exportBackup(password: String): String = mutex.withLock {
        requireDataExchange()
        MessagingCrypto.exportBackup(requireNotNull(identity), password).also { requireDataExchange() }
    }
    /** Recheck after the system picker; an earlier prepared key must not retain an expired grant. */
    fun writeBackup(source: String, open: () -> java.io.OutputStream) {
        requireDataExchange()
        open().use { it.write(source.toByteArray(Charsets.UTF_8)); it.flush() }
    }
    suspend fun importBackup(source: String, password: String) = mutex.withLock {
        requireDataExchange()
        val imported = MessagingCrypto.importBackup(source, password); requireDataExchange()
        val registered = request("GET", "/shared/messaging/key"); val id = registered.opt("keyId") as? String
        require(id == null || id == imported.keyId) { "MESSAGING_KEY_MISMATCH" }
        require(identity == null || identity!!.keyId == imported.keyId) { "MESSAGING_KEY_MISMATCH" }
        requireDataExchange()
        write("identity", MessagingCrypto.privateJwk(imported)); identity = imported
        if (id == null) {
            requireDataExchange()
            request("POST", "/shared/messaging/key", JSONObject().put("publicKey", JSONObject(imported.publicJson)))
        }
        initialized = false; initializeLocked(); inboxLocked()
        mutable.value.selected?.let { current ->
            val peer = peersLocked(current.spaceId).first { it.id == current.peerId }
            selectLocked(current, mutable.value.accepted, mutable.value.initiator, peer, mutable.value.declined)
        }
    }
    suspend fun closeConversation() = mutex.withLock {
        currentKey?.fill(0); currentKey = null; currentPeer = null
        publish(mutable.value.copy(selected = null, messages = emptyList(), draft = null, securityCode = null, accepted = false, declined = false, accessBlocked = false, offline = false, pending = false, pendingDelete = false, keyChanged = false))
        inboxLocked()
    }
    companion object {
        private val instances = java.util.WeakHashMap<GenesisDatabase, MutableMap<String, java.lang.ref.WeakReference<MessagingRepository>>>()
        fun room(database: GenesisDatabase, scope: String, ownerUid: String, gateway: MessagingGateway): MessagingRepository = synchronized(instances) {
            val key = "$scope:$ownerUid"
            val entries = instances.getOrPut(database) { mutableMapOf() }
            entries[key]?.get() ?: MessagingRepository(ownerUid, gateway, MessagingRoomStore(database, scope, ownerUid)).also { entries[key] = java.lang.ref.WeakReference(it) }
        }
    }
}
