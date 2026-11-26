package ru.genesis.calendar.security

import org.bouncycastle.crypto.AsymmetricCipherKeyPair
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.hpke.HPKE
import org.bouncycastle.crypto.params.HKDFParameters
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** RFC 9180/RFC 5869 via maintained Bouncy Castle. AES/ECDSA via platform JCA.
 * No server account key, Google identity or password is accepted as recovery material.
 */
object E2eeKeys {
    const val HPKE_SUITE = "DHKEM-P256-HKDFSHA256-A256GCM"
    private const val MAX_BUNDLE = 65536
    private val random = SecureRandom()
    private val hpke get() = HPKE(HPKE.mode_base, HPKE.kem_P256_SHA256, HPKE.kdf_HKDF_SHA256, HPKE.aead_AES_GCM256)
    private val identifier = Regex("[A-Za-z0-9][A-Za-z0-9._:@/\\-]{0,127}")
    private fun invalid(): Nothing = throw IllegalArgumentException("E2EE_INVALID_KEY_BUNDLE")
    fun technical(value: String): String = value.also { if (!identifier.matches(it)) invalid() }
    fun exact(source: JSONObject, fields: Set<String>) { if (source.keys().asSequence().toSet() != fields) invalid() }
    private fun bytes(value: String) = value.toByteArray(Charsets.UTF_8)
    private fun decode(source: JSONObject, field: String, min: Int, max: Int = min): ByteArray =
        (source.get(field) as? String)?.let { E2eeEnvelope.decode(it, min, max) } ?: invalid()
    fun freshSecret(): ByteArray = ByteArray(32).also(random::nextBytes)

