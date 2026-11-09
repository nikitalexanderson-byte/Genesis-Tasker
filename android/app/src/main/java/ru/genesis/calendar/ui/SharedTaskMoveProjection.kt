package ru.genesis.calendar.ui

import org.json.JSONObject

/** Move receipts may contain only identity, revision and placement, never a complete reader card. */
internal fun sharedMovedTaskProjection(task: JSONObject, receipt: JSONObject, projectId: String, statusId: String): JSONObject {
    require(receipt.getString("id") == task.getString("id")) { "SHARED_TASK_CONFLICT" }
    require(!receipt.has("projectId") || receipt.getString("projectId") == projectId) { "SHARED_TASK_CONFLICT" }
    return JSONObject(task.toString()).apply {
        put("projectId", projectId); put("statusId", statusId); put("pending", false)
        receipt.keys().forEach { key -> put(key, receipt.get(key)) }
    }
}
