package ru.genesis.calendar.ui

import java.math.BigDecimal
import org.json.JSONObject

internal const val SHARED_ESTIMATE_DRAFT_KEY = "_genesisEstimateDraft"

/** Editor intent only. This object is saved locally and never sent as a task field. */
internal data class SharedTaskEstimateDraft(
    val taskId: String,
    val baseStoryPoints: Double?,
    val baseEstimateHours: Double?,
    val storyPoints: String,
    val estimateHours: String,
    val touchedStoryPoints: Boolean = false,
    val touchedEstimateHours: Boolean = false,
) {
    fun points(value: String) = copy(storyPoints = value, touchedStoryPoints = true)
    fun hours(value: String) = copy(estimateHours = value, touchedEstimateHours = true)

    fun patch(): JSONObject = JSONObject().apply {
        if (touchedStoryPoints) parseSharedEstimate(storyPoints).let { value ->
            if (value != baseStoryPoints) put("storyPoints", value ?: JSONObject.NULL)
        }
        if (touchedEstimateHours) parseSharedEstimate(estimateHours).let { value ->
            if (value != baseEstimateHours) put("estimateHours", value ?: JSONObject.NULL)
        }
    }

    val valid: Boolean get() = runCatching { parseSharedEstimate(storyPoints); parseSharedEstimate(estimateHours) }.isSuccess
    val dirty: Boolean get() = runCatching { patch().length() > 0 }.getOrDefault(true)

    fun rebase(task: JSONObject): SharedTaskEstimateDraft {
        val fresh = fromTask(task)
        require(fresh.taskId == taskId) { "PLANNING_TASK_DRAFT_SCOPE" }
        return fresh.copy(
            storyPoints = if (touchedStoryPoints) storyPoints else fresh.storyPoints,
            estimateHours = if (touchedEstimateHours) estimateHours else fresh.estimateHours,
            touchedStoryPoints = touchedStoryPoints,
            touchedEstimateHours = touchedEstimateHours,
        )
    }

    fun saved(): JSONObject = JSONObject().put("version", 1).put("taskId", taskId)
        .put("baseStoryPoints", baseStoryPoints ?: JSONObject.NULL)
        .put("baseEstimateHours", baseEstimateHours ?: JSONObject.NULL)
        .put("storyPoints", storyPoints).put("estimateHours", estimateHours)
        .put("touchedStoryPoints", touchedStoryPoints).put("touchedEstimateHours", touchedEstimateHours)

    companion object {
        fun fromTask(task: JSONObject): SharedTaskEstimateDraft {
            val points = sharedEstimateNumber(task, "storyPoints")
            val hours = sharedEstimateNumber(task, "estimateHours")
            return SharedTaskEstimateDraft(task.optString("id"), points, hours, sharedEstimateInput(points), sharedEstimateInput(hours))
        }

        fun restore(value: JSONObject): SharedTaskEstimateDraft {
            require(value.getInt("version") == 1 && value.keys().asSequence().toSet() == setOf(
                "version", "taskId", "baseStoryPoints", "baseEstimateHours", "storyPoints", "estimateHours",
                "touchedStoryPoints", "touchedEstimateHours")) { "PLANNING_TASK_DRAFT_INVALID" }
            return SharedTaskEstimateDraft(value.getString("taskId"), sharedEstimateNumber(value, "baseStoryPoints"),
                sharedEstimateNumber(value, "baseEstimateHours"), value.getString("storyPoints"), value.getString("estimateHours"),
                value.getBoolean("touchedStoryPoints"), value.getBoolean("touchedEstimateHours"))
        }
    }
}

internal fun parseSharedEstimate(raw: String): Double? {
    if (raw.isEmpty()) return null
    require(raw.length <= 80 && Regex("[+-]?(?:\\d+(?:[.,]\\d*)?|[.,]\\d+)(?:[eE][+-]?\\d+)?").matches(raw)) { "PLANNING_ESTIMATE_INVALID" }
    val value = raw.replace(',', '.').toBigDecimalOrNull() ?: throw IllegalArgumentException("PLANNING_ESTIMATE_INVALID")
    require(value >= BigDecimal.ZERO && value <= BigDecimal("1000000") && value.stripTrailingZeros().scale() <= 2) { "PLANNING_ESTIMATE_INVALID" }
    return value.toDouble()
}

private fun sharedEstimateNumber(value: JSONObject, key: String): Double? {
    if (value.isNull(key)) return null
    require(value.get(key) is Number) { "PLANNING_ESTIMATE_INVALID" }
    return parseSharedEstimate(value.get(key).toString())
}

internal fun sharedEstimateInput(value: Double?): String = value?.let { BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() }.orEmpty()

internal fun sharedTaskEstimates(task: JSONObject, details: JSONObject): SharedTaskEstimateDraft =
    details.optJSONObject(SHARED_ESTIMATE_DRAFT_KEY)?.let { saved -> SharedTaskEstimateDraft.restore(saved).also {
        require(it.taskId == task.optString("id")) { "PLANNING_TASK_DRAFT_SCOPE" }
    } } ?: SharedTaskEstimateDraft.fromTask(task)

internal fun sharedTaskWithEstimates(details: JSONObject, value: SharedTaskEstimateDraft): JSONObject =
    JSONObject(details.toString()).put(SHARED_ESTIMATE_DRAFT_KEY, value.saved())

/** Current permissions take precedence. Only legacy snapshots without the object use their role. */
internal fun sharedTaskCanEdit(project: JSONObject?): Boolean = if (project?.has("permissions") == true)
    project.optJSONObject("permissions")?.optBoolean("editTasks", false) == true
else project?.optString("role") in setOf("owner", "manager", "member")

internal fun sharedTaskHasPending(taskId: String, queue: List<JSONObject>): Boolean = taskId.isNotBlank() &&
    queue.any { it.optString("taskId") == taskId }

/** A queued acknowledgement contains identity, not a replacement for the user's task. */
internal fun sharedPendingTask(current: JSONObject, reply: JSONObject, changes: JSONObject): JSONObject {
    require(reply.optBoolean("pending") && reply.getString("id") == current.getString("id") &&
        reply.getString("projectId") == current.getString("projectId")) { "PLANNING_TASK_ACK_INVALID" }
    return JSONObject(current.toString()).apply {
        changes.keys().forEach { key ->
            if (key == "customFields") {
                val values = ru.genesis.calendar.auth.CustomFieldProtocol.fromTask(current)
                val patch = ru.genesis.calendar.auth.CustomFieldProtocol.values(changes.get(key))
                patch.keys().forEach { id -> values.put(id, patch.get(id)) }
                put(key, values)
            } else if (key !in setOf("expectedRevision", "requestId", SHARED_ESTIMATE_DRAFT_KEY, SHARED_CUSTOM_DRAFT_KEY, SHARED_CUSTOM_CALENDAR_KEY)) put(key, changes.get(key))
        }
        put("pending", true)
    }
}
