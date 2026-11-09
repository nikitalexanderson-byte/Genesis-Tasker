package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Read-only reports never share a command journal, task queue or persisted report token. */
internal object SprintReportProtocol {
    val units = listOf("tasks", "points", "hours")
    val metrics = setOf("plan", "alreadyDone", "committed", "scope", "remaining", "done", "delivered", "carried", "reopened")
    val errors = setOf("REPORT_CHANGED", "REPORT_TOKEN_INVALID", "REPORT_INVALID", "REPORT_METRIC_INVALID", "SPRINT_REPORT_UNIT_INVALID",
        "SPRINT_REPORT_HISTORY_INVALID", "SPRINT_REPORT_TOO_LARGE", "SPRINT_REPORT_CONTEXT_INVALID", "PLANNING_PROJECT_REQUIRED")
    private val invalid get() = "SPRINT_REPORT_INVALID"
    fun rows(value: JSONArray) = (0 until value.length()).map(value::getJSONObject)
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun text(value: JSONObject, key: String, max: Int, nullable: Boolean = false): Any {
        if (nullable && value.has(key) && value.isNull(key)) return JSONObject.NULL
        val raw = value.get(key); require(raw is String && raw.length <= max) { invalid }; return raw
    }
    private fun id(value: JSONObject, key: String): String = text(value, key, 200).toString().also { require(PlanningLifecycle.id(it)) { invalid } }
    // The server retains two project-scoped inbox statuses outside the 30 ordinary board statuses.
    private fun hiddenStatusPosition(status: String, project: String): Int? = when (status) {
        "chaos-open:$project" -> -2
        "chaos-done:$project" -> -1
        else -> null
    }
    private fun validStatusId(status: String, project: String) = status.length <= 200 &&
        (PlanningLifecycle.id(status) || hiddenStatusPosition(status, project) != null)
    private fun statusId(value: JSONObject, project: String): String = text(value, "id", 200).toString().also { require(validStatusId(it, project)) { invalid } }
    private fun statusPosition(value: Any, hidden: Int?): Number {
        if (hidden == null) return count(value)
        require((value is Int || value is Long) && (value as Number).toLong() == hidden.toLong()) { invalid }
        return hidden
    }
    private fun bool(value: JSONObject, key: String): Boolean = value.get(key).also { require(it is Boolean) { invalid } } as Boolean
    private fun count(raw: Any): Long {
        require(raw is Int || raw is Long) { invalid }
        return (raw as Number).toLong().also { require(it in 0..Int.MAX_VALUE.toLong()) { invalid } }
    }
    private fun number(raw: Any, signed: Boolean = false): Number {
        require(raw is Number && raw.toDouble().isFinite() && (signed || raw.toDouble() >= 0)) { invalid }; return raw
    }
    fun instant(raw: String): Instant = Instant.parse(if (Regex("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}").matches(raw)) raw.replace(' ', 'T') + "Z" else raw)
    private fun stamp(value: JSONObject, key: String): String = text(value, key, 100).toString().also { instant(it) }
    private fun date(value: JSONObject, key: String): String = text(value, key, 10).toString().also { require(LocalDate.parse(it).toString() == it) { invalid } }
    private fun context(value: JSONObject): JSONObject {
        val version = count(value.get("version")); require(version in 1..2) { invalid }
        val zone = text(value, "timeZone", 200).toString(); ZoneId.of(zone)
        val start = text(value, "gregorianYearStart", 10).toString(); require(start in setOf("january", "march")) { invalid }
        return JSONObject().put("version", version).put("timeZone", zone).put("gregorianYearStart", start)
    }
    private fun period(value: JSONObject) = JSONObject().put("startDate", date(value, "startDate")).put("endDate", date(value, "endDate"))
        .put("calendarMode", text(value, "calendarMode", 10).also { require(it in setOf("profane", "sacred", "lunar")) { invalid } })
        .put("calendarContext", context(value.getJSONObject("calendarContext")))
    fun metric(value: JSONObject, withValue: Boolean = true): JSONObject = JSONObject().apply {
        for (key in listOf("tasks", "unestimated")) put(key, if (value.isNull(key)) { require(value.has(key)) { invalid }; JSONObject.NULL } else count(value.get(key)))
        put("knownValue", if (value.isNull("knownValue")) { require(value.has("knownValue")) { invalid }; JSONObject.NULL } else number(value.get("knownValue")))
        if (withValue) put("value", if (value.isNull("value")) { require(value.has("value")) { invalid }; JSONObject.NULL } else number(value.get("value")))
        if (value.has("unknownTasks")) put("unknownTasks", count(value.get("unknownTasks")))
        if (value.has("historyComplete")) put("historyComplete", bool(value, "historyComplete"))
    }
    fun emptyMetric(observed: Boolean): JSONObject = JSONObject().put("tasks", if (observed) 0 else JSONObject.NULL)
        .put("unestimated", 0).put("knownValue", if (observed) 0 else JSONObject.NULL).put("value", if (observed) 0 else JSONObject.NULL)
    private fun metricMap(value: Any, project: String): JSONObject {
        if (value is JSONArray) { require(value.length() == 0) { invalid }; return JSONObject() }
        require(value is JSONObject && value.length() <= 20_030) { invalid }
        return JSONObject().apply { (value as JSONObject).keys().forEach { key -> require(validStatusId(key, project)) { invalid }; put(key, metric(value.getJSONObject(key))) } }
    }
    fun snapshot(project: String, sprint: String, unit: String, value: JSONObject, offline: Boolean = false): JSONObject {
        require(unit in units && id(value, "projectId") == project) { invalid }
        val record = value.getJSONObject("sprint"); require(id(record, "id") == sprint && id(record, "projectId") == project) { invalid }
        val sprintState = text(record, "state", 20).toString(); require(sprintState in setOf("planning", "active", "completed")) { invalid }
        val cleanSprint = period(record).put("id", sprint).put("projectId", project).put("title", text(record, "title", 1000)).put("state", sprintState)
        val launch = period(value.getJSONObject("launch")); val launchUnit = value.getJSONObject("launch").opt("estimateUnit")
        require(launchUnit == null || launchUnit == JSONObject.NULL || launchUnit in setOf("points", "hours")) { invalid }
        launch.put("estimateUnit", launchUnit ?: JSONObject.NULL)
        val statuses = rows(value.getJSONArray("statuses")); require(statuses.size <= 32) { invalid }
        val statusIds = statuses.map { statusId(it, project) }
        require(statusIds.distinct().size == statuses.size && statusIds.count { hiddenStatusPosition(it, project) == null } <= 30) { invalid }
        val cleanStatuses = statuses.zip(statusIds).map { (status, identifier) ->
            val done = status.get("isDone"); require(done is Boolean || done is Int && done in 0..1) { invalid }
            JSONObject().put("id", identifier).put("title", text(status, "title", 1000)).put("color", text(status, "color", 50, true))
                .put("position", statusPosition(status.get("position"), hiddenStatusPosition(identifier, project))).put("revision", count(status.get("revision"))).put("isDone", done == true || done == 1)
        }
        val flow = value.getJSONObject("flow"); require(text(flow, "unit", 10) == unit) { invalid }
        val cleanFlow = JSONObject().put("available", bool(flow, "available")).put("unit", unit)
        if (!flow.getBoolean("available")) {
            cleanFlow.put("reason", text(flow, "reason", 200)).put("series", JSONArray()).put("summary", JSONObject.NULL).put("gaps", JSONArray())
        } else {
            require(text(flow, "resolution", 10) == "day") { invalid }
            val zone = text(flow, "timeZone", 200).toString(); ZoneId.of(zone)
            cleanFlow.put("resolution", "day").put("timeZone", zone).put("from", stamp(flow, "from")).put("to", stamp(flow, "to"))
                .put("terminal", bool(flow, "terminal")).put("historyComplete", bool(flow, "historyComplete")).put("scopeChangeCount", count(flow.get("scopeChangeCount")))
            val summary = flow.getJSONObject("summary"); val cleanSummary = JSONObject()
            metrics.filterNot { it == "reopened" }.forEach { key -> cleanSummary.put(key, metric(summary.getJSONObject(key))) }
            val coverage = text(summary, "scopeChangeCoverage", 20).toString(); require(coverage in setOf("observed", "partial")) { invalid }
            for (key in listOf("added", "removed")) {
                val row = metric(summary.getJSONObject(key), false)
                row.put("value", if (coverage == "observed") row.get("knownValue") else JSONObject.NULL); cleanSummary.put(key, row)
            }
            cleanSummary.put("scopeChangeCoverage", coverage).put("estimateDelta", number(summary.get("estimateDelta"), true))
                .put("unestimatedDelta", number(summary.get("unestimatedDelta"), true))
            for (key in listOf("completionTransitions", "completedTasksCount", "reopenedTasksCount")) cleanSummary.put(key, count(summary.get(key)))
            cleanFlow.put("summary", cleanSummary)
            val points = rows(flow.getJSONArray("series")); require(points.size <= 20_003) { invalid }
            var previous: Instant? = null
            val cleanPoints = points.map { point ->
                val at = stamp(point, "at"); val time = instant(at); require(previous == null || !time.isBefore(previous)) { invalid }; previous = time
                val pointCoverage = text(point, "coverage", 20).toString(); require(pointCoverage in setOf("observed", "partial")) { invalid }
                JSONObject().put("at", at).put("date", date(point, "date")).put("sequence", count(point.get("sequence")))
                    .put("firstSequence", count(point.get("firstSequence"))).put("sourceCount", count(point.get("sourceCount")))
                    .put("sourceKind", text(point, "sourceKind", 100)).put("connectPrevious", bool(point, "connectPrevious"))
                    .put("coverage", pointCoverage).put("unknownTasks", count(point.get("unknownTasks"))).apply {
                        for (key in listOf("scope", "remaining", "done", "wip")) put(key, metric(point.getJSONObject(key)))
                        for (key in listOf("statuses", "wipStatuses")) put(key, metricMap(point.get(key), project))
                        for (key in listOf("historyGap", "gapWithinBucket")) if (point.has(key)) put(key, bool(point, key))
                    }
            }
            cleanFlow.put("series", JSONArray(cleanPoints))
            val gaps = rows(flow.getJSONArray("gaps")); require(gaps.size <= 20_000) { invalid }
            cleanFlow.put("gaps", JSONArray(gaps.map { gap -> JSONObject().put("reason", text(gap, "reason", 200)) }))
        }
        return JSONObject().put("asOf", stamp(value, "asOf")).put("projectId", project).put("sprint", cleanSprint).put("launch", launch)
            .put("statuses", JSONArray(cleanStatuses)).put("flow", cleanFlow).put("offlineCache", offline).apply {
                if (!offline) put("token", text(value, "token", 32000).also { require(it.toString().isNotBlank()) { invalid } })
            }
    }
    fun offline(value: JSONObject): JSONObject = snapshot(value.getString("projectId"), value.getJSONObject("sprint").getString("id"), value.getJSONObject("flow").getString("unit"), value, true)
    fun query(kind: String, metric: String = "scope", date: String? = null): JSONObject {
        require(kind in setOf("tasks", "events", "changes") && (kind != "tasks" || metric in metrics) && (date == null || kind != "tasks")) { invalid }
        return JSONObject().put("kind", kind).apply { if (kind == "tasks") put("metric", metric); if (date != null) { require(LocalDate.parse(date).toString() == date) { invalid }; put("date", date) } }
    }
    private fun task(value: JSONObject) = JSONObject().put("id", id(value, "id")).put("projectId", id(value, "projectId"))
        .put("title", text(value, "title", 1000)).put("archived", bool(value, "archived")).put("revision", count(value.get("revision")))
    private fun observation(value: Any): Any {
        if (value == JSONObject.NULL) return JSONObject.NULL
        require(value is JSONObject) { invalid }
        return JSONObject().put("taskId", id(value, "taskId")).put("revision", count(value.get("revision")))
            .put("statusId", text(value, "statusId", 200, true)).put("sprintId", text(value, "sprintId", 200, true))
            .put("done", bool(value, "done")).put("active", bool(value, "active")).apply {
                for (key in listOf("storyPoints", "estimateHours")) put(key, if (value.isNull(key)) JSONObject.NULL else number(value.get(key)))
            }
    }
    fun sources(report: JSONObject, query: JSONObject, value: JSONObject, previous: JSONObject? = null): JSONObject {
        require(!report.optBoolean("offlineCache") && stamp(value, "asOf") == report.getString("asOf")) { invalid }
        val kind = query.getString("kind"); val selection = SprintReportProtocol.query(kind, query.optString("metric", "scope"), query.optString("date").takeIf { it.isNotEmpty() })
        val incoming = rows(value.getJSONArray("items")); require(incoming.size <= 100) { invalid }
        val total = count(value.get("total")); val unavailable = count(value.get("unavailable"))
        val result = incoming.map { item ->
            if (item.has("unavailable") && bool(item, "unavailable")) JSONObject().put("unavailable", true).put("id", text(item, "id", 500)).put("sequence", count(item.get("sequence")))
                .put("at", stamp(item, "at")).put("action", text(item, "action", 200))
            else (if (kind == "tasks") task(item) else JSONObject().put("id", if (kind == "changes")
                text(item, "sourceId", 500).toString() + ":" + id(item.getJSONObject("task"), "id") + ":" + text(item, "kind", 200)
                else text(item, "id", 500))).apply {
                if (item.has("task")) put("task", task(item.getJSONObject("task")))
                for (key in listOf("observed", "before", "after")) if (item.has(key)) put(key, observation(item.get(key)))
                for (key in listOf("at")) if (item.has(key)) put(key, stamp(item, key))
                for (key in listOf("kind", "action")) if (item.has(key)) put(key, text(item, key, 200))
                if (item.has("sequence")) put("sequence", count(item.get("sequence")))
                for (key in listOf("leftScope", "completionCarry")) if (item.has(key)) put(key, bool(item, key))
                val reference = if (kind == "tasks") getString("id") else optJSONObject("task")?.getString("id")
                if (reference != null) for (key in listOf("observed", "before", "after")) optJSONObject(key)?.let { require(it.getString("taskId") == reference) { invalid } }
            }
        }
        val old = previous?.let { require(it.getLong("total") == total && it.getString("asOf") == report.getString("asOf") &&
            PlanningLifecycle.canonical(it.getJSONObject("selection")) == PlanningLifecycle.canonical(selection)) { "REPORT_CHANGED" }; rows(it.getJSONArray("items")) }.orEmpty()
        val combined = old + result; require(combined.size <= total && combined.map { it.getString("id") }.distinct().size == combined.size) { invalid }
        val cursor = text(value, "nextCursor", 32000, true); require(cursor == JSONObject.NULL || result.isNotEmpty() && combined.size < total && cursor.toString().isNotBlank()) { invalid }
        require((cursor == JSONObject.NULL) == (combined.size.toLong() == total)) { invalid }
        return JSONObject().put("items", JSONArray(combined)).put("total", total).put("unavailable", unavailable).put("nextCursor", cursor).put("asOf", report.getString("asOf")).put("selection", copy(selection))
    }
}
