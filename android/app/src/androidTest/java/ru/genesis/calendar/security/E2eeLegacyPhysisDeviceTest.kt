package ru.genesis.calendar.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Base64

/** Actual platform/provider checks on public WebCrypto fixtures. This is not
 * packaged-source or product migration acceptance and uses no personal data. */
@RunWith(AndroidJUnit4::class)
class E2eeLegacyPhysisDeviceTest {
    private val fixture by lazy {
        InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/physis-legacy.json")
            .bufferedReader().use { JSONObject(it.readText()) }
    }
    private val owner get() = fixture.getString("ownerId")
    private fun independent(index: Int = 0) = fixture.getJSONArray("independent").getJSONObject(index)
    private fun bytes(value: String) = Base64.getDecoder().decode(value)
    private suspend fun rejected(operation: suspend () -> Unit) {
        try { operation() } catch (error: Exception) { assertTrue(error.message?.startsWith("E2EE_") == true); return }
        fail("Invalid public synthetic Physis source was accepted on device")
    }
    @Test fun actualWebCryptoPasswordAndRecoveryOpenOnJcaIncludingUnpairedUtf16() = runBlocking {
        for (index in 0 until fixture.getJSONArray("independent").length()) {
            val f = independent(index); val original = f.toString()
            for (method in listOf("password", "recovery")) E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), method, f.getString(method).toCharArray(), {}).use {
                assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
                assertEquals("E2eeLegacyPhysis.Reader([redacted])", it.toString())
            }
            assertEquals(original, f.toString())
        }
    }
    @Test fun actualWebCryptoAccountWrapperRejectsWrongKeyAndLateOwnerChange() = runBlocking {
        val f = fixture.getJSONObject("account"); val original = f.toString(); val raw = bytes(f.getString("oldKey")); var live = true
        try {
            rejected { E2eeLegacyPhysis.unlockAccount(owner, f.getJSONObject("vault"), ByteArray(32) { 17 }, {}) }
            E2eeLegacyPhysis.unlockAccount(owner, f.getJSONObject("vault"), raw, { check(live) { "E2EE_ACCOUNT_CHANGED" } }).use {
                assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
                live = false; rejected { it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")) }
                live = true; rejected { it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")) }
            }
            assertEquals(original, f.toString())
        } finally { raw.fill(0) }
    }
    @Test fun wrongEpochTamperedCipherAndNoncanonicalRecoveryNeverOpenOrAlterOriginal() = runBlocking {
        val f = independent(); val original = f.toString(); val code = f.getString("recovery"); val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val wrong = code.dropLast(1) + alphabet[alphabet.indexOf(code.last()) or 1]
        rejected { E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", wrong.toCharArray(), {}) }
        E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", ("\uFEFF" + code + "\u00A0").toCharArray(), {}).use {
            rejected { it.readRecord("other-owner", f.getString("id"), f.getJSONObject("envelope")) }
            rejected { it.readRecord(owner, f.getString("id"), JSONObject(f.getJSONObject("envelope").toString()).put("keyVersion", 8)) }
            val envelope = JSONObject(f.getJSONObject("envelope").toString()); val raw = bytes(envelope.getString("ciphertext")); raw[0] = (raw[0].toInt() xor 1).toByte()
            envelope.put("ciphertext", Base64.getEncoder().encodeToString(raw)); raw.fill(0)
            rejected { it.readRecord(owner, f.getString("id"), envelope) }
            assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
        }
        assertEquals(original, f.toString())
    }
    @Test fun fullLegacyRecordLimitAndOriginalDuplicateTextArePreservedForTheSharedParser() = runBlocking {
        val f = independent(); val raw = bytes(f.getString("recordKey"))
        fun seal(value: ByteArray): JSONObject {
            val packet = WorkspaceCipher.encrypt(value, raw, "genesis:physis:v1:$owner:${f.getString("id")}:1:7".toByteArray())
            return JSONObject().put("version", 1).put("schemaVersion", 1).put("keyVersion", 7).put("iv", packet.iv).put("ciphertext", packet.ciphertext)
        }
        try {
            E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", f.getString("recovery").toCharArray(), {}).use {
                val plain = "\"" + "x".repeat(E2eeLegacyPhysis.MAX_PLAIN - 2) + "\""; val packet = seal(plain.toByteArray())
                assertEquals(plain, it.readRecord(owner, f.getString("id"), packet))
                val duplicate = "{\"note\":1,\"n\\u006fte\":2}"
                assertEquals(duplicate, it.readRecord(owner, f.getString("id"), seal(duplicate.toByteArray())))
                rejected { it.readRecord(owner, f.getString("id"), seal(byteArrayOf(0xff.toByte(), 0xfe.toByte()))) }
                rejected { it.readRecord(owner, f.getString("id"), JSONObject(packet.toString()).put("ciphertext", Base64.getEncoder().encodeToString(ByteArray(E2eeLegacyPhysis.MAX_CIPHER + 1)))) }
            }
        } finally { raw.fill(0) }
    }
}