    class DeviceKeys(val signing: KeyPair, val receiving: AsymmetricCipherKeyPair) {
        override fun toString() = "E2eeKeys.DeviceKeys([redacted])"
    }
    class ReadKeys(val publicKeys:JSONObject,val receiving:AsymmetricCipherKeyPair,val signer:java.security.PublicKey){override fun toString()="E2eeKeys.ReadKeys([redacted])"}
    /** Deliberately does not accept or import signingPrivate. */
    fun importReadKeys(source:JSONObject):ReadKeys{
        exact(source,setOf("signingKey","receivingKey","receivingPrivate"));val signer=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decode(source,"signingKey",91)));E2eeEnvelope.assertP256(signer)
        val scalar=decode(source,"receivingPrivate",32);val receiving=try{hpke.deserializePrivateKey(scalar,decode(source,"receivingKey",65))}finally{scalar.fill(0)}
        val keys=JSONObject().put("signingKey",source.get("signingKey")).put("receivingKey",source.get("receivingKey"));return ReadKeys(keys,receiving,signer)
    }
    fun generateDeviceKeys(): DeviceKeys = DeviceKeys(
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), random) }.generateKeyPair(),
        hpke.generatePrivateKey())
    fun publicKeys(keys: DeviceKeys): JSONObject = JSONObject()
        .put("signingKey", E2eeEnvelope.encode(keys.signing.public.encoded))
        .put("receivingKey", E2eeEnvelope.encode(hpke.serializePublicKey(keys.receiving.public)))
    fun exportPrivateKeys(keys: DeviceKeys): JSONObject = publicKeys(keys)
        .put("signingPrivate", E2eeEnvelope.encode(keys.signing.private.encoded))
        .put("receivingPrivate", E2eeEnvelope.encode(hpke.serializePrivateKey(keys.receiving.private)))
    fun importDeviceKeys(source: JSONObject): DeviceKeys {
        exact(source, setOf("signingKey", "receivingKey", "signingPrivate", "receivingPrivate"))
        try {
            val factory = KeyFactory.getInstance("EC")
            val signing = KeyPair(factory.generatePublic(X509EncodedKeySpec(decode(source, "signingKey", 91))),
                factory.generatePrivate(PKCS8EncodedKeySpec(decode(source, "signingPrivate", 67, 200))))
            E2eeEnvelope.assertP256(signing.public); E2eeEnvelope.assertP256(signing.private)
            val scalar = decode(source, "receivingPrivate", 32)
            val receiving = try { hpke.deserializePrivateKey(scalar, decode(source, "receivingKey", 65)) } finally { scalar.fill(0) }
            val probe = freshSecret()
            try {
                val signature = Signature.getInstance("SHA256withECDSA").run { initSign(signing.private); update(probe); sign() }
                if (!Signature.getInstance("SHA256withECDSA").run { initVerify(signing.public); update(probe); verify(signature) }) invalid()
                val sender = hpke.setupBaseS(receiving.public, probe)
                val recipient = hpke.setupBaseR(sender.encapsulation, receiving, probe)
                val opened = recipient.open(ByteArray(0), sender.seal(ByteArray(0), probe))
                try { if (!MessageDigest.isEqual(probe, opened)) invalid() } finally { opened.fill(0) }
            } finally { probe.fill(0) }
            return DeviceKeys(signing, receiving)
        } catch (_: Exception) { invalid() }
    }
    private fun bundleAad(ownerId: String, purpose: String): ByteArray {
        technical(ownerId); technical(purpose)
        return bytes("GENESIS-E2EE-BUNDLE\u0000v1\u0000$ownerId\u0000$purpose")
    }
    private fun secretKey(secret: ByteArray, salt: ByteArray, ownerId: String, purpose: String): SecretKey {
        technical(ownerId); technical(purpose)
        if (secret.size != 32 || salt.size != 32) invalid()
        val material = secret.copyOf()
        val derived = ByteArray(32)
        try {
            HKDFBytesGenerator(SHA256Digest()).apply {
                init(HKDFParameters(material, salt, bytes("GENESIS-E2EE-SECRET\u0000v1\u0000$ownerId\u0000$purpose")))
                generateBytes(derived, 0, derived.size)
            }
            return SecretKeySpec(derived, "AES")
        } finally { material.fill(0); derived.fill(0) }
    }
    fun protectBundle(ownerId: String, purpose: String, secret: ByteArray, value: ByteArray): JSONObject {
        if (value.size > MAX_BUNDLE) invalid()
        val salt = freshSecret(); val nonce = ByteArray(12).also(random::nextBytes); val copy = value.copyOf()
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey(secret, salt, ownerId, purpose), GCMParameterSpec(128, nonce))
            cipher.updateAAD(bundleAad(ownerId, purpose))
            return JSONObject().put("protocol", 1).put("ownerId", ownerId).put("purpose", purpose)
                .put("salt", E2eeEnvelope.encode(salt)).put("nonce", E2eeEnvelope.encode(nonce))
                .put("ciphertext", E2eeEnvelope.encode(cipher.doFinal(copy)))
        } finally { copy.fill(0) }
    }
    fun openBundle(ownerId: String, purpose: String, secret: ByteArray, source: JSONObject): ByteArray {
        exact(source, setOf("protocol", "ownerId", "purpose", "salt", "nonce", "ciphertext"))
        val protocol = source.get("protocol")
        if ((protocol != 1 && protocol != 1L) || source.get("ownerId") != ownerId || source.get("purpose") != purpose) invalid()
        val salt = decode(source, "salt", 32); val nonce = decode(source, "nonce", 12)
        val encrypted = decode(source, "ciphertext", 16, MAX_BUNDLE + 16)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(secret, salt, ownerId, purpose), GCMParameterSpec(128, nonce))
            cipher.updateAAD(bundleAad(ownerId, purpose))
            return cipher.doFinal(encrypted)
        } catch (_: Exception) { throw IllegalStateException("E2EE_UNLOCK_REQUIRED") }
    }

    data class RootRecipient(val ownerId: String, val scopeId: String, val cryptoEpoch: Long, val keyId: String, val recipientId: String) {
        fun info(): ByteArray {
            listOf(ownerId, scopeId, keyId, recipientId).forEach(::technical)
            if (cryptoEpoch !in 1..9007199254740991L) invalid()
            return bytes("GENESIS-E2EE-ROOT\u0000v1\u0000$ownerId\u0000$scopeId\u0000$cryptoEpoch\u0000$keyId\u0000$recipientId")
        }
    }
    fun sealRoot(root: ByteArray, receivingKey: String, context: RootRecipient): JSONObject {
        if (root.size != 32) invalid()
        val suite = hpke; val recipient = suite.deserializePublicKey(E2eeEnvelope.decode(receivingKey, 65))
        val sender = suite.setupBaseS(recipient, context.info()); val copy = root.copyOf()
        try {
            return JSONObject().put("suite", HPKE_SUITE).put("enc", E2eeEnvelope.encode(sender.encapsulation))
                .put("ciphertext", E2eeEnvelope.encode(sender.seal(ByteArray(0), copy)))
        } finally { copy.fill(0) }
    }
    fun openRoot(capsule: JSONObject, privateKeys: AsymmetricCipherKeyPair, context: RootRecipient): SecretKey {
        exact(capsule, setOf("suite", "enc", "ciphertext"))
        if (capsule.get("suite") != HPKE_SUITE) invalid()
        val enc = decode(capsule, "enc", 65); val ciphertext = decode(capsule, "ciphertext", 48)
        try {
            val recipient = hpke.setupBaseR(enc, privateKeys, context.info())
            val root = recipient.open(ByteArray(0), ciphertext)
            try { return E2eeEnvelope.importRoot(root) } finally { root.fill(0) }
        } catch (_: Exception) { throw IllegalStateException("E2EE_CORRUPT_ROOT") }
    }
    fun forwardRoot(capsule:JSONObject,privateKeys:AsymmetricCipherKeyPair,source:RootRecipient,receivingKey:String,target:RootRecipient):JSONObject {
        if(source.ownerId!=target.ownerId||source.scopeId!=target.scopeId||source.cryptoEpoch!=target.cryptoEpoch||source.keyId!=target.keyId)invalid()
        exact(capsule,setOf("suite","enc","ciphertext"));if(capsule.get("suite")!=HPKE_SUITE)invalid()
        val enc=decode(capsule,"enc",65);val ciphertext=decode(capsule,"ciphertext",48)
        try{val recipient=hpke.setupBaseR(enc,privateKeys,source.info());val root=recipient.open(ByteArray(0),ciphertext)
            try{return sealRoot(root,receivingKey,target)}finally{root.fill(0)}
        }catch(_:Exception){error("E2EE_CORRUPT_ROOT")}
    }
    class RecoveryState(val secret: ByteArray, val keys: DeviceKeys, val kit: JSONObject) {
        override fun toString() = "E2eeKeys.RecoveryState([redacted])"
    }
    fun createRecoveryKit(ownerId: String): RecoveryState {
        technical(ownerId); val secret = freshSecret(); val keys = generateDeviceKeys()
        val privateBytes = bytes(exportPrivateKeys(keys).toString())
        try {
            return RecoveryState(secret, keys, JSONObject().put("protocol", 1).put("ownerId", ownerId)
                .put("authority", publicKeys(keys)).put("protectedKeys", protectBundle(ownerId, "recovery-authority", secret, privateBytes)))
        } finally { privateBytes.fill(0) }
    }
    fun recoverAuthority(ownerId: String, secret: ByteArray, kit: JSONObject): DeviceKeys {
        exact(kit, setOf("protocol", "ownerId", "authority", "protectedKeys"))
        if (kit.get("protocol") != 1 || kit.get("ownerId") != ownerId) invalid()
        val authority = kit.getJSONObject("authority"); exact(authority, setOf("signingKey", "receivingKey"))
        val clear = openBundle(ownerId, "recovery-authority", secret, kit.getJSONObject("protectedKeys"))
        try {
            val saved = JSONObject(clear.toString(Charsets.UTF_8))
            if (saved.get("signingKey") != authority.get("signingKey") || saved.get("receivingKey") != authority.get("receivingKey")) invalid()
            return importDeviceKeys(saved)
        } finally { clear.fill(0) }
    }
}
