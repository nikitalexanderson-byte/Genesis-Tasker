package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedAutomationEditorProtocol
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.RecurrenceConfig
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

internal object SharedAutomationEditorEdits {
    fun copy(value: JSONObject) = JSONObject(value.toString())
    fun rows(value: JSONArray) = (0 until value.length()).map(value::getJSONObject)
    fun initial(calendar: SharedCustomCalendar): JSONObject = JSONObject().put("schemaVersion", 1).put("trigger", JSONObject().put("type", "created"))
        .put("conditions", JSONArray()).put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0)))
        .put("calendarMode", calendar.mode.wireValue).put("calendarContext", calendar.saved().apply { remove("mode") })
    fun context(value: JSONObject) = CalendarContext(value.getInt("version"), value.getString("timeZone"), value.getString("gregorianYearStart"))
    fun recurrence(value: JSONObject) = RecurrenceConfig(value.getBoolean("enabled"), value.getString("mode"), value.getString("pattern"),
        ints(value.getJSONArray("days")), value.getInt("interval"), value.getString("rangeStart"), value.getString("rangeEnd"),
        ints(value.getJSONArray("months")), ints(value.getJSONArray("pyatas")), context(value.getJSONObject("calendarContext")), value.getString("invalidDayPolicy"))
    private fun ints(value: JSONArray) = (0 until value.length()).map(value::getInt)
    fun recurrence(value: RecurrenceConfig): JSONObject = JSONObject().put("enabled", true).put("mode", value.mode).put("pattern", value.pattern)
        .put("interval", value.interval).put("rangeStart", value.rangeStart).put("rangeEnd", value.rangeEnd).put("invalidDayPolicy", "skip")
        .put("days", JSONArray(value.days)).put("months", JSONArray(value.months)).put("pyatas", JSONArray(value.pyatas))
        .put("calendarContext", JSONObject().put("version", requireNotNull(value.calendarContext).version).put("timeZone", value.calendarContext.timeZone).put("gregorianYearStart", value.calendarContext.gregorianYearStart))
    fun trigger(edit: JSONObject, type: String) {
        val definition = edit.getJSONObject("definition"); val previous = definition.getJSONObject("trigger")
        val next = JSONObject().put("type", type)
        if (type in setOf("dueSoon", "due", "schedule")) next.put("time", previous.optString("time", "09:00"))
        if (type == "dueSoon") next.put("leadDays", previous.optInt("leadDays", 1))
        if (type == "schedule") {
            val calendar = SharedCustomCalendar.restore(copy(definition.getJSONObject("calendarContext")).put("mode", definition.getString("calendarMode")))
            val start = LocalDate.now(ZoneId.of(calendar.context.timeZone)).toString()
            next.put("target", "tasks").put("recurrence", previous.optJSONObject("recurrence") ?: recurrence(defaultTaskRecurrence(start, calendar.mode, calendar.context).copy(enabled = true)))
        }
        definition.put("trigger", next); edit.getJSONObject("inputs").remove("trigger.leadDays"); edit.getJSONObject("inputs").remove("trigger.interval")
    }
    fun rowKey(edit: JSONObject, actions: Boolean, index: Int) = edit.getJSONArray(if (actions) "actionKeys" else "conditionKeys").getString(index)
    fun numericKey(edit: JSONObject, actions: Boolean, index: Int, name: String = "value") = "${if (actions) "a" else "c"}:${rowKey(edit, actions, index)}:$name"
    fun row(edit: JSONObject, actions: Boolean, index: Int) = edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions").getJSONObject(index)
    fun replace(edit: JSONObject, actions: Boolean, index: Int, row: JSONObject) {
        edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions").put(index, row)
        val inputs = edit.getJSONObject("inputs"); for (suffix in listOf("value", "offset")) inputs.remove(numericKey(edit, actions, index, suffix))
    }
    fun append(edit: JSONObject, actions: Boolean, row: JSONObject) {
        edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions").put(row)
        edit.getJSONArray(if (actions) "actionKeys" else "conditionKeys").put(UUID.randomUUID().toString())
    }
    fun remove(edit: JSONObject, actions: Boolean, index: Int) {
        val list = edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions")
        require(!actions || list.length() > 1) { "AUTOMATION_INVALID" }
        for (suffix in listOf("value", "offset")) edit.getJSONObject("inputs").remove(numericKey(edit, actions, index, suffix))
        list.remove(index); edit.getJSONArray(if (actions) "actionKeys" else "conditionKeys").remove(index)
    }
    fun move(edit: JSONObject, actions: Boolean, index: Int, to: Int) {
        val list = edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions"); require(to in 0 until list.length())
        val keys = edit.getJSONArray(if (actions) "actionKeys" else "conditionKeys")
        val old = list.getJSONObject(index); list.put(index, list.getJSONObject(to)); list.put(to, old)
        val key = keys.getString(index); keys.put(index, keys.getString(to)); keys.put(to, key)
    }
    fun condition(field: String, project: String, firstField: String?) = JSONObject().put("field", field).put("operator", if (field == "label") "contains" else "eq")
        .put("value", when (field) { "project" -> project; "priority" -> 0; else -> JSONObject.NULL }).apply { if (field == "custom") put("fieldId", firstField.orEmpty()) }
    fun action(type: String, statuses: List<JSONObject>, fields: List<JSONObject>, account: String): JSONObject = JSONObject().put("type", type).apply { when (type) {
        "status" -> put("value", statuses.firstOrNull()?.getString("id").orEmpty())
        "assignee" -> put("value", JSONObject.NULL)
        "priority" -> put("value", 0)
        "custom" -> put("fieldId", fields.firstOrNull()?.getString("id").orEmpty()).put("value", JSONObject.NULL)
        "createTemplate" -> put("templateId", "").put("options", JSONObject())
        "due" -> put("mode", "clear")
        "notify" -> put("recipientIds", JSONArray().put(account)).put("message", "")
        else -> put("value", JSONArray())
    } }
    fun number(edit: JSONObject, actions: Boolean, index: Int, text: String, name: String = "value") {
        edit.getJSONObject("inputs").put(numericKey(edit, actions, index, name), text)
    }
    fun effective(edit: JSONObject) = runCatching { SharedAutomationEditorProtocol.definition(edit) }.getOrElse { copy(edit.getJSONObject("definition")) }
}
