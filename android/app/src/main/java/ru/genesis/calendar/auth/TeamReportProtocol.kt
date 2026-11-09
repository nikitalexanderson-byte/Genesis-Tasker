package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Exact server selections and per-project estimate scales; report tokens stay in screen memory. */
internal object TeamReportProtocol {
    val errors = setOf("REPORT_CHANGED", "REPORT_STATUS_CHANGED", "REPORT_PERIOD_INVALID", "REPORT_CONTEXT_INVALID", "REPORT_INVALID",
        "REPORT_TOKEN_INVALID", "REPORT_METRIC_INVALID", "SHARED_QUERY_CHANGED", "INVALID_TASK_FILTER")
    private val keyPattern = Regex("[A-Za-z0-9:_-]{1,200}")
    private fun valid(ok: Boolean) { require(ok) { "REPORT_INVALID" } }
    private fun copy(raw: JSONObject) = JSONObject(raw.toString())
    private inline fun <T> checked(action: () -> T): T = try { action() } catch (failure: Exception) {
        if (failure is IllegalArgumentException && failure.message in errors) throw failure
        throw IllegalArgumentException("REPORT_INVALID", failure)
    }
    private fun text(raw: JSONObject, key: String, max: Int = 1000, nullable: Boolean = false): String? {
        if (nullable && raw.has(key) && raw.isNull(key)) return null
        val value = raw.opt(key); valid(value is String && value.length <= max); return value as String
    }
    private fun id(raw: JSONObject, key: String) = text(raw, key, 200)!!.also { valid(keyPattern.matches(it)) }
    private fun count(raw: JSONObject, key: String): Int {
        val value = raw.opt(key); valid(value is Int || value is Long)
        val number = (value as Number).toLong(); valid(number in 0..Int.MAX_VALUE.toLong()); return number.toInt()
    }
    private fun number(raw: JSONObject, key: String, nullable: Boolean = false): Double? {
        if (nullable && raw.has(key) && raw.isNull(key)) return null
        val value = raw.opt(key); valid(value is Number && value.toDouble().isFinite() && value.toDouble() >= 0); return (value as Number).toDouble()
    }
    private fun bool(raw: JSONObject, key: String): Boolean { val value = raw.opt(key); valid(value is Boolean); return value as Boolean }
    private fun rows(raw: JSONObject, key: String, max: Int): List<JSONObject> {
        val values = raw.getJSONArray(key); valid(values.length() <= max)
        return (0 until values.length()).map { values.getJSONObject(it) }
    }
    private fun identities(values: List<JSONObject>, key: String = "id"): Set<String> = values.map { id(it, key) }.also { valid(it.distinct().size == it.size) }.toSet()
    private fun date(raw: JSONObject, key: String): LocalDate {
        val value = text(raw, key, 10)!!; val parsed = LocalDate.parse(value)
        valid(parsed.toString() == value && parsed.year in 1900..2100); return parsed
    }
    private fun context(raw: JSONObject) {
        valid(raw.keys().asSequence().toSet() == setOf("version", "timeZone", "gregorianYearStart") && raw.opt("version") == 2)
        valid(DataExportProtocol.timeZone(text(raw, "timeZone", 200)!!) != null && raw.opt("gregorianYearStart") in setOf("january", "march"))
    }
    private fun period(raw: JSONObject): Pair<LocalDate, LocalDate> {
        val from = date(raw, "from"); val to = date(raw, "to"); valid(ChronoUnit.DAYS.between(from, to) in 0..3659)
        valid(raw.opt("calendarMode") in setOf("profane", "sacred", "lunar")); context(raw.getJSONObject("calendarContext")); return from to to
    }
    private fun filter(raw: JSONObject) { valid(raw.toString().toByteArray(Charsets.UTF_8).size <= 8000) }
    fun options(raw: JSONObject): JSONObject = checked {
        valid(raw.keys().asSequence().toSet() == setOf("filter", "from", "to", "calendarMode", "calendarContext", "cycleStartStatusIds"))
        val (from, to) = try { date(raw, "from") to date(raw, "to") } catch (failure: Exception) { throw IllegalArgumentException("REPORT_PERIOD_INVALID", failure) }
        require(ChronoUnit.DAYS.between(from, to) in 0..3659) { "REPORT_PERIOD_INVALID" }
        require(raw.opt("calendarMode") in setOf("profane", "sacred", "lunar")) { "REPORT_CONTEXT_INVALID" }
        try { context(raw.getJSONObject("calendarContext")) } catch (failure: Exception) { throw IllegalArgumentException("REPORT_CONTEXT_INVALID", failure) }
        filter(raw.getJSONObject("filter")); val starts = raw.getJSONArray("cycleStartStatusIds"); valid(starts.length() <= 100)
        val ids = (0 until starts.length()).map { starts.getString(it).also { key -> valid(keyPattern.matches(key) && key.length <= 100) } }
        valid(ids.distinct().size == ids.size); copy(raw)
    }
    fun token(value: String) = value.also { valid(it.isNotBlank() && it.length < 32000) }
    fun snapshot(options: JSONObject, raw: JSONObject): JSONObject = checked {
        val request = options(options); valid(!raw.optBoolean("offlineCache")); token(text(raw, "token", 31999)!!)
        SprintReportProtocol.instant(text(raw, "asOf", 100)!!)
        val actualPeriod = raw.getJSONObject("period"); val (from, to) = period(actualPeriod)
        for (key in listOf("from", "to", "calendarMode", "calendarContext")) valid(PlanningLifecycle.canonical(actualPeriod.get(key)) == PlanningLifecycle.canonical(request.get(key)))
        val resolvedFilter = when (val value = raw.opt("filter")) {
            is JSONObject -> value.also(::filter)
            is JSONArray -> { valid(value.length() == 0); JSONObject() }
            else -> { valid(false); JSONObject() }
        }
        val catalog = raw.getJSONObject("catalog")
        val projects = rows(catalog, "projects", 20_000); val projectIds = identities(projects)
        projects.forEach { id(it, "spaceId"); text(it, "title") }
        val statuses = rows(catalog, "statuses", 300_000); identities(statuses)
        statuses.forEach { valid(id(it, "projectId") in projectIds); text(it, "title"); bool(it, "isDone"); count(it, "revision") }
        val catalogMembers = rows(catalog, "members", 100_000); identities(catalogMembers); catalogMembers.forEach { text(it, "title") }
        val fields = rows(catalog, "customFieldDefinitions", 20_000); identities(fields)
        fields.forEach { text(it, "title"); valid(it.opt("type") in setOf("text", "number", "date", "select", "multi", "checkbox", "url")) }
        val metrics = linkedMapOf<String, Int>()
        fun metric(value: JSONObject, expected: String): Int {
            valid(text(value, "key", 300) == expected); val count = count(value, "count")
            valid(!metrics.containsKey(expected) || metrics[expected] == count); metrics[expected] = count; return count
        }
        val summary = raw.getJSONObject("summary"); val all = metric(summary.getJSONObject("all"), "all")
        val open = metric(summary.getJSONObject("open"), "open"); val completed = metric(summary.getJSONObject("completed"), "completed")
        valid(open.toLong() + completed == all.toLong())
        for (key in listOf("overdue", "unassigned")) valid(metric(summary.getJSONObject(key), key) <= all)
        val members = rows(raw, "members", 100_000); identities(members)
        var memberCount = 0L
        members.forEach { row ->
            val id = id(row, "id"); text(row, "title", nullable = true)
            val total = metric(row.getJSONObject("all"), "member:$id"); memberCount += total
            valid(metric(row.getJSONObject("open"), "member-open:$id").toLong() + metric(row.getJSONObject("completed"), "member-completed:$id") == total.toLong())
        }; valid(memberCount == all.toLong())
        val stages = rows(raw, "stages", 300_000); identities(stages)
        stages.forEach { row -> val id = id(row, "id"); text(row, "title", nullable = true)
            valid(row.has("projectId") && (row.isNull("projectId") || id(row, "projectId") in projectIds)); number(row, "seconds")
            valid(metric(row.getJSONObject("tasks"), "stage:$id") <= all) }
        val ages = rows(raw, "ages", 5); valid(identities(ages) == setOf("week", "month", "quarter", "older", "unknown"))
        valid(ages.sumOf { metric(it.getJSONObject("tasks"), "age:${it.getString("id")}").toLong() } == open.toLong())
        val cycle = raw.getJSONObject("cycle"); val known = metric(cycle.getJSONObject("known"), "cycle:known"); val unknown = metric(cycle.getJSONObject("unknown"), "cycle:unknown")
        valid(known.toLong() + unknown == count(cycle, "eligible").toLong() && count(cycle, "eligible") <= completed)
        for (key in listOf("meanSeconds", "medianSeconds")) valid((number(cycle, key, nullable = true) == null) == (known == 0))
        valid(metric(raw.getJSONObject("unknown"), "history:unknown") <= all)
        val daily = rows(raw, "daily", 3660); valid(daily.size.toLong() == ChronoUnit.DAYS.between(from, to) + 1)
        daily.forEachIndexed { index, row ->
            val day = date(row, "date"); valid(day == from.plusDays(index.toLong()) && row.opt("coverage") in setOf("observed", "partial", "unknown", "future"))
            for (key in listOf("created", "completed", "reopened", "unknown")) valid(metric(row.getJSONObject(key), "day:$day:$key") <= all)
        }
        val estimates = raw.getJSONObject("estimates"); bool(estimates, "available"); valid(count(estimates, "unestimated") <= all)
        valid(estimates.has("points") && estimates.isNull("points") && estimates.has("hours") && estimates.isNull("hours"))
        fun estimateGroup(row: JSONObject, prefix: String): Int {
            val total = metric(row.getJSONObject("all"), "$prefix:all")
            for (unit in listOf("points", "hours")) { val value = row.getJSONObject(unit); val amount = number(value, "value")
                val estimated = metric(value.getJSONObject("estimated"), "$prefix:$unit:known")
                valid(estimated.toLong() + metric(value.getJSONObject("unestimated"), "$prefix:$unit:missing") == total.toLong() && (estimated > 0 || amount == 0.0)) }
            return total
        }
        val estimateProjects = rows(estimates, "projects", 20_000); valid(identities(estimateProjects, "projectId") == projectIds)
        var estimateCount = 0L
        estimateProjects.forEach { row ->
            val project = id(row, "projectId"); val total = estimateGroup(row, "estimate:$project"); estimateCount += total
            val people = rows(row, "members", 100_000); identities(people)
            valid(people.sumOf { estimateGroup(it, "estimate:$project:member:${it.getString("id")}").toLong() } == total.toLong())
        }; valid(estimateCount == all.toLong())
        valid(metrics.values.all { it <= all })
        copy(raw).put("filter", copy(resolvedFilter)).put("nativeMetrics", JSONObject(metrics))
    }
    fun check(raw: JSONObject) { valid(raw.opt("unchanged") == true) }
    fun taskQuery(report: JSONObject, metric: String, cursor: String?): JSONObject {
        require(report.getJSONObject("nativeMetrics").has(metric)) { "REPORT_METRIC_INVALID" }
        valid(cursor == null || cursor.isNotBlank() && cursor.length < 4096)
        return JSONObject().put("token", token(report.getString("token"))).put("metric", metric).put("cursor", cursor ?: JSONObject.NULL)
    }
    fun sources(report: JSONObject, metric: String, raw: JSONObject, previous: JSONObject? = null): JSONObject = checked {
        taskQuery(report, metric, null); valid(!raw.optBoolean("offlineCache"))
        val expected = report.getJSONObject("nativeMetrics").getInt(metric)
        valid(count(raw, "total") == expected && text(raw, "asOf", 100) == report.getString("asOf"))
        val projects = identities(rows(report.getJSONObject("catalog"), "projects", 20_000))
        val incoming = rows(raw, "tasks", 100)
        incoming.forEach { id(it, "id"); valid(id(it, "projectId") in projects); text(it, "title", 5000); count(it, "revision")
            valid(it.has("archivedAt") && (it.isNull("archivedAt") || it.opt("archivedAt") is String)) }
        val old = previous?.let { valid(it.getString("metric") == metric && it.getInt("total") == expected && it.getString("asOf") == report.getString("asOf")); rows(it, "tasks", Int.MAX_VALUE) }.orEmpty()
        val combined = old + incoming; identities(combined); valid(combined.size <= expected)
        val cursor = text(raw, "nextCursor", 4095, nullable = true)
        valid((cursor == null) == (combined.size == expected) && (cursor == null || cursor.isNotBlank() && incoming.size == 100))
        JSONObject().put("metric", metric).put("tasks", JSONArray(combined)).put("total", expected).put("asOf", report.getString("asOf")).put("nextCursor", cursor ?: JSONObject.NULL)
    }
}
