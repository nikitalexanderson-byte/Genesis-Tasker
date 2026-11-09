package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.DiaryNote
import ru.genesis.calendar.security.WorkspaceCipher
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Implemented by the existing authenticated account transport; no second session or workspace key. */
internal interface DiaryGateway {
    fun check()
    fun featureAccess(): FeatureAccess = FeatureAccess()
    suspend fun workspace(): JSONObject
    /** GET when body is null; otherwise PUT. The transport must keep its existing session generation guards. */
    suspend fun request(path: String, body: JSONObject? = null): JSONObject
    suspend fun remove(id: String, expectedRevision: Long): JSONObject = throw UnsupportedOperationException("DIARY_DELETE_UNAVAILABLE")
}

internal data class DiaryDeletion(val id: String, val revision: Long, val updatedAt: String, val localOnly: Boolean) {
    fun json() = JSONObject().put("id", id).put("revision", revision).put("updatedAt", updatedAt).put("localOnly", localOnly)
}

internal data class DiaryEnvelope(val id: String, val revision: Long, val updatedAt: String, val bodyJson: String) {
    fun json(): JSONObject = JSONObject(bodyJson).put("id", id).put("revision", revision).put("updatedAt", updatedAt)
    override fun toString() = "DiaryEnvelope([redacted])"
}

internal object DiaryProtocol {
    fun allowedRoute(method: String, path: String): Boolean = method == "GET" && path == "/diary" ||
        method == "GET" && (path in setOf("/diary/settings", "/diary/dream-voice", "/diary/dream-settings") || path.matches(Regex("/diary/dream-clock\\?timeZone=[A-Za-z0-9_%+./-]{1,150}"))) ||
        method in setOf("PUT", "DELETE") && path.matches(Regex("/diary/[A-Za-z0-9_-]{1,100}")) && (method != "DELETE" || path !in setOf("/diary/settings", "/diary/dream-settings"))
    fun aad(owner: String, id: String): ByteArray = "genesis-mindmap-v1:$owner:diary-note:v1:$id".toByteArray(Charsets.UTF_8)
    fun key(workspace: JSONObject): ByteArray {
        val row = workspace.getJSONObject("workspace")
        require(row.getString("keyMode") == "account") { "DIARY_KEY_LOCKED" }
        return WorkspaceCipher.decodeKey(row.getString("key"))
    }
    private fun integer(value: Any?, minimum: Long): Long {
        require(value is Number && value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble() && value.toLong() >= minimum) { "DIARY_INVALID_RESPONSE" }
        return value.toLong()
    }
    fun pending(value: JSONObject): JSONObject {
        require(value.keys().asSequence().toSet() == setOf("schemaVersion", "expectedRevision", "iv", "ciphertext")) { "DIARY_INVALID_PENDING" }
        require(integer(value.opt("schemaVersion"), 1) == 1L) { "DIARY_UNKNOWN_SCHEMA" }
        integer(value.opt("expectedRevision"), 0)
        val iv = value.opt("iv") as? String; val ciphertext = value.opt("ciphertext") as? String
        require(iv != null && iv.length == 16 && Base64.getDecoder().decode(iv).size == 12 && ciphertext != null &&
            ciphertext.length in 24..300_000 && Base64.getDecoder().decode(ciphertext).size >= 16) { "DIARY_INVALID_PENDING" }
        return JSONObject(value.toString())
    }
    fun seal(owner: String, note: DiaryNote, revision: Long, key: ByteArray): JSONObject {
        require(revision >= 0)
        val bytes = note.json().toString().toByteArray(Charsets.UTF_8)
        val envelope = try { WorkspaceCipher.encrypt(bytes, key, aad(owner, note.id)) } finally { bytes.fill(0) }
        return pending(JSONObject().put("schemaVersion", 1).put("expectedRevision", revision).put("iv", envelope.iv).put("ciphertext", envelope.ciphertext))
    }
    fun envelopes(response: JSONObject): List<DiaryEnvelope> {
        val rows = response.getJSONArray("notes"); require(rows.length() <= 20000) { "DIARY_INVALID_RESPONSE" }
        val result = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index); val id = row.getString("id")
            require(DiaryNote.idPattern.matches(id) && DiaryNote.validDate(row.opt("updatedAt"))) { "DIARY_INVALID_RESPONSE" }
            val revision = integer(row.opt("revision"), 1)
            val body = pending(JSONObject().put("schemaVersion", row.get("schemaVersion")).put("expectedRevision", revision - 1)
                .put("iv", row.get("iv")).put("ciphertext", row.get("ciphertext")))
            DiaryEnvelope(id, revision, row.getString("updatedAt"), body.toString())
        }
        require(result.map { it.id }.distinct().size == result.size) { "DIARY_INVALID_RESPONSE" }
        return result
    }
    fun open(owner: String, row: DiaryEnvelope, key: ByteArray): DiaryNote {
        val body = pending(JSONObject(row.bodyJson))
        val bytes = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"), body.getString("iv")), key, aad(owner, row.id))
        return try { DiaryNote.parse(JSONObject(bytes.toString(Charsets.UTF_8))).also { require(it.id == row.id) { "DIARY_INVALID_RESPONSE" } } }
        finally { bytes.fill(0) }
    }
    fun receipt(value: JSONObject, expectedRevision: Long): Long {
        val revision = integer(value.opt("revision"), 1)
        require(revision == expectedRevision + 1 && DiaryNote.validDate(value.opt("updatedAt"))) { "DIARY_INVALID_RECEIPT" }
        return revision
    }
    fun deletions(response: JSONObject): List<DiaryDeletion> {
        val rows = response.optJSONArray("deleted") ?: JSONArray()
        return (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index); val id = row.getString("id")
            require(DiaryNote.idPattern.matches(id) && DiaryNote.validDate(row.opt("updatedAt")) && row.opt("localOnly") is Boolean) { "DIARY_INVALID_RESPONSE" }
            DiaryDeletion(id, integer(row.opt("revision"), 2), row.getString("updatedAt"), row.getBoolean("localOnly"))
        }.also { require(it.map { row -> row.id }.distinct().size == it.size) { "DIARY_INVALID_RESPONSE" } }
    }
    fun settings(response: JSONObject): Pair<Boolean, Long>? = response.optJSONObject("settings")?.let { row ->
        require(row.opt("syncEnabled") is Boolean) { "DIARY_INVALID_RESPONSE" }
        row.getBoolean("syncEnabled") to integer(row.opt("revision"), 0)
    }
    /** WebCrypto HKDF-SHA256 -> 512-bit HMAC-SHA256 key (WebCrypto default HMAC key length), scoped to this account and purpose. */
    fun privateAdviceId(workspaceKey: ByteArray, owner: String, adviceId: String): String {
        require(workspaceKey.size == 32 && owner.isNotBlank() && adviceId.isNotBlank())
        fun hmac(key: ByteArray, bytes: ByteArray) = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(bytes) }
        val extracted = hmac("genesis-private-document-id-v1".toByteArray(Charsets.UTF_8), workspaceKey)
        val first = hmac(extracted, owner.toByteArray(Charsets.UTF_8) + byteArrayOf(1))
        val second = try { hmac(extracted, first + owner.toByteArray(Charsets.UTF_8) + byteArrayOf(2)) } finally { extracted.fill(0) }
        val derived = (first + second).also { first.fill(0); second.fill(0) }
        return try { hmac(derived, "diary-advice:$adviceId".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) } }
        finally { derived.fill(0) }
    }
}
