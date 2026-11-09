package ru.genesis.calendar.auth

import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/** Review data stays in memory; credentials and transport envelopes never enter it. */
data class WorkspaceConflictField(val path: String, val title: String?, val baseJson: String,
    val localJson: String, val remoteJson: String)

data class WorkspaceConflictPreview(val fields: List<WorkspaceConflictField>, val fingerprint: String) {
    companion object {
        internal fun create(fields: List<WorkspaceConflictField>): WorkspaceConflictPreview {
            val sorted = fields.sortedBy { it.path }
            val bytes = JSONArray(sorted.map { JSONArray(listOf(it.path, it.baseJson, it.localJson, it.remoteJson)) }).toString().toByteArray(Charsets.UTF_8)
            val fingerprint = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            return WorkspaceConflictPreview(sorted, fingerprint)
        }
    }
}

internal fun workspaceConflictJson(value: Any?): String = when (value) {
    null, JSONObject.NULL -> "null"
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") {
        JSONObject.quote(it) + ":" + workspaceConflictJson(value.opt(it))
    }
    is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { workspaceConflictJson(value.opt(it)) }
    is String -> JSONObject.quote(value)
    is Number -> JSONObject.numberToString(value)
    else -> value.toString()
}
