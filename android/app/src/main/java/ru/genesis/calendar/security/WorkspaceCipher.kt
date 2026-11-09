package ru.genesis.calendar.security

import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Wire-compatible with app/cloud-sync.ts; storage, key ownership and JSON merging are separate. */
object WorkspaceCipher {
    private const val KEY_BYTES = 32
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private val random = SecureRandom()

    class Envelope(val ciphertext: String, val iv: String) {
        // Do not accidentally put ciphertext or metadata in logs through a data-class toString.
        override fun toString() = "WorkspaceCipher.Envelope([redacted])"
    }

    fun encrypt(plaintext: ByteArray, workspaceKey: ByteArray, aad: ByteArray = byteArrayOf()): Envelope =
        encryptWithIv(plaintext, workspaceKey, ByteArray(IV_BYTES).also(random::nextBytes), aad)

    /** Explicit IV is internal solely for deterministic interoperability fixtures. Never reuse it. */
    internal fun encryptWithIv(plaintext: ByteArray, workspaceKey: ByteArray, iv: ByteArray, aad: ByteArray = byteArrayOf()): Envelope {
        validateKey(workspaceKey)
        require(iv.size == IV_BYTES) { "Workspace IV must contain 12 bytes" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(workspaceKey, "AES"), GCMParameterSpec(TAG_BITS, iv))
        if (aad.isNotEmpty()) cipher.updateAAD(aad)
        // WebCrypto appends its 16-byte authentication tag to ciphertext, as does JCA.
        return Envelope(encode(cipher.doFinal(plaintext)), encode(iv))
    }

    fun decrypt(envelope: Envelope, workspaceKey: ByteArray, aad: ByteArray = byteArrayOf()): ByteArray {
        validateKey(workspaceKey)
        val iv = decode(envelope.iv)
        require(iv.size == IV_BYTES) { "Workspace IV must contain 12 bytes" }
        val ciphertext = decode(envelope.ciphertext)
        require(ciphertext.size >= TAG_BITS / 8) { "Workspace ciphertext is truncated" }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(workspaceKey, "AES"), GCMParameterSpec(TAG_BITS, iv))
            if (aad.isNotEmpty()) cipher.updateAAD(aad)
            return cipher.doFinal(ciphertext)
        } catch (_: GeneralSecurityException) {
            // Never replace the existing key or return empty plaintext after an authentication failure.
            throw GeneralSecurityException("Workspace authentication failed; data was not changed")
        }
    }

    fun decodeKey(base64: String): ByteArray = decode(base64.trim()).also(::validateKey)

    fun wrapKey(workspaceKey: ByteArray, recoveryCode: String): Envelope {
        validateKey(workspaceKey)
        val recoveryKey = decodeKey(recoveryCode)
        return try { encrypt(workspaceKey, recoveryKey) } finally { recoveryKey.fill(0) }
    }

    fun unwrapKey(wrappedKey: Envelope, recoveryCode: String): ByteArray {
        val recoveryKey = decodeKey(recoveryCode)
        return try { decrypt(wrappedKey, recoveryKey).also(::validateKey) } finally { recoveryKey.fill(0) }
    }

    private fun validateKey(key: ByteArray) {
        require(key.size == KEY_BYTES) { "Workspace key must contain 32 bytes" }
    }

    private fun encode(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)

    private fun decode(value: String): ByteArray = try {
        Base64.getDecoder().decode(value)
    } catch (_: IllegalArgumentException) {
        throw IllegalArgumentException("Invalid workspace Base64 encoding")
    }
}
