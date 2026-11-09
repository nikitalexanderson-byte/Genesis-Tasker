package ru.genesis.calendar.auth

import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject
import ru.genesis.calendar.security.WorkspaceCipher

/** Verified bootstrap data for one account. No local draft scope is ever part of this snapshot. */
internal class CloudAccountSnapshot private constructor(
    val scope: String,
    val version: Long,
    val document: JSONObject?,
    val tasks: List<JSONObject>,
    val googleSyncWarning: Boolean,
    val googleSyncIssue: String?,
    val tasksDeferred: Boolean,
    val unreadableTaskCount: Int,
    val authProvider: String,
) {
    companion object {
        fun scopeFor(uid: String): String {
            require(uid.isNotBlank() && uid.length <= 256)
            val digest = MessageDigest.getInstance("SHA-256").digest(uid.toByteArray(Charsets.UTF_8))
            return "account-" + digest.joinToString("") { "%02x".format(it) }.take(32)
        }

        fun fromBootstrap(payload: JSONObject): CloudAccountSnapshot {
            val uid = AuthProtocol.identity(payload)?.uid ?: throw CloudWorkspacePreview.Unreadable()
            val authProvider = payload.optJSONObject("user")?.optString("authProvider") ?: "google"
            val workspace = payload.getJSONObject("workspace")
            val mode = workspace.getString("keyMode")
            require(mode in setOf("account", "client", "new"))
            val warningText = payload.optString("syncWarning").takeIf { it.isNotBlank() && it != "null" }?.take(1200)
            val warning = warningText != null
            val deferred = payload.optBoolean("tasksDeferred")
            val rows = payload.getJSONArray("tasks")
            // A bad Google row must not prevent the rest of an account from loading.
            // Individual task validation belongs to the importer; count non-object
            // rows too so an incomplete response can never erase cached tasks.
            val tasks = (0 until rows.length()).mapNotNull { index ->
                rows.optJSONObject(index)?.let { JSONObject(it.toString()) }
            }
            val unreadable = rows.length() - tasks.size
            if (workspace.isNull("envelope")) return CloudAccountSnapshot(scopeFor(uid), 0, null, tasks, warning, warningText, deferred, unreadable, authProvider)
            if (mode != "account") throw CloudWorkspacePreview.RecoveryRequired()
            val envelope = workspace.getJSONObject("envelope")
            val version = envelope.getLong("version")
            require(version > 0)
            val key = WorkspaceCipher.decodeKey(workspace.getString("key"))
            val plain = try {
                WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(envelope.getString("ciphertext"),
                    envelope.getString("iv")), key)
            } finally { key.fill(0) }
            val decoded = try { JSONObject(plain.toString(Charsets.UTF_8)) } finally { plain.fill(0) }
            val document = CloudWorkspaceMigration.normalize(decoded)
            require(document.optInt("trackerSchemaVersion", 0) == CloudWorkspaceMigration.CURRENT_SCHEMA)
            listOf("projects", "categories", "taskListLinks", "habits", "habitCompletions",
                "sleepPlans", "sleepEntries", "moodEntries", "dailyGoalRecords", "rewardTransactions").forEach {
                document.getJSONArray(it)
            }
            document.getJSONObject("userProgress")
            return CloudAccountSnapshot(scopeFor(uid), version, document, tasks, warning, warningText, deferred, unreadable, authProvider)
        }

        /** Keep unknown Google/web fields; native-only defaults are never written to the cloud snapshot. */
        fun nativeTaskJson(source: JSONObject): JSONObject {
            val row = JSONObject(source.toString())
            CloudTaskIdentity.requireImportedId(row.getString("id"))
            // Calendar events can legitimately have an empty/missing summary.
            val title = if (row.isNull("title")) "" else row.optString("title")
            row.put("title", title.takeIf { it.isNotBlank() } ?: "Без названия")
            val date = if (row.isNull("dueDate")) "" else row.optString("dueDate")
            require(date.isBlank() || runCatching { LocalDate.parse(date) }.isSuccess)
            row.put("dueDate", date.takeUnless { it.isBlank() } ?: "")
                .put("zoneId", row.optString("zoneId").takeIf { !row.isNull("zoneId") && it.isNotBlank() }
                    ?: ZoneId.systemDefault().id)
                .put("priority", row.optInt("priority", 5).coerceIn(1, 10))
            if (row.isNull("time")) row.put("time", "")
            if (!row.has("reminderAt")) row.put("reminderAt", JSONObject.NULL)
            return row
        }
    }
}
