package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

class E2eeFileStreamTest {
    private class Fixture {
        val original = JSONObject(javaClass.getResource("/e2ee/v1.json")!!.readText())
        val root = E2eeEnvelope.importRoot(E2eeEnvelope.decode(original.getString("rootKey"), 32))
        val signing = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(E2eeEnvelope.decode(original.getString("privateKeyPkcs8"), 1, 8192)))
        val signer = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(original.getString("publicKeySpki"), 1, 8192)))
        val context = E2eeEnvelope.Context.fromJson(original.getJSONObject("envelope").getJSONObject("context"))
        val chunks = mutableMapOf<String, E2eeEnvelope.Envelope>()
        var live = true
        fun current() { check(live) { "E2EE_ACCOUNT_CHANGED" } }
        fun write(chunk: E2eeEnvelope.Envelope) { chunks[chunk.context.toJson().getString("objectId")] = chunk }
    }
    private fun refuses(code: String, body: () -> Unit) {
        try { body() } catch (error: Exception) { assertTrue("Expected $code, got ${error.message}", error.message.orEmpty().contains(code)); return }; fail("Invalid stream produced a file manifest")
    }
    @Test fun boundedReadsProduceTheExistingFormatAndPreserveAllFilenameUnits() {
        val f = Fixture(); val original = ByteArray(E2eeFiles.CHUNK_BYTES * 2 + 37) { (it * 31).toByte() }; var closed = false
        val input = object : ByteArrayInputStream(original) {
            override fun read(target: ByteArray, offset: Int, length: Int) = super.read(target, offset, minOf(length, 8179))
            override fun close() { closed = true; super.close() }
        }
        val name = "\uFEFForiginal\uD800😀.bin"
        val manifest = E2eeFiles.sealStream(f.root, f.signing, f.context, input, original.size.toLong(), name, "application/octet-stream", f::current, f::write)
        assertFalse(closed); assertEquals(3, f.chunks.size)
        val opened = E2eeFiles.open(f.root, f.signer, f.context, manifest) { f.chunks.getValue(it) }
        assertArrayEquals(original, opened.bytes); assertEquals(name, opened.filename); original.fill(0); opened.bytes.fill(0); input.close()
    }
    @Test fun emptyFileReadsActualEofAndNeedsNoImplicitChunk() {
        val f = Fixture(); var calls = 0
        val input = object : ByteArrayInputStream(byteArrayOf()) {
            override fun read(target: ByteArray, offset: Int, length: Int): Int { calls++; return super.read(target, offset, length) }
        }
        val manifest = E2eeFiles.sealStream(f.root, f.signing, f.context, input, 0, "empty", "application/octet-stream", f::current, f::write)
        assertEquals(1, calls); assertTrue(f.chunks.isEmpty()); assertEquals(0, E2eeFiles.open(f.root, f.signer, f.context, manifest) { error("No implicit chunk") }.bytes.size)
    }
    @Test fun lateTagFailureDoesNotPublishAManifestForTheDeclaredByteCount() {
        val f = Fixture(); val input = object : ByteArrayInputStream(ByteArray(E2eeFiles.CHUNK_BYTES) { 17 }) {
            override fun read(target: ByteArray, offset: Int, length: Int): Int { val count = super.read(target, offset, length); if (count == -1) error("SYNTHETIC_FINAL_TAG_FAILURE"); return count }
        }
        refuses("FINAL_TAG_FAILURE") { E2eeFiles.sealStream(f.root, f.signing, f.context, input, E2eeFiles.CHUNK_BYTES.toLong(), "late", "application/octet-stream", f::current, f::write) }
        assertEquals(1, f.chunks.size)
    }
    @Test fun invalidCountsTruncationStorageFailureAndRetirementRefuse() {
        for (mode in listOf("short", "long", "zero-read", "space", "actor")) {
            val f = Fixture(); val bytes = ByteArray(E2eeFiles.CHUNK_BYTES + if (mode == "long") 2 else 0) { 19 }
            val input = object : ByteArrayInputStream(bytes) {
                override fun read(target: ByteArray, offset: Int, length: Int) = if (mode == "zero-read") 0 else super.read(target, offset, length)
            }
            val code = when (mode) { "space" -> "DISK_FULL"; "actor" -> "ACCOUNT_CHANGED"; else -> "INVALID_FILE_STREAM" }
            refuses(code) { E2eeFiles.sealStream(f.root, f.signing, f.context, input, (E2eeFiles.CHUNK_BYTES + 1).toLong(), "bad", "application/octet-stream", f::current) { chunk ->
                if (mode == "space") error("SYNTHETIC_DISK_FULL"); f.write(chunk); if (mode == "actor") f.live = false
            } }
            assertTrue(f.chunks.size <= 1); bytes.fill(0)
        }
    }
    @Test fun nativeExistingReaderOpensThePublicWebStreamingVector() {
        val f = Fixture(); val vector = JSONObject(javaClass.getResource("/e2ee/file-stream-web-v1.json")!!.readText())
        val chunks = vector.getJSONArray("chunks"); val map = (0 until chunks.length()).map { E2eeEnvelope.Envelope.fromJson(chunks.getJSONObject(it)) }.associateBy { it.context.toJson().getString("objectId") }
        val opened = E2eeFiles.open(f.root, f.signer, f.context, E2eeEnvelope.Envelope.fromJson(vector.getJSONObject("manifest"))) { map.getValue(it) }
        assertArrayEquals(E2eeEnvelope.decode(vector.getString("plaintext"), 1, 1024), opened.bytes)
        val units = vector.getJSONArray("filenameUnits"); assertEquals(units.length(), opened.filename.length)
        for (index in opened.filename.indices) assertEquals(units.getInt(index), opened.filename[index].code)
        opened.bytes.fill(0)
    }
}
