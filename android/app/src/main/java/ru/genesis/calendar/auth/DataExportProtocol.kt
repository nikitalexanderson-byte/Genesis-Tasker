package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** Export is an authorized full server selection, never a page of native cards. */
internal object DataExportProtocol {
    const val FILE_LIMIT = 20 * 1024 * 1024
    const val ENVELOPE_LIMIT = 6L * FILE_LIMIT + 262_144L
    val formats = setOf("json", "csv")
    val errors = setOf("DATA_EMPTY", "DATA_DATE_INVALID", "DATA_FILE_TOO_LARGE", "DATA_RESOURCE_LIMIT", "INVALID_CALENDAR_TIME_ZONE")
    val columns = setOf("key", "title", "description", "project", "status", "done", "assignee", "priority", "labels",
        "dueDate", "startDate", "startTime", "endTime", "parentKey", "storyPoints", "estimateHours")
    private val uuid = Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
    private val fields = setOf("scope", "projectId", "format", "from", "to", "undated", "archived", "calendarMode", "calendarContext", "titles")
    private val ianaZone = Regex("[A-Za-z_+\\-]+(?:/[A-Za-z0-9_+\\-]+)+")

    /** Match the server's explicit UTC/IANA contract, excluding offsets and legacy GMT aliases. */
    fun timeZone(value: String): ZoneId? = value.takeIf { it.length in 1..200 && (it == "UTC" || ianaZone.matches(it)) }
        ?.let { runCatching { ZoneId.of(it) }.getOrNull() }

    private fun valid(condition: Boolean) { if (!condition) throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
    private fun string(input: JSONObject, key: String): String = (input.opt(key) as? String) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)

    fun command(spaceId: String, input: JSONObject): JSONObject {
        valid(uuid.matches(spaceId) && input.keys().asSequence().all { it in fields })
        val scope = string(input, "scope"); valid(scope in setOf("project", "tree", "space"))
        val project = input.opt("projectId").takeUnless { it == JSONObject.NULL }
        valid(project == null && scope == "space" || project is String && uuid.matches(project))
        val format = string(input, "format"); valid(format in formats)
        val mode = string(input, "calendarMode"); valid(mode in setOf("profane", "sacred", "lunar"))
        val context = input.optJSONObject("calendarContext") ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        valid(context.opt("version") == 2 && context.keys().asSequence().all { it in setOf("version", "timeZone", "gregorianYearStart") })
        val timeZone = string(context, "timeZone")
        if (DataExportProtocol.timeZone(timeZone) == null) throw AuthApiError("INVALID_CALENDAR_TIME_ZONE")
        val yearStart = string(context, "gregorianYearStart"); valid(yearStart in setOf("january", "march"))
        val from = date(input, "from"); val to = date(input, "to")
        if (from != null && to != null && from > to) throw AuthApiError("DATA_DATE_INVALID")
        valid(input.opt("undated") is Boolean && input.opt("archived") is Boolean)
        val titles = input.optJSONObject("titles") ?: JSONObject()
        valid(titles.keys().asSequence().all { key -> key in columns && titles.opt(key) is String && titles.getString(key).length in 1..500 })
        return JSONObject().put("scope", scope).put("projectId", project ?: JSONObject.NULL).put("format", format)
            .put("from", from?.toString() ?: JSONObject.NULL).put("to", to?.toString() ?: JSONObject.NULL)
            .put("undated", input.getBoolean("undated")).put("archived", input.getBoolean("archived"))
            .put("calendarMode", mode).put("calendarContext", JSONObject().put("version", 2).put("timeZone", timeZone).put("gregorianYearStart", yearStart))
            .put("titles", JSONObject(titles.toString()))
    }

    private fun date(input: JSONObject, key: String): LocalDate? {
        val raw = input.opt(key).takeUnless { it == JSONObject.NULL } ?: return null
        val parsed = (raw as? String)?.takeIf { it.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")) }
            ?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        if (parsed == null || parsed.year !in 1900..2100) throw AuthApiError("DATA_DATE_INVALID")
        return parsed
    }

    fun snapshot(format: String, raw: JSONObject): JSONObject {
        valid(format in formats && raw.opt("format") == format)
        val content = string(raw, "content")
        valid(content.isNotEmpty() && utf8Within(content, FILE_LIMIT))
        fun count(key: String, minimum: Int): Int {
            val value = raw.opt(key); valid(value is Int || value is Long)
            val number = (value as Number).toLong(); valid(number in minimum.toLong()..Int.MAX_VALUE.toLong())
            return number.toInt()
        }
        val projects = count("projectCount", 1); val tasks = count("taskCount", 0)
        val source = raw.optJSONArray("notices") ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        valid(source.length() <= 4096)
        val notices = JSONArray()
        for (index in 0 until source.length()) {
            val row = source.optJSONObject(index) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
            val code = string(row, "code"); val field = string(row, "field")
            valid(code.matches(Regex("[A-Z][A-Z0-9_]{0,95}")) && field.length <= 4096)
            notices.put(JSONObject().put("code", code).put("field", field))
        }
        return JSONObject().put("format", format).put("content", content).put("projectCount", projects)
            .put("taskCount", tasks).put("notices", notices)
    }

    /** Count UTF-8 without allocating a second full file; malformed surrogates cannot be silently replaced. */
    fun utf8Within(text: String, limit: Int): Boolean {
        var size = 0L; var index = 0
        while (index < text.length) {
            val char = text[index++]
            size += when {
                char.code <= 0x7f -> 1
                char.code <= 0x7ff -> 2
                char.isHighSurrogate() -> {
                    if (index == text.length || !text[index].isLowSurrogate()) return false
                    index++; 4
                }
                char.isLowSurrogate() -> return false
                else -> 3
            }
            if (size > limit) return false
        }
        return true
    }
}
