package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

interface SharedTaskReviewGateway {
    suspend fun sharedTaskApprove(project: String, task: String): JSONObject = throw UnsupportedOperationException("sharedTaskApprove")
    suspend fun sharedTaskReview(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTaskReview")
    suspend fun sharedTaskApprovers(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTaskApprovers")
    suspend fun sharedTaskReviewSettings(project: String): JSONObject = throw UnsupportedOperationException("sharedTaskReviewSettings")
    suspend fun saveSharedTaskReviewSettings(project: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("saveSharedTaskReviewSettings")
}

internal object SharedTaskReviewProtocol {
    val kinds = listOf("checked", "confirmed", "deletable")
    fun review(task: JSONObject, kind: String, enabled: Boolean): JSONObject {
        SharedTaskLifecycleProtocol.task(task)
        val data = task.getJSONObject("review")
        require(task.optString("completedAt").let { it.isNotBlank() && it != "null" } &&
            data.optBoolean("enabled") && kind in kinds && data.getJSONObject("allowed").optBoolean(kind)) { "REVIEW_FORBIDDEN" }
        return JSONObject().put("kind", kind).put("enabled", enabled).put("expectedRevision", task.getLong("revision"))
    }
    fun approvers(task: JSONObject, enabled: Boolean, selected: Set<String>, members: List<JSONObject>, canConfigure: Boolean): JSONObject {
        SharedTaskLifecycleProtocol.task(task)
        require(canConfigure && task.optString("completedAt").let { it.isBlank() || it == "null" }) { "APPROVAL_CONFIGURATION_FORBIDDEN" }
        require(!enabled || selected.isNotEmpty()) { "INVALID_TASK_APPROVER" }
        require(selected.size <= 200 && selected.all { id -> members.any { it.optString("userId") == id } }) { "INVALID_TASK_APPROVER" }
        return JSONObject().put("approvalRequired", enabled).put("approverIds", JSONArray(if (enabled) selected.sorted() else emptyList<String>()))
            .put("expectedRevision", task.getLong("revision"))
    }
    fun canApprove(task: JSONObject, user: String): Boolean = !task.optBoolean("pending") &&
        task.optString("archivedAt").let { it.isBlank() || it == "null" } && task.optJSONArray("approvals")?.let { rows ->
            (0 until rows.length()).any { rows.getJSONObject(it).let { row -> row.optString("userId") == user && row.isNull("approvedAt") } }
        } == true
    fun policy(value: JSONObject): JSONObject {
        require(value.opt("enabled") is Boolean)
        kinds.forEach { kind -> val rule = value.getJSONObject(kind)
            require(rule.getString("group") in setOf("everyone", "editors", "organizers", "selected"))
            val users = rule.getJSONArray("userIds"); require(users.length() <= 200)
            (0 until users.length()).forEach { require(users.getString(it).length in 1..100) }
        }
        return JSONObject(value.toString())
    }
}
