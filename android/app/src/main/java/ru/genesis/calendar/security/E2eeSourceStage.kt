package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock

/** Encrypted local quarantine; completion does not publish a coordinator pointer.
 * The caller holds the original-source fence and retains originals until that
 * separate publication. No restore, network, ACL or replay capability exists. */
class E2eeSourceStage private constructor(private val options: Options, private val context: JSONObject,
    private val hash: String, private var journal: JSONObject) {
    data class Target(val ownerId: String, val scopeId: String, val kind: String)
    data class Reference(val stageId: String, val manifestHash: String)
    data class Capacity(val maximumBytes: Long, val maximumParts: Int)
    data class Admission(val bytes: Long, val parts: Int, val metadataBytes: Int)
    data class Marker(val id: String, val complete: Boolean, val manifestHash: String?)
    data class Options(val vault: UnlockedE2eeVault, val target: Target, val paths: List<String>, val capacity: Capacity,
        val ensureDurableKeys: () -> Unit, val assertCurrent: () -> Unit, val admit: (Admission) -> Unit)
    private var serial = 1L
    private val busy = AtomicBoolean(false)
    private val broken = AtomicBoolean(false)
    private fun current() {
        StageCodec.current(options.vault, options.assertCurrent)
        check(!broken.get() && journal.getString("phase") == "capturing") { "E2EE_SOURCE_STAGE_CLOSED" }
    }
    private fun append(path: Int, input: ByteArray, length: Int) {
        current(); val bytes = input.copyOf(length); var changes = emptyList<UnlockedE2eeVault.Write>()
        try {
            check(length in 1..StageCodec.CHUNK) { "E2EE_CORRUPT_SOURCE_STAGE" }
            val next = StageCodec.copy(journal); val entry = next.getJSONArray("entries").getJSONObject(path)
            check(!entry.getBoolean("complete")) { "E2EE_CORRUPT_SOURCE_STAGE" }
            val parts = entry.getJSONArray("parts")
            parts.put(JSONObject().put("size", length).put("hash", StageCodec.digest(bytes)))
            entry.put("size", entry.getLong("size") + length)
            val totals = StageCodec.totals(next.getJSONArray("entries"))
            check(totals.first <= options.capacity.maximumBytes && totals.second <= options.capacity.maximumParts) { "E2EE_SOURCE_STAGE_CAPACITY" }
            changes = listOf(UnlockedE2eeVault.Write(StageCodec.DOMAIN, StageCodec.key(hash, next.getString("stageId"), "p", path, parts.length() - 1), bytes, null),
                StageCodec.write(StageCodec.key(hash, next.getString("stageId"), "j"), next, serial))
            options.admit(Admission(totals.first, totals.second, changes[1].bytes.size)); current()
            StageCodec.commit(options.vault, changes, ::current); journal = next; serial++
        } finally { bytes.fill(0); changes.forEach { it.bytes.fill(0) } }
    }
    /** Output close/flush is not a completion receipt. Only the producer's
     * successful full authenticated EOF and this method's return close a path. */
    fun capturePath(id: String, producer: (OutputStream) -> Unit) = capturePathInternal(id, producer)
    /** A local producer may suspend between bounded writes. The original actor,
     * single-path gate and completion checks span that suspension. */
    suspend fun captureSuspendPath(id: String, producer: suspend (OutputStream) -> Unit) = capturePathInternal(id) { producer(it) }
    private inline fun capturePathInternal(id: String, producer: (OutputStream) -> Unit) {
        current(); check(busy.compareAndSet(false, true)) { "E2EE_SOURCE_STAGE_BUSY" }
        val buffer = ByteArray(StageCodec.CHUNK); val gate = ReentrantLock()
        var count = 0; val accepting = AtomicBoolean(true)
        try {
            val rows = journal.getJSONArray("entries")
            val path = (0 until rows.length()).firstOrNull { !rows.getJSONObject(it).getBoolean("complete") }
            check(path != null && rows.getJSONObject(path).getString("id") == id) { "E2EE_SOURCE_STAGE_ORDER" }
            val output = object : OutputStream() {
                override fun write(value: Int) {
                    var entered = false
                    try {
                        current(); check(accepting.get() && !gate.isHeldByCurrentThread && gate.tryLock()) { "E2EE_SOURCE_STAGE_INPUT" }; entered = true
                        buffer[count++] = value.toByte()
                        if (count == buffer.size) { append(path, buffer, count); buffer.fill(0); count = 0 }
                    } catch (error: Exception) { broken.set(true); throw error }
                    finally { if (entered) gate.unlock() }
                }
                override fun write(bytes: ByteArray, offset: Int, length: Int) {
                    var entered = false
                    try {
                        current()
                        check(accepting.get() && offset >= 0 && length >= 0 && offset <= bytes.size - length && !gate.isHeldByCurrentThread && gate.tryLock()) { "E2EE_SOURCE_STAGE_INPUT" }
                        entered = true
                        var at = offset; val end = offset + length
                        while (at < end) {
                            current(); check(accepting.get()) { "E2EE_SOURCE_STAGE_INPUT" }
                            val take = minOf(end - at, buffer.size - count)
                            bytes.copyInto(buffer, count, at, at + take); at += take; count += take
                            if (count == buffer.size) { append(path, buffer, count); buffer.fill(0); count = 0 }
                        }
                    } catch (error: Exception) { broken.set(true); throw error }
                    finally { if (entered) gate.unlock() }
                }
                override fun flush() { current() }
                override fun close() { broken.set(true); throw IllegalStateException("E2EE_SOURCE_STAGE_INPUT") }
            }
            producer(output); accepting.set(false)
            check(!gate.isLocked) { "E2EE_SOURCE_STAGE_INPUT" }; current()
            if (count > 0) append(path, buffer, count)
            val next = StageCodec.copy(journal); val entry = next.getJSONArray("entries").getJSONObject(path)
            check(entry.getLong("size") > 0) { "E2EE_SOURCE_STAGE_EMPTY" }; entry.put("complete", true)
            StageCodec.commit(options.vault, listOf(StageCodec.write(StageCodec.key(hash, next.getString("stageId"), "j"), next, serial)), ::current)
            journal = next; serial++
        } catch (error: Exception) { broken.set(true); throw error }
        finally { accepting.set(false); gate.lock(); try { buffer.fill(0) } finally { gate.unlock(); busy.set(false) } }
    }
    fun finish(): Reference {
        current(); check(busy.compareAndSet(false, true)) { "E2EE_SOURCE_STAGE_BUSY" }
        try {
            val rows = journal.getJSONArray("entries")
            check((0 until rows.length()).all { rows.getJSONObject(it).getBoolean("complete") }) { "E2EE_SOURCE_STAGE_INCOMPLETE" }
            val id = journal.getString("stageId")
            val manifest = JSONObject().put("protocol", 1).put("stageId", id).put("context", context).put("chunkSize", StageCodec.CHUNK)
                .put("entries", StageCodec.copy(journal).getJSONArray("entries"))
            for (path in 0 until rows.length()) {
                val parts = rows.getJSONObject(path).getJSONArray("parts")
                for (part in 0 until parts.length()) {
                    val opened = options.vault.read(StageCodec.DOMAIN, StageCodec.key(hash, id, "p", path, part))
                    try { current(); StageCodec.verifyPart(opened, parts.getJSONObject(part)) } finally { opened?.bytes?.fill(0) }
                }
            }
            val manifestHash = StageCodec.identity(manifest)
            val old = StageCodec.catalog(options.vault, context, hash, ::current) ?: StageCodec.invalid()
            val index = StageCodec.copy(old.body); val stages = index.getJSONArray("stages")
            val marker = (0 until stages.length()).map { stages.getJSONObject(it) }.singleOrNull { it.getString("id") == id } ?: StageCodec.invalid()
            if (marker.getBoolean("complete")) StageCodec.invalid()
            marker.put("complete", true).put("manifestHash", manifestHash)
            val next = StageCodec.copy(journal).put("phase", "complete").put("manifestHash", manifestHash)
            val changes = listOf(StageCodec.write(StageCodec.key(hash, id, "m"), manifest, null),
                StageCodec.write(StageCodec.key(hash, id, "j"), next, serial), StageCodec.write(StageCodec.catalogId(hash), index, old.serial))
            try {
                val totals = StageCodec.totals(rows)
                options.admit(Admission(totals.first, totals.second, changes.sumOf { it.bytes.size }))
                StageCodec.commit(options.vault, changes, ::current)
            } finally { changes.forEach { it.bytes.fill(0) } }
            journal = next; serial++; return Reference(id, manifestHash)
        } catch (error: Exception) { broken.set(true); throw error } finally { busy.set(false) }
    }
    companion object {
        fun create(input: Options): E2eeSourceStage {
            val options = input.copy(paths = input.paths.toList())
            StageCodec.current(options.vault, options.assertCurrent)
            val context = StageCodec.context(options.vault, options.target)
            if (options.paths.size !in 1..20 || options.paths.toSet().size != options.paths.size) StageCodec.invalid()
            options.paths.forEach(E2eeKeys::technical)
            check(options.capacity.maximumParts in 1..10000 && options.capacity.maximumBytes in 1..options.capacity.maximumParts.toLong() * StageCodec.CHUNK) { "E2EE_SOURCE_STAGE_CAPACITY" }
            options.ensureDurableKeys(); StageCodec.current(options.vault, options.assertCurrent)
            val hash = StageCodec.identity(context)
            val old = StageCodec.catalog(options.vault, context, hash, options.assertCurrent)
            val index = old?.body ?: JSONObject().put("protocol", 1).put("context", context).put("stages", JSONArray())
            check(index.getJSONArray("stages").length() < 64) { "E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED" }
            val id = UUID.randomUUID().toString()
            val rows = JSONArray().apply { options.paths.forEach { put(JSONObject().put("id", it).put("size", 0).put("parts", JSONArray()).put("complete", false)) } }
            val journal = JSONObject().put("protocol", 1).put("stageId", id).put("context", context).put("chunkSize", StageCodec.CHUNK)
                .put("phase", "capturing").put("entries", rows).put("manifestHash", JSONObject.NULL)
            index.getJSONArray("stages").put(JSONObject().put("id", id).put("complete", false).put("manifestHash", JSONObject.NULL))
            val changes = listOf(StageCodec.write(StageCodec.catalogId(hash), index, old?.serial), StageCodec.write(StageCodec.key(hash, id, "j"), journal, null))
            try {
                options.admit(Admission(0, 0, changes.sumOf { it.bytes.size }))
                StageCodec.commit(options.vault, changes, options.assertCurrent)
            } finally { changes.forEach { it.bytes.fill(0) } }
            return E2eeSourceStage(options, context, hash, journal)
        }
        fun inspect(vault: UnlockedE2eeVault, target: Target, check: () -> Unit): List<Marker> {
            val context = StageCodec.context(vault, target); val old = StageCodec.catalog(vault, context, StageCodec.identity(context), check) ?: return emptyList()
            val rows = old.body.getJSONArray("stages")
            return (0 until rows.length()).map { rows.getJSONObject(it).let { row -> Marker(row.getString("id"), row.getBoolean("complete"), if (row.isNull("manifestHash")) null else row.getString("manifestHash")) } }
        }
        /** Include this compare/re-seal in the SAME transaction as the pointer.
         * Returned owned bytes belong to the publication transaction owner. */
        internal fun publicationGuard(vault:UnlockedE2eeVault,target:Target,references:List<Reference>,check:()->Unit):UnlockedE2eeVault.Write {
            val refs=references.toList();refs.forEach{StageCodec.id(it.stageId);E2eeEnvelope.decode(it.manifestHash,32)}
            val context=StageCodec.context(vault,target);val hash=StageCodec.identity(context)
            val old=StageCodec.catalog(vault,context,hash,check)?:StageCodec.invalid();val rows=old.body.getJSONArray("stages")
            check(refs.isNotEmpty()&&rows.length()==refs.size&&(0 until rows.length()).all{index->val row=rows.getJSONObject(index)
                row.getBoolean("complete")&&row.get("id")==refs[index].stageId&&row.get("manifestHash")==refs[index].manifestHash}){"E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED"}
            StageCodec.current(vault,check);return StageCodec.write(StageCodec.catalogId(hash),old.body,old.serial)
        }
        fun open(vault: UnlockedE2eeVault, target: Target, reference: Reference, check: () -> Unit): Opened {
            StageCodec.current(vault, check); val context = StageCodec.context(vault, target); val hash = StageCodec.identity(context)
            StageCodec.id(reference.stageId); E2eeEnvelope.decode(reference.manifestHash, 32)
            val old = StageCodec.catalog(vault, context, hash, check) ?: StageCodec.invalid()
            val stages = old.body.getJSONArray("stages")
            val marker = (0 until stages.length()).map { stages.getJSONObject(it) }.singleOrNull { it.getString("id") == reference.stageId } ?: StageCodec.invalid()
            if (!marker.getBoolean("complete") || marker.getString("manifestHash") != reference.manifestHash) StageCodec.invalid()
            val manifest = StageCodec.metadata(vault, StageCodec.key(hash, reference.stageId, "m"), check) ?: StageCodec.invalid()
            if (StageCodec.identity(manifest.body) != reference.manifestHash) StageCodec.invalid()
            StageCodec.current(vault, check)
            return Opened(vault, hash, reference.stageId, manifest.body.getJSONArray("entries"), check)
        }
    }
    class Opened internal constructor(private val vault: UnlockedE2eeVault, private val hash: String, private val id: String,
        private val entries: JSONArray, private val check: () -> Unit) {
        val paths: List<String> get() = (0 until entries.length()).map { entries.getJSONObject(it).getString("id") }
        fun openPath(path: String): SourceInput {
            val index = (0 until entries.length()).singleOrNull { entries.getJSONObject(it).getString("id") == path } ?: throw IllegalStateException("E2EE_SOURCE_STAGE_PATH")
            return SourceInput(vault, hash, id, index, entries.getJSONObject(index), check)
        }
    }
    class SourceInput internal constructor(private val vault: UnlockedE2eeVault, private val hash: String, private val id: String,
        private val path: Int, private val entry: JSONObject, private val check: () -> Unit) : InputStream() {
        private var part = 0; private var at = 0; private var total = 0L
        private var buffer: ByteArray? = null; private var complete = false; private var closed = false; private var failed = false
        override fun read(): Int { val one = ByteArray(1); return try { if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 255 } finally { one.fill(0) } }
        override fun read(output: ByteArray, offset: Int, length: Int): Int {
            try {
                StageCodec.current(vault, check); check(!closed && !failed) { "E2EE_SOURCE_STAGE_CLOSED" }
                require(offset >= 0 && length >= 0 && offset <= output.size - length)
                if (length == 0) return 0
                if (buffer == null) {
                    val parts = entry.getJSONArray("parts")
                    if (part == parts.length()) { if (total != entry.getLong("size")) StageCodec.invalid(); complete = true; return -1 }
                    val row = vault.read(StageCodec.DOMAIN, StageCodec.key(hash, id, "p", path, part))
                    try { StageCodec.current(vault, check); StageCodec.verifyPart(row, parts.getJSONObject(part)); buffer = row!!.bytes }
                    catch (error: Exception) { row?.bytes?.fill(0); throw error }
                }
                val bytes = buffer!!; val count = minOf(length, bytes.size - at)
                bytes.copyInto(output, offset, at, at + count); at += count; total += count
                if (at == bytes.size) { bytes.fill(0); buffer = null; at = 0; part++ }
                return count
            } catch (error: Exception) { failed = true; buffer?.fill(0); buffer = null; throw error }
        }
        fun assertComplete() { StageCodec.current(vault, check); check(complete && !failed) { "E2EE_SOURCE_STAGE_EOF_REQUIRED" } }
        override fun close() { closed = true; buffer?.fill(0); buffer = null }
    }
}

