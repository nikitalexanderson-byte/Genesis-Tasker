package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.LocalDate
import java.util.Locale

/** Typed task patches never replace fields omitted by this client. */
internal object CustomFieldProtocol {
    val types = setOf("text", "number", "date", "select", "multi", "checkbox", "url")
    val errors = setOf("CUSTOM_FIELD_INVALID", "CUSTOM_FIELD_VALUE_INVALID", "CUSTOM_FIELD_URL_INVALID", "CUSTOM_FIELD_OPTION_UNAVAILABLE",
        "CUSTOM_FIELD_UNAVAILABLE", "CUSTOM_FIELD_REQUIRED", "CUSTOM_FIELD_CONFLICT", "CUSTOM_FIELD_SCOPE_HAS_VALUES", "CUSTOM_FIELD_TYPE_TRANSITION_REQUIRED",
        "CUSTOM_FIELD_LIMIT", "CUSTOM_FIELD_OPTIONS_LIMIT", "CUSTOM_FIELD_OPERATION_REUSED")
    private fun valid(ok: Boolean, code: String = "CUSTOM_FIELD_VALUE_INVALID") { require(ok) { code } }
    fun id(value: String) = value.also { valid(Regex("[A-Za-z0-9_-]{1,100}").matches(it), "CUSTOM_FIELD_INVALID") }
    private fun count(value: Any, min: Int, max: Int): Int {
        valid((value is Int || value is Long) && (value as Number).toLong() in min.toLong()..max.toLong(), "CUSTOM_FIELD_INVALID")
        return (value as Number).toInt()
    }
    private fun text(value: Any, max: Int): String {
        valid(value is String && value.codePointCount(0, value.length) <= max)
        return value as String
    }
    private fun bool(value: Any) { valid(value is Boolean, "CUSTOM_FIELD_INVALID") }
    private fun stringIds(array: JSONArray, max: Int = 200): List<String> {
        valid(array.length() <= max)
        return (0 until array.length()).map { id(text(array.get(it), 100)) }
    }
    fun definitions(space: String, project: String, raw: JSONArray): List<JSONObject> {
        id(space); id(project); valid(raw.length() <= 5000, "CUSTOM_FIELD_INVALID")
        val result = PlanningLifecycle.rows(raw).map { field ->
            id(field.getString("id")); valid(field.opt("spaceId") == space && (field.isNull("projectId") || field.opt("projectId") == project), "CUSTOM_FIELD_INVALID")
            valid(field.has("projectId") && field.opt("type") in types, "CUSTOM_FIELD_INVALID"); text(field.get("title"), 160)
            count(field.get("position"), -100000, 100000); count(field.get("revision"), 1, Int.MAX_VALUE)
            for (key in listOf("required", "showCard", "showList", "archived")) bool(field.get(key))
            valid(field.has("predecessorId") && (field.isNull("predecessorId") || runCatching { id(field.getString("predecessorId")) }.isSuccess), "CUSTOM_FIELD_INVALID")
            val options = PlanningLifecycle.rows(field.getJSONArray("options")); valid(field.toString().toByteArray(Charsets.UTF_8).size <= 1_000_000 && options.count { !it.getBoolean("archived") } <= 200, "CUSTOM_FIELD_INVALID")
            valid(field.getString("type") in setOf("select", "multi") || options.isEmpty(), "CUSTOM_FIELD_INVALID")
            options.forEach { option -> id(option.getString("id")); text(option.get("title"), 160); bool(option.get("archived")) }
            valid(options.map { it.getString("id") }.distinct().size == options.size, "CUSTOM_FIELD_INVALID")
            JSONObject(field.toString())
        }
        valid(result.map { it.getString("id") }.distinct().size == result.size && result.count { !it.getBoolean("archived") } <= 200, "CUSTOM_FIELD_INVALID")
        return result.sortedWith(compareBy<JSONObject> { it.getInt("position") }.thenBy { it.getString("id") })
    }
    /** PHP empty maps may be []; a populated array cannot become a value dictionary. */
    fun values(raw: Any): JSONObject {
        val objectValue = when (raw) {
            is JSONObject -> raw
            is JSONArray -> { valid(raw.length() == 0); JSONObject() }
            else -> { valid(false); JSONObject() }
        }
        valid(objectValue.length() <= 5000 && objectValue.toString().toByteArray(Charsets.UTF_8).size <= 8_000_000)
        objectValue.keys().forEach { key ->
            id(key)
            when (val value = objectValue.get(key)) {
                JSONObject.NULL -> Unit
                is Boolean -> Unit
                is String -> text(value, 5000)
                is Number -> valid(value.toDouble().isFinite() && kotlin.math.abs(value.toDouble()) <= 1e15)
                is JSONArray -> stringIds(value)
                else -> valid(false)
            }
        }
        return JSONObject(objectValue.toString())
    }
    fun fromTask(task: JSONObject) = values(task.opt("customFields") ?: JSONObject())
    fun absent(value: Any?) = value == null || value == JSONObject.NULL
    fun equal(first: Any?, second: Any?): Boolean {
        if (absent(first) || absent(second)) return absent(first) && absent(second)
        if (first is Number && second is Number) return first.toDouble() == second.toDouble()
        if (first is JSONArray && second is JSONArray) return stringIds(first).toSet() == stringIds(second).toSet()
        return first is Boolean && second is Boolean && first == second || first is String && second is String && first == second
    }
    /** Numeric input has no thousands separator. Both decimal marks survive a language switch. */
    fun normalize(field: JSONObject, raw: Any?, previous: Any?, input: Boolean = true): Any {
        if (absent(raw) || raw == "" || raw is JSONArray && raw.length() == 0) return JSONObject.NULL
        return when (field.getString("type")) {
            "text", "url" -> {
                val value = text(requireNotNull(raw), 5000)
                if (value.isBlank()) JSONObject.NULL else {
                    if (field.getString("type") == "url") {
                        val uri = runCatching { URI(value) }.getOrNull()
                        valid(uri != null && uri.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.port in -1..65535, "CUSTOM_FIELD_URL_INVALID")
                    }
                    value
                }
            }
            "number" -> {
                val number = if (raw is Number) raw.toDouble() else if (input && raw is String) raw.trim().replace(',', '.').toDoubleOrNull() else null
                valid(number != null && number.isFinite() && kotlin.math.abs(number) <= 1e15); requireNotNull(number)
            }
            "checkbox" -> { valid(raw is Boolean); requireNotNull(raw) }
            "date" -> {
                val value = text(requireNotNull(raw), 10); val parsed = runCatching { LocalDate.parse(value) }.getOrNull()
                valid(parsed != null && parsed.toString() == value && Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(value)); value
            }
            "select", "multi" -> {
                val options = PlanningLifecycle.rows(field.getJSONArray("options")).associateBy { it.getString("id") }
                val selected = if (field.getString("type") == "select") listOf(id(text(requireNotNull(raw), 100))) else {
                    valid(raw is JSONArray); stringIds(raw as JSONArray).distinct().sorted()
                }
                val old = when (previous) { is String -> setOf(previous); is JSONArray -> stringIds(previous).toSet(); else -> emptySet() }
                selected.forEach { key -> valid(options[key] != null && (options[key]!!.opt("archived") == false || key in old), "CUSTOM_FIELD_OPTION_UNAVAILABLE") }
                if (field.getString("type") == "select") selected.single() else JSONArray(selected)
            }
            else -> throw IllegalArgumentException("CUSTOM_FIELD_UNAVAILABLE")
        }
    }
    /** A success body must acknowledge every changed value before the old task command is removed. */
    fun confirmPatch(patch: JSONObject, task: JSONObject) {
        try {
            valid(task.has("customFields")); val returned = values(task.get("customFields"))
            patch.keys().forEach { key -> valid(equal(patch.get(key), returned.opt(key))) }
        } catch (failure: Exception) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
    }
}
