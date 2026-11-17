package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Separate rescue format. It is never accepted as account, entitlement, ACL or device authority. */
internal object EmergencyArchive {
    private const val MAX = 64 * 1024 * 1024
    private val aad = "GENESIS|emergency-local|1|A256GCM".toByteArray(Charsets.UTF_8)
    fun newKey(): String = Base64.getEncoder().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
    fun seal(payload: String, key: String): String {
        val plain=payload.toByteArray(Charsets.UTF_8); require(plain.size <= MAX)
        val bytes=Base64.getDecoder().decode(key); require(bytes.size==32)
        try {
            val iv=ByteArray(12).also(SecureRandom()::nextBytes)
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE,SecretKeySpec(bytes,"AES"),GCMParameterSpec(128,iv)); cipher.updateAAD(aad)
            return JSONObject().put("format","genesis-emergency").put("schema",1).put("algorithm","A256GCM")
                .put("iv",Base64.getEncoder().encodeToString(iv)).put("ciphertext",Base64.getEncoder().encodeToString(cipher.doFinal(plain))).toString()
        } finally { plain.fill(0); bytes.fill(0) }
    }
    fun open(archive: String, key: String): String {
        require(archive.length <= (MAX+16)*4/3+2048)
        val root=JSONObject(archive)
        require(root.keys().asSequence().toSet()==setOf("format","schema","algorithm","iv","ciphertext") && root.getString("format")=="genesis-emergency" && root.getInt("schema")==1 && root.getString("algorithm")=="A256GCM")
        val bytes=Base64.getDecoder().decode(key); require(bytes.size==32)
        val iv=Base64.getDecoder().decode(root.getString("iv")); require(iv.size==12)
        val ciphertext=Base64.getDecoder().decode(root.getString("ciphertext")); require(ciphertext.size in 16..MAX+16)
        try {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,SecretKeySpec(bytes,"AES"),GCMParameterSpec(128,iv)); cipher.updateAAD(aad)
            val plain=cipher.doFinal(ciphertext)
            try { return plain.toString(Charsets.UTF_8) } finally { plain.fill(0) }
        } finally { bytes.fill(0) }
    }
}