private object StageCodec {
    const val CHUNK = E2eeFiles.CHUNK_BYTES
    const val DOMAIN = "local-snapshot"
    private const val MAX_METADATA = 2 * 1024 * 1024
    private val uuid = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    fun invalid(): Nothing = throw IllegalStateException("E2EE_CORRUPT_SOURCE_STAGE")
    fun current(vault: UnlockedE2eeVault, check: () -> Unit) { check(); vault.requireOpen() }
    fun id(value: String) { if (!uuid.matches(value)) invalid() }
    fun key(hash: String, id: String, role: String, path: Int = 0, part: Int = 0): String {
        E2eeEnvelope.decode(hash, 32); id(id)
        if (role !in listOf("j", "m", "p") || path !in 0..19 || part !in 0..9999 || role != "p" && (path != 0 || part != 0)) invalid()
        return "source-stage:$hash:$id:$role:${path.toString().padStart(2, '0')}:${part.toString().padStart(5, '0')}"
    }
    fun catalogId(hash: String) = "source-stage-catalog:$hash"
    fun canonical(value: Any): ByteArray = E2eeCommands.canonical(value).also { if (it.size > MAX_METADATA) { it.fill(0); throw IllegalStateException("E2EE_SOURCE_STAGE_METADATA_LIMIT") } }
    fun copy(value: JSONObject) = JSONObject(value.toString())
    fun digest(value: ByteArray): String = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(value))
    fun identity(value: Any): String { val bytes = canonical(value); return try { digest(bytes) } finally { bytes.fill(0) } }
    fun context(vault: UnlockedE2eeVault, target: E2eeSourceStage.Target): JSONObject {
        E2eeKeys.technical(target.ownerId); E2eeKeys.technical(target.scopeId)
        if (target.kind !in listOf("personal", "project", "space")) invalid()
        val actor = vault.localIdentity()
        return JSONObject().put("ownerId", target.ownerId).put("scopeId", target.scopeId).put("kind", target.kind)
            .put("actorId", actor.ownerId).put("actorScopeId", actor.scopeId).put("deviceId", actor.deviceId)
    }
    fun context(value: JSONObject, expected: JSONObject) {
        val fields = setOf("ownerId", "scopeId", "kind", "actorId", "actorScopeId", "deviceId"); E2eeKeys.exact(value, fields)
        check(fields.all { value.get(it) == expected.get(it) }) { "E2EE_SOURCE_STAGE_CONTEXT" }
    }
    class Metadata(val serial: Long, val body: JSONObject)
    fun metadata(vault: UnlockedE2eeVault, id: String, check: () -> Unit): Metadata? {
        current(vault, check); val row = vault.read(DOMAIN, id)
        try {
            current(vault, check); if (row == null) return null
            val body = E2eeCommands.decodeCanonical(row.bytes, MAX_METADATA) as? JSONObject ?: invalid()
            val encoded = canonical(body)
            try { if (!encoded.contentEquals(row.bytes)) invalid() } finally { encoded.fill(0) }
            return Metadata(row.serial, body)
        } finally { row?.bytes?.fill(0) }
    }
    fun entries(rows: JSONArray, complete: Boolean) {
        if (rows.length() !in 1..20) invalid()
        val seen = mutableSetOf<String>(); var unfinished = false; var count = 0
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index); E2eeKeys.exact(row, setOf("id", "size", "parts", "complete"))
            val id = row.get("id") as? String ?: invalid(); E2eeKeys.technical(id)
            if (!seen.add(id)) invalid()
            val size = E2eeCommands.integer(row.get("size")); val done = row.get("complete") as? Boolean ?: invalid(); val parts = row.getJSONArray("parts")
            if (complete && !done || unfinished && (done || size != 0L || parts.length() != 0)) invalid()
            if (!done) unfinished = true
            count += parts.length(); if (count > 10000) invalid(); var total = 0L
            for (part in 0 until parts.length()) {
                val item = parts.getJSONObject(part); E2eeKeys.exact(item, setOf("size", "hash"))
                val length = E2eeCommands.integer(item.get("size"), 1)
                if (length > CHUNK || part < parts.length() - 1 && length != CHUNK.toLong()) invalid()
                E2eeEnvelope.decode(item.getString("hash"), 32); total += length
            }
            if (total != size || done && total == 0L) invalid()
        }
    }
    fun totals(rows: JSONArray): Pair<Long, Int> = (0 until rows.length()).fold(0L to 0) { (size, count), index ->
        val row = rows.getJSONObject(index); size + row.getLong("size") to count + row.getJSONArray("parts").length() }
    fun verifyPart(opened: UnlockedE2eeVault.Opened?, expected: JSONObject) {
        if (opened == null || opened.serial != 1L || opened.bytes.size.toLong() != E2eeCommands.integer(expected.get("size")) || digest(opened.bytes) != expected.getString("hash")) invalid()
    }
    class Catalog(val serial: Long, val body: JSONObject)
    /** Caller holds the original-source fence. Re-reads detect concurrent changes
     * during discovery; none are repaired, resumed, rebound or deleted here. */
    fun catalog(vault: UnlockedE2eeVault, context: JSONObject, hash: String, check: () -> Unit): Catalog? {
        val before = metadata(vault, catalogId(hash), check)
        val keys = vault.listLocal(DOMAIN, "source-stage:"); current(vault, check)
        val after = metadata(vault, catalogId(hash), check)
        check(before?.serial == after?.serial) { "E2EE_SOURCE_STAGE_BUSY" }
        val prefix = "source-stage:$hash:"; val owned = keys.filter { candidate ->
            val fields = candidate.split(':')
            check(fields.size == 6 && fields[0] == "source-stage" && fields[4].matches(Regex("[0-9]{2}")) && fields[5].matches(Regex("[0-9]{5}"))) { "E2EE_SOURCE_STAGE_UNBOUND_REMNANT" }
            check(candidate == key(fields[1], fields[2], fields[3], fields[4].toInt(), fields[5].toInt())) { "E2EE_SOURCE_STAGE_UNBOUND_REMNANT" }
            candidate.startsWith(prefix)
        }.toSet()
        if (before == null) { check(owned.isEmpty()) { "E2EE_SOURCE_STAGE_UNBOUND_REMNANT" }; return null }
        val body = before.body; E2eeKeys.exact(body, setOf("protocol", "context", "stages"))
        if (E2eeCommands.integer(body.get("protocol")) != 1L) invalid(); context(body.getJSONObject("context"), context)
        val stages = body.getJSONArray("stages"); if (stages.length() > 64) invalid()
        val ids = mutableSetOf<String>(); val expected = mutableSetOf<String>(); val stamps = mutableListOf<Pair<String, Long>>()
        for (index in 0 until stages.length()) {
            val marker = stages.getJSONObject(index); E2eeKeys.exact(marker, setOf("id", "complete", "manifestHash"))
            val id = marker.getString("id"); id(id); if (!ids.add(id)) invalid()
            val complete = marker.get("complete") as? Boolean ?: invalid()
            val manifestHash = if (complete) marker.getString("manifestHash").also { E2eeEnvelope.decode(it, 32) } else { if (!marker.isNull("manifestHash")) invalid(); null }
            val journal = metadata(vault, key(hash, id, "j"), check) ?: invalid(); stamps.add(id to journal.serial)
            val state = journal.body; E2eeKeys.exact(state, setOf("protocol", "stageId", "context", "chunkSize", "phase", "entries", "manifestHash"))
            if (E2eeCommands.integer(state.get("protocol")) != 1L || state.getString("stageId") != id || E2eeCommands.integer(state.get("chunkSize")) != CHUNK.toLong()
                || state.getString("phase") != (if (complete) "complete" else "capturing")
                || (if (state.isNull("manifestHash")) null else state.getString("manifestHash")) != manifestHash) invalid()
            context(state.getJSONObject("context"), context); val rows = state.getJSONArray("entries"); entries(rows, complete); expected.add(key(hash, id, "j"))
            for (path in 0 until rows.length()) for (part in 0 until rows.getJSONObject(path).getJSONArray("parts").length()) expected.add(key(hash, id, "p", path, part))
            if (complete) {
                val manifest = metadata(vault, key(hash, id, "m"), check) ?: invalid(); if (manifest.serial != 1L) invalid()
                E2eeKeys.exact(manifest.body, setOf("protocol", "stageId", "context", "chunkSize", "entries"))
                if (E2eeCommands.integer(manifest.body.get("protocol")) != 1L || manifest.body.getString("stageId") != id || E2eeCommands.integer(manifest.body.get("chunkSize")) != CHUNK.toLong()) invalid()
                context(manifest.body.getJSONObject("context"), context); entries(manifest.body.getJSONArray("entries"), true)
                if (identity(manifest.body) != manifestHash || identity(rows) != identity(manifest.body.getJSONArray("entries"))) invalid()
                expected.add(key(hash, id, "m"))
            }
        }
        check(owned == expected) { "E2EE_SOURCE_STAGE_UNBOUND_REMNANT" }
        for ((id, serial) in stamps) check(metadata(vault, key(hash, id, "j"), check)?.serial == serial) { "E2EE_SOURCE_STAGE_BUSY" }
        check(metadata(vault, catalogId(hash), check)?.serial == before.serial) { "E2EE_SOURCE_STAGE_BUSY" }
        return Catalog(before.serial, body)
    }
    fun write(id: String, value: Any, expected: Long?) = UnlockedE2eeVault.Write(DOMAIN, id, canonical(value), expected)
    fun commit(vault: UnlockedE2eeVault, changes: List<UnlockedE2eeVault.Write>, check: () -> Unit) {
        try { current(vault, check); vault.write(changes); current(vault, check) } finally { changes.forEach { it.bytes.fill(0) } }
    }
}
