package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeCommands
import ru.genesis.calendar.security.E2eeDirectory
import ru.genesis.calendar.security.E2eeEnvelope
import ru.genesis.calendar.security.E2eeKeys
import ru.genesis.calendar.security.E2eeSourceReadVault
import ru.genesis.calendar.security.UnlockedE2eeVault
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Same-original-active-actor quarantine, matching web remote-original.ts.
 * No network, normalization, old private identity, replay or activation port. */
internal class E2eeRemoteOriginal private constructor(private val options: Options, private val context: JSONObject,
    private val binding: JSONObject) : E2eeHttpObservation {
    data class Target(val ownerId: String, val scopeId: String, val kind: String)
    data class Capacity(val maximumBytes: Long, val maximumParts: Int, val maximumObservations: Int, val maximumRecords: Int, val maximumMetadataBytes: Int)
    data class Admission(val bytes: Long, val parts: Int, val observations: Int, val records: Int, val metadataBytes: Int)
    data class ReadOptions(val vault: E2eeSourceReadVault, val target: Target, val capacity: Capacity, val assertCurrent: () -> Unit)
    data class Options(val vault: UnlockedE2eeVault, val target: Target, val capacity: Capacity, val packet: JSONObject,
        val signer: PublicKey, val generation: Long, val assertCurrent: () -> Unit, val ensureDurableKeys: () -> Unit, val admit: (Admission) -> Unit)
    data class Reference(val id: String, val manifestHash: String, val rawHash: String, val size: Long)
    data class Marker(val id: String, val phase: String, val size: Long, val parts: Int, val manifestHash: String?)
    data class Receipt(val id: String, val size: Long, val rawHash: String, val complete: Boolean, val manifestHash: String?)
    data class OriginalContext(val ownerId:String,val scopeId:String,val kind:String,val actorId:String,val actorScopeId:String,val deviceId:String) {
        override fun toString()="E2eeRemoteOriginal.OriginalContext([redacted])"
    }
    data class RequestBinding(val packetHash:String,val signer:String,val generation:Long,val migrationId:String,val fence:Long,val sourceHash:String,
        val action:String,val directoryRevision:Long,val checkpointHash:String,val securityEpoch:Long) {
        override fun toString()="E2eeRemoteOriginal.RequestBinding([redacted])"
    }
    /** Technical identity only. No durable storage, EOF, body proof or custody. */
    data class Registration(val id:String,val context:OriginalContext,val binding:RequestBinding) {
        val protocol:Int get()=1
        val purpose:String get()=RemoteOriginalCodec.PURPOSE
        fun toJson():JSONObject=JSONObject().put("protocol",protocol).put("purpose",purpose).put("id",id)
            .put("context",JSONObject().put("ownerId",context.ownerId).put("scopeId",context.scopeId).put("kind",context.kind)
                .put("actorId",context.actorId).put("actorScopeId",context.actorScopeId).put("deviceId",context.deviceId))
            .put("binding",JSONObject().put("packetHash",binding.packetHash).put("signer",binding.signer).put("generation",binding.generation)
                .put("migrationId",binding.migrationId).put("fence",binding.fence).put("sourceHash",binding.sourceHash).put("action",binding.action)
                .put("directoryRevision",binding.directoryRevision).put("checkpointHash",binding.checkpointHash).put("securityEpoch",binding.securityEpoch))
        override fun toString()="E2eeRemoteOriginal.Registration([redacted])"
    }
    data class RequestDigest(val size:Int,val hash:String) {
        override fun toString()="E2eeRemoteOriginal.RequestDigest([redacted])"
    }
    data class Descriptor(val registration:Registration,val phase:String,val request:RequestDigest,val response:E2eeHttpBodyObservation.Response?,
        val size:Long,val parts:Int,val rawHash:String?,val manifestHash:String?) {
        val bodyVerified:Boolean get()=false
        override fun toString()="E2eeRemoteOriginal.Descriptor([redacted])"
    }
    private val id = UUID.randomUUID().toString()
    private var state: JSONObject? = null
    private var serial = 0L
    private val busy = AtomicBoolean(false)
    private val broken = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val digest = MessageDigest.getInstance("SHA-256")
    private var reference: Reference? = null
    private fun readOptions() = ReadOptions(options.vault, options.target, options.capacity, options.assertCurrent)
    fun registration():Registration=RemoteOriginalCodec.registration(id,context,binding)
    private fun current() {
        RemoteOriginalCodec.current(readOptions()); RemoteOriginalCodec.same(RemoteOriginalCodec.context(readOptions()), context)
        check(!closed.get() && !broken.get()) { "E2EE_REMOTE_ORIGINAL_CLOSED" }
    }
    private inline fun <T> operation(body: () -> T): T {
        if (!busy.compareAndSet(false, true)) { broken.set(true); throw AuthApiError("E2EE_REMOTE_ORIGINAL_BUSY") }
        try { current(); return body() } catch (error: Exception) {
            broken.set(true)
            if (error is CancellationException || error is AuthApiError) throw error
            // No provider path, source snippet or private cause crosses the
            // actual HTTP client's generic IOException/protocol classifiers.
            throw AuthApiError(error.message?.takeIf { it in localCodes } ?: "E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE")
        } finally { busy.set(false) }
    }
    private fun admit(previous: RemoteOriginalCodec.Inventory, next: Admission) {
        RemoteOriginalCodec.within(next, options.capacity); options.admit(next); current(); RemoteOriginalCodec.stable(readOptions(), previous); current()
    }
    override fun prepare(request: E2eeHttpObservation.Request) = operation {
        check(state == null && request.path == "/e2ee/v1/read" && request.method == "POST" && request.body != null) { "E2EE_OBSERVATION_REQUEST_INVALID" }
        val bytes = requireNotNull(request.body).toByteArray(Charsets.UTF_8)
        try {
            check(bytes.size in 1..RemoteOriginalCodec.MAX_REQUEST && !request.body.startsWith('\ufeff')) { "E2EE_OBSERVATION_REQUEST_INVALID" }
            val parsed = E2eeHttpResponseJson.read(ByteArrayInputStream(bytes), request.path, 200, "application/json", bytes.size.toLong(), ::current)
            check(parsed != null && RemoteOriginalCodec.identity(parsed) == binding.getString("packetHash")) { "E2EE_OBSERVATION_REQUEST_INVALID" }
            options.ensureDurableKeys(); current(); val previous = RemoteOriginalCodec.inventory(readOptions())
            val next = JSONObject().put("protocol", 1).put("purpose", RemoteOriginalCodec.PURPOSE).put("id", id).put("context", context).put("binding", binding)
                .put("request", JSONObject().put("size", bytes.size).put("hash", RemoteOriginalCodec.hash(bytes))).put("response", JSONObject.NULL)
                .put("phase", "registered").put("size", 0).put("parts", JSONArray()).put("rawHash", JSONObject.NULL).put("manifestHash", JSONObject.NULL)
            val index = RemoteOriginalCodec.copy(previous.catalog).also { it.getJSONArray("ids").put(id) }
            val jbytes = RemoteOriginalCodec.encoded(next); val cbytes = RemoteOriginalCodec.encoded(index); val old = RemoteOriginalCodec.encoded(previous.catalog)
            try {
                admit(previous, previous.usage.copy(observations = previous.usage.observations + 1, records = previous.usage.records + 2 + if (previous.serial == null) 1 else 0,
                    metadataBytes = previous.usage.metadataBytes + jbytes.size + bytes.size + cbytes.size - if (previous.serial == null) 0 else old.size))
                RemoteOriginalCodec.commit(options, listOf(RemoteOriginalCodec.write(RemoteOriginalCodec.catalogKey(previous.hash), index, previous.serial),
                    UnlockedE2eeVault.Write("local-snapshot", RemoteOriginalCodec.key(previous.hash, id, "r"), bytes, null), RemoteOriginalCodec.write(RemoteOriginalCodec.key(previous.hash, id, "j"), next, null)))
                current(); state = next; serial = 1
            } finally { jbytes.fill(0); cbytes.fill(0); old.fill(0) }
        } finally { bytes.fill(0) }
    }
    private fun publish(next: JSONObject, part: ByteArray? = null, finished: Boolean = false) {
        current(); val oldState = state ?: RemoteOriginalCodec.invalid(); val previous = RemoteOriginalCodec.inventory(readOptions())
        val old = previous.journals.singleOrNull { it.value.getString("id") == id }
        check(old != null && old.serial == serial && RemoteOriginalCodec.identity(old.value) == RemoteOriginalCodec.identity(oldState)) { "E2EE_REMOTE_ORIGINAL_BUSY" }
        val bytes = RemoteOriginalCodec.encoded(next); val oldBytes = RemoteOriginalCodec.encoded(oldState); val manifest = if (finished) RemoteOriginalCodec.encoded(RemoteOriginalCodec.manifest(next)) else null
        try {
            admit(previous, previous.usage.copy(bytes = previous.usage.bytes + (part?.size ?: 0), parts = previous.usage.parts + if (part == null) 0 else 1,
                records = previous.usage.records + (if (part == null) 0 else 1) + if (manifest == null) 0 else 1,
                metadataBytes = previous.usage.metadataBytes + bytes.size - oldBytes.size + (manifest?.size ?: 0)))
            val changes = mutableListOf(RemoteOriginalCodec.write(RemoteOriginalCodec.key(previous.hash, id, "j"), next, serial))
            if (part != null) changes += UnlockedE2eeVault.Write("local-snapshot", RemoteOriginalCodec.key(previous.hash, id, "p", next.getJSONArray("parts").length() - 1), part, null)
            if (manifest != null) changes += UnlockedE2eeVault.Write("local-snapshot", RemoteOriginalCodec.key(previous.hash, id, "m"), manifest, null)
            RemoteOriginalCodec.commit(options, changes); current(); state = next; serial++
        } finally { bytes.fill(0); oldBytes.fill(0); manifest?.fill(0) }
    }
    override fun begin(response: E2eeHttpBodyObservation.Response) = operation {
        val saved = JSONObject().put("path", response.path).put("status", response.status).put("contentType", response.contentType ?: JSONObject.NULL).put("contentLength", response.contentLength ?: JSONObject.NULL)
        RemoteOriginalCodec.response(saved); val old = state ?: RemoteOriginalCodec.invalid(); check(old.getString("phase") == "registered") { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
        publish(RemoteOriginalCodec.copy(old).put("response", saved).put("phase", "receiving"))
    }
    override fun append(bytes: ByteArray) = operation {
        check(bytes.size in 1..RemoteOriginalCodec.MAX_PART) { "E2EE_CORRUPT_REMOTE_ORIGINAL" }; val copy = bytes.copyOf()
        try {
            val old = state ?: RemoteOriginalCodec.invalid(); check(old.getString("phase") == "receiving") { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
            val next = RemoteOriginalCodec.copy(old).put("size", old.getLong("size") + copy.size)
            check(next.getLong("size") <= RemoteOriginalCodec.responseLimit(old.getJSONObject("response"))) { "E2EE_REMOTE_ORIGINAL_CAPACITY" }
            next.getJSONArray("parts").put(JSONObject().put("size", copy.size).put("hash", RemoteOriginalCodec.hash(copy)))
            digest.update(copy); publish(next, copy)
        } finally { copy.fill(0) }
    }
    override fun finish() = operation {
        val old = state ?: RemoteOriginalCodec.invalid(); check(old.getString("phase") == "receiving") { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
        val rawHash = E2eeEnvelope.encode(digest.digest())
        val proof = withOriginal(readOptions().copy(assertCurrent = ::current), id, true) { input ->
            val buffer = ByteArray(RemoteOriginalCodec.MAX_PART); try { while (input.read(buffer) >= 0) buffer.fill(0) } finally { buffer.fill(0) }
        }
        current(); check(proof.rawHash == rawHash && proof.size == old.getLong("size")) { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
        val next = RemoteOriginalCodec.copy(old).put("phase", "complete").put("rawHash", rawHash)
        next.put("manifestHash", RemoteOriginalCodec.identity(RemoteOriginalCodec.manifest(next))); publish(next, finished = true)
        reference = Reference(id, next.getString("manifestHash"), rawHash, next.getLong("size"))
    }
    fun reference(): Reference { check(!broken.get()) { "E2EE_REMOTE_ORIGINAL_INCOMPLETE" }; return reference ?: error("E2EE_REMOTE_ORIGINAL_INCOMPLETE") }
    override fun close() { if (closed.compareAndSet(false, true)) digest.reset() }
    companion object {
        /** Inert pre-prepare identity, checked against an independently trusted
         * signer and actual local actor. No storage, IO or body proof. */
        fun authenticateRegistration(value:JSONObject,packet:JSONObject,signer:PublicKey,options:ReadOptions,generation:Long):Registration {
            val saved=RemoteOriginalCodec.copy(value);val request=RemoteOriginalCodec.copy(packet)
            RemoteOriginalCodec.current(options);val context=RemoteOriginalCodec.context(options);val id=saved.getString("id")
            check(RemoteOriginalCodec.uuid.matches(id)){"E2EE_CORRUPT_REMOTE_ORIGINAL"}
            val binding=RemoteOriginalCodec.packetBinding(request,signer,context,generation)
            RemoteOriginalCodec.current(options);RemoteOriginalCodec.same(RemoteOriginalCodec.context(options),context)
            val expected=RemoteOriginalCodec.registration(id,context,binding)
            check(RemoteOriginalCodec.identity(saved)==RemoteOriginalCodec.identity(expected.toJson())){"E2EE_CORRUPT_REMOTE_ORIGINAL"}
            return expected
        }
        private val localCodes = setOf("E2EE_ACCOUNT_CHANGED", "E2EE_UNLOCK_REQUIRED", "E2EE_KEY_UNAVAILABLE", "E2EE_LOCAL_CONFLICT", "E2EE_LOCAL_RECORD_LIMIT", "E2EE_STORAGE_CAPACITY", "E2EE_STORAGE_USAGE_UNAVAILABLE", "E2EE_CORRUPT_LOCAL_RECORD", "E2EE_CORRUPT_LOCAL_DATABASE", "E2EE_OBSERVATION_REQUEST_INVALID", "E2EE_CORRUPT_REMOTE_ORIGINAL", "E2EE_REMOTE_ORIGINAL_METADATA_LIMIT", "E2EE_REMOTE_ORIGINAL_CONTEXT", "E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT", "E2EE_REMOTE_ORIGINAL_CAPACITY", "E2EE_REMOTE_ORIGINAL_BUSY", "E2EE_REMOTE_ORIGINAL_CLOSED", "E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ")
        fun create(source: Options): E2eeRemoteOriginal {
            RemoteOriginalCodec.capacity(source.capacity); val options = source.copy(packet = RemoteOriginalCodec.copy(source.packet))
            val read = ReadOptions(options.vault, options.target, options.capacity, options.assertCurrent); RemoteOriginalCodec.current(read)
            val context = RemoteOriginalCodec.context(read); val binding = RemoteOriginalCodec.packetBinding(options.packet, options.signer, context, options.generation)
            RemoteOriginalCodec.current(read); return E2eeRemoteOriginal(options, context, binding)
        }
        fun listOriginals(options: ReadOptions): List<Marker> {
            RemoteOriginalCodec.capacity(options.capacity); val state = RemoteOriginalCodec.inventory(options); RemoteOriginalCodec.within(state.usage, options.capacity)
            return state.journals.map { val row = it.value; Marker(row.getString("id"), row.getString("phase"), row.getLong("size"), row.getJSONArray("parts").length(), row.get("manifestHash") as? String) }
        }
        /** Request-authenticated metadata discovery; never opens response parts.
         * Even a complete marker is not a body/EOF or migration receipt. */
        fun describeOriginal(options:ReadOptions,id:String):Descriptor {
            RemoteOriginalCodec.capacity(options.capacity);RemoteOriginalCodec.current(options)
            check(RemoteOriginalCodec.uuid.matches(id)){"E2EE_CORRUPT_REMOTE_ORIGINAL"}
            val before=RemoteOriginalCodec.inventory(options);RemoteOriginalCodec.within(before.usage,options.capacity)
            val journal=before.journals.singleOrNull{it.value.getString("id")==id}?.value?:error("E2EE_REMOTE_ORIGINAL_MISSING")
            val registered=RemoteOriginalCodec.verifiedRequest(options,before,journal)
            RemoteOriginalCodec.stable(options,before);RemoteOriginalCodec.current(options)
            val request=journal.getJSONObject("request")
            val response=if(journal.isNull("response"))null else journal.getJSONObject("response").let{value->
                E2eeHttpBodyObservation.Response(value.getString("path"),value.getInt("status"),value.get("contentType") as? String,value.get("contentLength") as? String)
            }
            return Descriptor(registered,journal.getString("phase"),RequestDigest(request.getInt("size"),request.getString("hash")),response,
                journal.getLong("size"),journal.getJSONArray("parts").length(),journal.get("rawHash") as? String,journal.get("manifestHash") as? String)
        }
        fun withOriginal(options: ReadOptions, id: String, allowIncomplete: Boolean = false, consume: (InputStream) -> Unit): Receipt {
            RemoteOriginalCodec.capacity(options.capacity); RemoteOriginalCodec.current(options); check(RemoteOriginalCodec.uuid.matches(id)) { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
            val before = RemoteOriginalCodec.inventory(options); RemoteOriginalCodec.within(before.usage, options.capacity)
            val row = before.journals.singleOrNull { it.value.getString("id") == id } ?: error("E2EE_REMOTE_ORIGINAL_MISSING"); val journal = row.value
            check(journal.getString("phase") == "complete" || allowIncomplete) { "E2EE_REMOTE_ORIGINAL_INCOMPLETE" }
            RemoteOriginalCodec.verifiedRequest(options,before,journal)
            val stream = RemoteOriginalInput(options, before, journal)
            try {
                consume(stream); RemoteOriginalCodec.current(options)
                check(stream.eof && !stream.failed.get() && stream.size == journal.getLong("size")) { "E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ" }
                val rawHash = stream.hash(); if (journal.getString("phase") == "complete") check(rawHash == journal.getString("rawHash")) { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
                RemoteOriginalCodec.stable(options, before); RemoteOriginalCodec.current(options)
                return Receipt(id, stream.size, rawHash, journal.getString("phase") == "complete", journal.get("manifestHash") as? String)
            } finally { stream.close() }
        }
    }
}

private class RemoteOriginalInput(private val options: E2eeRemoteOriginal.ReadOptions, private val inventory: RemoteOriginalCodec.Inventory,
    private val journal: JSONObject) : InputStream() {
    private val live = AtomicBoolean(true); private val reading = AtomicBoolean(false); private val gate = ReentrantLock()
    val failed = AtomicBoolean(false); var eof = false; private set
    var size = 0L; private set
    private var index = 0; private var at = 0; private var buffer = ByteArray(0); private val digest = MessageDigest.getInstance("SHA-256"); private var completedHash: String? = null
    private fun current() { RemoteOriginalCodec.current(options); check(live.get()) { "E2EE_REMOTE_ORIGINAL_READER_CLOSED" } }
    override fun read(): Int { val one = ByteArray(1); return try { if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 255 } finally { one.fill(0) } }
    override fun read(target: ByteArray, offset: Int, length: Int): Int {
        require(offset >= 0 && length >= 0 && offset <= target.size - length)
        if (!reading.compareAndSet(false, true)) { failed.set(true); target.fill(0, offset, offset + length); error("E2EE_REMOTE_ORIGINAL_READER_BUSY") }
        try { return gate.withLock {
            current(); if (length == 0) return@withLock 0
            if (at == buffer.size) {
                buffer.fill(0); buffer = ByteArray(0); at = 0; val parts = journal.getJSONArray("parts")
                if (index == parts.length()) {
                    if (!eof) { val hash = digest.digest(); try { completedHash = E2eeEnvelope.encode(hash) } finally { hash.fill(0) }; eof = true }
                    return@withLock -1
                }
                val part = parts.getJSONObject(index); val row = options.vault.read("local-snapshot", RemoteOriginalCodec.key(inventory.hash, journal.getString("id"), "p", index))
                try {
                    current(); check(row != null && row.serial == 1L && row.bytes.size.toLong() == part.getLong("size") && RemoteOriginalCodec.hash(row.bytes) == part.getString("hash")) { "E2EE_CORRUPT_REMOTE_ORIGINAL" }
                    buffer = row.bytes; digest.update(buffer); index++
                } catch (error: Exception) { row?.bytes?.fill(0); throw error }
            }
            val count = minOf(length, RemoteOriginalCodec.MAX_PART, buffer.size - at); buffer.copyInto(target, offset, at, at + count); at += count; size += count; current(); count
        } } catch (error: Exception) { failed.set(true); target.fill(0, offset, offset + length); throw error } finally { reading.set(false) }
    }
    fun hash(): String = completedHash ?: error("E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ")
    override fun close() { live.set(false); gate.withLock { buffer.fill(0); buffer = ByteArray(0); digest.reset() } }
}

private object RemoteOriginalCodec {
    const val PURPOSE = "remote-original/v1"; const val MAX_META = 2 * 1024 * 1024; const val MAX_REQUEST = 128 * 1024; const val MAX_PART = 65536
    val uuid = Regex("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
    private val actions = setOf("legacy-workspace", "legacy-aurora", "legacy-stoicheion", "legacy-advice", "legacy-tasks", "legacy-diary", "legacy-mindmaps", "legacy-physis", "legacy-reminders", "legacy-archives")
    class Meta(val serial: Long, val value: JSONObject, val hash: String, val bytes: Int)
    class Inventory(val context: JSONObject, val hash: String, val catalog: JSONObject, val serial: Long?, val journals: List<Meta>, val usage: E2eeRemoteOriginal.Admission, val stamp: String)
    fun invalid(): Nothing = error("E2EE_CORRUPT_REMOTE_ORIGINAL")
    fun hash(bytes: ByteArray) = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    fun encoded(value: Any): ByteArray = E2eeCommands.canonical(value).also { if (it.size > MAX_META) { it.fill(0); error("E2EE_REMOTE_ORIGINAL_METADATA_LIMIT") } }
    fun identity(value: Any): String { val bytes = encoded(value); return try { hash(bytes) } finally { bytes.fill(0) } }
    fun copy(value: JSONObject): JSONObject { val bytes = encoded(value); return try { E2eeCommands.decodeCanonical(bytes, MAX_META) as? JSONObject ?: invalid() } finally { bytes.fill(0) } }
    fun current(options: E2eeRemoteOriginal.ReadOptions) { options.assertCurrent(); options.vault.assertOpen() }
    fun registration(id:String,context:JSONObject,binding:JSONObject):E2eeRemoteOriginal.Registration = E2eeRemoteOriginal.Registration(id,
        E2eeRemoteOriginal.OriginalContext(context.getString("ownerId"),context.getString("scopeId"),context.getString("kind"),context.getString("actorId"),context.getString("actorScopeId"),context.getString("deviceId")),
        E2eeRemoteOriginal.RequestBinding(binding.getString("packetHash"),binding.getString("signer"),binding.getLong("generation"),binding.getString("migrationId"),binding.getLong("fence"),binding.getString("sourceHash"),
            binding.getString("action"),binding.getLong("directoryRevision"),binding.getString("checkpointHash"),binding.getLong("securityEpoch")))
    fun verifiedRequest(options:E2eeRemoteOriginal.ReadOptions,inventory:Inventory,journal:JSONObject):E2eeRemoteOriginal.Registration {
        val id=journal.getString("id");val request=options.vault.read("local-snapshot",key(inventory.hash,id,"r"))
        try {
            current(options);val descriptor=journal.getJSONObject("request")
            check(request!=null&&request.serial==1L&&request.bytes.size.toLong()==descriptor.getLong("size")&&hash(request.bytes)==descriptor.getString("hash")){"E2EE_CORRUPT_REMOTE_ORIGINAL"}
            check(request.bytes.size in 1..MAX_REQUEST&&!(request.bytes.size>=3&&request.bytes[0]==0xef.toByte()&&request.bytes[1]==0xbb.toByte()&&request.bytes[2]==0xbf.toByte())){"E2EE_CORRUPT_REMOTE_ORIGINAL"}
            val packet=E2eeHttpResponseJson.read(ByteArrayInputStream(request.bytes),"/e2ee/v1/read",200,"application/json",request.bytes.size.toLong(),{current(options)})?:invalid()
            val binding=journal.getJSONObject("binding");val context=journal.getJSONObject("context");val signer=E2eeDirectory.signingKey(binding.getString("signer"))
            val bound=packetBinding(packet,signer,context,binding.getLong("generation"));current(options)
            check(identity(bound)==identity(binding)){"E2EE_CORRUPT_REMOTE_ORIGINAL"};return registration(id,context,binding)
        }finally{request?.bytes?.fill(0)}
    }
    fun capacity(value: E2eeRemoteOriginal.Capacity) {
        check(value.maximumBytes in 1..128L * 1024 * 1024 && value.maximumParts in 1..8000 && value.maximumObservations in 1..1000 && value.maximumRecords in 1..10000 && value.maximumMetadataBytes in 1..16 * 1024 * 1024) { "E2EE_REMOTE_ORIGINAL_CAPACITY" }
    }
    fun within(value: E2eeRemoteOriginal.Admission, capacity: E2eeRemoteOriginal.Capacity) {
        check(value.bytes <= capacity.maximumBytes && value.parts <= capacity.maximumParts && value.observations <= capacity.maximumObservations && value.records <= capacity.maximumRecords && value.metadataBytes <= capacity.maximumMetadataBytes) { "E2EE_REMOTE_ORIGINAL_CAPACITY" }
    }
    fun context(options: E2eeRemoteOriginal.ReadOptions): JSONObject {
        val target = options.target; listOf(target.ownerId, target.scopeId).forEach(E2eeKeys::technical); if (target.kind !in setOf("personal", "project", "space")) invalid(); val actor = options.vault.localIdentity()
        return JSONObject().put("ownerId", target.ownerId).put("scopeId", target.scopeId).put("kind", target.kind).put("actorId", actor.ownerId).put("actorScopeId", actor.scopeId).put("deviceId", actor.deviceId)
    }
    fun same(value: JSONObject, expected: JSONObject) { E2eeKeys.exact(value, setOf("ownerId", "scopeId", "kind", "actorId", "actorScopeId", "deviceId")); for (name in expected.keys()) check(value.get(name) == expected.get(name)) { "E2EE_REMOTE_ORIGINAL_CONTEXT" } }
    fun key(hash: String, id: String, role: String, part: Int = 0): String {
        E2eeEnvelope.decode(hash, 32); if (!uuid.matches(id) || role !in setOf("j", "r", "m", "p") || part !in 0..7999) invalid()
        return "remote-original:$hash:$id:$role:${part.toString().padStart(5, '0')}"
    }
    fun catalogKey(hash: String) = "remote-original-catalog:$hash"
    private fun number(value: Any, minimum: Long = 0, maximum: Long = 9007199254740991): Long = E2eeCommands.integer(value, minimum).also { if (it > maximum) invalid() }
    fun response(value: JSONObject) {
        E2eeKeys.exact(value, setOf("path", "status", "contentType", "contentLength")); if (value.get("path") != "/e2ee/v1/read") invalid(); number(value.get("status"), 0, 599)
        for (name in listOf("contentType", "contentLength")) { val text = value.get(name); if (text != JSONObject.NULL && (text !is String || text.length > (if (name == "contentType") 512 else 64) || text.any { it.code !in 32..126 })) invalid() }
    }
    fun responseLimit(value: JSONObject) = if (value.getInt("status") in 200..299) 16L * 1024 * 1024 else 8192L
    private fun binding(value: JSONObject) {
        E2eeKeys.exact(value, setOf("packetHash", "signer", "generation", "migrationId", "fence", "sourceHash", "action", "directoryRevision", "checkpointHash", "securityEpoch"))
        E2eeEnvelope.decode(value.getString("packetHash"), 32); E2eeEnvelope.decode(value.getString("signer"), 91); number(value.get("generation"), 1); if (!uuid.matches(value.getString("migrationId"))) invalid()
        number(value.get("fence"), 1); E2eeEnvelope.decode(value.getString("sourceHash"), 32); if (value.get("action") !in actions) invalid(); number(value.get("directoryRevision"), 1); E2eeEnvelope.decode(value.getString("checkpointHash"), 32); number(value.get("securityEpoch"), 1)
    }
    fun manifest(journal: JSONObject) = copy(journal).also { it.remove("phase"); it.remove("manifestHash") }
    private fun journal(value: JSONObject, scope: JSONObject, id: String) {
        E2eeKeys.exact(value, setOf("protocol", "purpose", "id", "context", "binding", "request", "response", "phase", "size", "parts", "rawHash", "manifestHash"))
        if (number(value.get("protocol")) != 1L || value.get("purpose") != PURPOSE || value.get("id") != id || value.get("phase") !in setOf("registered", "receiving", "complete")) invalid()
        same(value.getJSONObject("context"), scope); binding(value.getJSONObject("binding")); val request = value.getJSONObject("request"); E2eeKeys.exact(request, setOf("size", "hash")); number(request.get("size"), 1, MAX_REQUEST.toLong()); E2eeEnvelope.decode(request.getString("hash"), 32)
        if (!value.isNull("response")) response(value.getJSONObject("response")); if ((value.get("phase") == "registered") != value.isNull("response")) invalid()
        number(value.get("size"), 0, if (value.isNull("response")) 0 else responseLimit(value.getJSONObject("response"))); val parts = value.getJSONArray("parts"); if (parts.length() > 8000) invalid(); var size = 0L
        for (index in 0 until parts.length()) { val part = parts.getJSONObject(index); E2eeKeys.exact(part, setOf("size", "hash")); size += number(part.get("size"), 1, MAX_PART.toLong()); E2eeEnvelope.decode(part.getString("hash"), 32) }
        if (size != value.getLong("size") || value.get("phase") == "registered" && size != 0L) invalid()
        if (value.get("phase") == "complete") { E2eeEnvelope.decode(value.getString("rawHash"), 32); E2eeEnvelope.decode(value.getString("manifestHash"), 32) } else if (!value.isNull("rawHash") || !value.isNull("manifestHash")) invalid()
    }
    private fun meta(options: E2eeRemoteOriginal.ReadOptions, id: String): Meta? {
        current(options); val row = options.vault.read("local-snapshot", id)
        try { current(options); if (row == null) return null; val value = E2eeCommands.decodeCanonical(row.bytes, MAX_META) as? JSONObject ?: invalid(); if (identity(value) != hash(row.bytes)) invalid(); return Meta(row.serial, value, hash(row.bytes), row.bytes.size) } finally { row?.bytes?.fill(0) }
    }
    fun inventory(options: E2eeRemoteOriginal.ReadOptions): Inventory {
        current(options); val context = context(options); val hash = identity(context); val before = meta(options, catalogKey(hash)); val all = options.vault.listLocal("local-snapshot", "remote-original:"); current(options); val owned = mutableListOf<String>()
        for (id in all) { val parts = id.split(':'); if (!Regex("^remote-original:[A-Za-z0-9_-]{43}:[a-f0-9-]{36}:[jrmp]:[0-9]{5}$").matches(id) || !uuid.matches(parts[2]) || parts[4].toInt() > 7999 || parts[3] != "p" && parts[4] != "00000") error("E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT"); E2eeEnvelope.decode(parts[1], 32); if (parts[1] == hash) owned += id }
        val catalog = before?.value ?: JSONObject().put("protocol", 1).put("context", context).put("ids", JSONArray())
        E2eeKeys.exact(catalog, setOf("protocol", "context", "ids")); if (number(catalog.get("protocol")) != 1L) invalid(); same(catalog.getJSONObject("context"), context); val ids = catalog.getJSONArray("ids"); if (ids.length() > 1000) invalid(); val seen = mutableSetOf<String>()
        for (index in 0 until ids.length()) { val id = ids.getString(index); if (!uuid.matches(id) || !seen.add(id)) invalid() }
        if (before == null && owned.isNotEmpty()) error("E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT")
        val present = owned.toSet(); val expected = mutableSetOf<String>(); val journals = mutableListOf<Meta>(); var bytes = 0L; var parts = 0; var records = if (before == null) 0 else 1; var metadata = before?.bytes ?: 0
        for (index in 0 until ids.length()) {
            val id = ids.getString(index); val jid = key(hash, id, "j"); val rid = key(hash, id, "r"); if (jid !in present || rid !in present) invalid(); expected += jid; expected += rid
            val row = meta(options, jid) ?: invalid(); val j = row.value; journal(j, context, id); journals += row; val count = j.getJSONArray("parts").length()
            bytes += j.getLong("size"); parts += count; records += 2 + count; metadata += row.bytes + j.getJSONObject("request").getInt("size")
            if (parts > 8000 || records > 10000 || metadata > 16 * 1024 * 1024) error("E2EE_REMOTE_ORIGINAL_CAPACITY")
            repeat(count) { expected += key(hash, id, "p", it) }
            if (j.get("phase") == "complete") { val mid = key(hash, id, "m"); expected += mid; val m = meta(options, mid) ?: invalid(); if (m.serial != 1L || m.hash != j.getString("manifestHash") || identity(m.value) != identity(manifest(j))) invalid(); records++; metadata += m.bytes }
        }
        if (owned.size != expected.size || owned.any { it !in expected }) error("E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT")
        for (row in journals) { val current = meta(options, key(hash, row.value.getString("id"), "j")); check(current != null && current.serial == row.serial && current.hash == row.hash) { "E2EE_REMOTE_ORIGINAL_BUSY" } }
        val after = meta(options, catalogKey(hash)); check(before?.serial == after?.serial && before?.hash == after?.hash) { "E2EE_REMOTE_ORIGINAL_BUSY" }; current(options)
        val stamp = identity(JSONObject().put("catalogHash", before?.hash ?: JSONObject.NULL).put("catalogSerial", before?.serial ?: JSONObject.NULL)
            .put("keys", JSONArray(owned.sorted())).put("journals", JSONArray(journals.map { JSONObject().put("id", it.value.get("id")).put("serial", it.serial).put("hash", it.hash) })))
        return Inventory(context, hash, catalog, before?.serial, journals, E2eeRemoteOriginal.Admission(bytes, parts, ids.length(), records, metadata), stamp)
    }
    fun stable(options: E2eeRemoteOriginal.ReadOptions, previous: Inventory) { check(inventory(options).stamp == previous.stamp) { "E2EE_REMOTE_ORIGINAL_BUSY" } }
    fun write(id: String, value: Any, expected: Long?) = UnlockedE2eeVault.Write("local-snapshot", id, encoded(value), expected)
    fun commit(options: E2eeRemoteOriginal.Options, changes: List<UnlockedE2eeVault.Write>) { try { options.assertCurrent(); options.vault.assertOpen(); options.vault.write(changes); options.assertCurrent(); options.vault.assertOpen() } finally { changes.forEach { it.bytes.fill(0) } } }
    fun packetBinding(packet: JSONObject, signer: PublicKey, context: JSONObject, generation: Long): JSONObject {
        val command = E2eeCommands.verify(packet, signer)
        check(command.get("ownerId") == context.get("ownerId") && command.get("scopeId") == context.get("scopeId") && command.get("deviceId") == context.get("deviceId") && command.get("action") in actions) { "E2EE_REMOTE_ORIGINAL_CONTEXT" }
        val payload = command.getJSONObject("payload"); val names = mutableSetOf("migrationId", "fence", "sourceHash"); if (payload.has("table")) names += setOf("table", "offset"); if (payload.has("byteOffset")) names += "byteOffset"; E2eeKeys.exact(payload, names)
        if (!uuid.matches(payload.getString("migrationId"))) invalid(); number(payload.get("fence"), 1); E2eeEnvelope.decode(payload.getString("sourceHash"), 32); number(command.get("expectedRevision"), 1); E2eeEnvelope.decode(command.getString("checkpointHash"), 32); number(generation, 1)
        if (payload.has("table")) { val tables = mapOf("legacy-mindmaps" to setOf("maps", "versions", "receipts", "deletions"), "legacy-physis" to setOf("owners", "records", "usedIds", "receipts"), "legacy-reminders" to setOf("habitProfiles", "habitDevices", "habitDeliveries", "adviceDays", "adviceDeliveries", "sharedPreferences"), "legacy-archives" to setOf("stages", "safety", "receipts")); if (tables[command.getString("action")]?.contains(payload.getString("table")) != true) invalid(); number(payload.get("offset")) }
        if (payload.has("byteOffset")) { if (command.get("action") != "legacy-archives" || !payload.has("table")) invalid(); number(payload.get("byteOffset"), 0, 64L * 1024 * 1024) }
        val spki = E2eeEnvelope.encode(signer.encoded); E2eeEnvelope.decode(spki, 91)
        return JSONObject().put("packetHash", identity(packet)).put("signer", spki).put("generation", generation).put("migrationId", payload.get("migrationId")).put("fence", payload.get("fence"))
            .put("sourceHash", payload.get("sourceHash")).put("action", command.get("action")).put("directoryRevision", command.get("expectedRevision")).put("checkpointHash", command.get("checkpointHash")).put("securityEpoch", command.get("securityEpoch"))
    }
}
