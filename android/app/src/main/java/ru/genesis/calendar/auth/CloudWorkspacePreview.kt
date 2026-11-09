package ru.genesis.calendar.auth

import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.security.WorkspaceCipher
import java.security.GeneralSecurityException

/** Read-only inspection. A failed decrypt must never become an empty workspace or a new key. */
object CloudWorkspacePreview {
    data class Category(val id: String, val name: String, val color: String)

    data class Summary(
        val version: Long,
        val updatedAt: String?,
        val projects: Int,
        val categories: Int,
        val habits: Int,
        val completions: Int,
        val sleepEntries: Int,
        val moodEntries: Int,
        val rewards: Int,
        val quests: Int,
        val tasks: Int?,
        val taskLists: Int?,
        val hasGoogleSyncWarning: Boolean,
        val isEmpty: Boolean,
        val categoryItems: List<Category> = emptyList(),
    )

    class RecoveryRequired : Exception("Workspace recovery code is required")
    class Unreadable : Exception("Cloud workspace could not be verified")

    fun inspect(response: JSONObject): Summary = try {
        inspectVerified(response)
    } catch (error: RecoveryRequired) {
        throw error
    } catch (_: JSONException) {
        throw Unreadable()
    } catch (_: IllegalArgumentException) {
        throw Unreadable()
    } catch (_: GeneralSecurityException) {
        throw Unreadable()
    }

    private fun inspectVerified(response: JSONObject): Summary {
        val workspace = response.getJSONObject("workspace")
        val mode = workspace.getString("keyMode")
        require(mode in setOf("account", "client", "new")) { "Unknown workspace key mode" }
        val tasks = response.optJSONArray("tasks")?.length()?.takeUnless { response.optBoolean("tasksDeferred") }
        val taskLists = response.optJSONArray("taskLists")?.length()?.takeUnless { response.optBoolean("tasksDeferred") }
        val warning = response.optString("syncWarning").let { it.isNotBlank() && it != "null" }
        if (workspace.isNull("envelope")) {
            // No cloud blob exists. This does not authorize overwriting any local draft.
            return Summary(0, null, 0, 0, 0, 0, 0, 0, 0, 0, tasks, taskLists, warning, true)
        }
        if (mode != "account") throw RecoveryRequired()
        val key = WorkspaceCipher.decodeKey(workspace.getString("key"))
        try {
            val envelope = workspace.getJSONObject("envelope")
            val version = envelope.getLong("version")
            require(version > 0) { "Invalid cloud workspace version" }
            val encrypted = WorkspaceCipher.Envelope(envelope.getString("ciphertext"), envelope.getString("iv"))
            val plain = WorkspaceCipher.decrypt(encrypted, key)
            try {
                val document = CloudWorkspaceMigration.normalize(JSONObject(plain.toString(Charsets.UTF_8)))
                fun count(name: String): Int = document.getJSONArray(name).length()
                val categoryRows = document.getJSONArray("categories")
                val categoryItems = (0 until categoryRows.length()).mapNotNull { index ->
                    val item = categoryRows.optJSONObject(index) ?: return@mapNotNull null
                    val id = item.optString("id")
                    val name = item.optString("name")
                    if (id.isBlank() || name.isBlank()) null else Category(id, name, item.optString("color"))
                }
                return Summary(version, envelope.optString("updatedAt").takeIf { it.isNotBlank() },
                    count("projects"), count("categories"), count("habits"), count("habitCompletions"),
                    count("sleepEntries"), count("moodEntries"), count("rewardTransactions"),
                    count("quests"), tasks, taskLists, warning, false, categoryItems)
            } finally {
                plain.fill(0)
            }
        } finally {
            key.fill(0)
        }
    }
}
