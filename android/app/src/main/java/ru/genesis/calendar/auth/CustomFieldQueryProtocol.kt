package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

/** Read predicates use the server's typed contract, including historical choices. */
internal object CustomFieldQueryProtocol {
    val errors = setOf("SHARED_QUERY_CHANGED", "INVALID_TASK_FILTER", "INVALID_TASK_PAGE", "INVALID_SEARCH",
        "CUSTOM_FIELD_FILTER_INVALID", "CUSTOM_FIELD_SORT_INVALID", "CUSTOM_FIELD_UNAVAILABLE", "CUSTOM_FIELD_VALUE_INVALID", "CUSTOM_FIELD_OPTION_UNAVAILABLE", "CUSTOM_FIELD_URL_INVALID")
    fun operations(type: String): List<String> = listOf("eq", "ne", "exists", "missing") +
        (if (type in setOf("text", "url", "multi")) listOf("contains") else emptyList()) +
        (if (type in setOf("number", "date")) listOf("gt", "gte", "lt", "lte") else emptyList())

    fun criterion(field: JSONObject, op: String, raw: Any?): JSONObject {
        require(op in operations(field.getString("type"))) { "CUSTOM_FIELD_FILTER_INVALID" }
        val result = JSONObject().put("fieldId", CustomFieldProtocol.id(field.getString("id"))).put("op", op)
        if (op !in setOf("exists", "missing")) {
            // A search may refer to an archived choice without making it writable on a task.
            val value = CustomFieldProtocol.normalize(field, raw, raw)
            require(!CustomFieldProtocol.absent(value)) { "CUSTOM_FIELD_FILTER_INVALID" }
            result.put("value", value)
        }
        return result
    }

    fun criteria(raw: JSONArray, fields: List<JSONObject>): JSONArray {
        require(raw.length() <= 20) { "CUSTOM_FIELD_FILTER_INVALID" }
        val catalog = fields.associateBy { it.getString("id") }
        return JSONArray((0 until raw.length()).map { index ->
            val row = raw.getJSONObject(index)
            require(row.keys().asSequence().all { it in setOf("fieldId", "op", "value") }) { "CUSTOM_FIELD_FILTER_INVALID" }
            val field = catalog[row.getString("fieldId")] ?: throw IllegalArgumentException("CUSTOM_FIELD_UNAVAILABLE")
            criterion(field, row.getString("op"), row.opt("value"))
        })
    }

    fun sort(raw: String, fields: List<JSONObject>): String {
        if (!raw.startsWith("custom:")) {
            require(raw in setOf("position", "priority", "dueDate", "title", "updatedAt", "createdAt", "createdAtAsc")) { "INVALID_TASK_FILTER" }
            return raw
        }
        val parts = Regex("custom:([A-Za-z0-9_-]{1,100}):(asc|desc)").matchEntire(raw)
            ?: throw IllegalArgumentException("CUSTOM_FIELD_SORT_INVALID")
        require(fields.any { it.getString("id") == parts.groupValues[1] && it.getString("type") != "multi" }) { "CUSTOM_FIELD_SORT_INVALID" }
        return raw
    }

    fun filter(base: JSONObject, raw: JSONArray, fields: List<JSONObject>): JSONObject {
        val rows = criteria(raw, fields)
        val result = JSONObject(base.toString()).apply { remove("customFields"); if (rows.length() > 0) put("customFields", rows) }
        require(result.toString().toByteArray(Charsets.UTF_8).size <= 8000) { "CUSTOM_FIELD_FILTER_INVALID" }
        return result
    }
}
