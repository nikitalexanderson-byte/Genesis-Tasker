package ru.genesis.calendar.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.auth.MessagingProtocol
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.security.MessagingCrypto
import ru.genesis.calendar.security.MessagingIdentity
import ru.genesis.calendar.security.MessageContext
import java.util.UUID

internal data class MessengerMember(val userId: String, val name: String, val role: String, val status: String,
    val deviceId: String? = null, val keyId: String? = null, val publicKey: String? = null, val revoked: Boolean = false)
internal data class MessengerChat(val id: String, val kind: String, val title: String, val members: List<MessengerMember>, val unread: Int = 0)
internal data class MessengerContact(val userId: String, val name: String, val email: String)
internal data class MessengerRow(val id: String, val seq: Long, val senderId: String, val revision: Int, val text: String, val deleted: Boolean, val failed: Boolean = false) {
    override fun toString() = "MessengerRow([redacted])"
}
internal data class MessengerState(val ready: Boolean = false, val chats: List<MessengerChat> = emptyList(), val hiddenChats: List<MessengerChat> = emptyList(), val contacts: List<MessengerContact> = emptyList(),
    val blocked: List<MessengerContact> = emptyList(),
    val selected: MessengerChat? = null, val rows: List<MessengerRow> = emptyList(), val before: Long? = null,
    val draft: String = "", val editing: MessengerRow? = null, val pending: Boolean = false, val pendingConflict: Boolean = false,
    val secretError: String? = null, val securityCode: String? = null, val offline: Boolean = false)

