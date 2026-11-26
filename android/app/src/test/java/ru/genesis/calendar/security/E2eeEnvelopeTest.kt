package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

class E2eeEnvelopeTest {
    private val fixture: JSONObject by lazy {
        val path = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "tests/fixtures/e2ee/v1.json") }.first { it.isFile }
        JSONObject(path.readText())
    }
    private fun packet() = E2eeEnvelope.Envelope.fromJson(fixture.getJSONObject("envelope"))
    private fun context() = packet().context
    private fun bytes(name: String) = E2eeEnvelope.decode(fixture.getString(name), 1, 8192)
    private fun root() = E2eeEnvelope.importRoot(bytes("rootKey"))
    private fun peer() = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes("publicKeySpki")))
    private fun signer() = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(bytes("privateKeyPkcs8")))
    private fun reject(code: String, operation: () -> Unit) {
        try { operation() } catch (error: Exception) {
            if (error !is GeneralSecurityException && error !is IllegalArgumentException) throw error
            assertEquals(code, error.message)
            return
        }
        fail("Invalid synthetic E2EE input was accepted")
    }

    @Test fun independentVectorAndLargeIntegers() {
        assertEquals(fixture.getString("aad"), E2eeEnvelope.encode(context().additionalData()))
        val max = E2eeEnvelope.Context.fromJson(context().toJson().put("revision", 9007199254740991L))
        assertEquals(fixture.getString("maxIntegerAad"), E2eeEnvelope.encode(max.additionalData()))
        assertArrayEquals(bytes("plaintext"), E2eeEnvelope.open(root(), peer(), context(), packet()))
    }

    @Test fun freshKeysAndRoundtripIncludingEmptyContent() {
        val root = root(); val signer = signer(); val peer = peer(); val context = context()
        val packets = (0..31).map { E2eeEnvelope.seal(root, signer, context, bytes("plaintext")) }
        assertEquals(32, packets.map { it.wrappedKey }.toSet().size)
        assertEquals(32, packets.map { it.nonce }.toSet().size)
        packets.forEach { assertArrayEquals(bytes("plaintext"), E2eeEnvelope.open(root, peer, context, it)) }
        // Opt-in SYNTHETIC interoperability evidence for JS/PHP. Never writes user key material.
        System.getenv("GENESIS_E2EE_VECTOR_OUTPUT")?.let { path ->
            val output = File(path)
            require(output.isAbsolute && output.name == "kotlin-envelope.json")
            output.parentFile.mkdirs()
            output.writeText(JSONObject().put("warning", "PUBLIC SYNTHETIC FIXTURE; NEVER USE FOR USER DATA")
                .put("origin", "JCA ${System.getProperty("java.version")}")
                .put("rootFixture", "v1.json").put("envelope", packets.first().toJson()).toString(2) + "\n")
        }
        val empty = E2eeEnvelope.seal(root, signer, context, byteArrayOf())
        assertEquals(0, E2eeEnvelope.open(root, peer, context, empty).size)
    }

    @Test fun jsonNumberSpellingsHaveIdenticalCanonicalSemantics() {
        val serialized = packet().toJson().toString()
        for (spelling in listOf("7.0", "7e0")) {
            val source = JSONObject(serialized.replace("\"revision\":7", "\"revision\":$spelling"))
            val parsed = E2eeEnvelope.Envelope.fromJson(source)
            assertArrayEquals(context().additionalData(), parsed.context.additionalData())
            E2eeEnvelope.verify(parsed, context(), peer())
        }
        for ((spelling, expected) in listOf("1" to 1L, "1.0" to 1L, "1e0" to 1L,
            "9007199254740991" to 9007199254740991L, "9007199254740990.5" to 9007199254740990L)) {
            val source = JSONObject(serialized.replace("\"revision\":7", "\"revision\":$spelling"))
            val parsed = E2eeEnvelope.Envelope.fromJson(source)
            val canonical = E2eeEnvelope.Context.fromJson(context().toJson().put("revision", expected))
            assertArrayEquals(canonical.additionalData(), parsed.context.additionalData())
        }
        for (spelling in listOf("9007199254740992", "-0.0", "1.5")) {
            reject("E2EE_INVALID_ENVELOPE") {
                E2eeEnvelope.Envelope.fromJson(JSONObject(serialized.replace("\"revision\":7", "\"revision\":$spelling")))
            }
        }
    }

    @Test fun contextBindingAndSnapshot() {
        val original = context().toJson()
        val captured = E2eeEnvelope.Context.fromJson(original)
        original.put("ownerId", "other-owner")
        assertEquals(fixture.getString("aad"), E2eeEnvelope.encode(captured.additionalData()))
        for (field in listOf("ownerId", "scopeId", "domain", "objectId", "schemaVersion", "dataGeneration", "cryptoEpoch",
            "securityEpoch", "revision", "keyId", "deviceId", "operationId")) {
            val changed = context().toJson()
            val value = changed.get(field)
            changed.put(field, if (value is Number) value.toLong() + 1 else if (field == "domain") "diary" else "changed-id")
            val expected = E2eeEnvelope.Context.fromJson(changed)
            reject("E2EE_CONTEXT_MISMATCH") { E2eeEnvelope.open(root(), peer(), expected, packet()) }
            val changedPacket = E2eeEnvelope.Envelope.fromJson(packet().toJson().put("context", changed))
            reject("E2EE_CORRUPT_ENVELOPE") { E2eeEnvelope.verify(changedPacket, expected, peer()) }
        }
    }

    @Test fun tamperingWrongKeysAndNoFallback() {
        for (field in listOf("wrappedKey", "nonce", "ciphertext", "signature")) {
            val json = packet().toJson()
            val changed = E2eeEnvelope.decode(json.getString(field), 1, 8192)
            changed[0] = (changed[0].toInt() xor 1).toByte()
            val packet = E2eeEnvelope.Envelope.fromJson(json.put(field, E2eeEnvelope.encode(changed)))
            reject("E2EE_CORRUPT_ENVELOPE") { E2eeEnvelope.open(root(), peer(), context(), packet) }
        }
        reject("E2EE_CORRUPT_ENVELOPE") {
            E2eeEnvelope.open(E2eeEnvelope.importRoot(ByteArray(32) { 111 }), peer(), context(), packet())
        }
        val wrong = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        reject("E2EE_CORRUPT_ENVELOPE") { E2eeEnvelope.open(root(), wrong.public, context(), packet()) }
        val wrongCurve = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp384r1")) }.generateKeyPair()
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.verify(packet(), context(), wrongCurve.public) }
    }

    @Test fun strictTypesLimitsAndBase64() {
        for (value in listOf(0, -1, 1.5, 9007199254740992L, "7", true, JSONObject.NULL)) {
            reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.Context.fromJson(context().toJson().put("revision", value)) }
        }
        for ((name, value) in listOf("suite" to "unknown", "cryptoProtocol" to 2, "writerProtocol" to 10,
            "domain" to "billing", "ownerId" to "bad\n", "objectId" to "Секретное название", "keyId" to "a".repeat(129))) {
            reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.Context.fromJson(context().toJson().put(name, value)) }
        }
        for (field in listOf("wrappedKey", "nonce", "ciphertext", "signature")) {
            for (value in listOf(JSONObject.NULL, 123, true, "", "!", packet().toJson().getString(field) + "=")) {
                reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.Envelope.fromJson(packet().toJson().put(field, value)) }
            }
        }
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.Context.fromJson(context().toJson().put("extra", 1)) }
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.Envelope.fromJson(packet().toJson().put("rawKey", "forbidden")) }
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.decode("AB", 1) }
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.importRoot(ByteArray(31)) }
        reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.seal(root(), signer(), context(), ByteArray(E2eeEnvelope.MAX_PLAINTEXT + 1)) }
        assertFalse(packet().toString().contains(packet().ciphertext))
        assertFalse(context().toString().contains("synthetic-owner"))
    }

    @Test fun strictSignatureEncodingRoundtripAndMalformedDer() {
        for (leading in listOf(0, 1, 127, 128, 255)) {
            val raw = ByteArray(64) { leading.toByte() }
            assertArrayEquals(raw, E2eeEnvelope.derToP1363(E2eeEnvelope.p1363ToDer(raw)))
        }
        for (bad in listOf(byteArrayOf(), byteArrayOf(0x30, 0), ByteArray(73),
            byteArrayOf(0x30, 6, 2, 1, -1, 2, 1, 1), byteArrayOf(0x30, 7, 2, 2, 0, 1, 2, 1, 1))) {
            reject("E2EE_INVALID_ENVELOPE") { E2eeEnvelope.derToP1363(bad) }
        }
    }
}
