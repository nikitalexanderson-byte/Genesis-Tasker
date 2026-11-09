package ru.genesis.calendar.data

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONArray
import org.json.JSONObject

/** Portable schema 1. Uses JCA AEAD/key wrap; no Keystore or sign-in key enters a file. */
internal object GenesisBackupContainer {
    const val MAX_PLAIN = 16 * 1024 * 1024
    const val MAX_FILE = 24 * 1024 * 1024
    private val encoder = Base64.getEncoder()
    private val decoder = Base64.getDecoder()
    fun newRecoveryKey(): String = encoder.encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
    private fun bytes(value: String, limit: Int): ByteArray {
        require(value.length <= ((limit + 2) / 3) * 4) { "BACKUP_TOO_LARGE" }
        val result = decoder.decode(value)
        require(result.size <= limit && encoder.encodeToString(result) == value) { "BACKUP_INVALID" }
        return result
    }
    private fun digest(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    private fun aad(value: JSONObject): ByteArray = JSONArray(listOf("genesisbackup", 1, value.getString("backupId"), "A256GCM+A256KW", value.getString("wrappedKey"))).toString().toByteArray(Charsets.UTF_8)
    /** Bounds parser nesting before org.json sees the input. No compression is accepted. */
    private fun bounded(text: String, limit: Int): JSONObject {
        require(text.toByteArray(Charsets.UTF_8).size <= limit) { "BACKUP_TOO_LARGE" }
        var quoted = false; var escaped = false; var depth = 0
        for (char in text) {
            if (quoted) { if (escaped) escaped = false else if (char == '\\') escaped = true else if (char == '"') quoted = false }
            else if (char == '"') quoted = true else if (char == '{' || char == '[') { depth++; require(depth <= 40) { "BACKUP_LIMIT" } }
            else if (char == '}' || char == ']') { depth--; require(depth >= 0) { "BACKUP_INVALID" } }
        }
        require(!quoted && depth == 0) { "BACKUP_INVALID" }
        val root = JSONObject(text)
        val stack = ArrayDeque<Any>().apply { add(root) }; var objects = 0
        while (stack.isNotEmpty()) {
            require(++objects <= 200_000) { "BACKUP_LIMIT" }
            when (val value = stack.removeLast()) {
                is JSONObject -> value.keys().forEach { key -> require(key !in setOf("__proto__", "prototype", "constructor")); value.opt(key)?.let(stack::add) }
                is JSONArray -> repeat(value.length()) { value.opt(it)?.let(stack::add) }
            }
        }
        return root
    }
    private fun payload(value: JSONObject): JSONObject {
        require(value.getInt("schema") == 1) { "BACKUP_VERSION" }
        require(value.getString("source") in setOf("device_snapshot", "server_snapshot"))
        require(value.isNull("billingEvidence")) { "BACKUP_INVALID" }
        val allowed = setOf("schema", "backupId", "source", "ownerId", "createdAt", "client", "sections", "billingEvidence", "serverEvidence")
        require(value.keys().asSequence().all { it in allowed })
        require(value.getString("ownerId").matches(Regex("[A-Za-z0-9_-]{1,100}")))
        require(value.getString("backupId").matches(Regex("[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}")))
        val sections = value.getJSONArray("sections"); require(sections.length() <= 7)
        val seen = mutableSetOf<String>()
        repeat(sections.length()) { val id = sections.getJSONObject(it).getString("id"); require(id in setOf("workspace", "mindmaps", "diary", "stoicheion", "aurora", "physis", "shared-drafts") && seen.add(id)) }
        return value
    }
    fun seal(value: JSONObject, recovery: String): String {
        val plain = payload(bounded(value.toString(), MAX_PLAIN)).toString().toByteArray(Charsets.UTF_8)
        val recoveryBytes = bytes(recovery.trim(), 32); require(recoveryBytes.size == 32)
        val dataKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        try {
            val wrap = Cipher.getInstance("AESWrap").apply { init(Cipher.WRAP_MODE, SecretKeySpec(recoveryBytes, "AES")) }
            val root = JSONObject().put("format", "genesisbackup").put("schema", 1).put("backupId", value.getString("backupId"))
                .put("algorithm", "A256GCM+A256KW").put("wrappedKey", encoder.encodeToString(wrap.wrap(dataKey)))
            val iv = ByteArray(12).also(SecureRandom()::nextBytes)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, dataKey, GCMParameterSpec(128, iv)); updateAAD(aad(root)) }
            val ciphertext = cipher.doFinal(plain)
            return root.put("iv", encoder.encodeToString(iv)).put("ciphertext", encoder.encodeToString(ciphertext)).put("sha256", digest(ciphertext)).toString().also { require(it.toByteArray().size <= MAX_FILE) }
        } finally { recoveryBytes.fill(0); plain.fill(0) }
    }
    fun open(text: String, recovery: String): JSONObject {
        val root = bounded(text, MAX_FILE)
        require(root.getInt("schema") == 1) { "BACKUP_VERSION" }
        require(root.getString("format") == "genesisbackup" && root.getString("algorithm") == "A256GCM+A256KW")
        require(root.keys().asSequence().toSet() == setOf("format", "schema", "backupId", "algorithm", "wrappedKey", "iv", "ciphertext", "sha256"))
        val ciphertext = bytes(root.getString("ciphertext"), MAX_PLAIN + 16)
        require(digest(ciphertext) == root.getString("sha256")) { "BACKUP_INTEGRITY" }
        val iv = bytes(root.getString("iv"), 12); require(iv.size == 12)
        val wrapped = bytes(root.getString("wrappedKey"), 40); require(wrapped.size == 40)
        val recoveryBytes = bytes(recovery.trim(), 32); require(recoveryBytes.size == 32)
        try {
            val unwrap = Cipher.getInstance("AESWrap").apply { init(Cipher.UNWRAP_MODE, SecretKeySpec(recoveryBytes, "AES")) }
            val dataKey = unwrap.unwrap(wrapped, "AES", Cipher.SECRET_KEY)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, dataKey, GCMParameterSpec(128, iv)); updateAAD(aad(root)) }
            val plain = cipher.doFinal(ciphertext)
            try { return payload(bounded(plain.toString(Charsets.UTF_8), MAX_PLAIN)).also { require(it.getString("backupId") == root.getString("backupId")) } }
            finally { plain.fill(0) }
        } finally { recoveryBytes.fill(0) }
    }
}
