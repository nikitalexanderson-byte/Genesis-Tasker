package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthFailure
import java.time.LocalDate
import java.time.ZoneId

internal fun planningRows(array: JSONArray?): List<JSONObject> = array?.let { rows ->
    (0 until rows.length()).map { rows.getJSONObject(it) }
}.orEmpty()

internal fun planningAccessLost(error: Exception): Boolean = error is AuthFailure &&
    error.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED)

internal fun planningTaskFilter(projectId: String, bucket: String): JSONObject = JSONObject()
    .put("projectIds", JSONArray().put(projectId)).apply {
        if (bucket == "backlog") put("backlog", true) else put("sprintId", bucket)
    }

/** Pages never cross project, bucket or query-generation boundaries. */
internal fun mergePlanningPage(projectId: String, previous: JSONObject?, next: JSONObject, append: Boolean): JSONObject {
    val rows = planningRows(next.getJSONArray("tasks"))
    require(rows.size <= 100 && rows.all { it.getString("projectId") == projectId }) { "PLANNING_PAGE_INVALID" }
    val version = next.getString("queryVersion")
    require(version.isNotBlank() && next.getInt("total") >= rows.size) { "PLANNING_PAGE_INVALID" }
    if (previous == null || !append) return JSONObject(next.toString())
    require(previous.getString("queryVersion") == version) { "SHARED_QUERY_CHANGED" }
    val combined = planningRows(previous.getJSONArray("tasks")) + rows
    require(combined.all { it.getString("projectId") == projectId } && combined.map { it.getString("id") }.distinct().size == combined.size && combined.size <= next.getInt("total")) { "SHARED_QUERY_CHANGED" }
    return JSONObject(next.toString()).put("tasks", JSONArray(combined))
}

internal fun validatePlanning(projectId: String, data: JSONObject): JSONObject {
    val config = data.getJSONObject("config")
    require(config.getString("estimateUnit") in setOf("points", "hours"))
    config.getBoolean("enabled")
    data.getJSONObject("context").getJSONObject("permissions").let { rights ->
        listOf("editTasks", "organizeTasks", "manageProjects").forEach { rights.getBoolean(it) }
    }
    val ids = mutableSetOf("backlog")
    planningRows(data.getJSONArray("sprints")).forEach { sprint ->
        require(sprint.getString("projectId") == projectId && ids.add(sprint.getString("id")))
        require(sprint.getString("state") in setOf("planning", "active", "completed"))
        require(LocalDate.parse(sprint.getString("endDate")) >= LocalDate.parse(sprint.getString("startDate")))
        require(sprint.getString("calendarMode") in setOf("sacred", "profane", "lunar"))
        val context = sprint.getJSONObject("calendarContext")
        require(context.getInt("version") in 1..2)
        ZoneId.of(context.getString("timeZone"))
        require(context.getString("gregorianYearStart") in setOf("january", "march"))
    }
    val totals = data.getJSONObject("totals")
    ids.forEach { id -> validatePlanningTotals(totals.getJSONObject(id)) }
    val members = data.getJSONObject("byAssignee")
    members.keys().forEach { bucket ->
        require(bucket in ids)
        members.getJSONObject(bucket).let { group -> group.keys().forEach { validatePlanningTotals(group.getJSONObject(it)) } }
    }
    return data
}

private fun validatePlanningTotals(totals: JSONObject) {
    val count = totals.getInt("count")
    require(count >= 0 && totals.getInt("completed") in 0..count)
    for (unit in listOf("points", "hours")) {
        val values = totals.getJSONObject(unit)
        require(values.getDouble("value").let { it.isFinite() && it >= 0 } && values.getInt("unestimated") in 0..count)
    }
}

internal fun planningAssignment(data: JSONObject, projectId: String, task: JSONObject, destination: String?, pending: Boolean): JSONObject {
    require(!pending && !data.optBoolean("offlineCache") && data.getJSONObject("config").getBoolean("enabled")) { "PLANNING_PERMISSION_CHANGED" }
    val rights = data.getJSONObject("context").getJSONObject("permissions")
    require(rights.getBoolean("editTasks") && rights.getBoolean("organizeTasks")) { "PLANNING_PERMISSION_CHANGED" }
    require(task.getString("projectId") == projectId && !task.optBoolean("pending") && task.isNull("archivedAt")) { "PLANNING_TASK_UNAVAILABLE" }
    val source = task.optString("sprintId").takeUnless { it.isBlank() || it == "null" }
    val sprints = planningRows(data.getJSONArray("sprints"))
    require(destination != source && (destination == null || sprints.any { it.getString("id") == destination && it.getString("state") != "completed" })) { "PLANNING_TASK_DESTINATION" }
    return JSONObject().put("sprintId", destination ?: JSONObject.NULL).put("expectedRevision", task.getInt("revision"))
}