/** Same account session as the rest of GENESIS. Device keys and commands are Keystore-sealed Room cells. */
internal class MessengerRepository(val owner: String, private val gateway: MessagingGateway, private val store: MessagingStore) {
    private val mutex = Mutex()
    private val mutable = MutableStateFlow(MessengerState())
    val state = mutable.asStateFlow()
    private var deviceId: String? = null
    private var identity: MessagingIdentity? = null
    private var currentKey: ByteArray? = null
    private var currentIds = emptyMap<String, String>()
    private fun check() = gateway.check()
    private fun publish(value: MessengerState) { check(); mutable.value = value }
    private suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        check(); val full = "/shared/messenger$path"; require(MessagingProtocol.allowedRoute(method, full))
        return gateway.request(method, full, body).also { check() }
    }
    private suspend fun read(key: String) = store.read("messenger/$key").also { check() }
    private suspend fun write(key: String, value: String) { check(); store.write("messenger/$key", value); check() }
    private suspend fun delete(key: String) { check(); store.delete("messenger/$key"); check() }
    private fun id(value: String) = value.also { require(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").matches(it)) }
    private fun text(row: JSONObject, key: String) = row.opt(key) as? String
    private fun chat(row: JSONObject): MessengerChat {
        val kind = row.getString("kind"); require(kind in setOf("direct", "group", "project", "secret"))
        val members = row.getJSONArray("members"); require(members.length() <= 5000)
        return MessengerChat(id(row.getString("id")), kind, row.getString("title"), (0 until members.length()).map { i -> members.getJSONObject(i).let {
            val public = it.optJSONObject("publicKey")
            MessengerMember(it.getString("userId"), it.getString("name"), it.getString("role"), it.getString("status"), text(it,"deviceId"), text(it,"keyId"), public?.let(MessagingCrypto::canonicalPublicKey), text(it,"revokedAt") != null)
        } }, row.optInt("unread").coerceAtLeast(0))
    }
    private suspend fun inboxLocked() {
        val result = request("GET", "/conversations")
        val rows = result.getJSONArray("conversations")
        val hidden = result.optJSONArray("hiddenConversations") ?: JSONArray()
        require(rows.length() + hidden.length() <= 500)
        publish(mutable.value.copy(ready = true, chats = (0 until rows.length()).map { chat(rows.getJSONObject(it)) },
            hiddenChats = (0 until hidden.length()).map { chat(hidden.getJSONObject(it)) }))
    }
    suspend fun initialize() = mutex.withLock { inboxLocked() }
    suspend fun inbox() = mutex.withLock { inboxLocked() }
    suspend fun visibility(chatId: String, action: String) = mutex.withLock {
        require(action in setOf("hide", "show", "delete"))
        request("POST", "/conversations/${id(chatId)}/visibility", JSONObject().put("action", action))
        if (action == "delete") delete("draft/$chatId")
        inboxLocked()
    }
    private suspend fun deviceLocked(): String {
        if (identity == null) {
            val saved = read("device")?.let(::JSONObject)
            if (saved == null) {
                val created = MessagingCrypto.createIdentity(); val did = UUID.randomUUID().toString()
                write("device", JSONObject().put("id", did).put("privateKey", JSONObject(MessagingCrypto.privateJwk(created))).toString())
                identity = created; deviceId = did
            } else { deviceId = id(saved.getString("id")); identity = MessagingCrypto.importIdentity(saved.getJSONObject("privateKey")) }
        }
        val result = request("POST", "/devices", JSONObject().put("id", deviceId).put("publicKey", JSONObject(identity!!.publicJson)).put("label", "Android"))
        val rows = result.getJSONArray("devices")
        require((0 until rows.length()).any { rows.getJSONObject(it).let { d -> d.getString("id") == deviceId && d.getString("keyId") == identity!!.keyId && text(d,"revokedAt") == null } })
        return requireNotNull(deviceId)
    }
    private suspend fun secretLocked(current: MessengerChat) {
        currentKey?.fill(0); currentKey = null; currentIds = emptyMap()
        if (current.kind != "secret") { publish(mutable.value.copy(secretError = null, securityCode = null)); return }
        try {
            val own = current.members.first { it.userId == owner }; val peer = current.members.first { it.userId != owner }
            if (own.status == "pending") { publish(mutable.value.copy(secretError = null, securityCode = null)); return }
            require(current.members.size == 2 && own.deviceId == deviceLocked() && own.keyId == identity!!.keyId) { "MESSENGER_SECRET_DEVICE_ONLY" }
            require(own.status == "active" && peer.status == "active" && !own.revoked && !peer.revoked && peer.publicKey != null && peer.keyId != null) { "MESSENGER_SECRET_NOT_READY" }
            require(MessagingCrypto.fingerprint(JSONObject(peer.publicKey)) == peer.keyId) { "MESSENGER_DEVICE_CHANGED" }
            val pin = JSONArray(current.members.sortedBy { it.userId }.map { JSONArray().put(it.userId).put(it.deviceId).put(it.keyId) }).toString()
            val old = read("pin/${current.id}")
            require(old == null || old == pin) { "MESSENGER_DEVICE_CHANGED" }
            if (old == null) write("pin/${current.id}", pin)
            currentKey = MessagingCrypto.conversationKey(identity!!, JSONObject(peer.publicKey), current.id, "messenger-secret-v1")
            currentIds = mapOf(owner to own.keyId!!, peer.userId to peer.keyId)
            publish(mutable.value.copy(secretError = null, securityCode = MessagingCrypto.securityCode(currentIds.values.toList())))
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { publish(mutable.value.copy(secretError = error.message ?: "MESSENGER_SECRET_NOT_READY", securityCode = null, rows = emptyList())) }
    }
    suspend fun select(selected: MessengerChat) = mutex.withLock {
        val current = chat(request("GET", "/conversations/${id(selected.id)}"))
        val draft = read("draft/${current.id}")?.let(::JSONObject)
        publish(mutable.value.copy(selected = current, rows = emptyList(), before = null, editing = null, draft = draft?.optString("text") ?: "", pending = read("pending/${current.id}") != null, pendingConflict = false, secretError = null, securityCode = null, offline = false))
        // Persisted edit target is restored only when its authoritative row is loaded.
        secretLocked(current)
        if (current.members.none { it.userId == owner && it.status == "pending" } && mutable.value.secretError == null) messagesLocked()
    }
    private fun context(current: MessengerChat, id: String, sender: String, revision: Int) = MessageContext("messenger-secret-v1", current.id, id, sender, revision.toLong())
    private suspend fun messagesLocked(before: Long = 0) {
        val current = requireNotNull(mutable.value.selected)
        val result = request("GET", "/conversations/${current.id}/messages?before=$before" + if (current.kind == "secret") "&deviceId=${requireNotNull(deviceId)}" else "")
        val rows = result.getJSONArray("messages"); require(rows.length() <= 50)
        val parsed = (0 until rows.length()).map { i -> rows.getJSONObject(i).let {
            val mid = id(it.getString("id")); val sender = it.getString("senderId"); val revision = it.getInt("revision"); val seq = it.getLong("seq"); require(revision > 0 && seq > 0)
            val deleted = text(it,"deletedAt") != null
            val value = if (deleted) "" else runCatching { if (current.kind == "secret") MessagingCrypto.decryptMessage(requireNotNull(currentKey), context(current,mid,sender,revision),it.getJSONObject("payload"),currentIds) else it.getString("text") }.getOrNull()
            MessengerRow(mid, seq, sender, revision, value ?: "", deleted, !deleted && value == null)
        } }
        val cursor = (result.opt("nextCursor") as? Number)?.toLong()
        val old = mutable.value.rows.filter { it.seq > result.optLong("clearedThrough", 0) }
        val combined = if (before > 0) (parsed + old).distinctBy { it.id }.sortedBy { it.seq } else old.filter { parsed.firstOrNull()?.seq?.let { start -> it.seq < start } == true } + parsed
        publish(mutable.value.copy(rows = combined, before = if (before > 0 || old.size <= 50) cursor else mutable.value.before, offline = false))
        if (parsed.isNotEmpty() && parsed.none { it.failed }) request("POST", "/conversations/${current.id}/read",JSONObject().put("seq", parsed.maxOf { it.seq }).also { if(current.kind=="secret")it.put("deviceId",deviceId) })
    }
    suspend fun refresh() = mutex.withLock {
        val selected = mutable.value.selected ?: return@withLock
        try {
            val current = chat(request("GET", "/conversations/${selected.id}")); publish(mutable.value.copy(selected = current))
            secretLocked(current)
            if (current.members.none { it.userId == owner && it.status == "pending" } && mutable.value.secretError == null) messagesLocked()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { if(error is AuthFailure && error.httpStatus in setOf(401,403,404) || error.message?.contains("NOT_FOUND") == true || error.message?.contains("FORBIDDEN") == true) publish(mutable.value.copy(rows = emptyList(), secretError = "MESSENGER_NOT_FOUND")) else publish(mutable.value.copy(offline = true)); throw error }
    }
    suspend fun older() = mutex.withLock { mutable.value.before?.let { messagesLocked(it) } }
    suspend fun close() = mutex.withLock { currentKey?.fill(0); currentKey = null; currentIds = emptyMap(); publish(mutable.value.copy(selected = null, rows = emptyList(), draft = "", editing = null, pending = false, pendingConflict = false, secretError = null, securityCode = null)); inboxLocked() }
    suspend fun saveDraft(value: String) = mutex.withLock {
        val current = mutable.value.selected ?: return@withLock
        if (mutable.value.pending) return@withLock
        require(value.toByteArray().size <= 30000)
        write("draft/${current.id}",JSONObject().put("text", value).toString()); publish(mutable.value.copy(draft = value))
    }
    suspend fun edit(row: MessengerRow?) = mutex.withLock {
        require(!mutable.value.pending)
        if(row!=null)require(row.senderId==owner && !row.failed && !row.deleted)
        publish(mutable.value.copy(editing = row, draft = row?.text ?: ""))
    }
    private suspend fun retryLocked() {
        val current = requireNotNull(mutable.value.selected)
        val command = JSONObject(requireNotNull(read("pending/${current.id}")))
        try { request(command.getString("method"), command.getString("path"), command.getJSONObject("body")) }
        catch (failure: AuthFailure) {
            if (failure.kind == AuthFailure.Kind.CONFLICT || failure.httpStatus == 409) publish(mutable.value.copy(pendingConflict = true))
            throw failure
        }
        delete("pending/${current.id}"); delete("draft/${current.id}")
        publish(mutable.value.copy(pending = false, pendingConflict = false, draft = "", editing = null)); messagesLocked(); inboxLocked()
    }
    /** Only a confirmed conflict unlocks this action; an uncertain network result must be retried verbatim. */
    suspend fun recoverPendingConflict() = mutex.withLock {
        require(mutable.value.pending && mutable.value.pendingConflict)
        val current = requireNotNull(mutable.value.selected)
        messagesLocked() // Keep the journal intact if fresh state cannot be read.
        val draft = mutable.value.draft
        write("draft/${current.id}", JSONObject().put("text", draft).toString())
        delete("pending/${current.id}")
        publish(mutable.value.copy(pending = false, pendingConflict = false, editing = null, draft = draft))
    }
    suspend fun send() = mutex.withLock {
        val current = requireNotNull(mutable.value.selected)
        if(mutable.value.pending) { retryLocked(); return@withLock }
        val fresh=chat(request("GET","/conversations/${current.id}"));secretLocked(fresh);require(mutable.value.secretError==null)
        val draft = mutable.value.draft; require(draft.isNotBlank() && draft.toByteArray().size <= 30000)
        val edit = mutable.value.editing; val mid = edit?.id ?: UUID.randomUUID().toString(); val body = JSONObject().put("id",mid)
        if(edit!=null)body.put("expectedRevision",edit.revision)
        if(current.kind=="secret")body.put("deviceId",deviceId).put("payload",MessagingCrypto.encryptMessage(requireNotNull(currentKey),context(current,mid,owner,(edit?.revision?:0)+1),draft,currentIds)) else body.put("text",draft)
        val command=JSONObject().put("method",if(edit==null)"POST" else "PATCH").put("path","/conversations/${current.id}/messages"+(if(edit==null)"" else "/$mid")).put("body",body)
        write("pending/${current.id}",command.toString());publish(mutable.value.copy(pending=true));retryLocked()
    }
    suspend fun deleteMessage(row: MessengerRow) = mutex.withLock {
        val current=requireNotNull(mutable.value.selected);require(row.senderId==owner&&!mutable.value.pending)
        val body=JSONObject().put("expectedRevision",row.revision);if(current.kind=="secret")body.put("deviceId",deviceLocked())
        val command=JSONObject().put("method","DELETE").put("path","/conversations/${current.id}/messages/${row.id}").put("body",body)
        write("pending/${current.id}",command.toString());publish(mutable.value.copy(pending=true));retryLocked()
    }
    suspend fun contacts() = mutex.withLock { contactsLocked() }
    private suspend fun contactsLocked() {
        val result=request("GET","/contacts");val rows=result.getJSONArray("contacts");val blocked=result.optJSONArray("blocked")?:JSONArray();require(rows.length()<=2000&&blocked.length()<=2000)
        fun parse(values:JSONArray)=(0 until values.length()).map{values.getJSONObject(it).let{r->MessengerContact(r.getString("userId"),r.getString("name"),r.getString("email"))}}
        publish(mutable.value.copy(contacts=parse(rows),blocked=parse(blocked)))
    }
    suspend fun addContact(email: String) = mutex.withLock { request("POST","/contacts",JSONObject().put("email",email));contactsLocked() }
    suspend fun removeContact(user: String) = mutex.withLock { request("DELETE","/contacts",JSONObject().put("userId",user));contactsLocked() }
    suspend fun block(user: String, blocked: Boolean) = mutex.withLock { request("POST","/blocks",JSONObject().put("userId",user).put("blocked",blocked));publish(mutable.value.copy(selected=null,rows=emptyList()));inboxLocked();contactsLocked() }
    suspend fun projects(): List<Pair<String,String>> = mutex.withLock { val rows=request("GET","/projects").getJSONArray("projects");(0 until rows.length()).map{rows.getJSONObject(it).let{r->id(r.getString("id")) to r.getString("title")}} }
    suspend fun devices(): JSONArray = mutex.withLock { request("GET","/devices").getJSONArray("devices") }
    suspend fun revokeDevice(id: String) = mutex.withLock { request("DELETE","/devices/${id(id)}") }
    suspend fun create(kind: String, email: String = "", title: String = "", projectId: String = "", commandId: String): MessengerChat = mutex.withLock {
        val input=JSONObject().put("id",id(commandId)).put("kind",kind)
        when(kind){"project"->input.put("projectId",id(projectId));"group"->input.put("title",title).put("emails",JSONArray(email.split(',').map{it.trim()}.filter{it.isNotEmpty()}));else->input.put("email",email)}
        if(kind=="secret")input.put("deviceId",deviceLocked())
        chat(request("POST","/conversations",input)).also{inboxLocked()}
    }
    suspend fun membership(action: String, email: String = "", userId: String = "") = mutex.withLock {
        val current=requireNotNull(mutable.value.selected)
        val body=JSONObject().put("action",action).put("email",email).put("userId",userId)
        if(current.kind=="secret"&&action=="accept")body.put("deviceId",deviceLocked())
        request("POST","/conversations/${current.id}/membership",body)
        if(action in setOf("decline","leave"))publish(mutable.value.copy(selected=null,rows=emptyList()))
        else {val fresh=chat(request("GET","/conversations/${current.id}"));publish(mutable.value.copy(selected=fresh));secretLocked(fresh);if(mutable.value.secretError==null)messagesLocked()}
        inboxLocked()
    }
    companion object { fun room(database: GenesisDatabase, scope: String, owner: String, gateway: MessagingGateway) = MessengerRepository(owner,gateway,MessagingRoomStore(database,scope,owner)) }
}
