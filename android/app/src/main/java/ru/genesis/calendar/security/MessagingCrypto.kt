package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

internal class MessagingIdentity(val privateKey: PrivateKey, val publicJson: String, val keyId: String) {
    override fun toString() = "MessagingIdentity([redacted])"
}
internal data class MessageContext(val spaceId: String, val conversationId: String, val id: String, val senderId: String, val revision: Long)
internal data class PrivateFileMetadata(val id: String, val name: String, val type: String, val size: Int, val iv: String, val chunks: Int) {
    fun json() = JSONObject().put("id", id).put("name", name).put("type", type).put("size", size).put("iv", iv).put("chunks", chunks)
    override fun toString() = "PrivateFileMetadata([redacted])"
}
internal data class PrivateMessageContent(val text: String, val files: List<PrivateFileMetadata> = emptyList()) {
    override fun toString() = "PrivateMessageContent([redacted])"
}

/** Exact WebCrypto wire format from app/private-message-crypto.ts; independent from personal workspace keys. */
internal object MessagingCrypto {
    const val FILE_LIMIT = 10 * 1024 * 1024
    const val CHUNK_SIZE = 256 * 1024
    private val random = SecureRandom()
    private val curve: ECParameterSpec get() = AlgorithmParameters.getInstance("EC").run { init(ECGenParameterSpec("secp256r1")); getParameterSpec(ECParameterSpec::class.java) }
    fun base64(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
    fun unbase64(value: String): ByteArray {
        require(value.matches(Regex("[A-Za-z0-9_-]*"))) { "INVALID_BASE64" }
        return Base64.getUrlDecoder().decode(value).also { require(base64(it) == value) { "INVALID_BASE64" } }
    }
    private fun sha(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value)
    private fun hex(value: ByteArray) = value.joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun bytes(value: String) = value.toByteArray(Charsets.UTF_8)
    private fun integer(row: JSONObject, name: String, minimum: Int, maximum: Int): Int {
        val value = row.opt(name)
        require(value is Number && value.toDouble().isFinite() && value.toDouble() == value.toInt().toDouble() && value.toInt() in minimum..maximum) { "INVALID_PRIVATE_CONTENT" }
        return value.toInt()
    }
    private fun utf8(value: ByteArray): String = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString()
    private fun scalar(value: BigInteger): ByteArray = value.toByteArray().let { raw -> ByteArray(32).also { result -> val offset = (raw.size - 32).coerceAtLeast(0); System.arraycopy(raw, offset, result, 32 - (raw.size - offset), raw.size - offset) } }
    fun canonicalPublicKey(jwk: JSONObject): String {
        val x = jwk.optString("x"); val y = jwk.optString("y")
        require(jwk.optString("kty") == "EC" && jwk.optString("crv") == "P-256" && x.length == 43 && y.length == 43 && unbase64(x).size == 32 && unbase64(y).size == 32) { "INVALID_PUBLIC_KEY" }
        // JSONObject's property order is unspecified; fingerprint order is part of the protocol.
        return "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"$x\",\"y\":\"$y\"}"
    }
    fun fingerprint(jwk: JSONObject): String = hex(sha(bytes(canonicalPublicKey(jwk))))
    private fun publicKey(jwk: JSONObject) = JSONObject(canonicalPublicKey(jwk)).let {
        KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(BigInteger(1, unbase64(it.getString("x"))), BigInteger(1, unbase64(it.getString("y")))), curve))
    }
    fun createIdentity(): MessagingIdentity {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), random) }.generateKeyPair()
        val public = pair.public as ECPublicKey
        val json = JSONObject().put("kty", "EC").put("crv", "P-256").put("x", base64(scalar(public.w.affineX))).put("y", base64(scalar(public.w.affineY)))
        return MessagingIdentity(pair.private, canonicalPublicKey(json), fingerprint(json))
    }
    fun privateJwk(identity: MessagingIdentity): String = JSONObject(identity.publicJson).put("d", base64(scalar((identity.privateKey as ECPrivateKey).s))).put("ext", true).put("key_ops", JSONArray().put("deriveBits")).toString()
    private fun shared(identity: MessagingIdentity, peer: JSONObject): ByteArray = KeyAgreement.getInstance("ECDH").run { init(identity.privateKey); doPhase(publicKey(peer), true); generateSecret() }
    fun importIdentity(jwk: JSONObject): MessagingIdentity {
        val canonical = canonicalPublicKey(jwk); val d = unbase64(jwk.getString("d"))
        require(d.size == 32 && BigInteger(1, d) > BigInteger.ZERO && BigInteger(1, d) < curve.order) { "INVALID_PRIVATE_KEY" }
        val private = try { KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, d), curve)) } finally { d.fill(0) }
        val identity = MessagingIdentity(private, canonical, fingerprint(jwk))
        val probe = createIdentity()
        val a = shared(identity, JSONObject(probe.publicJson)); val b = shared(probe, JSONObject(canonical))
        try { require(MessageDigest.isEqual(a, b)) { "PRIVATE_PUBLIC_MISMATCH" } } finally { a.fill(0); b.fill(0) }
        return identity
    }
    private fun hmac(key: ByteArray, value: ByteArray) = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(value) }
    fun conversationKey(identity: MessagingIdentity, peer: JSONObject, conversation: String, space: String): ByteArray {
        val ids = listOf(identity.keyId, fingerprint(peer)).sorted()
        val salt = sha(bytes(JSONArray().put("GENESIS private messages v1").put(space).put(conversation).put(ids[0]).put(ids[1]).toString()))
        val secret = shared(identity, peer)
        val extracted = try { hmac(salt, secret) } finally { secret.fill(0) }
        return try { hmac(extracted, bytes("AES-GCM-256") + byteArrayOf(1)) } finally { extracted.fill(0) }
    }
    fun securityCode(ids: List<String>): String = hex(sha(bytes(JSONArray(ids.sorted()).toString())).copyOfRange(0, 20)).chunked(5).joinToString(" ")
    private fun aad(context: MessageContext) = bytes(JSONArray().put(1).put(context.spaceId).put(context.conversationId).put(context.id).put(context.senderId).put(context.revision).toString())
    private fun fileAad(context: MessageContext, id: String) = bytes(JSONArray().put("GENESIS private file v1").put(context.spaceId).put(context.conversationId).put(context.id).put(context.senderId).put(id).toString())
    private fun crypt(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, value: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
        require(key.size == 32 && iv.size == 12) { "INVALID_CIPHER" }
        init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)); updateAAD(aad); doFinal(value)
    }
    fun encryptMessage(key: ByteArray, context: MessageContext, text: String, keyIds: Map<String, String>): JSONObject {
        val plain = bytes(text); require(text.isNotBlank() && plain.size <= 32000 && keyIds.size == 2) { "INVALID_MESSAGE" }
        val iv = ByteArray(12).also(random::nextBytes)
        val encrypted = try { crypt(Cipher.ENCRYPT_MODE, key, iv, aad(context), plain) } finally { plain.fill(0) }
        return JSONObject().put("version", 1).put("iv", base64(iv)).put("ciphertext", base64(encrypted)).put("keyIds", JSONObject(keyIds))
    }
    fun decryptMessage(key: ByteArray, context: MessageContext, payload: JSONObject, expected: Map<String, String>): String {
        val ids = payload.getJSONObject("keyIds")
        require(integer(payload, "version", 1, 1) == 1 && ids.length() == 2 && expected.size == 2 && expected.all { (id, value) -> ids.optString(id) == value }) { "MESSAGE_KEY_MISMATCH" }
        val encrypted = unbase64(payload.getString("ciphertext")); require(encrypted.size in 16..32016) { "INVALID_MESSAGE" }
        val plain = crypt(Cipher.DECRYPT_MODE, key, unbase64(payload.getString("iv")), aad(context), encrypted)
        return try { utf8(plain) } finally { plain.fill(0) }
    }
    fun content(source: String): PrivateMessageContent {
        if (!source.startsWith("{\"format\":\"genesis-private-content\"")) return PrivateMessageContent(source)
        val json = JSONObject(source); val rows = json.getJSONArray("files")
        require(rows.length() <= 5 && json.opt("text") is String) { "INVALID_PRIVATE_CONTENT" }
        return PrivateMessageContent(json.getString("text"), (0 until rows.length()).map { file(rows.getJSONObject(it)) }).also {
            require(it.files.map { file -> file.id }.distinct().size == it.files.size) { "INVALID_PRIVATE_CONTENT" }
        }
    }
    fun encodeContent(content: PrivateMessageContent): String {
        require(content.files.size <= 5)
        content.files.forEach { file(it.json()) }
        return if (content.files.isEmpty()) content.text else "{\"format\":\"genesis-private-content\",\"text\":" + JSONObject.quote(content.text) + ",\"files\":" + JSONArray(content.files.map { it.json() }) + "}"
    }
    fun file(row: JSONObject): PrivateFileMetadata {
        val size = integer(row, "size", 0, FILE_LIMIT); val count = integer(row, "chunks", 1, 41); val iv = row.getString("iv")
        require(row.getString("id").matches(Regex("[a-f0-9-]{36}")) && row.opt("name") is String && row.getString("name").length <= 255 && row.opt("type") is String && size in 0..FILE_LIMIT && count == (size + 16 + CHUNK_SIZE - 1) / CHUNK_SIZE && iv.length == 16 && unbase64(iv).size == 12) { "INVALID_PRIVATE_FILE" }
        return PrivateFileMetadata(row.getString("id"), row.getString("name"), row.getString("type"), size, iv, count)
    }
    fun encryptFile(key: ByteArray, context: MessageContext, id: String, name: String, type: String, data: ByteArray): Pair<PrivateFileMetadata, List<String>> {
        require(data.size <= FILE_LIMIT) { "PRIVATE_FILE_TOO_LARGE" }
        val iv = ByteArray(12).also(random::nextBytes)
        val cipher = crypt(Cipher.ENCRYPT_MODE, key, iv, fileAad(context, id), data)
        val chunks = (cipher.indices step CHUNK_SIZE).map { offset -> base64(cipher.copyOfRange(offset, (offset + CHUNK_SIZE).coerceAtMost(cipher.size))) }
        return PrivateFileMetadata(id, name.take(255), type, data.size, base64(iv), chunks.size).also { file(it.json()) } to chunks
    }
    fun decryptFile(key: ByteArray, context: MessageContext, file: PrivateFileMetadata, chunks: List<String>): ByteArray {
        file(file.json()); require(chunks.size == file.chunks) { "INVALID_PRIVATE_FILE" }
        val cipher = ByteArray(file.size + 16); var offset = 0
        chunks.forEachIndexed { index, chunk ->
            val part = unbase64(chunk)
            require(part.size == if (index == chunks.lastIndex) cipher.size - offset else CHUNK_SIZE) { "INVALID_PRIVATE_FILE" }
            part.copyInto(cipher, offset); offset += part.size
        }
        require(offset == cipher.size) { "INVALID_PRIVATE_FILE" }
        return crypt(Cipher.DECRYPT_MODE, key, unbase64(file.iv), fileAad(context, file.id), cipher)
    }
    private fun backupKey(password: String, salt: ByteArray): ByteArray {
        require(password.length >= 12 && salt.size == 16) { "BACKUP_PASSWORD_REQUIRED" }
        val spec = PBEKeySpec(password.toCharArray(), salt, 310000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded } finally { spec.clearPassword() }
    }
    fun exportBackup(identity: MessagingIdentity, password: String): String {
        val salt = ByteArray(16).also(random::nextBytes); val iv = ByteArray(12).also(random::nextBytes)
        val key = backupKey(password, salt); val plain = bytes(privateJwk(identity))
        val ciphertext = try { crypt(Cipher.ENCRYPT_MODE, key, iv, bytes("GENESIS messaging backup v1"), plain) } finally { key.fill(0); plain.fill(0) }
        return JSONObject().put("format", "genesis-messaging-key").put("version", 1).put("salt", base64(salt)).put("iv", base64(iv)).put("ciphertext", base64(ciphertext)).toString()
    }
    fun importBackup(source: String, password: String): MessagingIdentity {
        require(source.length <= 4000) { "INVALID_BACKUP" }
        val json = JSONObject(source)
        require(json.getString("format") == "genesis-messaging-key" && integer(json, "version", 1, 1) == 1) { "INVALID_BACKUP" }
        val key = backupKey(password, unbase64(json.getString("salt")))
        val plain = try { crypt(Cipher.DECRYPT_MODE, key, unbase64(json.getString("iv")), bytes("GENESIS messaging backup v1"), unbase64(json.getString("ciphertext"))) } finally { key.fill(0) }
        return try { importIdentity(JSONObject(utf8(plain))) } finally { plain.fill(0) }
    }
}
