package ru.genesis.calendar.security

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.json.JSONObject

/** Exact signed bytes; no platform-dependent JSON canonicalization. All values are public. */
internal data class UpdatePolicy(val sequence: Long, val issuedAt: Long, val activatesAt: Long,
    val expiresAt: Long, val channel: String, val minimumVersion: Int, val minimumCrypto: Int) {
    fun needsUpdate(version: Int, crypto: Int) = version < minimumVersion || crypto < minimumCrypto
    fun mayActivate(now: Long, availableVersion: Int, installedVersion: Int, crypto: Int): Boolean =
        now in activatesAt..expiresAt && now >= issuedAt && minimumVersion > installedVersion &&
            availableVersion >= minimumVersion && needsUpdate(installedVersion, crypto)

    companion object {
        const val CRYPTO_PROTOCOL = 0 // Legacy account-key mode; never advertise E2EE here.
        fun verify(text: String, channel: String, publicKey: String = UpdatePolicyKey.SPKI): UpdatePolicy {
            require(text.length <= 8192)
            val envelope = JSONObject(text)
            require(envelope.keys().asSequence().toSet() == setOf("payload", "signature"))
            val bytes = Base64.getDecoder().decode(envelope.getString("payload"))
            val signature = Base64.getDecoder().decode(envelope.getString("signature"))
            require(bytes.size in 1..4096 && signature.size in 64..80)
            val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)))
            require(Signature.getInstance("SHA256withECDSA").run { initVerify(key); update(bytes); verify(signature) })
            val root = JSONObject(bytes.toString(Charsets.UTF_8))
            require(root.keys().asSequence().toSet() == setOf("schema", "sequence", "issuedAt", "activatesAt", "expiresAt", "package", "channels"))
            fun integer(row: JSONObject, name: String, maximum: Long = 9_007_199_254_740_991L): Long {
                val value = row.get(name)
                require(value is Int || value is Long)
                return (value as Number).toLong().also { require(it in 0..maximum) }
            }
            require(integer(root,"schema") == 1L && root.getString("package") == "ru.genesis.calendar")
            val channels = root.getJSONObject("channels")
            require(channels.keys().asSequence().toSet() == setOf("site", "play") && channel in channels.keys().asSequence().toSet())
            val floors = channels.getJSONObject(channel)
            require(floors.keys().asSequence().toSet() == setOf("minimumVersionCode", "minimumCryptoProtocol"))
            val policy = UpdatePolicy(integer(root,"sequence"), integer(root,"issuedAt"), integer(root,"activatesAt"),
                integer(root,"expiresAt"), channel, integer(floors,"minimumVersionCode",Int.MAX_VALUE.toLong()).toInt(),
                integer(floors,"minimumCryptoProtocol",100).toInt())
            require(policy.sequence > 0 && policy.issuedAt <= policy.activatesAt && policy.activatesAt < policy.expiresAt &&
                policy.expiresAt - policy.issuedAt <= 180L * 86400 && (policy.minimumCrypto == 0 || policy.minimumVersion > 0))
            return policy
        }
    }
}

/** Once activated, expiry, cancellation, clock changes and a later lower policy never release a floor. */
internal fun updateFloorBlocked(floor: UpdatePolicy?, installedVersion: Int, crypto: Int): Boolean =
    floor?.needsUpdate(installedVersion, crypto) == true
