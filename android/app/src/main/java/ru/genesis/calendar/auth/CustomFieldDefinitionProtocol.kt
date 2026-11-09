package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** C3 definition reads are scoped metadata, never a grant to read a task or its values. */
internal object CustomFieldDefinitionProtocol {
    private val definitionKeys = setOf("id", "spaceId", "projectId", "title", "type", "options", "position", "required", "showCard", "showList", "archived")
    private fun valid(ok: Boolean) { require(ok) { "CUSTOM_FIELD_PROTOCOL" } }
    private fun keys(value: JSONObject, expected: Set<String>) = valid(value.keys().asSequence().toSet() == expected)
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun integer(value: Any, minimum: Int = 0): Int {
        valid((value is Int || value is Long) && (value as Number).toLong() in minimum.toLong()..Int.MAX_VALUE.toLong())
        return (value as Number).toInt()
    }
    fun catalog(space: String, project: String, raw: JSONObject, archived: Boolean): JSONObject {
        keys(raw, setOf("fields"))
        val fields = CustomFieldProtocol.definitions(space, project, raw.getJSONArray("fields"))
        valid(archived || fields.none { it.getBoolean("archived") })
        return JSONObject().put("fields", JSONArray(fields))
    }
    private fun field(space: String, project: String, raw: JSONObject): JSONObject {
        keys(raw, definitionKeys + setOf("revision", "predecessorId"))
        return CustomFieldProtocol.definitions(space, project, JSONArray().put(raw)).single()
    }
    fun history(space: String, id: String, raw: JSONObject): JSONObject {
        CustomFieldProtocol.id(space); CustomFieldProtocol.id(id); keys(raw, setOf("versions"))
        val versions = raw.getJSONArray("versions")
        valid(versions.length() <= 10000)
        var previous = Long.MAX_VALUE
        val rows = (0 until versions.length()).map { index ->
            val row = versions.getJSONObject(index); keys(row, setOf("field", "createdAt"))
            val source = row.getJSONObject("field")
            // A permitted history may include an earlier project scope. It conveys no task access.
            val oldProject = source.optString("projectId").takeUnless { source.isNull("projectId") } ?: id
            val parsed = field(space, oldProject, source)
            valid(parsed.getString("id") == id && parsed.getInt("revision").toLong() < previous)
            previous = parsed.getInt("revision").toLong()
            valid(row.get("createdAt") is String); Instant.parse(row.getString("createdAt"))
            JSONObject().put("field", parsed).put("createdAt", row.getString("createdAt"))
        }
        return JSONObject().put("versions", JSONArray(rows))
    }
    fun preview(space: String, project: String, request: JSONObject, raw: JSONObject): JSONObject {
        keys(raw, setOf("field", "fingerprint", "valueCount", "replaceType", "previousRevision", "preservesPreviousValues"))
        val next = raw.getJSONObject("field"); keys(next, definitionKeys)
        val revision = integer(raw.get("previousRevision"))
        valid(raw.get("replaceType") is Boolean && raw.get("preservesPreviousValues") == true)
        val count = integer(raw.get("valueCount"))
        valid(revision > 0 || count == 0)
        valid(!raw.getBoolean("replaceType") || revision > 0 && count > 0)
        valid(raw.get("fingerprint") is String && raw.getString("fingerprint").matches(Regex("[a-f0-9]{64}")))
        field(space, project, copy(next).put("revision", maxOf(1, revision)).put("predecessorId", JSONObject.NULL))
        valid(request.get("expectedRevision") is Int || request.get("expectedRevision") is Long)
        valid(integer(request.get("expectedRevision")) == revision && next.getString("id") == request.getString("id"))
        for (key in listOf("projectId", "type", "position", "required", "showCard", "showList", "archived"))
            valid(PlanningLifecycle.canonical(next.get(key)) == PlanningLifecycle.canonical(request.get(key)))
        // The API normalizes title whitespace. Display its reviewed value; do not trim/translate locally.
        valid(request.get("title") is String)
        val input = PlanningLifecycle.rows(request.getJSONArray("options"))
        val options = PlanningLifecycle.rows(next.getJSONArray("options")).associateBy { it.getString("id") }
        valid(input.map { it.getString("id") }.distinct().size == input.size)
        input.forEach { option ->
            val normalized = options[option.getString("id")]; valid(normalized != null)
            valid(option.get("title") is String && normalized!!.get("archived") == option.get("archived"))
        }
        val supplied = input.map { it.getString("id") }.toSet()
        valid(options.values.filter { it.getString("id") !in supplied }.all { it.getBoolean("archived") })
        return copy(raw)
    }
}
