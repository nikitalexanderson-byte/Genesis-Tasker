package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.calendarContextFromJson
import ru.genesis.calendar.data.calendarContextJson
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.RecurrenceEngine
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate
import java.time.ZoneId

interface SharedTaskSeriesGateway {
    suspend fun sharedTaskSeries(project: String, task: String): JSONObject = throw UnsupportedOperationException("sharedTaskSeries")
    suspend fun sharedTaskSeriesCommand(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("sharedTaskSeriesCommand")
}

internal object SharedTaskSeriesProtocol {
    fun recurrence(value: JSONObject): RecurrenceConfig {
        fun ints(key: String) = value.getJSONArray(key).let { source -> (0 until source.length()).map { source.getInt(it) } }
        val context = requireNotNull(calendarContextFromJson(value.getJSONObject("calendarContext")))
        ZoneId.of(context.timeZone); require(context.version in 1..2 && context.gregorianYearStart in setOf("january", "march"))
        val rule = RecurrenceConfig(true, value.getString("mode"), value.getString("pattern"), ints("days"), value.getInt("interval"),
            value.getString("rangeStart"), value.getString("rangeEnd"), ints("months"), ints("pyatas"), context, "skip")
        require(rule.rangeStart.isNotBlank()); val start = LocalDate.parse(rule.rangeStart)
        require(start.year in 1900..2100 && (rule.rangeEnd.isBlank() || LocalDate.parse(rule.rangeEnd).let { it >= start && it.year <= 2100 })) { "SERIES_INVALID" }
        val normalized = RecurrenceEngine(GenesisCalendar()).normalize(rule)
        require(normalized.pattern == rule.pattern && normalized.interval == rule.interval && rule.days.isNotEmpty() &&
            normalized.days.toSet() == rule.days.toSet() && normalized.months.toSet() == rule.months.toSet() && normalized.pyatas.toSet() == rule.pyatas.toSet() &&
            (rule.pattern != "lunar-yearly" || rule.months.isNotEmpty())) { "SERIES_INVALID" }
        return normalized
    }
    fun recurrence(value: RecurrenceConfig) = JSONObject().put("enabled", true).put("mode", value.mode).put("pattern", value.pattern)
        .put("days", JSONArray(value.days)).put("interval", value.interval).put("rangeStart", value.rangeStart).put("rangeEnd", value.rangeEnd)
        .put("months", JSONArray(value.months)).put("pyatas", JSONArray(value.pyatas)).put("invalidDayPolicy", "skip").put("calendarContext", calendarContextJson(value.calendarContext))
    fun settings(value: JSONObject): JSONObject {
        require(value.getString("timing") in setOf("schedule", "after-completion") && value.getInt("limit") in 1..1000 && value.getInt("delayDays") in 1..366 && value.opt("cloneChildren") is Boolean) { "SERIES_INVALID" }
        recurrence(value.getJSONObject("recurrence"))
        val excluded = value.getJSONArray("excludedDates"); require(excluded.length() <= 1000)
        val dates = (0 until excluded.length()).map { LocalDate.parse(excluded.getString(it)).also { date -> require(date.year in 1900..2100) }.toString() }
        require(dates.distinct().size == dates.size)
        return JSONObject(value.toString())
    }
    fun series(response: JSONObject): JSONObject? {
        if (response.isNull("series")) return null
        return JSONObject(response.getJSONObject("series").toString()).also {
            SharedTaskLifecycleProtocol.id(it.getString("id")); SharedTaskLifecycleProtocol.id(it.getString("projectId"))
            require(it.getLong("revision") >= 1 && it.opt("paused") is Boolean && it.getInt("generatedCount") >= 1)
            settings(it.getJSONObject("settings")); require(it.getJSONArray("instances").length() <= 30)
        }
    }
    fun save(task: JSONObject, settings: JSONObject, paused: Boolean, refresh: Boolean, series: JSONObject?, requestId: String): JSONObject {
        SharedTaskLifecycleProtocol.task(task); SharedTaskLifecycleProtocol.id(requestId)
        require(series == null || series.getString("projectId") == task.getString("projectId")) { "SERIES_SCOPE_CHANGED" }
        return JSONObject().put("settings", SharedTaskSeriesProtocol.settings(settings)).put("paused", paused).put("refreshTemplate", refresh)
            .put("taskRevision", task.getLong("revision")).put("requestId", requestId).apply {
                if (series != null) put("seriesId", series.getString("id")).put("expectedRevision", series.getLong("revision"))
            }
    }
    fun skip(task: JSONObject, series: JSONObject, requestId: String): JSONObject {
        SharedTaskLifecycleProtocol.task(task); SharedTaskLifecycleProtocol.id(requestId)
        require(series.getString("projectId") == task.getString("projectId") &&
            task.optString("completedAt").let { it.isBlank() || it == "null" } &&
            task.optString("archivedAt").let { it.isBlank() || it == "null" }) { "SERIES_COMPLETED_INSTANCE" }
        return JSONObject().put("skipInstance", true).put("seriesId", series.getString("id")).put("expectedRevision", series.getLong("revision"))
            .put("taskRevision", task.getLong("revision")).put("requestId", requestId)
    }
}
