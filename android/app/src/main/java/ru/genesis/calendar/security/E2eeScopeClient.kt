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
    private fun knownPrefix(generation:Long)="confirmed:${hash(scopeId)}:$generation:"
    private fun confirmed(envelope:E2eeEnvelope.Envelope):UnlockedE2eeVault.Write?{
        val context=envelope.context.toJson();val value=current()
        check(context.getString("scopeId")==scopeId&&context.getString("ownerId")==ownerId&&context.getLong("dataGeneration")==value.generation){"E2EE_CONTEXT_MISMATCH"}
        val key=knownPrefix(value.generation)+id(context.getString("domain"),context.getString("objectId"));val prior=device.vault.read("key-check",key)
        val head=JSONObject().put("scopeId",scopeId).put("generation",value.generation).put("domain",context.get("domain")).put("objectId",context.get("objectId"))
            .put("revision",context.get("revision")).put("payloadHash",E2eeEnvelope.payloadHash(envelope))
        try{if(prior!=null){val old=E2eeFileManifestJson.readPrivateDocument(prior.bytes);E2eeKeys.exact(old,setOf("scopeId","generation","domain","objectId","revision","payloadHash"))
                check(old.get("scopeId")==scopeId&&old.getLong("generation")==value.generation&&old.get("domain")==head.get("domain")&&old.get("objectId")==head.get("objectId")&&E2eeCommands.integer(old.get("revision"))>=1){"E2EE_CORRUPT_CHECKPOINT"}
                E2eeEnvelope.decode(old.getString("payloadHash"),32)
                check(old.getLong("revision")<head.getLong("revision")||old.getLong("revision")==head.getLong("revision")&&old.get("payloadHash")==head.get("payloadHash")){"E2EE_REMOTE_ROLLBACK"}
                if(old.getLong("revision")==head.getLong("revision"))return null}
            return UnlockedE2eeVault.Write("key-check",key,head.toString().toByteArray(Charsets.UTF_8),prior?.serial)
        }finally{prior?.bytes?.fill(0)}
    }
    /** Per-object protected checkpoints include confirmed chunks and all heads
     * observed since the last retired manifest, without a lossy mutable index. */
    private fun assertKnownHeads(objects:JSONArray,requireSettled:Boolean=true){
        val value=current();val prefix=knownPrefix(value.generation);val byId=mutableMapOf<String,JSONObject>()
        for(at in 0 until objects.length()){val row=objects.getJSONObject(at);val key=prefix+id(row.getString("domain"),row.getString("objectId"));check(byId.put(key,row)==null){"E2EE_MANIFEST_MISMATCH"}}
        for(key in device.vault.listLocal("key-check",prefix)){val saved=device.vault.read("key-check",key)?:error("E2EE_CORRUPT_CHECKPOINT")
            try{val old=E2eeFileManifestJson.readPrivateDocument(saved.bytes);E2eeKeys.exact(old,setOf("scopeId","generation","domain","objectId","revision","payloadHash"))
                check(old.get("scopeId")==scopeId&&old.getLong("generation")==value.generation&&E2eeCommands.integer(old.get("revision"))>=1&&key==prefix+id(old.getString("domain"),old.getString("objectId"))){"E2EE_CORRUPT_CHECKPOINT"}
                E2eeEnvelope.decode(old.getString("payloadHash"),32);val head=byId[key]?:error("E2EE_REMOTE_ROLLBACK")
                check(head.getLong("revision")>old.getLong("revision")||head.getLong("revision")==old.getLong("revision")&&head.get("payloadHash")==old.get("payloadHash")){"E2EE_REMOTE_ROLLBACK"}
            }finally{saved.bytes.fill(0)}}
        // Candidate devices predating the checkpoint catalogue still retain
        // their exact immutable writer plans. Never rotate past an unfinished job.
        for(key in device.vault.listLocal("outbox","job:")){val saved=device.vault.read("outbox",key)?:error("E2EE_CORRUPT_OUTBOX")
            try{val job=E2eeFileManifestJson.readPrivateDocument(saved.bytes);if(job.getString("scopeId")!=scopeId||job.getLong("generation")!=value.generation)continue
                if(!job.getBoolean("complete")){check(!requireSettled){"E2EE_PENDING_SAVE_REQUIRED"};continue};val plan=job.getJSONArray("plan")
                for(at in 0 until plan.length()){val item=plan.getJSONObject(at);val bytes=device.vault.read("outbox",item.getString("recordId"))?:error("E2EE_CORRUPT_OUTBOX")
                    try{val envelope=E2eeEnvelope.Envelope.fromJson(E2eeFileManifestJson.readPrivateDocument(bytes.bytes));val context=envelope.context.toJson()
                        val head=byId[prefix+id(context.getString("domain"),context.getString("objectId"))]?:error("E2EE_REMOTE_ROLLBACK")
                        check(E2eeEnvelope.payloadHash(envelope)==item.getString("hash")&&(head.getLong("revision")>context.getLong("revision")||head.getLong("revision")==context.getLong("revision")&&head.get("payloadHash")==item.get("hash"))){"E2EE_REMOTE_ROLLBACK"}
                    }finally{bytes.bytes.fill(0)}}
            }finally{saved.bytes.fill(0)}}
        device.requireOpen();check(current()===value){"E2EE_DIRECTORY_CONFLICT"}
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
            } else if(previous!=null){
                check(previous.value.getBoolean("complete")){"E2EE_PENDING_SAVE_REQUIRED"}
                val raw=device.vault.read("outbox","job:$id")?:error("E2EE_LOCAL_CONFLICT")
                try{check(raw.serial==previous.serial){"E2EE_LOCAL_CONFLICT"};changes+=UnlockedE2eeVault.Write("local-snapshot","${previous.value.getString("draftId")}:completed:${UUID.randomUUID()}",raw.bytes.copyOf(),null)}finally{raw.bytes.fill(0)}
            }
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
        this.confirmed(envelope)?.let{confirmed+=it}
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
    @Synchronized fun read(domain: String, objectId: String,expected:JSONObject?=null): Opened? {
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
        check(expected==null||context.getLong("revision")==expected.getLong("revision")&&payloadHash==expected.getString("payloadHash")){"E2EE_MANIFEST_MISMATCH"}
        check(previous == null || context.getLong("revision") > previous.getLong("revision")
            || context.getLong("revision") == previous.getLong("revision") && payloadHash == previous.get("hash")) { "E2EE_REMOTE_ROLLBACK" }
        val root = roots[context.getString("keyId")] ?: throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
        historicalHead(envelope); val signer = E2eeDirectory.contentSigningKey(frame, context)
        val chunks=mutableListOf<E2eeEnvelope.Envelope>()
        val opened = if (domain == "shared-comment") E2eeFiles.Opened(E2eeEnvelope.open(root, signer, envelope.context, envelope), "", "application/json")
            else E2eeFiles.open(root, signer, envelope.context, envelope) { chunkId ->
                (envelope("attachment", chunkId) ?: throw IllegalStateException("E2EE_CORRUPT_FILE")).also { historicalHead(it);chunks+=it }
            }
        val encoded = JSONObject().put("revision", context.get("revision")).put("hash", payloadHash).toString().toByteArray()
        val writes=mutableListOf(UnlockedE2eeVault.Write("key-check","floor:$key",encoded,floor?.serial))
        try {
            for(item in chunks+envelope)confirmed(item)?.let{writes+=it}
            device.vault.write(writes)
            device.requireOpen(); return Opened(opened.bytes, opened.filename, opened.mediaType, context.getLong("revision"))
        } catch (error: Exception) { opened.bytes.fill(0); throw error } finally { writes.forEach{it.bytes.fill(0)} }
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
                try{device.vault.write((previous?.let{listOf(UnlockedE2eeVault.Write("local-snapshot","$key:attempt:${it.serial}",it.bytes,null))}?:emptyList())+
                    UnlockedE2eeVault.Write("outbox",key,bytes,previous?.serial))}finally{bytes.fill(0)}}
            device.requireOpen();val receipt=transport.command(requireNotNull(signed));device.requireOpen();check(receipt.get("id")==resultId&&receipt.get("ready")==true){"AURORA_RESULT_MISMATCH"}
        }finally{previous?.bytes?.fill(0)}
    }
    @Synchronized fun executeService(action:String,payload:JSONObject,intentId:String):JSONObject{
        check(action in setOf("product-commit","product-approve","stoicheion-grant","advice-issue","product-bootstrap-start","product-bootstrap-stage","product-bootstrap-complete","resource-create-prepare","resource-create-resolve","shared-invitations-issue","shared-invitation-revoke","shared-invitation-respond")){"E2EE_UNKNOWN_ACTION"};E2eeKeys.technical(intentId)
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
    @Synchronized fun contentHeads():JSONObject{
        val value=current();check(refreshed&&value.state in setOf("active","retirement")){"E2EE_REFRESH_REQUIRED"}
        val objects=JSONArray();var manifestHash:String?=null;var count=-1L
        do{val response=readPacket("content-heads",JSONObject().put("offset",objects.length()).put("manifestHash",manifestHash?:JSONObject.NULL));device.requireOpen()
            val rows=response.getJSONArray("objects");val nextCount=E2eeCommands.integer(response.get("objectCount"));val nextHash=response.getString("manifestHash");E2eeEnvelope.decode(nextHash,32)
            check(nextCount in 0..10000L&&rows.length()<=50&&(manifestHash==null||manifestHash==nextHash&&count==nextCount)){"E2EE_MANIFEST_MISMATCH"};manifestHash=nextHash;count=nextCount
            for(at in 0 until rows.length()){val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("domain","objectId","revision","payloadHash"));E2eeKeys.technical(row.getString("objectId"));E2eeEnvelope.decode(row.getString("payloadHash"),32);E2eeCommands.integer(row.get("revision"),1)
                check(row.getString("domain") in setOf("workspace","diary","dream-journal","mindmap","physis","aurora","stoicheion","shared-project","shared-comment","attachment","local-snapshot","outbox","draft","key-check")){"E2EE_MANIFEST_MISMATCH"};objects.put(JSONObject(row.toString()))}
            check(objects.length()<=count&&(rows.length()!=0||objects.length()>=count)){"E2EE_MANIFEST_MISMATCH"}
        }while(objects.length()<count)
        check(E2eeFiles.objectManifestHash(objects)==manifestHash){"E2EE_MANIFEST_MISMATCH"};assertKnownHeads(objects,false)
        val heads=(0 until objects.length()).associate{val row=objects.getJSONObject(it);(row.getString("domain")+"\u0000"+row.getString("objectId")) to row}
        sealedHeads()?.let{floors->for(at in 0 until floors.length()){val floor=floors.getJSONObject(at);val row=heads[floor.getString("domain")+"\u0000"+floor.getString("objectId")]?:error("E2EE_REMOTE_ROLLBACK")
            check(row.getLong("revision")>floor.getLong("revision")||row.getLong("revision")==floor.getLong("revision")&&row.get("payloadHash")==floor.get("payloadHash")){"E2EE_REMOTE_ROLLBACK"}}}
        device.requireOpen();check(current()===value){"E2EE_DIRECTORY_CONFLICT"};return JSONObject().put("objects",objects).put("manifestHash",manifestHash).put("objectCount",count)
    }
    @Synchronized fun readStoicheionState():JSONObject=readPacket("stoicheion-state",JSONObject())
    @Synchronized fun readBootstrapState(afterPart:Int=-1):JSONObject{check(afterPart in -1..255){"E2EE_INVALID_LIMIT"};return readPacket("product-bootstrap-state",JSONObject().put("afterPart",afterPart))}
    @Synchronized fun readProductContext():JSONObject=readPacket("product-context",JSONObject())
    @Synchronized fun readTransitionCandidates():JSONObject=readPacket("resource-transition-candidates",JSONObject())
    /** Proposed routing only: no consent, journal advancement or trust grant. */
    @Synchronized fun readProjectCreationPreview(resourceId:String,input:JSONObject):JSONObject{
        E2eeKeys.technical(resourceId);val selected=E2eeProjectCreationContract.selection(input)
        val response=readPacket("project-create-preview",JSONObject().put("resourceId",resourceId).put("topology",selected))
        E2eeKeys.exact(response,setOf("resourceId","topology","checkpointHash","directoryRevision"));check(response.get("resourceId")==resourceId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val topology=E2eeProjectCreationContract.topology(response.getJSONObject("topology"),device.ownerId)
        check(E2eeProductJson.same(selected,JSONObject(topology.toString()).apply{remove("reviewedMembers")})){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
        device.requireOpen();return topology
    }
    @Synchronized fun readSharedInvitationPage(after:String="",limit:Int=50):JSONObject{if(after.isNotEmpty())E2eeKeys.technical(after);check(limit in 1..50){"E2EE_INVALID_LIMIT"};return readPacket("shared-invitations-page",JSONObject().put("after",after).put("limit",limit))}
    @Synchronized fun readSharedInvitationResponse(id:String):JSONObject{E2eeKeys.technical(id);return readPacket("shared-invitation-response-state",JSONObject().put("id",id))}
    @Synchronized fun readPendingInvitationPage(after:String="",limit:Int=50):JSONObject{if(after.isNotEmpty())E2eeKeys.technical(after);check(limit in 1..50){"E2EE_INVALID_LIMIT"};return readPacket("shared-invitation-pending",JSONObject().put("after",after).put("limit",limit))}
    @Synchronized fun readInvitationState(ids:List<String>):JSONObject{check(ids.size<=20&&ids.toSet().size==ids.size){"E2EE_INVALID_LIMIT"};ids.forEach{E2eeKeys.technical(it)};return readPacket("shared-invitation-state",JSONObject().put("ids",JSONArray(ids)))}
    @Synchronized fun sharedReadHistory():JSONObject{val result=readPacket("shared-read-history",JSONObject());E2eeKeys.exact(result,setOf("history","checkpointHash","directoryRevision"));return result.getJSONObject("history")}
    @Synchronized fun readProductHistory(entityId:String,before:Long,limit:Int=5):JSONObject{E2eeKeys.technical(entityId);check(before in 1..9_007_199_254_740_991L&&limit in 1..10){"E2EE_INVALID_LIMIT"};return readPacket("product-history",JSONObject().put("entityId",entityId).put("before",before).put("limit",limit))}
    @Synchronized fun readAdvicePolicy():JSONObject=readPacket("advice-policy",JSONObject())
    @Synchronized fun originalMigrationManifest():JSONObject{
        current();val sealed=directoryFrames.values.firstOrNull{it.state=="active"&&it.sealedHeads?.cryptoEpoch==0L}?.sealedHeads?:error("E2EE_MIGRATION_PROOF_REQUIRED")
        val response=readPacket("sealed-heads",JSONObject().put("cryptoEpoch",0));val objects=response.getJSONArray("objects");check(objects.length()==sealed.count&&E2eeFiles.objectManifestHash(objects)==sealed.hash){"E2EE_MANIFEST_MISMATCH"};device.requireOpen()
        return JSONObject().put("manifestHash",sealed.hash).put("objectCount",sealed.count)
    }
    @Synchronized fun readMigrationOriginal(domain:String,objectId:String):Opened{
        current();val sealed=directoryFrames.values.firstOrNull{it.state=="active"&&it.sealedHeads?.cryptoEpoch==0L}?.sealedHeads?:error("E2EE_MIGRATION_PROOF_REQUIRED")
        val response=readPacket("sealed-heads",JSONObject().put("cryptoEpoch",0));val objects=response.getJSONArray("objects");check(objects.length()==sealed.count&&E2eeFiles.objectManifestHash(objects)==sealed.hash){"E2EE_MANIFEST_MISMATCH"};device.requireOpen()
        val reference=(0 until objects.length()).map{objects.getJSONObject(it)}.singleOrNull{it.getString("domain")==domain&&it.getString("objectId")==objectId}?:error("E2EE_PRIVATE_SEED_REQUIRED")
        check(reference.getLong("revision")==1L){"E2EE_PRIVATE_SEED_REQUIRED"};return read(domain,objectId,reference)?:error("E2EE_PRIVATE_SEED_REQUIRED")
    }
    @Synchronized fun authorizeMembership(intentId:String,changeHash:String):JSONObject{
        E2eeKeys.technical(intentId);E2eeEnvelope.decode(changeHash,32);val value=current();val own=value.devices[device.deviceId]
        check(refreshed&&value.kind=="personal"&&value.ownerId==device.ownerId&&value.state=="active"&&own?.role=="owner"&&!own.revoked){"E2EE_OWNER_REQUIRED"}
        return packet("membership-authorize",JSONObject().put("intentId",intentId).put("changeHash",changeHash))
    }
    @Synchronized fun authorizeMembershipAtomic(action:String,input:JSONObject):JSONObject{
        val payload=E2eeMembershipAtomicContract.stagingPayload(action,input)
        val value=current();val own=value.devices[device.deviceId]
        check(refreshed&&value.kind=="personal"&&value.ownerId==device.ownerId&&value.state=="active"&&own?.role=="owner"&&!own.revoked){"E2EE_OWNER_REQUIRED"}
        return packet(action,payload)
    }
    @Synchronized fun authorizeMembershipAtomicApply(action:String,input:JSONObject):JSONObject{
        val payload=E2eeMembershipAtomicReceipts.payload(action,input);val value=current();val own=value.devices[device.deviceId]
        check(refreshed&&value.kind=="personal"&&value.ownerId==device.ownerId&&value.state=="active"&&own?.role=="owner"&&!own.revoked){"E2EE_OWNER_REQUIRED"}
        return packet(action,payload)
    }
    @Synchronized fun prepareMembershipProduct(intentId:String,membershipHash:String,input:JSONArray):JSONObject{
        E2eeKeys.technical(intentId);E2eeEnvelope.decode(membershipHash,32);check(input.length() in 1..100){"E2EE_PRODUCT_BATCH_INVALID"};val operations=JSONArray();val ids=mutableSetOf<String>()
        for(at in 0 until input.length()){val operation=E2eeProductContract.operation(input.getJSONObject(at));check(ids.add(operation.getString("entityId"))){"E2EE_PRODUCT_BATCH_INVALID"};operations.put(operation)}
        val payload=JSONObject().put("intentId",intentId).put("membershipHash",membershipHash).put("operations",operations);val key="membership-product:"+hash("$scopeId\u0000$intentId");val prior=device.vault.read("outbox",key);device.requireOpen()
        try{
            if(prior!=null){val signed=E2eeFileManifestJson.readPrivateDocument(prior.bytes);val command=signed.getJSONObject("command")
                check(command.get("action")=="product-commit-bound"&&command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId&&command.get("deviceId")==device.deviceId&&E2eeCommands.canonical(command.getJSONObject("payload")).contentEquals(E2eeCommands.canonical(payload))){"E2EE_IDEMPOTENCY_CONFLICT"};return signed}
            val value=current();val own=value.devices[device.deviceId];check(refreshed&&value.state=="active"&&own!=null&&!own.revoked&&own.role in setOf("owner","writer")){"E2EE_WRITE_FORBIDDEN"}
            val signed=packet("product-commit-bound",payload);val bytes=signed.toString().toByteArray(Charsets.UTF_8)
            try{device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",key,bytes,null)));device.requireOpen()}finally{bytes.fill(0)};return signed
        }finally{prior?.bytes?.fill(0)}
    }
    /** A complete human-reviewed roster, never implicit consent to a preview.
     * The independent future root exists only while HPKE capsules are prepared. */
    @Synchronized fun prepareMembershipRotation(changeHash:String,reviewed:JSONArray,manifest:JSONObject,expected:JSONObject):JSONObject{
        E2eeEnvelope.decode(changeHash,32);E2eeKeys.exact(manifest,setOf("manifestHash","objectCount"));E2eeEnvelope.decode(manifest.getString("manifestHash"),32)
        val roles=JSONArray(reviewed.toString());val value=current();val own=value.devices[device.deviceId]
        check(refreshed&&value.kind in setOf("project","space")&&value.ownerId==device.ownerId&&own?.role=="owner"&&!own.revoked&&value.state in setOf("active","retirement")){"E2EE_OWNER_REQUIRED"}
        val seen=mutableSetOf<String>();check(roles.length()==value.devices.values.count{!it.revoked}&&roles.length()<=256){"E2EE_MEMBERSHIP_ROTATION_INCOMPLETE"}
        for(at in 0 until roles.length()){val row=roles.getJSONObject(at);E2eeKeys.exact(row,setOf("deviceId","role"));val id=E2eeKeys.technical(row.getString("deviceId"));val known=value.devices[id]?:error("E2EE_MEMBERSHIP_ROLE_INVALID")
            val role=if(row.isNull("role"))null else row.getString("role")
            check(!known.revoked&&seen.add(id)&&(role==null||role in setOf("owner","writer","commenter","reader"))
                &&(known.userId!=value.ownerId||role=="owner")&&(known.userId==value.ownerId||role!="owner")){"E2EE_MEMBERSHIP_ROLE_INVALID"}}
        val key="rotation:"+hash("$scopeId\u0000$changeHash");val prior=device.vault.read("outbox",key);device.requireOpen()
        try{
            if(prior!=null){val saved=E2eeFileManifestJson.readPrivateDocument(prior.bytes);E2eeKeys.exact(saved,setOf("protocol","roles","manifest","packet"));val signed=saved.getJSONObject("packet");val command=signed.getJSONObject("command")
                check(saved.getInt("protocol")==1&&E2eeCommands.canonical(saved.getJSONArray("roles")).contentEquals(E2eeCommands.canonical(roles))
                    &&E2eeProductJson.same(saved.getJSONObject("manifest"),manifest)&&command.getJSONObject("payload").getString("membershipHash")==changeHash
                    &&command.getString("scopeId")==scopeId&&command.getString("ownerId")==ownerId&&command.getString("deviceId")==device.deviceId&&command.getString("action")=="rotate-membership"){"E2EE_CORRUPT_OUTBOX"}
                E2eeCommands.verify(signed,device.keys().signing.public);return signed
            }
            check(expected.getLong("directoryRevision")==value.checkpoint.revision&&expected.getString("checkpointHash")==value.checkpoint.hash&&expected.getLong("cryptoEpoch")==value.cryptoEpoch&&expected.getLong("securityEpoch")==value.securityEpoch
                &&expected.getString("ownerId")==ownerId&&expected.getString("kind")==value.kind&&expected.getString("resourceId")==value.resourceId){"E2EE_MEMBERSHIP_STALE"}
            val count=E2eeCommands.integer(manifest.get("objectCount"));check(count<=10000){"E2EE_MANIFEST_MISMATCH"};val objects=JSONArray()
            do{val response=readPacket("active-heads",JSONObject().put("offset",objects.length()).put("manifestHash",if(objects.length()==0)JSONObject.NULL else manifest.get("manifestHash")))
                val rows=response.getJSONArray("objects");check(response.get("manifestHash")==manifest.get("manifestHash")&&response.getLong("objectCount")==count&&rows.length()<=50
                    &&objects.length()+rows.length()<=count&&(rows.length()!=0||objects.length()>=count)){"E2EE_MANIFEST_MISMATCH"}
                for(at in 0 until rows.length())objects.put(rows.getJSONObject(at))
            }while(objects.length()<count)
            check(E2eeFiles.objectManifestHash(objects)==manifest.getString("manifestHash")){"E2EE_MANIFEST_MISMATCH"}
            assertKnownHeads(objects)
            val heads=(0 until objects.length()).associate{val row=objects.getJSONObject(it);(row.getString("domain")+"\u0000"+row.getString("objectId")) to row}
            val sealed=sealedHeads();if(sealed!=null)for(at in 0 until sealed.length()){val floor=sealed.getJSONObject(at);val head=heads[floor.getString("domain")+"\u0000"+floor.getString("objectId")]?:error("E2EE_REMOTE_ROLLBACK")
                check(head.getLong("revision")>floor.getLong("revision")||head.getLong("revision")==floor.getLong("revision")&&head.get("payloadHash")==floor.get("payloadHash")){"E2EE_REMOTE_ROLLBACK"}}
            for(at in 0 until objects.length()){val head=objects.getJSONObject(at);val item=envelope(head.getString("domain"),head.getString("objectId"))?:error("E2EE_MANIFEST_MISMATCH");val context=item.context.toJson()
                check(context.getLong("revision")==head.getLong("revision")&&E2eeEnvelope.payloadHash(item)==head.getString("payloadHash")){"E2EE_MANIFEST_MISMATCH"}
                val frame=history[epochKey(context)]?:error("E2EE_CONTEXT_MISMATCH");check(context.getString("ownerId")==ownerId&&context.getString("scopeId")==scopeId&&context.getString("domain")==head.getString("domain")&&context.getString("objectId")==head.getString("objectId")&&context.getLong("dataGeneration")==value.generation){"E2EE_CONTEXT_MISMATCH"}
                E2eeEnvelope.verify(item,item.context,E2eeDirectory.contentSigningKey(frame,context));historicalHead(item)
                val floor=device.vault.read("key-check","floor:"+id(context.getString("domain"),context.getString("objectId")))
                try{if(floor!=null){val stored=E2eeFileManifestJson.readPrivateDocument(floor.bytes);check(head.getLong("revision")>stored.getLong("revision")||head.getLong("revision")==stored.getLong("revision")&&head.get("payloadHash")==stored.get("hash")){"E2EE_REMOTE_ROLLBACK"}}}finally{floor?.bytes?.fill(0)}
            }
            check(current()===value){"E2EE_DIRECTORY_CONFLICT"};val root=E2eeKeys.freshSecret();val keyId=UUID.randomUUID().toString();val nextEpoch=value.cryptoEpoch+1
            try{val capsules=JSONArray();val revoked=JSONArray();val changes=JSONArray()
                for(at in 0 until roles.length()){val row=roles.getJSONObject(at);val id=row.getString("deviceId")
                    if(row.isNull("role"))revoked.put(id)else{changes.put(row);capsules.put(JSONObject().put("deviceId",id).put("capsule",E2eeKeys.sealRoot(root,requireNotNull(value.devices[id]).receivingKey,E2eeKeys.RootRecipient(ownerId,scopeId,nextEpoch,keyId,id))))}}
                val recovery=E2eeKeys.sealRoot(root,value.recoveryKit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient(ownerId,scopeId,nextEpoch,keyId,"recovery"))
                check(current()===value){"E2EE_DIRECTORY_CONFLICT"};assertKnownHeads(objects);val signed=packet("rotate-membership",JSONObject().put("membershipHash",changeHash).put("revokedDeviceIds",revoked).put("roleChanges",changes)
                    .put("cryptoEpoch",nextEpoch).put("securityEpoch",value.securityEpoch+1).put("keyId",keyId).put("capsules",capsules).put("recoveryCapsule",recovery)
                    .put("retiredManifestHash",manifest.get("manifestHash")).put("retiredObjectCount",count))
                val bytes=JSONObject().put("protocol",1).put("roles",roles).put("manifest",manifest).put("packet",signed).toString().toByteArray(Charsets.UTF_8)
                try{device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",key,bytes,null)))}finally{bytes.fill(0)};return signed
            }finally{root.fill(0)}
        }finally{prior?.bytes?.fill(0)}
    }
    @Synchronized fun confirmMembershipRotation(signed:JSONObject){
        val command=signed.getJSONObject("command");check(command.getString("scopeId")==scopeId&&command.getString("ownerId")==ownerId&&command.getString("action")=="rotate-membership"){"E2EE_CONTEXT_MISMATCH"}
        refresh();val frame=directoryFrames[command.getLong("expectedRevision")+1]?:error("E2EE_INVALID_RECEIPT")
        val expected=hash(command.getString("checkpointHash")+"\u0000"+E2eeCommands.hash(command));val payload=command.getJSONObject("payload")
        check(frame.checkpoint.hash==expected&&frame.cryptoEpoch==payload.getLong("cryptoEpoch")&&frame.keyId==payload.getString("keyId")){"E2EE_INVALID_RECEIPT"};device.requireOpen()
    }
    @Synchronized fun objectReference(domain:String,objectId:String):JSONObject{
        val value=current();val item=envelope(domain,objectId)?:error("E2EE_PRIVATE_DOCUMENT_MISSING");device.requireOpen();val context=item.context.toJson();val frame=history[epochKey(context)]
        check(frame!=null&&context.get("ownerId")==ownerId&&context.get("scopeId")==scopeId&&context.get("domain")==domain&&context.get("objectId")==objectId&&context.getLong("dataGeneration")==value.generation){"E2EE_CONTEXT_MISMATCH"}
        val root=roots[context.getString("keyId")]?:error("E2EE_KEY_UNAVAILABLE");historicalHead(item);val bytes=E2eeEnvelope.open(root,E2eeDirectory.contentSigningKey(frame,context),item.context,item);bytes.fill(0);device.requireOpen()
        return JSONObject().put("scopeId",scopeId).put("generation",context.get("dataGeneration")).put("revision",context.get("revision")).put("payloadHash",E2eeEnvelope.payloadHash(item))
    }
    @Synchronized internal fun prepareDeviceAccess(input:JSONObject,comparedFingerprint:String):JSONObject{
        val request=E2eeDeviceAccessContract.verify(input);val value=current();val own=value.devices[device.deviceId];val target=request.getJSONObject("target");val challenge=request.getJSONObject("challenge")
        check(refreshed&&value.state=="active"&&value.ownerId==device.ownerId&&own!=null&&!own.revoked&&own.role=="owner"
            &&target.get("scopeId")==scopeId&&target.get("ownerId")==ownerId&&target.get("kind")==value.kind&&target.get("resourceId")==value.resourceId
            &&E2eeProductJson.same(target.getJSONObject("authority"),pin)){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(E2eeDeviceAccessContract.fingerprint(request)==comparedFingerprint){"E2EE_DEVICE_FINGERPRINT_REQUIRED"}
        check(E2eeCommands.integer(challenge.get("expiresAt"),1)>System.currentTimeMillis()/1000){"E2EE_CHALLENGE_EXPIRED"};check(challenge.getString("deviceId") !in value.devices){"E2EE_DEVICE_ALREADY_KNOWN"}
        fun forward(epoch:Long,keyId:String,capsule:JSONObject):JSONObject {
            val result=E2eeKeys.forwardRoot(capsule,device.keys().receiving,E2eeKeys.RootRecipient(ownerId,scopeId,epoch,keyId,device.deviceId),challenge.getString("receivingKey"),
                E2eeKeys.RootRecipient(ownerId,scopeId,epoch,keyId,challenge.getString("deviceId")))
            device.requireOpen();check(current()===value){"E2EE_DIRECTORY_CONFLICT"};return result
        }
        val history=JSONArray();for(grant in requireNotNull(own).historyCapsules)history.put(JSONObject().put("cryptoEpoch",grant.cryptoEpoch).put("keyId",grant.keyId).put("capsule",forward(grant.cryptoEpoch,grant.keyId,grant.capsule)))
        val capsule=forward(value.cryptoEpoch,value.keyId,own.capsule);check(current()===value){"E2EE_DIRECTORY_CONFLICT"}
        return packet("enroll",JSONObject().put("challenge",challenge).put("selfProof",request.get("selfProof")).put("historyCapsules",history).put("capsule",capsule))
    }
    @Synchronized fun verifyServiceProof(input:JSONObject):JSONObject{
        current();val packet=JSONObject(input.toString());val command=packet.getJSONObject("command");val frame=directoryFrames[command.getLong("expectedRevision")]?:error("E2EE_PRODUCT_PROOF_INVALID")
        check(command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId&&command.get("checkpointHash")==frame.checkpoint.hash&&command.getLong("securityEpoch")==frame.securityEpoch
            &&command.getString("action") in setOf("product-commit","product-commit-bound","product-approve","product-bootstrap-stage","product-bootstrap-complete")){"E2EE_PRODUCT_PROOF_INVALID"}
        val signer=frame.devices[command.getString("deviceId")]?:error("E2EE_PRODUCT_PROOF_INVALID");check(!signer.revoked){"E2EE_PRODUCT_PROOF_INVALID"}
        if(command.getString("action").startsWith("product-bootstrap-"))check(signer.role=="owner"&&signer.userId==frame.ownerId){"E2EE_PRODUCT_PROOF_INVALID"}
        if(command.getString("action")=="product-commit-bound"){val accepted=directoryFrames[command.getLong("expectedRevision")+1];check(accepted!=null&&accepted.membershipHash==command.getJSONObject("payload").get("membershipHash")&&accepted.cryptoEpoch==frame.cryptoEpoch+1){"E2EE_PRODUCT_PROOF_INVALID"}}
        if(command.getString("action") in setOf("product-commit","product-commit-bound")){val rows=command.getJSONObject("payload").getJSONArray("operations");check(rows.length() in 1..100){"E2EE_PRODUCT_PROOF_INVALID"}
            for(at in 0 until rows.length()){val comment=rows.getJSONObject(at).getString("kind") in setOf("comment","project-comment");check(signer.role in if(comment)setOf("owner","writer","commenter")else setOf("owner","writer")){"E2EE_PRODUCT_PROOF_INVALID"}}}
        val key=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(signer.signingKey,91)));E2eeEnvelope.assertP256(key)
        val verified=E2eeCommands.verify(packet,key);device.requireOpen();return JSONObject().put("actorId",signer.userId).put("command",verified).put("proofHash",E2eeCommands.hash(verified))
    }
    @Synchronized fun close() { refreshed = false; directory = null; history.clear();directoryFrames.clear(); roots.clear(); sealedCache.clear() }
    override fun toString() = "E2eeScopeClient([redacted])"
}
