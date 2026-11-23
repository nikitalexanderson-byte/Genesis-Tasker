package ru.genesis.calendar.security

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.math.BigDecimal
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.floor

/** Inactive 3.3.6 contract. Does not grant device trust or change legacy sync/storage. */
object E2eeEnvelope {
    const val SUITE = "A256KW-A256GCM-ES256"
    const val MAX_PLAINTEXT = 4 * 1024 * 1024
    private const val MAX_INTEGER = 9007199254740991L
    private val random = SecureRandom()
    private val fields = listOf("cryptoProtocol", "suite", "ownerId", "scopeId", "domain", "objectId", "schemaVersion",
        "dataGeneration", "writerProtocol", "cryptoEpoch", "securityEpoch", "revision", "keyId", "deviceId", "operationId")
    private val numbers = setOf("cryptoProtocol", "schemaVersion", "dataGeneration", "writerProtocol", "cryptoEpoch", "securityEpoch", "revision")
    private val domains = setOf("workspace", "diary", "dream-journal", "mindmap", "physis", "aurora", "stoicheion",
        "shared-project", "shared-comment", "attachment", "local-snapshot", "outbox", "draft", "key-check")
    fun supportsDomain(domain: String): Boolean = domain in domains
    private val identifier = Regex("[A-Za-z0-9][A-Za-z0-9._:@/\\-]{0,127}")
    private val base64Url = Regex("[A-Za-z0-9_\\-]+")
    private val aadPrefix = "GENESIS-E2EE-AAD\u0000v1\u0000".toByteArray(Charsets.UTF_8)
    private val signaturePrefix = "GENESIS-E2EE-SIGNATURE\u0000v1\u0000".toByteArray(Charsets.UTF_8)
    private val p256: ECParameterSpec by lazy {
        AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
    }
    private fun invalid(): Nothing = throw IllegalArgumentException("E2EE_INVALID_ENVELOPE")
    private fun corrupt(): Nothing = throw GeneralSecurityException("E2EE_CORRUPT_ENVELOPE")

    class Context private constructor(private val values: Map<String, Any>) {
        fun toJson(): JSONObject = JSONObject(values)
        override fun toString() = "E2eeEnvelope.Context([redacted])"

        fun additionalData(): ByteArray {
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { output ->
                output.write(aadPrefix)
                for (name in fields) {
                    when (val value = values.getValue(name)) {
                        is Long -> output.writeLong(value)
                        is String -> value.toByteArray(Charsets.UTF_8).let { output.writeInt(it.size); output.write(it) }
                        else -> invalid()
                    }
                }
            }
            return bytes.toByteArray()
        }

        companion object {
            fun fromJson(source: JSONObject): Context {
                exactFields(source, fields.toSet())
                val values = fields.associateWith { name ->
                    val item = source.get(name)
                    if (name in numbers) {
                        // Android JSON uses Double; the JVM fixture parser can use BigDecimal.
                        if (item !is Int && item !is Long && item !is Float && item !is Double
                            && item !is BigDecimal && item !is BigInteger) invalid()
                        val numeric = (item as Number).toDouble()
                        if (!numeric.isFinite() || numeric < 1.0 || numeric > MAX_INTEGER.toDouble()
                            || floor(numeric) != numeric) invalid()
                        numeric.toLong()
                    } else {
                        if (item !is String || !identifier.matches(item)) invalid()
                        item
                    }
                }
                if (values["cryptoProtocol"] != 1L || values["suite"] != SUITE || values["writerProtocol"] != 9L
                    || values["domain"] !in domains) invalid()
                return Context(values)
            }
        }
    }

    class Envelope private constructor(val context: Context, val wrappedKey: String, val nonce: String,
        val ciphertext: String, val signature: String) {
        fun toJson() = JSONObject().put("context", context.toJson()).put("wrappedKey", wrappedKey)
            .put("nonce", nonce).put("ciphertext", ciphertext).put("signature", signature)
        override fun toString() = "E2eeEnvelope.Envelope([redacted])"

        companion object {
            fun fromJson(source: JSONObject): Envelope {
                exactFields(source, setOf("context", "wrappedKey", "nonce", "ciphertext", "signature"))
                val context = (source.get("context") as? JSONObject)?.let(Context::fromJson) ?: invalid()
                fun binary(name: String, min: Int, max: Int = min): String {
                    val text = source.get(name) as? String ?: invalid()
                    decode(text, min, max)
                    return text
                }
                return Envelope(context, binary("wrappedKey", 40), binary("nonce", 12),
                    binary("ciphertext", 16, MAX_PLAINTEXT + 16), binary("signature", 64))
            }
        }
    }

    private fun exactFields(source: JSONObject, expected: Set<String>) {
        if (source.keys().asSequence().toSet() != expected) invalid()
    }

    fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun decode(source: String, minimum: Int, maximum: Int = minimum): ByteArray {
        if (source.length < (minimum * 4 + 2) / 3 || source.length > (maximum * 4 + 2) / 3
            || !base64Url.matches(source)) invalid()
        val bytes = try { Base64.getUrlDecoder().decode(source) } catch (_: IllegalArgumentException) { invalid() }
        if (bytes.size !in minimum..maximum || encode(bytes) != source) invalid()
        return bytes
    }

    /** Caller owns lifecycle/unlock. No key is read from or written to persistent storage. */
    fun importRoot(source: ByteArray): SecretKey {
        if (source.size != 32) invalid()
        return SecretKeySpec(source, "AES")
    }

    private fun assertRoot(root: SecretKey) {
        val bytes = root.encoded ?: invalid()
        try { if (root.algorithm != "AES" || bytes.size != 32) invalid() }
        finally { bytes.fill(0) }
    }

