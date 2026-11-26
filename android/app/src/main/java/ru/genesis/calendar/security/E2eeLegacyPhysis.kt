package ru.genesis.calendar.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.KeyParameter
import org.json.JSONException
import org.json.JSONObject
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.GeneralSecurityException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Read-only conversion of the two original Physis vault formats. Raw retained
 * JSON must pass the shared duplicate-name parser before this typed boundary;
 * JSONObject alone is not that validation. No key is exported to JavaScript.
 * This primitive is not a source adapter or a product unlock/bootstrap path. */
internal object E2eeLegacyPhysis {
    const val MAX_CIPHER = 256 * 1024
    const val MAX_PLAIN = MAX_CIPHER - 16
    private const val ITERATIONS = 600000
    private val uuid = Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    private val standardBase64 = Regex("[A-Za-z0-9+/]*={0,2}")
    private fun invalid(): Nothing = error("E2EE_PHYSIS_SOURCE_INVALID")
    private fun exact(value: JSONObject, fields: Set<String>) {
        if (value.keys().asSequence().toSet() != fields) invalid()
    }
    private fun integer(value: Any): Long = E2eeCommands.integer(value, 1)
    private fun decode(value: Any, min: Int, max: Int = min): ByteArray {
        val text = value as? String ?: invalid()
        if (text.length > 4 * ((max + 2) / 3) || !standardBase64.matches(text)) invalid()
        val raw = try { Base64.getDecoder().decode(text) } catch (_: IllegalArgumentException) { invalid() }
        if (raw.size !in min..max || Base64.getEncoder().encodeToString(raw) != text) {
            raw.fill(0); invalid()
        }
        return raw
    }
    private fun text(value: JSONObject, key: String): String = value.get(key) as? String ?: invalid()
    private class Wrapped(val iv: String, val ciphertext: String) {
        override fun toString() = "E2eeLegacyPhysis.Wrapped([redacted])"
    }
    private class Vault(val version: Long, val keyVersion: Long, val password: Wrapped?,
        val recovery: Wrapped?, val salt: String?, val account: Wrapped?) {
        override fun toString() = "E2eeLegacyPhysis.Vault([redacted])"
    }
    private fun wrapped(value: JSONObject, size: Int): Wrapped {
        exact(value, setOf("iv", "ciphertext"))
        val iv = text(value, "iv"); val ciphertext = text(value, "ciphertext")
        decode(iv, 12).fill(0); decode(ciphertext, size).fill(0)
        return Wrapped(iv, ciphertext)
    }
    private inline fun <T> typed(action: () -> T): T = try { action() }
        catch (_: JSONException) { invalid() }
        catch (_: CharacterCodingException) { invalid() }
    private fun vault(input: JSONObject): Vault = typed {
        val version = integer(input.get("version")); val keyVersion = integer(input.get("keyVersion"))
        when (version) {
            1L -> {
                exact(input, setOf("version", "keyVersion", "password", "recovery"))
                val password = input.getJSONObject("password")
                exact(password, setOf("iv", "ciphertext", "salt", "iterations"))
                if (integer(password.get("iterations")) != ITERATIONS.toLong()) invalid()
                val salt = text(password, "salt"); decode(salt, 16).fill(0)
                Vault(version, keyVersion, wrapped(JSONObject().put("iv", password.get("iv"))
                    .put("ciphertext", password.get("ciphertext")), 48), wrapped(input.getJSONObject("recovery"), 48), salt, null)
            }
            2L -> {
                exact(input, setOf("version", "keyVersion", "account"))
                Vault(version, keyVersion, null, null, null, wrapped(input.getJSONObject("account"), 62))
            }
            else -> error("E2EE_PHYSIS_FORMAT_UNSUPPORTED")
        }
    }
    private fun aad(ownerId: String, id: String, keyVersion: Long) =
        "genesis:physis:v1:$ownerId:$id:1:$keyVersion".toByteArray(Charsets.UTF_8)
    private fun decrypt(key: ByteArray, packet: Wrapped, additionalData: ByteArray, maximum: Int): ByteArray {
        val iv = decode(packet.iv, 12); val ciphertext = decode(packet.ciphertext, 16, maximum)
        return try {
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                updateAAD(additionalData); doFinal(ciphertext)
            }
        } finally { iv.fill(0); ciphertext.fill(0); additionalData.fill(0) }
    }
    /** Match WebCrypto TextEncoder, including U+FFFD for unpaired UTF-16. The
     * platform String.toByteArray fallback uses '?' on some runtimes. */
    private fun passwordBytes(value: CharArray): ByteArray {
        val encoded = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE).replaceWith(byteArrayOf(0xef.toByte(), 0xbf.toByte(), 0xbd.toByte()))
            .encode(CharBuffer.wrap(value))
        return try { ByteArray(encoded.remaining()).also(encoded::get) }
        finally { if (encoded.hasArray()) encoded.array().fill(0) }
    }
    private fun passwordKey(value: CharArray, salt: String): ByteArray {
        val raw = passwordBytes(value); val decodedSalt = decode(salt, 16)
        return try {
            val generator = PKCS5S2ParametersGenerator(SHA256Digest())
            try { generator.init(raw, decodedSalt, ITERATIONS); (generator.generateDerivedParameters(256) as KeyParameter).key }
            finally { generator.init(ByteArray(0), ByteArray(0), 1) }
        } finally { raw.fill(0); decodedSalt.fill(0) }
    }
    private fun jsWhitespace(char: Char) = when (char.code) {
        in 0x09..0x0d, 0x20, 0xa0, 0x1680, in 0x2000..0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff -> true
        else -> false
    }
    private fun recoveryKey(value: CharArray): ByteArray {
        val secret = value.concatToString().trim(::jsWhitespace)
        if (!Regex("PHY1-[A-Za-z0-9_-]{43}").matches(secret)) invalid()
        return decode(secret.substring(5).replace('-', '+').replace('_', '/') + "=", 32)
    }
    /** A borrowed CharArray is copied before suspension; only this copy is
     * consumed/wiped. PBKDF2 runs off the main thread. No account fallback. */
    suspend fun unlockIndependent(ownerId: String, input: JSONObject, method: String, credential: CharArray,
        assertCurrent: () -> Unit): Reader {
        E2eeKeys.technical(ownerId); assertCurrent(); val original = vault(input)
        check(original.version == 1L) { "E2EE_PHYSIS_UNLOCK_REQUIRED" }
        if (method !in setOf("password", "recovery") || credential.size !in 1..1024) invalid()
        val secret = credential.copyOf(); var raw: ByteArray? = null
        try {
            withContext(Dispatchers.Default) {
                assertCurrent(); val key = if (method == "password") passwordKey(secret, requireNotNull(original.salt)) else recoveryKey(secret)
                try {
                    raw = try { decrypt(key, requireNotNull(if (method == "password") original.password else original.recovery),
                        aad(ownerId, "vault:$method", original.keyVersion), 48) }
                    catch (_: GeneralSecurityException) { assertCurrent(); error("E2EE_PHYSIS_UNLOCK_REQUIRED") }
                } finally { key.fill(0) }
            }
            assertCurrent(); val opened = requireNotNull(raw); if (opened.size != 32) invalid()
            return Reader(ownerId, original.keyVersion, opened, assertCurrent).also { raw = null }
        } finally { secret.fill('\u0000'); raw?.fill(0) }
    }
    /** Only the captured original account wrapper is opened. Its original
     * WebCrypto payload is exactly a quoted canonical base64-encoded 32-byte DEK. */
    fun unlockAccount(ownerId: String, input: JSONObject, oldAccountKey: ByteArray, assertCurrent: () -> Unit): Reader = typed {
        E2eeKeys.technical(ownerId); assertCurrent(); val original = vault(input)
        check(original.version == 2L) { "E2EE_PHYSIS_UNLOCK_REQUIRED" }; if (oldAccountKey.size != 32) invalid()
        val accountKey = oldAccountKey.copyOf(); var plain: ByteArray? = null; var raw: ByteArray? = null
        try {
            plain = try { decrypt(accountKey, requireNotNull(original.account),
                "genesis-mindmap-v1:$ownerId:physis-vault:v2:${original.keyVersion}".toByteArray(Charsets.UTF_8), 62) }
            catch (_: GeneralSecurityException) { assertCurrent(); error("E2EE_PHYSIS_UNLOCK_REQUIRED") }
            assertCurrent()
            if (plain.size != 46 || plain.first() != 34.toByte() || plain.last() != 34.toByte()) invalid()
            val encoded = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(plain, 1, 44)).toString()
            raw = decode(encoded, 32); assertCurrent()
            Reader(ownerId, original.keyVersion, raw, assertCurrent).also { raw = null }
        } finally { accountKey.fill(0); plain?.fill(0); raw?.fill(0) }
    }

    class Reader internal constructor(private val ownerId: String, private val keyVersion: Long,
        private val raw: ByteArray, private val assertCurrent: () -> Unit): Closeable {
        private var closed = false
        private fun current() {
            check(!closed) { "E2EE_PHYSIS_UNLOCK_REQUIRED" }
            try { assertCurrent() } catch (error: Throwable) { close(); throw error }
            check(!closed) { "E2EE_PHYSIS_UNLOCK_REQUIRED" }
        }
        /** Return original UTF-8 text, not JSONObject: the common strict parser
         * must still reject duplicate names and validate the category schema. */
        @Synchronized fun readRecord(ownerId: String, id: String, input: JSONObject): String = typed {
            current(); check(ownerId == this.ownerId) { "E2EE_SCOPE_BINDING_MISMATCH" }
            if (!uuid.matches(id)) invalid()
            exact(input, setOf("version", "schemaVersion", "keyVersion", "iv", "ciphertext"))
            if (integer(input.get("version")) != 1L || integer(input.get("schemaVersion")) != 1L) error("E2EE_PHYSIS_FORMAT_UNSUPPORTED")
            if (integer(input.get("keyVersion")) != keyVersion) invalid()
            val packet = Wrapped(text(input, "iv"), text(input, "ciphertext")); var plain: ByteArray? = null
            try {
                plain = try { decrypt(raw, packet, aad(ownerId, id, keyVersion), MAX_CIPHER) }
                catch (_: GeneralSecurityException) { current(); error("E2EE_LEGACY_PHYSIS_CORRUPT") }
                current(); if (plain.size > MAX_PLAIN) invalid()
                val original = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(plain)).toString()
                current(); original
            } finally { plain?.fill(0) }
        }
        @Synchronized override fun close() { if (!closed) { closed = true; raw.fill(0) } }
        override fun toString() = "E2eeLegacyPhysis.Reader([redacted])"
    }
}
