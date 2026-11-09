package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Server-owned lifecycle. No optimistic destructive action or local recovery substitute. */
interface SharedTaskLifecycleGateway {
    suspend fun sharedTaskArchive(space: String, query: String, cursor: String?): JSONObject = throw UnsupportedOperationException("sharedTaskArchive")
    suspend fun sharedTaskTrash(space: String): JSONObject = throw UnsupportedOperationException("sharedTaskTrash")
    suspend fun sharedTaskArchiveCommand(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTaskArchiveCommand")
    suspend fun sharedTaskTrashCommand(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTaskTrashCommand")
    suspend fun sharedTrashRestore(space: String, kind: String, id: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTrashRestore")
    suspend fun sharedTrashPurge(space: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTrashPurge")
}

internal fun allowedSharedTaskExtensionRoute(method: String, path: String): Boolean {
    val id = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
    return when {
        path.matches(Regex("/shared/spaces/$id/trash")) -> method == "GET"
        path.matches(Regex("/shared/spaces/$id/trash/(?:task|project)/$id")) -> method == "PATCH"
        path.matches(Regex("/shared/spaces/$id/trash/task/$id/purge")) -> method == "POST"
        path.matches(Regex("/shared/projects/$id/tasks/$id/archive")) -> method == "POST"
        path.matches(Regex("/shared/projects/$id/tasks/$id")) -> method == "DELETE"
        path.matches(Regex("/shared/projects/$id/tasks/$id/approve")) -> method == "POST"
        path.matches(Regex("/shared/projects/$id/tasks/$id/reviews")) -> method == "PATCH"
        path.matches(Regex("/shared/projects/$id/review-settings")) -> method in setOf("GET", "PATCH")
        path.matches(Regex("/shared/projects/$id/tasks/$id/series")) -> method in setOf("GET", "POST")
        path.matches(Regex("/shared/tasks/$id/attachments/$id")) -> method == "GET"
        else -> false
    }
}

internal object SharedTaskLifecycleProtocol {
    fun id(value: String): String = value.also { require(Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}").matches(it)) { "LIFECYCLE_SCOPE_INVALID" } }
    fun task(task: JSONObject) {
        id(task.getString("id")); id(task.getString("projectId"))
        require(task.opt("revision") is Number && task.getLong("revision") >= 1 && !task.optBoolean("pending")) { "SHARED_TASK_CONFLICT" }
    }
    fun rows(response: JSONObject): List<JSONObject> {
        val rows = response.getJSONArray("items")
        require(rows.length() <= 10000) { "TRASH_PROTOCOL" }
        return (0 until rows.length()).map { index -> JSONObject(rows.getJSONObject(index).toString()).also {
            id(it.getString("id")); require(it.getString("kind") in setOf("task", "project")) { "TRASH_PROTOCOL" }
            require(it.opt("title") is String && it.opt("canRestore") is Boolean && it.getInt("retentionDays") in 1..30) { "TRASH_PROTOCOL" }
            Instant.parse(it.getString("expiresAt"))
            it.optString("projectId").takeIf { value -> value.isNotBlank() && value != "null" }?.let(::id)
        } }
    }
    fun archive(task: JSONObject, archived: Boolean, requestId: String) = JSONObject().also {
        SharedTaskLifecycleProtocol.task(task); id(requestId); it.put("archived", archived).put("expectedRevision", task.getLong("revision")).put("requestId", requestId)
    }
    fun trash(task: JSONObject, retention: Int, requestId: String) = JSONObject().also {
        SharedTaskLifecycleProtocol.task(task); require(retention in 1..30); id(requestId)
        it.put("retentionDays", retention).put("expectedRevision", task.getLong("revision")).put("requestId", requestId)
    }
    fun restore(item: JSONObject, requestId: String, retention: Int? = null): JSONObject {
        require(item.getBoolean("canRestore")) { "SHARED_PROJECT_FORBIDDEN" }; id(item.getString("id")); id(requestId)
        require(item.getString("kind") in setOf("task", "project")); Instant.parse(item.getString("expiresAt"))
        return JSONObject().put("requestId", requestId).put("expectedExpiresAt", item.getString("expiresAt"))
            .apply { retention?.let { require(it in 1..30); put("retentionDays", it) } }
    }
    fun purge(item: JSONObject, requestId: String, confirmed: Boolean): JSONObject {
        require(confirmed && item.getString("kind") == "task" && item.optBoolean("canPurge")) { "TRASH_PURGE_FORBIDDEN" }
        id(item.getString("id")); id(requestId); Instant.parse(item.getString("expiresAt"))
        return JSONObject().put("requestId", requestId).put("expectedExpiresAt", item.getString("expiresAt")).put("confirmPermanent", true)
    }
}

/** The identical body reuses its id after a lost response; edited commands get a new id. */
internal class SharedTaskCommandIdentity {
    private var previous = ""
    private var request = ""
    fun forBody(body: JSONObject): String {
        val fingerprint = canonical(body)
        if (fingerprint != previous) { previous = fingerprint; request = UUID.randomUUID().toString() }
        return request
    }
    private fun canonical(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }
}
