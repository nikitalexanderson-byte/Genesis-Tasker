package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.PrivateKey
import java.security.PublicKey
import java.security.MessageDigest
import java.util.UUID
import java.io.InputStream
import javax.crypto.SecretKey

/** Independent file key, fresh per-chunk DEKs and authenticated encrypted final manifest. */
object E2eeFiles {
    fun objectManifestHash(source:JSONArray):String {
        require(source.length()<=10000){"E2EE_SCOPE_OBJECT_LIMIT"};val seen=mutableSetOf<String>()
        val entries=(0 until source.length()).map{source.getJSONObject(it)}.sortedWith(compareBy({it.getString("domain")},{it.getString("objectId")}))
        for(entry in entries) {
            E2eeKeys.exact(entry,setOf("domain","objectId","revision","payloadHash"));E2eeKeys.technical(entry.getString("domain"));E2eeKeys.technical(entry.getString("objectId"))
            E2eeCommands.integer(entry.get("revision"),1);E2eeEnvelope.decode(entry.getString("payloadHash"),32)
            require(seen.add(entry.getString("domain")+"\u0000"+entry.getString("objectId"))){"E2EE_DUPLICATE_OBJECT"}
        }
        return E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(E2eeCommands.canonical(JSONArray(entries))))
    }
    const val CHUNK_BYTES = 256 * 1024
    const val MAX_FILE_BYTES = 64 * 1024 * 1024
    class Sealed(val manifest: E2eeEnvelope.Envelope, val chunks: List<E2eeEnvelope.Envelope>) {
        override fun toString() = "E2eeFiles.Sealed([redacted])"
    }
    class Opened(val bytes: ByteArray, val filename: String, val mediaType: String) {
        override fun toString() = "E2eeFiles.Opened([redacted])"
    }
    private fun corrupt(): Nothing = throw IllegalStateException("E2EE_CORRUPT_FILE")
    fun seal(root: SecretKey, signingKey: PrivateKey, context: E2eeEnvelope.Context, source: ByteArray, filename: String, mediaType: String): Sealed {
        require(source.size <= MAX_FILE_BYTES && filename.length <= 512 && mediaType.length <= 128) { "E2EE_FILE_TOO_LARGE" }
        val copy = source.copyOf(); val chunks = mutableListOf<E2eeEnvelope.Envelope>()
        try {
            val manifest = copy.inputStream().use { input -> sealStream(root, signingKey, context, input, copy.size.toLong(), filename, mediaType, {}, { chunks += it }) }
            return Sealed(manifest, chunks)
        } finally { copy.fill(0) }
    }
    /** Same v1 format. Only bounded plaintext/ciphertext is held here. The
     * caller owns source closing, durable original/key custody and local-only
     * ciphertext quarantine. A prefix is not a complete file or save receipt;
     * upload/restore authority still requires the complete coordinator plan. */
    fun sealStream(root: SecretKey, signingKey: PrivateKey, original: E2eeEnvelope.Context, source: InputStream, size: Long,
        filename: String, mediaType: String, assertCurrent: () -> Unit, writeQuarantinedChunk: (E2eeEnvelope.Envelope) -> Unit): E2eeEnvelope.Envelope {
        assertCurrent()
        require(size in 0..MAX_FILE_BYTES.toLong() && filename.length <= 512 && mediaType.length <= 128) { "E2EE_FILE_TOO_LARGE" }
        val context = E2eeEnvelope.Context.fromJson(original.toJson()); val fileKey = E2eeKeys.freshSecret()
        val buffer = ByteArray(CHUNK_BYTES); val descriptors = JSONArray(); val fileId = UUID.randomUUID().toString()
        var filled = 0; var total = 0L
        try {
            val chunkRoot = E2eeEnvelope.importRoot(fileKey)
            fun append(count: Int) {
                assertCurrent(); val index = descriptors.length(); val objectId = "$fileId:${index.toString().padStart(6, '0')}"; val operationId = UUID.randomUUID().toString()
                val header = E2eeEnvelope.Context.fromJson(context.toJson().put("domain", "attachment").put("objectId", objectId).put("operationId", operationId).put("revision", 1))
                val bytes = buffer.copyOf(count)
                val chunk = try { E2eeEnvelope.seal(chunkRoot, signingKey, header, bytes) } finally { bytes.fill(0) }
                assertCurrent(); val hash = E2eeEnvelope.payloadHash(chunk); assertCurrent()
                writeQuarantinedChunk(chunk); assertCurrent()
                descriptors.put(JSONObject().put("objectId", objectId).put("operationId", operationId).put("index", index).put("size", count).put("hash", hash))
            }
            while (true) {
                assertCurrent(); val count = source.read(buffer, filled, buffer.size - filled); assertCurrent()
                if (count == -1) break
                check(count in 1..(buffer.size - filled) && total + count <= size) { "E2EE_INVALID_FILE_STREAM" }
                total += count; filled += count
                if (filled == buffer.size) { append(filled); buffer.fill(0); filled = 0 }
            }
            check(total == size) { "E2EE_INVALID_FILE_STREAM" }; assertCurrent()
            if (filled > 0) append(filled); buffer.fill(0)
            val text = JSONObject().put("protocol", 1).put("fileKey", E2eeEnvelope.encode(fileKey)).put("size", size).put("chunkSize", CHUNK_BYTES)
                .put("filename", filename).put("mediaType", mediaType).put("chunks", descriptors).toString()
            // JSONObject's UTF8 conversion otherwise replaces lone UTF16 units.
            // Escaping every surrogate preserves both pairs and lone units in
            // the existing private JSON manifest without changing its schema.
            val safe = buildString { for (char in text) if (char.isSurrogate()) {
                append("\\u"); val hex = "0123456789abcdef"
                append(hex[char.code ushr 12]).append(hex[char.code ushr 8 and 15]).append(hex[char.code ushr 4 and 15]).append(hex[char.code and 15])
            } else append(char) }
            val bytes = safe.toByteArray(Charsets.UTF_8)
            try { assertCurrent(); val manifest = E2eeEnvelope.seal(root, signingKey, context, bytes); assertCurrent(); return manifest }
            finally { bytes.fill(0) }
        } finally { buffer.fill(0); fileKey.fill(0) }
    }
    fun open(root: SecretKey, signer: PublicKey, expected: E2eeEnvelope.Context, manifestEnvelope: E2eeEnvelope.Envelope,
        fetch: (String) -> E2eeEnvelope.Envelope): Opened {
        val privateBytes = E2eeEnvelope.open(root,signer,expected,manifestEnvelope)
        var keyBytes: ByteArray? = null;var output: ByteArray? = null
        try {
            val manifest = E2eeFileManifestJson.read(privateBytes)
            E2eeKeys.exact(manifest,setOf("protocol","fileKey","size","chunkSize","filename","mediaType","chunks"))
            val size = E2eeCommands.integer(manifest.get("size"));val chunks = manifest.getJSONArray("chunks")
            val filename = manifest.get("filename") as? String ?: corrupt(); val mediaType = manifest.get("mediaType") as? String ?: corrupt()
            if (E2eeCommands.integer(manifest.get("protocol")) != 1L || E2eeCommands.integer(manifest.get("chunkSize")) != CHUNK_BYTES.toLong()
                || size > MAX_FILE_BYTES || filename.length > 512 || mediaType.length > 128 || chunks.length().toLong() != (size + CHUNK_BYTES - 1) / CHUNK_BYTES) corrupt()
            val seen = mutableSetOf<String>()
            for (index in 0 until chunks.length()) {
                val entry = chunks.getJSONObject(index); E2eeKeys.exact(entry, setOf("objectId", "operationId", "index", "size", "hash"))
                val objectId = entry.get("objectId") as? String ?: corrupt(); val operationId = entry.get("operationId") as? String ?: corrupt()
                val hash = entry.get("hash") as? String ?: corrupt(); E2eeKeys.technical(objectId); E2eeKeys.technical(operationId); E2eeEnvelope.decode(hash, 32)
                if (E2eeCommands.integer(entry.get("index")) != index.toLong() || E2eeCommands.integer(entry.get("size")) != minOf(CHUNK_BYTES.toLong(), size - index.toLong() * CHUNK_BYTES)
                    || !seen.add(objectId)) corrupt()
            }
            val fileKey = manifest.get("fileKey") as? String ?: corrupt()
            keyBytes = E2eeEnvelope.decode(fileKey,32);val chunkRoot = E2eeEnvelope.importRoot(keyBytes)
            val result = ByteArray(size.toInt());output = result;var offset = 0
            for (index in 0 until chunks.length()) {
                val entry = chunks.getJSONObject(index);E2eeKeys.exact(entry,setOf("objectId","operationId","index","size","hash"))
                val objectId = entry.getString("objectId");val operationId = entry.getString("operationId")
                val length = E2eeCommands.integer(entry.get("size"))
                val envelope = fetch(objectId)
                if (E2eeEnvelope.payloadHash(envelope) != entry.getString("hash")) corrupt()
                val context = E2eeEnvelope.Context.fromJson(expected.toJson().put("domain","attachment").put("objectId",objectId).put("operationId",operationId).put("revision",1))
                val bytes = E2eeEnvelope.open(chunkRoot,signer,context,envelope)
                try { if (bytes.size.toLong() != length) corrupt();bytes.copyInto(result,offset);offset += bytes.size } finally { bytes.fill(0) }
            }
            if (offset != result.size) corrupt()
            return Opened(result,filename,mediaType)
        } catch (_: Exception) { output?.fill(0);corrupt() }
        finally { privateBytes.fill(0);keyBytes?.fill(0) }
    }
}
