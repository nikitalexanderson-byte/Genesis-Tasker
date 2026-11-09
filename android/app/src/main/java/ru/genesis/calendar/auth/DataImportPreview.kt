package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Validate every nested value the form reads before accepting a network preview. */
internal object DataImportPreview {
    private val keyPattern = Regex("[A-Za-z0-9:_-]{1,100}")
    private val types = setOf("text", "number", "date", "select", "multi", "checkbox", "url")
    private fun valid(value: Boolean) { require(value) { "DATA_IMPORT_INVALID" } }
    private fun key(value: Any?): String {
        valid(value is String && keyPattern.matches(value)); return value as String
    }
    private fun title(row: JSONObject, empty: Boolean = false) {
        val value = row.opt("title"); valid(value is String && value.length <= 500 && (empty || value.isNotBlank()))
    }
    private fun rows(value: Any?, limit: Int, id: String = "key", emptyTitles: Boolean = false): Map<String, JSONObject> {
        valid(value is JSONArray); value as JSONArray; valid(value.length() <= limit)
        val result = linkedMapOf<String, JSONObject>()
        for (index in 0 until value.length()) {
            val row = value.opt(index); valid(row is JSONObject); row as JSONObject
            val identity = key(row.opt(id)); title(row, emptyTitles); valid(result.put(identity, row) == null)
        }
        return result
    }
    private fun calendar(value: Any?) {
        valid(value is JSONObject); value as JSONObject
        valid(value.opt("version") == 2 && value.opt("timeZone") is String && DataExportProtocol.timeZone(value.getString("timeZone")) != null &&
            value.opt("gregorianYearStart") in setOf("january", "march"))
    }
    private fun status(row: JSONObject, destination: Boolean) {
        val done = row.opt("isDone")
        valid(done is Boolean || destination && (done == 0 || done == 1))
    }
    private fun field(row: JSONObject): Set<String> {
        valid(row.opt("type") in types && row.opt("archived") is Boolean && row.opt("required") is Boolean)
        val options = rows(row.opt("options"), 10000, "id")
        check(options.values.count { it.opt("archived") == false } <= 200 && row.toString().toByteArray(Charsets.UTF_8).size <= 1_000_000)
        options.values.forEach { valid(it.opt("archived") is Boolean) }
        valid(row.getString("type") in setOf("select", "multi") || options.isEmpty())
        return options.keys
    }
    private fun mapped(raw: JSONObject, name: String, sources: Set<String>, complete: Boolean = true): JSONObject {
        val map = raw.getJSONObject(name); val keys = map.keys().asSequence().toSet()
        valid(if (complete) keys == sources else sources.containsAll(keys)); return map
    }
    fun validate(raw: JSONObject): JSONObject {
        val data = raw.getJSONObject("data"); val counts = raw.getJSONObject("sourceCounts")
        valid(data.opt("version") == 1 && data.opt("format") == "genesis.shared-data" && data.opt("calendarMode") in setOf("profane", "sacred", "lunar"))
        calendar(data.opt("calendarContext"))
        val projects = rows(data.opt("projects"), 1000); valid(projects.isNotEmpty() && projects.size == counts.getInt("projects"))
        valid(raw.getInt("projectCount") == 0 || raw.getInt("projectCount") == projects.size)
        val visited = mutableSetOf<String>(); val statuses = mutableSetOf<String>()
        for ((id, project) in projects) {
            valid(project.has("parentKey")); val parent = project.opt("parentKey")
            valid(parent == JSONObject.NULL || parent is String && parent in visited); visited += id
            val columns = rows(project.opt("statuses"), 30)
            valid(columns.values.map { it.opt("isDone") }.toSet() == setOf(false, true))
            columns.forEach { (column, row) -> status(row, false); valid(statuses.add(column)) }
        }
        val tasks = rows(data.opt("tasks"), 100)
        valid(tasks.size == minOf(100, counts.getInt("tasks")))
        tasks.values.forEach { row ->
            valid(row.opt("projectKey") in projects.keys && row.has("dueDate"))
            val date = row.opt("dueDate")
            valid(date == JSONObject.NULL || date is String && date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) &&
                runCatching { LocalDate.parse(date) }.getOrNull()?.let { it.year in 1900..2100 } == true)
        }
        val members = rows(data.opt("members"), 20_000, emptyTitles = true)
        val labels = rows(data.opt("labels"), 2000)
        val fields = rows(data.opt("fields"), 2000)
        val options = fields.mapValues { (_, row) ->
            valid(row.has("projectKey") && (row.opt("projectKey") == JSONObject.NULL || row.opt("projectKey") in projects.keys)); field(row)
        }
        rows(raw.opt("destinationMembers"), 20_000, "id", emptyTitles = true)
        rows(raw.opt("destinationLabels"), 2000, "id")
        rows(raw.opt("destinationStatuses"), 30, "id").values.forEach { status(it, true) }
        rows(raw.opt("destinationFields"), 2000, "id").values.forEach { field(it) }
        mapped(raw, "memberMap", members.keys); mapped(raw, "statusMap", statuses)
        mapped(raw, "labelMap", labels.keys); mapped(raw, "fieldMap", fields.keys)
        val optionMaps = mapped(raw, "optionMap", fields.keys, complete = false)
        optionMaps.keys().forEach { id ->
            valid(options.getValue(id).containsAll(optionMaps.getJSONObject(id).keys().asSequence().toSet()))
        }
        val titles = raw.getJSONObject("issueTitles")
        valid(titles.length() <= 100_000)
        titles.keys().forEach { id -> val value = titles.get(id); key(id); valid(value is String && value.length <= 500) }
        // Unavailable mapping targets remain visible with server blockers so the user can repair them.
        return raw
    }
}
