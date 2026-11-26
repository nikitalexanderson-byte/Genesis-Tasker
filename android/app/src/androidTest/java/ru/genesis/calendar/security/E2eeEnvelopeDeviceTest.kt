package ru.genesis.calendar.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher

/** Platform/provider coverage, including API26; isolated public synthetic fixtures only. */
@RunWith(AndroidJUnit4::class)
class E2eeEnvelopeDeviceTest {
    private val fixture by lazy {
        InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/v1.json")
            .bufferedReader().use { JSONObject(it.readText()) }
    }
    private fun bytes(name: String) = E2eeEnvelope.decode(fixture.getString(name), 1, 8192)
    private fun peer() = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes("publicKeySpki")))
    private fun packet() = E2eeEnvelope.Envelope.fromJson(fixture.getJSONObject("envelope"))

    @Test fun platformReadsIndependentVectorAndSealsWithFreshDataKeys() {
        val original = packet(); val root = E2eeEnvelope.importRoot(bytes("rootKey"))
        val signer = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(bytes("privateKeyPkcs8")))
        assertEquals(fixture.getString("aad"), E2eeEnvelope.encode(original.context.additionalData()))
        assertArrayEquals(bytes("plaintext"), E2eeEnvelope.open(root, peer(), original.context, original))
        val a = E2eeEnvelope.seal(root, signer, original.context, bytes("plaintext"))
        val b = E2eeEnvelope.seal(root, signer, original.context, bytes("plaintext"))
        assertNotEquals(a.wrappedKey, b.wrappedKey)
        assertNotEquals(a.nonce, b.nonce)
        assertArrayEquals(bytes("plaintext"), E2eeEnvelope.open(root, peer(), original.context, a))
        println("Synthetic E2EE platform providers: AESWrap=${Cipher.getInstance("AESWrap").provider.name}, GCM=${Cipher.getInstance("AES/GCM/NoPadding").provider.name}")
    }

    @Test fun platformRejectsWrongRootTamperAndUnexpectedOwnerWithoutReplacingAnything() {
        val original = packet()
        fun reject(code: String, action: () -> Unit) {
            try { action() } catch (error: GeneralSecurityException) { assertEquals(code, error.message); return }
            fail("Invalid synthetic envelope accepted")
        }
        reject("E2EE_CORRUPT_ENVELOPE") {
            E2eeEnvelope.open(E2eeEnvelope.importRoot(ByteArray(32) { 111 }), peer(), original.context, original)
        }
        val expected = E2eeEnvelope.Context.fromJson(original.context.toJson().put("ownerId", "other-owner"))
        reject("E2EE_CONTEXT_MISMATCH") { E2eeEnvelope.open(E2eeEnvelope.importRoot(bytes("rootKey")), peer(), expected, original) }
        val signature = E2eeEnvelope.decode(original.signature, 64); signature[0] = (signature[0].toInt() xor 1).toByte()
        val tampered = E2eeEnvelope.Envelope.fromJson(original.toJson().put("signature", E2eeEnvelope.encode(signature)))
        reject("E2EE_CORRUPT_ENVELOPE") {
            E2eeEnvelope.open(E2eeEnvelope.importRoot(bytes("rootKey")), peer(), original.context, tampered)
        }
    }
}
