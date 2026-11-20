package ru.genesis.calendar.security

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.io.InputStream
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

/** Public primitive fixtures only. Real provider/IO coverage; not device key
 * custody, process-death recovery, coordinator publication or archive coverage. */
class E2eeFileStreamDeviceTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun fixture(name: String) = InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/$name").bufferedReader().use { JSONObject(it.readText()) }
    private class Rig(original: JSONObject) {
        val root = E2eeEnvelope.importRoot(E2eeEnvelope.decode(original.getString("rootKey"), 32))
        val signing = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(E2eeEnvelope.decode(original.getString("privateKeyPkcs8"), 1, 8192)))
        val signer = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(original.getString("publicKeySpki"), 1, 8192)))
        val context = E2eeEnvelope.Context.fromJson(original.getJSONObject("envelope").getJSONObject("context"))
        var live = true
        fun current() { check(live) { "E2EE_ACCOUNT_CHANGED" } }
    }
    private fun save(file: File, value: JSONObject) {
        // Envelopes and numeric proof fields only. Private filename UTF16 units
        // live in the encrypted manifest, never this outer JSON conversion.
        file.outputStream().use { stream -> stream.write(value.toString().toByteArray(Charsets.UTF_8)); stream.fd.sync() }
    }
    private fun clean(folder: File) {
        check(folder.canonicalFile.parentFile == app.noBackupFilesDir.canonicalFile && folder.name.startsWith("file-stream-synthetic-"))
        check(folder.deleteRecursively())
    }
    @Test fun actualFortyMiBStreamUsesPrivateCiphertextQuarantineAndColdV1Readback() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".qa1103.debug"))
        val f = Rig(fixture("v1.json")); val directory = File(app.noBackupFilesDir, "file-stream-synthetic-${UUID.randomUUID()}").apply { check(mkdir()) }
        val size = 40L * 1024 * 1024; var at = 0L; var eof = false; var calls = 0; var chunks = 0
        val originalHash = MessageDigest.getInstance("SHA-256"); val started = android.os.SystemClock.elapsedRealtime()
        val source = object : InputStream() {
            override fun read() = error("Bounded bulk input only")
            override fun read(target: ByteArray, offset: Int, length: Int): Int {
                calls++; if (at == size) { eof = true; return -1 }
                val count = minOf(length, 65521, (size - at).toInt())
                for (index in 0 until count) target[offset + index] = ((at + index) * 31).toByte()
                originalHash.update(target, offset, count); at += count; return count
            }
            override fun close() = error("Caller owns source")
        }
        try {
            val name = "\uFEFForiginal\uD800😀.bin"; val mime = "application/octet-stream"
            val manifest = E2eeFiles.sealStream(f.root, f.signing, f.context, source, size, name, mime, f::current) { envelope ->
                val id = envelope.context.toJson().getString("objectId"); assertTrue(id.matches(Regex("[a-f0-9-]{36}:[0-9]{6}")))
                save(File(directory, "$id.json"), envelope.toJson()); chunks++
            }
            assertTrue(eof); assertEquals(160, chunks); assertEquals(size, at)
            save(File(directory, "manifest.json"), manifest.toJson())
            // Re-open actual ciphertext files through the unchanged v1 reader.
            val reopened = E2eeEnvelope.Envelope.fromJson(JSONObject(File(directory, "manifest.json").readText()))
            val output = E2eeFiles.open(f.root, f.signer, f.context, reopened) { id -> E2eeEnvelope.Envelope.fromJson(JSONObject(File(directory, "$id.json").readText())) }
            val digest = try { assertEquals(name, output.filename); assertEquals(mime, output.mediaType); assertEquals(size, output.bytes.size.toLong())
                MessageDigest.getInstance("SHA-256").digest(output.bytes) } finally { output.bytes.fill(0) }
            assertArrayEquals(originalHash.digest(), digest)
            val proof = JSONObject().put("synthetic", true).put("primitiveOnly", true).put("bytes", size).put("chunks", chunks).put("readCalls", calls).put("actualEof", eof)
                .put("sha256", digest.joinToString("") { "%02x".format(it) }).put("filenameUnits", JSONArray(name.toCharArray().map { it.code }))
                .put("maxHeap", Runtime.getRuntime().maxMemory()).put("elapsedMs", android.os.SystemClock.elapsedRealtime() - started)
            save(File(app.getExternalFilesDir(null), "file-stream336-large-proof.json"), proof)
        } finally { clean(directory) }
    }
    @Test fun webStreamVectorOpensAndNativeStreamExportsTheSameV1SchemaAndFilenameUnits() {
        val original = fixture("v1.json"); val f = Rig(original); val web = fixture("file-stream-web-v1.json")
        val expected = E2eeEnvelope.decode(web.getString("plaintext"), 1, 1024); val units = web.getJSONArray("filenameUnits")
        val name = buildString { for (index in 0 until units.length()) append(units.getInt(index).toChar()) }
        val webChunks = web.getJSONArray("chunks"); val map = (0 until webChunks.length()).map { E2eeEnvelope.Envelope.fromJson(webChunks.getJSONObject(it)) }.associateBy { it.context.toJson().getString("objectId") }
        val read = E2eeFiles.open(f.root, f.signer, f.context, E2eeEnvelope.Envelope.fromJson(web.getJSONObject("manifest"))) { map.getValue(it) }
        try { assertArrayEquals(expected, read.bytes); assertEquals(name, read.filename) } finally { read.bytes.fill(0) }
        val chunks = JSONArray(); val manifest = expected.inputStream().use { input -> E2eeFiles.sealStream(f.root, f.signing, f.context, input, expected.size.toLong(), name, web.getString("mediaType"), f::current) { chunks.put(it.toJson()) } }
        val exported = JSONObject().put("synthetic", true).put("warning", "PUBLIC TEST KEYS; DO NOT USE FOR USER DATA").put("producer", "Android/JCA API${android.os.Build.VERSION.SDK_INT} streaming file writer")
            .put("rootKey", original.getString("rootKey")).put("publicKeySpki", original.getString("publicKeySpki")).put("context", f.context.toJson())
            .put("manifest", manifest.toJson()).put("chunks", chunks).put("plaintext", E2eeEnvelope.encode(expected)).put("filenameUnits", units).put("mediaType", web.getString("mediaType"))
        save(File(app.getExternalFilesDir(null), "file-stream336-native-vector.json"), exported); expected.fill(0)
    }
    @Test fun providerFinalTagFailureAndRetirementNeverReturnACompletedManifest() {
        for (tag in listOf(true, false)) {
            val f = Rig(fixture("v1.json")); var chunks = 0
            val source = object : java.io.ByteArrayInputStream(ByteArray(E2eeFiles.CHUNK_BYTES) { 23 }) {
                override fun read(target: ByteArray, offset: Int, length: Int): Int {
                    val count = super.read(target, offset, length); if (count == -1 && tag) error("SYNTHETIC_FINAL_TAG_FAILURE"); return count
                }
            }
            val error = assertThrows(IllegalStateException::class.java) { E2eeFiles.sealStream(f.root, f.signing, f.context, source, E2eeFiles.CHUNK_BYTES.toLong(), "failed", "application/octet-stream", f::current) { chunks++; if (!tag) f.live = false } }
            assertEquals(if (tag) "SYNTHETIC_FINAL_TAG_FAILURE" else "E2EE_ACCOUNT_CHANGED", error.message); assertEquals(1, chunks)
        }
    }
}
