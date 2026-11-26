package ru.genesis.calendar.security

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

class E2eeFileManifestPreflightTest {
    private fun fixture(name: String) = JSONObject(javaClass.getResource("/e2ee/$name")!!.readText())
    private fun rejects(body: () -> Unit) { try { body() } catch (error: IllegalStateException) { assertEquals("E2EE_CORRUPT_FILE", error.message); return }; fail("Invalid private manifest accepted") }
    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    @Test fun sharedStrictSyntaxCorpusAndBounds() {
        val vectors = fixture("file-manifest-json-v1.json"); val valid = vectors.getJSONArray("valid")
        for (index in 0 until valid.length()) E2eeFileManifestJson.read(valid.getJSONObject(index).getString("text").toByteArray(Charsets.UTF_8))
        val invalid = vectors.getJSONArray("invalid")
        for (index in 0 until invalid.length()) { val row = invalid.getJSONObject(index); rejects { E2eeFileManifestJson.read(if (row.has("hex")) hex(row.getString("hex")) else row.getString("text").toByteArray(Charsets.UTF_8)) } }
        rejects { E2eeFileManifestJson.read(("{\"x\":" + "[".repeat(17) + "0" + "]".repeat(17) + "}").toByteArray()) }
        rejects { E2eeFileManifestJson.read(ByteArray(256 * 1024 + 1) { 32 }) }
        rejects { E2eeFileManifestJson.read(("{\"x\":\"" + "a".repeat(513) + "\"}").toByteArray()) }
        rejects { E2eeFileManifestJson.read(("{\"x\":" + "1".repeat(33) + "}").toByteArray()) }
        val units = E2eeFileManifestJson.read("{\"name\":\"\\ud800😀\\ufeff\"}".toByteArray()).getString("name")
        assertEquals('\uD800', units[0]); assertEquals('\uFEFF', units.last())
    }
    @Test fun malformedLaterDescriptorCannotReachFetchOrPlatformStringCoercion() {
        val original = fixture("v1.json"); val root = E2eeEnvelope.importRoot(E2eeEnvelope.decode(original.getString("rootKey"), 32))
        val signing = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(E2eeEnvelope.decode(original.getString("privateKeyPkcs8"), 1, 8192)))
        val signer = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(original.getString("publicKeySpki"), 1, 8192)))
        val context = E2eeEnvelope.Context.fromJson(original.getJSONObject("envelope").getJSONObject("context")); val hash = E2eeEnvelope.encode(ByteArray(32))
        for (mode in listOf("id-type", "operation-type", "hash", "duplicate", "index", "size")) {
            val first = JSONObject().put("objectId", "first-part").put("operationId", "first-operation").put("index", 0).put("size", E2eeFiles.CHUNK_BYTES).put("hash", hash)
            val bad = JSONObject().put("objectId", "second-part").put("operationId", "second-operation").put("index", 1).put("size", 1).put("hash", hash)
            when (mode) { "id-type" -> bad.put("objectId", 42); "operation-type" -> bad.put("operationId", 42); "hash" -> bad.put("hash", "invalid"); "duplicate" -> bad.put("objectId", "first-part"); "index" -> bad.put("index", 0); else -> bad.put("size", 2) }
            val value = JSONObject().put("protocol", 1).put("fileKey", hash).put("size", E2eeFiles.CHUNK_BYTES + 1).put("chunkSize", E2eeFiles.CHUNK_BYTES)
                .put("filename", "private").put("mediaType", "application/octet-stream").put("chunks", JSONArray().put(first).put(bad))
            val bytes = value.toString().toByteArray(); val packet = try { E2eeEnvelope.seal(root, signing, context, bytes) } finally { bytes.fill(0) }; var calls = 0
            rejects { E2eeFiles.open(root, signer, context, packet) { calls++; error("UNEXPECTED_PRIVATE_IO") } }; assertEquals(mode, 0, calls)
            var outputs=0;rejects{E2eeFiles.openStream(root,signer,context,packet,{calls++;error("UNEXPECTED_PRIVATE_IO")},{},{outputs++})};assertEquals(mode,0,calls);assertEquals(mode,0,outputs)
        }
    }
}
