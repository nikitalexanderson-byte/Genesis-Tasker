package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.SecretKey

/** Login is deliberately insufficient to construct this capability. */
interface E2eeScopeDevice {
    val ownerId: String
    val deviceId: String
    val vault: UnlockedE2eeVault
    fun requireOpen()
    fun keys(): E2eeKeys.DeviceKeys
    fun ensureDurableKeys()
    fun rememberDirectory(scopeId: String, pin: JSONObject, events: JSONArray, scopeOwner: String = ownerId,
        onVerified: ((E2eeDirectory.Verified) -> Unit)? = null): E2eeDirectory.Verified
    fun savedDirectory(scopeId: String, onVerified: ((E2eeDirectory.Verified) -> Unit)? = null): E2eeDirectory.Verified?
}

/** Implementations use the existing authenticated HTTP channel on an IO dispatcher. */
interface E2eeScopeTransport {
    fun directory(scopeId: String): JSONObject
    fun command(packet: JSONObject): JSONObject
    fun read(packet: JSONObject): JSONObject
}

/** Same normal-operation protocol and durable retry records as the browser.
 * A local save succeeds only after both the draft and exact upload ciphertext
 * are committed. A failed network request never consumes or replaces the draft.
 */
class E2eeScopeClient(private val device: E2eeScopeDevice, private val ownerId: String, private val scopeId: String,
    authorityPin: JSONObject, private val transport: E2eeScopeTransport) {
    class Opened(val bytes: ByteArray, val filename: String, val mediaType: String, val revision: Long) {
        override fun toString() = "E2eeScopeClient.Opened([redacted])"
    }
    private val pin = JSONObject(authorityPin.toString())
    private var directory: E2eeDirectory.Verified? = null
    private var history = mutableMapOf<String, E2eeDirectory.Verified>()
    private var roots = mutableMapOf<String, SecretKey>()
    private val sealedCache = mutableMapOf<String, JSONArray>()
    private var refreshed = false
    private var directoryFrames=mutableMapOf<Long,E2eeDirectory.Verified>()
    init { E2eeKeys.technical(ownerId); E2eeKeys.technical(scopeId) }
    fun assertBinding(candidate: E2eeScopeDevice, candidateScope: String) {
        check(candidate === device && candidateScope == scopeId) { "E2EE_SCOPE_BINDING_MISMATCH" }
    }
    private fun current(): E2eeDirectory.Verified {
        device.requireOpen()
        return directory ?: throw IllegalStateException("E2EE_DIRECTORY_REQUIRED")
    }
    private fun epochKey(value: E2eeDirectory.Verified) = "${value.cryptoEpoch}:${value.securityEpoch}:${value.keyId}:${value.generation}"
    private fun epochKey(value: JSONObject) = listOf("cryptoEpoch", "securityEpoch", "keyId", "dataGeneration").joinToString(":") { value.get(it).toString() }
    private fun hash(value: String) = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))
    private fun id(domain: String, objectId: String): String {
        E2eeKeys.technical(domain); E2eeKeys.technical(objectId)
        return hash("$scopeId\u0000$domain\u0000$objectId")
    }

    @Synchronized fun refresh(): E2eeDirectory.Verified {
        refreshed = false
        device.requireOpen()
        val response = transport.directory(scopeId)
        device.requireOpen()
        val frames = mutableMapOf<String, E2eeDirectory.Verified>();val revisions=mutableMapOf<Long,E2eeDirectory.Verified>()
        val verified = device.rememberDirectory(scopeId, pin, response.getJSONArray("events"), ownerId) { frames[epochKey(it)] = it;revisions[it.checkpoint.revision]=it }
        installDirectory(verified, frames)
        directoryFrames=revisions;refreshed = true
        try { loadSealedHeads(true) } catch (error: Exception) { refreshed = false; throw error }
        // Do not hand a mutable authorization roster to product code.
        return E2eeDirectory.verify(ownerId, scopeId, pin, response.getJSONArray("events"), verified.checkpoint)
    }
    @Synchronized fun hydrateOffline(): E2eeDirectory.Verified {
        refreshed = false; device.requireOpen()
        val frames = mutableMapOf<String, E2eeDirectory.Verified>();val revisions=mutableMapOf<Long,E2eeDirectory.Verified>()
        val verified = device.savedDirectory(scopeId) { frames[epochKey(it)] = it;revisions[it.checkpoint.revision]=it } ?: throw IllegalStateException("E2EE_DIRECTORY_REQUIRED")
        installDirectory(verified, frames);directoryFrames=revisions; loadSealedHeads(false)
        // Reconstruct a separate copy for callers through the saved signed events.
        return requireNotNull(device.savedDirectory(scopeId))
    }
    private fun installDirectory(verified: E2eeDirectory.Verified, frames: MutableMap<String, E2eeDirectory.Verified>) {
        check(verified.ownerId == ownerId && E2eeCommands.canonical(verified.recoveryKit.getJSONObject("authority")).contentEquals(E2eeCommands.canonical(pin))) { "E2EE_AUTHORITY_CHANGED" }
        val own = verified.devices[device.deviceId]
        check(own != null && !own.revoked && own.userId == device.ownerId) { "E2EE_REVOKED_DEVICE" }
        val available = mutableMapOf<String, SecretKey>()
        val keys = device.keys()
        for (grant in own.historyCapsules + E2eeDirectory.HistoricalRoot(verified.cryptoEpoch, verified.keyId, own.capsule)) {
            available[grant.keyId] = E2eeKeys.openRoot(grant.capsule, keys.receiving,
                E2eeKeys.RootRecipient(ownerId, scopeId, grant.cryptoEpoch, grant.keyId, device.deviceId))
        }
        device.requireOpen()
        history = frames; roots = available; directory = verified
    }
    private fun packet(action: String, payload: JSONObject, operationId: String = UUID.randomUUID().toString()): JSONObject {
        val value = current()
        return E2eeCommands.sign(JSONObject().put("protocol", 1).put("ownerId", ownerId).put("scopeId", scopeId)
            .put("deviceId", device.deviceId).put("action", action).put("expectedRevision", value.checkpoint.revision)
            .put("checkpointHash", value.checkpoint.hash).put("securityEpoch", value.securityEpoch)
            .put("operationId", operationId).put("payload", payload), device.keys().signing.private)
    }
    private fun readPacket(action: String, payload: JSONObject): JSONObject {
        check(refreshed) { "E2EE_REFRESH_REQUIRED" }
        val signed = packet(action, payload); device.requireOpen()
        val response = transport.read(signed); device.requireOpen()
        val command = signed.getJSONObject("command")
        check(response.get("checkpointHash") == command.get("checkpointHash")
            && E2eeCommands.integer(response.get("directoryRevision")) == E2eeCommands.integer(command.get("expectedRevision"))) { "E2EE_DIRECTORY_CONFLICT" }
        return response
    }
    private class Job(val value: JSONObject, val serial: Long)
    class LocalJob(val originId: String?, val expectedRevision: Long, val complete: Boolean)
    @Synchronized fun localJob(domain: String, objectId: String): LocalJob? {
        device.requireOpen(); val loaded = loadJob(id(domain, objectId)) ?: return null
        return LocalJob(if(loaded.value.isNull("originId"))null else loaded.value.getString("originId"),loaded.value.getLong("expected"),loaded.value.getBoolean("complete"))
    }
    fun assertVerifiedRevision(domain: String, objectId: String, revision: Long) {
        device.requireOpen(); val floor = device.vault.read("key-check", "floor:${id(domain,objectId)}")
        try { check(floor != null && JSONObject(floor.bytes.toString(Charsets.UTF_8)).getLong("revision") == revision) { "E2EE_VERIFIED_REMOTE_REQUIRED" } }
        finally { floor?.bytes?.fill(0) }
    }
    private fun loadJob(id: String): Job? {
        val row = device.vault.read("outbox", "job:$id") ?: return null
        try {
            val job = JSONObject(row.bytes.toString(Charsets.UTF_8))
            val size = E2eeCommands.integer(job.get("size")); val uploaded = E2eeCommands.integer(job.get("uploaded"))
            val plan = job.getJSONArray("plan")
            check(E2eeCommands.integer(job.get("protocol")) == 1L && job.get("scopeId") == scopeId
                && plan.length() in 1..258 && uploaded <= plan.length() && job.get("complete") is Boolean
                && job.getJSONObject("metadata").getString("filename").length <= 512 && job.getJSONObject("metadata").getString("mediaType").length <= 128
                && size <= E2eeFiles.MAX_FILE_BYTES && E2eeCommands.integer(job.get("draftParts")) == (size + E2eeFiles.CHUNK_BYTES - 1) / E2eeFiles.CHUNK_BYTES) { "E2EE_CORRUPT_OUTBOX" }
            return Job(job, row.serial)
        } finally { row.bytes.fill(0) }
    }
    private fun saveJob(id: String, job: JSONObject, serial: Long?, changes: List<UnlockedE2eeVault.Write> = emptyList()): Long {
        val bytes = job.toString().toByteArray(Charsets.UTF_8)
        try { device.vault.write(changes + UnlockedE2eeVault.Write("outbox", "job:$id", bytes, serial)) }
        finally { bytes.fill(0) }
        return (serial ?: 0) + 1
    }
    @Synchronized fun prepare(domain: String, objectId: String, source: ByteArray, expectedRevision: Long,
        filename: String = "", mediaType: String = "application/json", originId: String? = null) {
        originId?.let(E2eeKeys::technical)
        prepareInternal(domain, objectId, source, expectedRevision, filename, mediaType, null, originId)
    }
    private fun prepareInternal(domain: String, objectId: String, source: ByteArray, expectedRevision: Long,
        filename: String, mediaType: String, replacement: Job?, originId: String? = null) {
        val value = current(); check(value.state == "active") { "E2EE_NOT_ACTIVE" }
        require(expectedRevision in 0..9007199254740990L) { "E2EE_INVALID_REVISION" }
        require(source.size <= E2eeFiles.MAX_FILE_BYTES && (domain != "shared-comment" || source.size <= 65536 && expectedRevision == 0L)) { "E2EE_FILE_TOO_LARGE" }
        val bytes = source.copyOf(); val changes = mutableListOf<UnlockedE2eeVault.Write>()
        try {
            device.ensureDurableKeys(); val key = id(domain, objectId); val previous = loadJob(key)
            val signed = sealedHead(domain, objectId)
            val savedFloor = device.vault.read("key-check", "floor:$key")
            val localRevision = try { savedFloor?.let { JSONObject(it.bytes.toString(Charsets.UTF_8)).getLong("revision") } ?: 0L }
                finally { savedFloor?.bytes?.fill(0) }
            check(expectedRevision >= maxOf(signed?.getLong("revision") ?: 0L, localRevision)) { "E2EE_OBJECT_CONFLICT" }
            if (replacement != null) {
                check(previous != null && previous.serial == replacement.serial
                    && previous.value.get("draftId") == replacement.value.get("draftId")
                    && previous.value.isNull("pending") && previous.value.isNull("cancelling")) { "E2EE_LOCAL_CONFLICT" }
                changes += UnlockedE2eeVault.Write("local-snapshot", "${replacement.value.getString("draftId")}:rebase:${UUID.randomUUID()}",
                    replacement.value.toString().toByteArray(), null)
            } else check(previous == null || previous.value.getBoolean("complete")) { "E2EE_PENDING_SAVE_REQUIRED" }
            val root = roots[value.keyId] ?: throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
            val context = E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol", 1).put("suite", E2eeEnvelope.SUITE)
                .put("ownerId", ownerId).put("scopeId", scopeId).put("domain", domain).put("objectId", objectId).put("schemaVersion", 1)
                .put("dataGeneration", value.generation).put("writerProtocol", 9).put("cryptoEpoch", value.cryptoEpoch)
                .put("securityEpoch", value.securityEpoch).put("revision", expectedRevision + 1).put("keyId", value.keyId)
                .put("deviceId", device.deviceId).put("operationId", UUID.randomUUID().toString()))
            E2eeDirectory.contentSigningKey(value, context.toJson())
            val sealed = if (domain == "shared-comment") E2eeFiles.Sealed(E2eeEnvelope.seal(root, device.keys().signing.private, context, bytes), emptyList())
                else E2eeFiles.seal(root, device.keys().signing.private, context, bytes, filename, mediaType)
            val draftId = UUID.randomUUID().toString(); val draftParts = (bytes.size + E2eeFiles.CHUNK_BYTES - 1) / E2eeFiles.CHUNK_BYTES
            for (part in 0 until draftParts) changes += UnlockedE2eeVault.Write("draft", "$draftId:$part",
                bytes.copyOfRange(part * E2eeFiles.CHUNK_BYTES, minOf((part + 1) * E2eeFiles.CHUNK_BYTES, bytes.size)), null)
            val plan = JSONArray()
            for (envelope in sealed.chunks + sealed.manifest) {
                val recordId = "$draftId:cipher:${plan.length()}"
                changes += UnlockedE2eeVault.Write("outbox", recordId, envelope.toJson().toString().toByteArray(), null)
                plan.put(JSONObject().put("recordId", recordId).put("hash", E2eeEnvelope.payloadHash(envelope))
                    .put("expected", if (envelope === sealed.manifest) expectedRevision else 0))
            }
            val job = JSONObject().put("protocol", 1).put("scopeId", scopeId).put("domain", domain).put("objectId", objectId)
                .put("generation", value.generation).put("cryptoEpoch", value.cryptoEpoch).put("keyId", value.keyId).put("expected", expectedRevision)
                .put("size", bytes.size).put("metadata", JSONObject().put("filename", filename).put("mediaType", mediaType))
                .put("originId", originId?:replacement?.value?.opt("originId")?:JSONObject.NULL)
                .put("draftId", draftId).put("draftParts", draftParts).put("plan", plan).put("uploaded", 0)
                .put("pending", JSONObject.NULL).put("cancelling", JSONObject.NULL).put("complete", false)
            saveJob(key, job, previous?.serial, changes)
        } finally { bytes.fill(0); changes.forEach { it.bytes.fill(0) } }
    }
    @Synchronized fun readDraft(domain: String, objectId: String): ByteArray? {
        device.requireOpen(); val job = loadJob(id(domain, objectId))?.value ?: return null
        val bytes = ByteArray(E2eeCommands.integer(job.get("size")).toInt()); var offset = 0
        try {
            for (part in 0 until job.getInt("draftParts")) {
                val row = device.vault.read("draft", "${job.getString("draftId")}:$part") ?: throw IllegalStateException("E2EE_CORRUPT_OUTBOX")
                try {
                    check(row.bytes.size == minOf(E2eeFiles.CHUNK_BYTES, bytes.size - offset)) { "E2EE_CORRUPT_OUTBOX" }
                    row.bytes.copyInto(bytes, offset); offset += row.bytes.size
                } finally { row.bytes.fill(0) }
            }
            device.requireOpen(); return bytes
        } catch (error: Exception) { bytes.fill(0); throw error }
    }
    @Synchronized fun flush(domain: String, objectId: String, originId: String? = null): Long {
        check(refreshed) { "E2EE_REFRESH_REQUIRED" }
        val value = current(); val key = id(domain, objectId); val loaded = loadJob(key) ?: throw IllegalStateException("E2EE_PENDING_SAVE_REQUIRED")
        val job = loaded.value; var serial = loaded.serial
        check(originId == null || job.opt("originId") == originId) { "E2EE_PENDING_EDITOR_MISMATCH" }
        if (job.getBoolean("complete")) return job.getLong("expected") + 1
        check(job.isNull("cancelling") && job.getLong("generation") == value.generation
            && job.getLong("cryptoEpoch") == value.cryptoEpoch && job.getString("keyId") == value.keyId) { "E2EE_DRAFT_REBASE_REQUIRED" }
        val plan = job.getJSONArray("plan")
        while (job.getInt("uploaded") < plan.length()) {
            val item = plan.getJSONObject(job.getInt("uploaded"))
            val row = device.vault.read("outbox", item.getString("recordId")) ?: throw IllegalStateException("E2EE_CORRUPT_OUTBOX")
            val envelope = try { E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8))).also {
                check(E2eeEnvelope.payloadHash(it) == item.getString("hash")) { "E2EE_CORRUPT_OUTBOX" }
            } } finally { row.bytes.fill(0) }
            if (job.isNull("pending")) {
                job.put("pending", packet("put", JSONObject().put("envelope", envelope.toJson()).put("expectedObjectRevision", item.get("expected"))
                    .put("migrationId", JSONObject.NULL).put("fence", 0), envelope.context.toJson().getString("operationId")))
                serial = saveJob(key, job, serial)
            }
            var pending = job.getJSONObject("pending"); val command = pending.getJSONObject("command")
            val result = if (command.getLong("expectedRevision") != value.checkpoint.revision || command.get("checkpointHash") != value.checkpoint.hash) {
                val lookup = readPacket("receipt", JSONObject().put("operationId", command.get("operationId")).put("payloadHash", E2eeCommands.hash(command)))
                if (!lookup.isNull("receipt")) {
                    val receipt = lookup.getJSONObject("receipt")
                    check(receipt.get("payloadHash") == E2eeCommands.hash(command)) { "E2EE_INVALID_RECEIPT" }; receipt.getJSONObject("result")
                } else {
                    pending = packet("put", command.getJSONObject("payload"), command.getString("operationId"))
                    job.put("pending", pending); serial = saveJob(key, job, serial)
                    device.requireOpen(); transport.command(pending)
                }
            } else { device.requireOpen(); transport.command(pending) }
            serial = acknowledge(key, job, serial, result)
        }
        return job.getLong("expected") + 1
    }
    /** Recover only an already sent packet by its immutable receipt identity.
     * Reading an editor must not send a previously unsent write. */
    @Synchronized fun recoverReceipt(domain:String,objectId:String):Pair<String,Long>?{
        check(refreshed){"E2EE_REFRESH_REQUIRED"};current();val key=id(domain,objectId);val loaded=loadJob(key)?:return null;val job=loaded.value
        val origin=job.opt("originId") as? String?:return null
        if(!job.getBoolean("complete")&&!job.isNull("pending")&&job.isNull("cancelling")){
            val command=job.getJSONObject("pending").getJSONObject("command");val hash=E2eeCommands.hash(command)
            val lookup=readPacket("receipt",JSONObject().put("operationId",command.get("operationId")).put("payloadHash",hash))
            lookup.optJSONObject("receipt")?.let{receipt->check(receipt.get("payloadHash")==hash){"E2EE_INVALID_RECEIPT"}
                val result=receipt.getJSONObject("result");if(!result.optBoolean("cancelled"))acknowledge(key,job,loaded.serial,result)}
        }
        return if(job.getBoolean("complete"))origin to job.getLong("expected")+1 else null
    }
    private fun acknowledge(id: String, job: JSONObject, serial: Long, result: JSONObject): Long {
        device.requireOpen(); val pending = job.getJSONObject("pending"); val item = job.getJSONArray("plan").getJSONObject(job.getInt("uploaded"))
        val envelope = E2eeEnvelope.Envelope.fromJson(pending.getJSONObject("command").getJSONObject("payload").getJSONObject("envelope"))
        val context = envelope.context.toJson()
        check(E2eeEnvelope.payloadHash(envelope) == item.getString("hash") && result.optLong("revision", -1) == context.getLong("revision")
            && result.opt("payloadHash") == item.get("hash") && result.optLong("generation", -1) == job.getLong("generation")) { "E2EE_INVALID_RECEIPT" }
        job.put("uploaded", job.getInt("uploaded") + 1).put("pending", JSONObject.NULL)
            .put("complete", job.getInt("uploaded") == job.getJSONArray("plan").length())
        val confirmed = mutableListOf<UnlockedE2eeVault.Write>()
        if (job.getBoolean("complete")) {
            val floor = device.vault.read("key-check", "floor:$id")
            val previous = try { floor?.let { JSONObject(it.bytes.toString(Charsets.UTF_8)) } } finally { floor?.bytes?.fill(0) }
            check(previous == null || previous.getLong("revision") != context.getLong("revision") || previous.get("hash") == item.get("hash")) { "E2EE_REMOTE_ROLLBACK" }
            if (previous == null || previous.getLong("revision") < context.getLong("revision")) confirmed += UnlockedE2eeVault.Write("key-check", "floor:$id",
                JSONObject().put("revision", context.get("revision")).put("hash", item.get("hash")).toString().toByteArray(), floor?.serial)
        }
        try { return saveJob(id, job, serial, confirmed) } finally { confirmed.forEach { it.bytes.fill(0) } }
    }
    @Synchronized fun rebase(domain: String, objectId: String, expectedRevision: Long, filename: String? = null, mediaType: String? = null, originId: String? = null): String {
        return rebaseInternal(domain,objectId,expectedRevision,filename,mediaType,originId)
    }
    @Synchronized fun replaceReviewed(domain:String,objectId:String,source:ByteArray,expectedRevision:Long,originId:String,filename:String,mediaType:String):String{
        E2eeKeys.technical(originId);val bytes=source.copyOf()
        try{return rebaseInternal(domain,objectId,expectedRevision,filename,mediaType,null,bytes,originId)}finally{bytes.fill(0)}
    }
    private fun rebaseInternal(domain:String,objectId:String,expectedRevision:Long,filename:String?,mediaType:String?,originId:String?,replacementBytes:ByteArray?=null,replacementOrigin:String?=null):String{
        check(refreshed) { "E2EE_REFRESH_REQUIRED" }
        current(); val key = id(domain, objectId); val loaded = loadJob(key)
        if(loaded==null){check(replacementBytes!=null&&replacementOrigin!=null){"E2EE_PENDING_SAVE_REQUIRED"};prepare(domain,objectId,replacementBytes,expectedRevision,filename?:"",mediaType?:"application/json",replacementOrigin);return "rebased"}
        val job = loaded.value; var serial = loaded.serial
        check(originId == null || job.opt("originId") == originId) { "E2EE_PENDING_EDITOR_MISMATCH" }
        if (job.getBoolean("complete")&&replacementBytes==null) return "already-confirmed"
        if (!job.isNull("pending")) {
            if (job.isNull("cancelling")) {
                val bytes = job.toString().toByteArray()
                job.put("cancelling", packet("cancel-put", JSONObject().put("original", job.getJSONObject("pending"))))
                try { serial = saveJob(key, job, serial, listOf(UnlockedE2eeVault.Write("local-snapshot", "${job.getString("draftId")}:cancel:${UUID.randomUUID()}", bytes, null))) }
                finally { bytes.fill(0) }
            }
            var result: JSONObject? = null
            val old = job.getJSONObject("cancelling"); val command = old.getJSONObject("command")
            if (command.get("checkpointHash") != current().checkpoint.hash) {
                val lookup = readPacket("receipt", JSONObject().put("operationId", command.get("operationId")).put("payloadHash", E2eeCommands.hash(command)))
                if (!lookup.isNull("receipt")) {
                    val receipt = lookup.getJSONObject("receipt")
                    check(receipt.get("payloadHash") == E2eeCommands.hash(command)) { "E2EE_INVALID_RECEIPT" }; result = receipt.getJSONObject("result")
                } else {
                    job.put("cancelling", packet("cancel-put", command.getJSONObject("payload"), command.getString("operationId"))); serial = saveJob(key, job, serial)
                }
            }
            if (result == null) { device.requireOpen(); result = transport.command(job.getJSONObject("cancelling")) }
            device.requireOpen(); val receipt = result.getJSONObject("operationReceipt")
            check(receipt.get("payloadHash") == E2eeCommands.hash(job.getJSONObject("pending").getJSONObject("command"))) { "E2EE_INVALID_RECEIPT" }
            job.put("cancelling", JSONObject.NULL)
            if (receipt.getJSONObject("result").opt("cancelled") == true) { job.put("pending", JSONObject.NULL); serial = saveJob(key, job, serial) }
            else serial = acknowledge(key, job, serial, receipt.getJSONObject("result"))
            if (job.getBoolean("complete")&&replacementBytes==null) return "already-confirmed"
        }
        check(replacementBytes==null||!job.getBoolean("complete")||job.getLong("expected")+1<=expectedRevision){"E2EE_CONFLICT_REVIEW_STALE"}
        val bytes = replacementBytes?.copyOf()?:readDraft(domain, objectId) ?: throw IllegalStateException("E2EE_CORRUPT_OUTBOX")
        try { prepareInternal(domain, objectId, bytes, expectedRevision, filename ?: job.getJSONObject("metadata").getString("filename"),
            mediaType ?: job.getJSONObject("metadata").getString("mediaType"), Job(job, serial),replacementOrigin) }
        finally { bytes.fill(0) }
        return "rebased"
    }
    private fun envelope(domain: String, objectId: String): E2eeEnvelope.Envelope? {
        val values = readPacket("get", JSONObject().put("domain", domain).put("objectId", objectId)).getJSONArray("envelopes")
        check(values.length() <= 1) { "E2EE_INVALID_RESPONSE" }
        return if (values.length() == 0) null else E2eeEnvelope.Envelope.fromJson(values.getJSONObject(0))
    }
    private fun loadSealedHeads(allowNetwork: Boolean): JSONArray? {
        val sealed = current().sealedHeads ?: return null
        return sealedCache.getOrPut(sealed.hash) {
            val record = device.vault.read("key-check", "heads:${sealed.hash}")
            var values = try { record?.let { JSONArray(it.bytes.toString(Charsets.UTF_8)) } } finally { record?.bytes?.fill(0) }
            if (values == null) {
                check(allowNetwork) { "E2EE_SEALED_HEADS_REQUIRED" }
                values = readPacket("sealed-heads", JSONObject().put("cryptoEpoch", sealed.cryptoEpoch)).getJSONArray("objects")
                check(values.length() == sealed.count && E2eeFiles.objectManifestHash(values) == sealed.hash) { "E2EE_MANIFEST_MISMATCH" }
                val bytes = values.toString().toByteArray()
                try { device.vault.write(listOf(UnlockedE2eeVault.Write("key-check", "heads:${sealed.hash}", bytes, null))) } finally { bytes.fill(0) }
            }
            check(values.length() == sealed.count && E2eeFiles.objectManifestHash(values) == sealed.hash) { "E2EE_MANIFEST_MISMATCH" }
            values
        }
    }
    private fun sealedHeads() = loadSealedHeads(false)
    private fun historicalHead(envelope: E2eeEnvelope.Envelope) {
        val value = current(); val context = envelope.context.toJson()
        val head = sealedHead(context.getString("domain"), context.getString("objectId"))
        check(head == null || context.getLong("revision") > head.getLong("revision")
            || context.getLong("revision") == head.getLong("revision") && E2eeEnvelope.payloadHash(envelope) == head.get("payloadHash")) { "E2EE_REMOTE_ROLLBACK" }
        if (context.getLong("cryptoEpoch") == value.cryptoEpoch) return
        E2eeDirectory.verifyHistoricalHead(value, envelope, sealedHeads() ?: throw IllegalStateException("E2EE_UNSEALED_HISTORY"))
    }
    private fun sealedHead(domain: String, objectId: String): JSONObject? {
        val heads = sealedHeads() ?: return null
        return (0 until heads.length()).map { heads.getJSONObject(it) }.firstOrNull { it.get("domain") == domain && it.get("objectId") == objectId }
    }
    @Synchronized fun read(domain: String, objectId: String): Opened? {
        current(); val key = id(domain, objectId); val floor = device.vault.read("key-check", "floor:$key")
        val previous = try { floor?.let { JSONObject(it.bytes.toString(Charsets.UTF_8)) } } finally { floor?.bytes?.fill(0) }
        val envelope = envelope(domain, objectId)
        if (envelope == null) {
            val heads = sealedHeads()
            check(previous == null && (heads == null || (0 until heads.length()).none { heads.getJSONObject(it).let { head -> head.get("domain") == domain && head.get("objectId") == objectId } })) { "E2EE_REMOTE_ROLLBACK" }
            return null
        }
        val context = envelope.context.toJson(); val frame = history[epochKey(context)]
        check(frame != null && context.get("ownerId") == ownerId && context.get("scopeId") == scopeId
            && context.get("domain") == domain && context.get("objectId") == objectId) { "E2EE_CONTEXT_MISMATCH" }
        val payloadHash = E2eeEnvelope.payloadHash(envelope)
        check(previous == null || context.getLong("revision") > previous.getLong("revision")
            || context.getLong("revision") == previous.getLong("revision") && payloadHash == previous.get("hash")) { "E2EE_REMOTE_ROLLBACK" }
        val root = roots[context.getString("keyId")] ?: throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
        historicalHead(envelope); val signer = E2eeDirectory.contentSigningKey(frame, context)
        val opened = if (domain == "shared-comment") E2eeFiles.Opened(E2eeEnvelope.open(root, signer, envelope.context, envelope), "", "application/json")
            else E2eeFiles.open(root, signer, envelope.context, envelope) { chunkId ->
                (envelope("attachment", chunkId) ?: throw IllegalStateException("E2EE_CORRUPT_FILE")).also { historicalHead(it) }
            }
        val encoded = JSONObject().put("revision", context.get("revision")).put("hash", payloadHash).toString().toByteArray()
        try {
            device.vault.write(listOf(UnlockedE2eeVault.Write("key-check", "floor:$key", encoded, floor?.serial)))
            device.requireOpen(); return Opened(opened.bytes, opened.filename, opened.mediaType, context.getLong("revision"))
        } catch (error: Exception) { opened.bytes.fill(0); throw error } finally { encoded.fill(0) }
    }
    @Synchronized fun assertObjectReference(domain:String,objectId:String,revision:Long,payloadHash:String){
        val value=current();val item=envelope(domain,objectId);device.requireOpen();val context=item?.context?.toJson()
        check(item!=null&&context!=null&&context.get("ownerId")==ownerId&&context.get("scopeId")==scopeId&&context.getLong("dataGeneration")==value.generation
            &&context.get("domain")==domain&&context.get("objectId")==objectId&&context.getLong("revision")==revision&&E2eeEnvelope.payloadHash(item)==payloadHash){"E2EE_OBJECT_REFERENCE_MISMATCH"}
    }
    @Synchronized fun prepareAuroraResult(resultId:String,methodVersion:String){
        check(resultId.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))&&methodVersion=="aurora-two-circles-v2"){"AURORA_RESULT_MISMATCH"}
        val value=current();check(value.kind=="personal"&&value.ownerId==device.ownerId&&value.state=="active"){"E2EE_SCOPE_BINDING_MISMATCH"}
        val objectId="aurora-result-live:$resultId";val item=envelope("aurora",objectId)?:error("E2EE_AURORA_RESULT_MISSING")
        val payloadHash=E2eeEnvelope.payloadHash(item);assertObjectReference("aurora",objectId,1,payloadHash)
        val payload=JSONObject().put("id",resultId).put("methodVersion",methodVersion).put("objectId",objectId).put("payloadHash",payloadHash)
        val key="aurora-manifest:$resultId";val previous=device.vault.read("outbox",key)
        try{
            var signed=previous?.let{E2eeFileManifestJson.readPrivateDocument(it.bytes)}
            if(signed!=null){val command=signed.getJSONObject("command");check(command.get("action")=="aurora-result"&&command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId
                &&command.get("deviceId")==device.deviceId&&E2eeProductJson.same(command.getJSONObject("payload"),payload)){"E2EE_CORRUPT_OUTBOX"}
                if(command.getLong("expectedRevision")!=value.checkpoint.revision||command.getLong("securityEpoch")!=value.securityEpoch||command.get("checkpointHash")!=value.checkpoint.hash)signed=null
            }
            if(signed==null){signed=packet("aurora-result",payload);val bytes=signed.toString().toByteArray(Charsets.UTF_8)
                try{device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",key,bytes,previous?.serial)))}finally{bytes.fill(0)}}
            device.requireOpen();val receipt=transport.command(requireNotNull(signed));device.requireOpen();check(receipt.get("id")==resultId&&receipt.get("ready")==true){"AURORA_RESULT_MISMATCH"}
        }finally{previous?.bytes?.fill(0)}
    }
    @Synchronized fun executeService(action:String,payload:JSONObject,intentId:String):JSONObject{
        check(action in setOf("product-commit","product-approve","stoicheion-grant")){"E2EE_UNKNOWN_ACTION"};E2eeKeys.technical(intentId)
        val held=JSONObject(payload.toString()).put("intentId",intentId);val key="service:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("$action\u0000$intentId".toByteArray(Charsets.UTF_8)))
        for(attempt in 0..1){val value=current();val prior=device.vault.read("outbox",key)
            try{val old=prior?.let{E2eeFileManifestJson.readPrivateDocument(it.bytes)};val command=old?.getJSONObject("command")
                if(command!=null)check(command.get("action")==action&&command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId&&command.get("deviceId")==device.deviceId
                    &&E2eeCommands.canonical(command.getJSONObject("payload")).contentEquals(E2eeCommands.canonical(held))){"E2EE_CORRUPT_OUTBOX"}
                val reusable=command!=null&&command.getLong("expectedRevision")==value.checkpoint.revision&&command.getLong("securityEpoch")==value.securityEpoch&&command.get("checkpointHash")==value.checkpoint.hash
                val signed=if(reusable)requireNotNull(old)else packet(action,held)
                if(!reusable){val bytes=signed.toString().toByteArray(Charsets.UTF_8);try{val writes=mutableListOf<UnlockedE2eeVault.Write>()
                    if(prior!=null)writes+=UnlockedE2eeVault.Write("local-snapshot","$key:attempt:${prior.serial}",prior.bytes,null)
                    writes+=UnlockedE2eeVault.Write("outbox",key,bytes,prior?.serial);device.vault.write(writes)}finally{bytes.fill(0)}}
                device.requireOpen();return transport.command(signed).also{device.requireOpen()}
            }catch(error:Exception){if(attempt!=0||error.message !in setOf("E2EE_STALE_EPOCH","E2EE_DIRECTORY_CONFLICT","E2EE_CHECKPOINT_MISMATCH"))throw error}
            finally{prior?.bytes?.fill(0)}
            refresh();device.requireOpen()
        };error("E2EE_DIRECTORY_CONFLICT")
    }
    @Synchronized fun readProductIndex(after:String="",limit:Int=50):JSONObject{if(after.isNotEmpty())E2eeKeys.technical(after);check(limit in 1..50){"E2EE_INVALID_LIMIT"};return readPacket("product-index",JSONObject().put("after",after).put("limit",limit))}
    @Synchronized fun objectReference(domain:String,objectId:String):JSONObject{
        val value=current();val item=envelope(domain,objectId)?:error("E2EE_PRIVATE_DOCUMENT_MISSING");device.requireOpen();val context=item.context.toJson();val frame=history[epochKey(context)]
        check(frame!=null&&context.get("ownerId")==ownerId&&context.get("scopeId")==scopeId&&context.get("domain")==domain&&context.get("objectId")==objectId&&context.getLong("dataGeneration")==value.generation){"E2EE_CONTEXT_MISMATCH"}
        val root=roots[context.getString("keyId")]?:error("E2EE_KEY_UNAVAILABLE");historicalHead(item);val bytes=E2eeEnvelope.open(root,E2eeDirectory.contentSigningKey(frame,context),item.context,item);bytes.fill(0);device.requireOpen()
        return JSONObject().put("scopeId",scopeId).put("generation",context.get("dataGeneration")).put("revision",context.get("revision")).put("payloadHash",E2eeEnvelope.payloadHash(item))
    }
    @Synchronized fun verifyServiceProof(input:JSONObject):JSONObject{
        current();val packet=JSONObject(input.toString());val command=packet.getJSONObject("command");val frame=directoryFrames[command.getLong("expectedRevision")]?:error("E2EE_PRODUCT_PROOF_INVALID")
        check(command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId&&command.get("checkpointHash")==frame.checkpoint.hash&&command.getLong("securityEpoch")==frame.securityEpoch
            &&command.getString("action") in setOf("product-commit","product-approve")){"E2EE_PRODUCT_PROOF_INVALID"}
        val signer=frame.devices[command.getString("deviceId")]?:error("E2EE_PRODUCT_PROOF_INVALID");check(!signer.revoked){"E2EE_PRODUCT_PROOF_INVALID"}
        if(command.getString("action")=="product-commit"){val rows=command.getJSONObject("payload").getJSONArray("operations");check(rows.length() in 1..100){"E2EE_PRODUCT_PROOF_INVALID"}
            for(at in 0 until rows.length()){val comment=rows.getJSONObject(at).getString("kind") in setOf("comment","project-comment");check(signer.role in if(comment)setOf("owner","writer","commenter")else setOf("owner","writer")){"E2EE_PRODUCT_PROOF_INVALID"}}}
        val key=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(signer.signingKey,91)));E2eeEnvelope.assertP256(key)
        val verified=E2eeCommands.verify(packet,key);device.requireOpen();return JSONObject().put("actorId",signer.userId).put("command",verified).put("proofHash",E2eeCommands.hash(verified))
    }
    @Synchronized fun close() { refreshed = false; directory = null; history.clear();directoryFrames.clear(); roots.clear(); sealedCache.clear() }
    override fun toString() = "E2eeScopeClient([redacted])"
}
