package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import kotlin.math.floor

object E2eeCommands {
    private const val MAX_BYTES = 6 * 1024 * 1024
    private val fieldName = Regex("[A-Za-z][A-Za-z0-9]{0,63}")
    private val commandFields = setOf("protocol", "ownerId", "scopeId", "deviceId", "action", "expectedRevision", "checkpointHash", "securityEpoch", "operationId", "payload")
    private fun invalid(): Nothing = throw IllegalArgumentException("E2EE_INVALID_COMMAND")
    fun integer(value: Any, minimum: Long = 0): Long {
        if (value !is Number) invalid()
        val number = value.toDouble()
        if (!number.isFinite() || floor(number) != number || number < minimum.toDouble() || number > 9007199254740991.0) invalid()
        return number.toLong()
    }
    fun canonical(value: Any): ByteArray {
        val buffer = ByteArrayOutputStream(); val output = DataOutputStream(buffer)
        fun write(value: Any, depth: Int) {
            if (depth > 16) invalid()
            when (value) {
                JSONObject.NULL -> output.writeByte(0)
                is Boolean -> output.writeByte(if (value) 2 else 1)
                is Number -> { output.writeByte(3); output.writeLong(integer(value)) }
                is String -> {
                    if (value.length > MAX_BYTES || value.any { it.code !in 32..126 }) invalid()
                    val bytes = value.toByteArray(Charsets.US_ASCII); output.writeByte(4); output.writeInt(bytes.size); output.write(bytes)
                }
                is JSONArray -> {
                    if (value.length() > 10000) invalid()
                    output.writeByte(5); output.writeInt(value.length())
                    for (index in 0 until value.length()) write(value.get(index), depth + 1)
                }
                is JSONObject -> {
                    val keys = value.keys().asSequence().toList().sorted()
                    if (keys.isEmpty() || keys.size > 128 || keys.any { !fieldName.matches(it) }) invalid()
                    output.writeByte(6); output.writeInt(keys.size)
                    for (key in keys) { write(key, depth + 1); write(value.get(key), depth + 1) }
                }
                else -> invalid()
            }
            if (buffer.size() > MAX_BYTES) invalid()
        }
        write(value, 0); output.flush(); return buffer.toByteArray()
    }
    /** Strict inverse of canonical technical metadata. Private text stays opaque bytes. */
    fun decodeCanonical(bytes: ByteArray, maximum: Int = MAX_BYTES): Any {
        if (maximum !in 1..MAX_BYTES || bytes.isEmpty() || bytes.size > maximum) invalid()
        var at = 0
        var nodes = 0
        fun need(count: Int) { if (count < 0 || count > bytes.size - at) invalid() }
        fun u32(): Long {
            need(4)
            var value = 0L
            repeat(4) { value = (value shl 8) or (bytes[at++].toLong() and 255) }
            return value
        }
        fun read(depth: Int): Any {
            if (depth > 16 || ++nodes > maximum) invalid()
            need(1)
            return when (bytes[at++].toInt() and 255) {
                0 -> JSONObject.NULL
                1 -> false
                2 -> true
                3 -> {
                    val high = u32()
                    val low = u32()
                    if (high > 0x1fffffL) invalid()
                    (high shl 32) or low
                }
                4 -> {
                    val count = u32()
                    if (count > (bytes.size - at).toLong()) invalid()
                    val size = count.toInt()
                    repeat(size) { if ((bytes[at + it].toInt() and 255) !in 32..126) invalid() }
                    String(bytes, at, size, Charsets.US_ASCII).also { at += size }
                }
                5 -> {
                    val count = u32()
                    if (count > 10000L) invalid()
                    JSONArray().apply { repeat(count.toInt()) { put(read(depth + 1)) } }
                }
                6 -> {
                    val count = u32()
                    if (count !in 1L..128L) invalid()
                    var previous = ""
                    JSONObject().apply { repeat(count.toInt()) {
                        val name = read(depth + 1) as? String ?: invalid()
                        if (!fieldName.matches(name) || name <= previous) invalid()
                        previous = name
                        put(name, read(depth + 1))
                    } }
                }
                else -> invalid()
            }
        }
        val value = read(0)
        if (at != bytes.size) invalid()
        return value
    }
    fun commandBytes(source: JSONObject): ByteArray {
        E2eeKeys.exact(source, commandFields)
        if (integer(source.get("protocol")) != 1L) invalid()
        integer(source.get("expectedRevision")); integer(source.get("securityEpoch"), 1)
        for (key in listOf("ownerId", "scopeId", "deviceId", "action", "operationId")) {
            (source.get(key) as? String)?.let(E2eeKeys::technical) ?: invalid()
        }
        val checkpoint = source.get("checkpointHash") as? String ?: invalid()
        if (checkpoint != "genesis") E2eeEnvelope.decode(checkpoint, 32)
        if (source.get("payload") !is JSONObject) invalid()
        return "GENESIS-E2EE-COMMAND\u0000v1\u0000".toByteArray(Charsets.UTF_8) + canonical(source)
    }
    fun sign(command: JSONObject, privateKey: PrivateKey): JSONObject {
        E2eeEnvelope.assertP256(privateKey)
        val snapshot = JSONObject(command.toString()); val bytes = commandBytes(snapshot)
        val signature = Signature.getInstance("SHA256withECDSA").run { initSign(privateKey); update(bytes); E2eeEnvelope.derToP1363(sign()) }
        return JSONObject().put("command", snapshot).put("signature", E2eeEnvelope.encode(signature))
    }
    fun verify(packet: JSONObject, publicKey: PublicKey): JSONObject {
        E2eeEnvelope.assertP256(publicKey)
        E2eeKeys.exact(packet, setOf("command", "signature"))
        val command = JSONObject(packet.getJSONObject("command").toString())
        val signature = E2eeEnvelope.p1363ToDer(E2eeEnvelope.decode(packet.getString("signature"), 64))
        if (!Signature.getInstance("SHA256withECDSA").run { initVerify(publicKey); update(commandBytes(command)); verify(signature) })
            throw IllegalStateException("E2EE_UNTRUSTED_COMMAND")
        return command
    }
    fun hash(command: JSONObject): String {
        fun withoutProofs(value: Any): Any = when (value) {
            is JSONObject -> JSONObject().apply {
                for (key in value.keys().asSequence().toList()) if (key !in setOf("signature", "selfProof")) put(key, withoutProofs(value.get(key)))
            }
            is JSONArray -> JSONArray().apply { for (index in 0 until value.length()) put(withoutProofs(value.get(index))) }
            else -> value
        }
        return E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(canonical(withoutProofs(command))))
    }
}
