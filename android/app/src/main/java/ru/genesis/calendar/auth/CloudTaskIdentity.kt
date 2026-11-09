package ru.genesis.calendar.auth

import java.security.MessageDigest
import org.json.JSONObject

/** Bootstrap adds an account namespace to external Google IDs; mutation routes take the underlying ID. */
internal object CloudTaskIdentity {
    private val importedId = Regex("[A-Za-z0-9_-]{1,256}")
    private val mutationId = Regex("[A-Za-z0-9_-]{1,100}")

    fun requireImportedId(id: String) { require(importedId.matches(id)) }

    data class Mutation(val localId: String, val remoteId: String, val body: JSONObject) {
        fun confirmed(response: JSONObject): JSONObject {
            val result = JSONObject(response.toString())
            val saved = result.getJSONObject("task")
            require(saved.getString("id") == remoteId) { "Server returned another task" }
            saved.put("id", localId)
            return result
        }
    }

    fun mutation(id: String, task: JSONObject): Mutation {
        requireImportedId(id)
        require(task.getString("id") == id)
        val account = task.optString("googleAccountId").takeUnless { task.isNull("googleAccountId") || it.isBlank() }
        val external = task.optString("createdIn") in setOf("google-calendar", "google-tasks")
        val prefix = account?.let {
            "account-" + MessageDigest.getInstance("SHA-256").digest(it.toByteArray(Charsets.UTF_8))
                .joinToString("") { byte -> "%02x".format(byte) }.take(10) + "-"
        }
        // Remove only the verified outer namespace. Older website edits can leave
        // another prefix inside the original ID; stripping it would rename the task.
        val remoteId = if (external && prefix != null && id.startsWith(prefix)) id.removePrefix(prefix) else id
        require(mutationId.matches(remoteId)) { "Task identifier is not supported by the mutation route" }
        return Mutation(id, remoteId, JSONObject(task.toString()).put("id", remoteId))
    }
}