    internal fun assertP256(key: Any) {
        val params = (key as? ECKey)?.params ?: invalid()
        if (params.curve != p256.curve || params.generator != p256.generator
            || params.order != p256.order || params.cofactor != p256.cofactor) invalid()
    }

    private fun signatureData(envelope: Envelope): ByteArray = signaturePrefix + envelope.context.additionalData() +
        decode(envelope.wrappedKey, 40) + decode(envelope.nonce, 12) +
        MessageDigest.getInstance("SHA-256").digest(decode(envelope.ciphertext, 16, MAX_PLAINTEXT + 16))

    /** Stable ciphertext identity; ES256 proof bytes are deliberately excluded. */
    fun payloadHash(envelope: Envelope): String = encode(MessageDigest.getInstance("SHA-256").digest(signatureData(envelope)))

    /** Fresh platform CSPRNG DEK for EVERY encryption. Persist/retry the result as a whole. */
    fun seal(root: SecretKey, signingKey: PrivateKey, context: Context, sourcePlaintext: ByteArray): Envelope {
        assertRoot(root); assertP256(signingKey)
        if (sourcePlaintext.size > MAX_PLAINTEXT) invalid()
        val plaintext = sourcePlaintext.copyOf()
        try {
            val dek = KeyGenerator.getInstance("AES").apply { init(256, random) }.generateKey()
            val nonce = ByteArray(12).also(random::nextBytes)
            val wrappedKey = Cipher.getInstance("AESWrap").run { init(Cipher.WRAP_MODE, root); wrap(dek) }
            val ciphertext = Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.ENCRYPT_MODE, dek, GCMParameterSpec(128, nonce))
                updateAAD(context.additionalData())
                doFinal(plaintext)
            }
            val unsigned = Envelope.fromJson(JSONObject().put("context", context.toJson())
                .put("wrappedKey", encode(wrappedKey)).put("nonce", encode(nonce))
                .put("ciphertext", encode(ciphertext)).put("signature", encode(ByteArray(64))))
            val signature = Signature.getInstance("SHA256withECDSA").run {
                initSign(signingKey, random); update(signatureData(unsigned)); derToP1363(sign())
            }
            return Envelope.fromJson(unsigned.toJson().put("signature", encode(signature)))
        } finally { plaintext.fill(0) }
    }

    /** Key must come from the verified device directory, never from the incoming envelope. */
    fun verify(envelope: Envelope, expectedContext: Context, trustedDeviceKey: PublicKey): Envelope {
        if (!MessageDigest.isEqual(envelope.context.additionalData(), expectedContext.additionalData())) {
            throw GeneralSecurityException("E2EE_CONTEXT_MISMATCH")
        }
        assertP256(trustedDeviceKey)
        try {
            val valid = Signature.getInstance("SHA256withECDSA").run {
                initVerify(trustedDeviceKey); update(signatureData(envelope))
                verify(p1363ToDer(decode(envelope.signature, 64)))
            }
            if (!valid) corrupt()
        } catch (_: GeneralSecurityException) { corrupt() }
        return envelope
    }

    fun open(root: SecretKey, trustedDeviceKey: PublicKey, expectedContext: Context, envelope: Envelope): ByteArray {
        assertRoot(root)
        verify(envelope, expectedContext, trustedDeviceKey)
        try {
            val dek = Cipher.getInstance("AESWrap").run {
                init(Cipher.UNWRAP_MODE, root)
                unwrap(decode(envelope.wrappedKey, 40), "AES", Cipher.SECRET_KEY)
            }
            return Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, dek, GCMParameterSpec(128, decode(envelope.nonce, 12)))
                updateAAD(envelope.context.additionalData())
                doFinal(decode(envelope.ciphertext, 16, MAX_PLAINTEXT + 16))
            }
        } catch (_: GeneralSecurityException) { corrupt() }
    }

    // Encoding conversion, not an implementation of the ECDSA algorithm.
    internal fun p1363ToDer(source: ByteArray): ByteArray {
        if (source.size != 64) invalid()
        fun integer(part: ByteArray): ByteArray {
            val trimmed = part.dropWhile { it == 0.toByte() }.toByteArray()
            val stripped = if (trimmed.isEmpty()) byteArrayOf(0) else trimmed
            val unsigned = if (stripped[0].toInt() and 0x80 != 0) byteArrayOf(0) + stripped else stripped
            return byteArrayOf(2, unsigned.size.toByte()) + unsigned
        }
        val body = integer(source.copyOfRange(0, 32)) + integer(source.copyOfRange(32, 64))
        return byteArrayOf(0x30, body.size.toByte()) + body
    }

    internal fun derToP1363(source: ByteArray): ByteArray {
        if (source.size !in 8..72 || source[0] != 0x30.toByte() || source[1].toInt() != source.size - 2) invalid()
        var offset = 2
        fun integer(): ByteArray {
            if (offset + 2 > source.size || source[offset++] != 2.toByte()) invalid()
            val length = source[offset++].toInt()
            if (length !in 1..33 || offset + length > source.size) invalid()
            val bytes = source.copyOfRange(offset, offset + length); offset += length
            if (bytes[0].toInt() and 0x80 != 0 || (length > 1 && bytes[0] == 0.toByte()
                    && bytes[1].toInt() and 0x80 == 0)) invalid()
            val unsigned = if (length == 33) {
                if (bytes[0] != 0.toByte()) invalid()
                bytes.copyOfRange(1, 33)
            } else bytes
            return ByteArray(32).also { unsigned.copyInto(it, 32 - unsigned.size) }
        }
        val result = integer() + integer()
        if (offset != source.size) invalid()
        return result
    }
}
