package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId
import java.util.UUID

/** Recoverable form data is separate from the management journal and the immutable wire request. */
internal object SharedAutomationEditorProtocol {
    private fun valid(value: Boolean, code: String = "AUTOMATION_DRAFT_INVALID") { require(value) { code } }
    fun copy(value: JSONObject) = JSONObject(value.toString())
    fun rows(value: JSONArray) = (0 until value.length()).map(value::getJSONObject)
    private fun keys(value: JSONObject, required: Set<String>, optional: Set<String> = emptySet()) {
        val actual = value.keys().asSequence().toSet()
        valid(actual.containsAll(required) && (actual - required - optional).isEmpty())
    }
    private fun text(value: Any?, maximum: Int): String {
        valid(value is String && value.codePointCount(0, value.length) <= maximum)
        return value as String
    }
    private fun integer(value: Any?, minimum: Int, maximum: Int): Int {
        valid(value is Int || value is Long)
        valid((value as Number).toLong() in minimum.toLong()..maximum.toLong()); return value.toInt()
    }
    private fun nullableId(value: Any?) { valid(value == JSONObject.NULL || value is String); if (value is String) SharedAutomationProtocol.id(value) }
    private fun scalar(value: Any?) {
        valid(value == JSONObject.NULL || value is String && value.length <= 20000 || value is Boolean ||
            value is Number && value.toDouble().isFinite() || value is JSONArray && value.length() <= 200 &&
            (0 until value.length()).all { value.opt(it) is String && value.getString(it).length <= 100 })
    }
    private fun calendar(value: JSONObject) {
        keys(value, setOf("version", "timeZone", "gregorianYearStart"))
        integer(value.opt("version"), 1, 2); ZoneId.of(text(value.opt("timeZone"), 200))
        valid(value.opt("gregorianYearStart") in setOf("january", "march"))
    }
    private fun localKeys(value: JSONArray, count: Int): List<String> {
        valid(value.length() == count)
        val result = (0 until value.length()).map { index -> text(value.opt(index), 36).also { valid(UUID.fromString(it).toString() == it) } }
        valid(result.distinct().size == count); return result
    }
    fun newEdit(space: String, project: String, owner: String, definition: JSONObject, rule: JSONObject? = null): JSONObject {
        val source = rule?.let { SharedAutomationProtocol.rule(it, project) }
        val base = source?.getJSONObject("definition") ?: definition
        return edit(JSONObject().put("kind", "automation-save").put("spaceId", SharedAutomationProtocol.id(space))
            .put("projectId", SharedAutomationProtocol.id(project)).put("ruleId", source?.getString("id") ?: JSONObject.NULL)
            .put("revision", source?.getInt("revision") ?: JSONObject.NULL).put("title", source?.getString("title") ?: "")
            .put("ownerId", source?.get("ownerId") ?: SharedAutomationProtocol.id(owner))
            .put("enabled", source?.getBoolean("enabled") ?: false).put("definition", copy(base))
            .put("conditionKeys", JSONArray(List(base.getJSONArray("conditions").length()) { UUID.randomUUID().toString() }))
            .put("actionKeys", JSONArray(List(base.getJSONArray("actions").length()) { UUID.randomUUID().toString() }))
            .put("inputs", JSONObject()).put("dateInput", JSONObject().put("mode", base.getString("calendarMode"))
                .put("version", base.getJSONObject("calendarContext").getInt("version"))
                .put("timeZone", base.getJSONObject("calendarContext").getString("timeZone"))
                .put("gregorianYearStart", base.getJSONObject("calendarContext").getString("gregorianYearStart"))))
    }
    /** The rule owns the destination and run date. Only configuration, never an apply command, is stored. */
    fun templateOptions(space: String, project: String, raw: Any?): JSONObject {
        val input = SharedTemplateProtocol.dictionary(raw)
        valid(!input.has("anchorDate"), "AUTOMATION_TEMPLATE_OPTIONS")
        for ((key, expected) in listOf("spaceId" to space, "projectId" to project)) {
            valid(!input.has(key) || input.opt(key) == expected, "AUTOMATION_SCOPE_CHANGED"); input.put(key, expected)
        }
        valid((!input.has("parentProjectId") || input.isNull("parentProjectId")) &&
            (!input.has("boardStatusId") || input.isNull("boardStatusId")), "AUTOMATION_TEMPLATE_OPTIONS")
        if (!input.has("language")) input.put("language", "ru")
        return SharedTemplateProtocol.options(input.put("anchorDate", "2000-06-15")).apply {
            remove("anchorDate")
            val overrides = getJSONObject("fieldValues")
            overrides.keys().forEach { task -> overrides.getJSONObject(task).let { values -> values.keys().forEach { scalar(values.get(it)) } } }
        }
    }
    /** Partial text and numbers are legal here; unknown fields, executable objects and unbounded lists are not. */
    fun edit(input: JSONObject): JSONObject {
        val raw = copy(input)
        valid(raw.toString().toByteArray(Charsets.UTF_8).size <= 1000000, "AUTOMATION_SIZE_LIMIT")
        keys(raw, setOf("kind", "spaceId", "projectId", "ruleId", "revision", "title", "ownerId", "enabled", "definition", "conditionKeys", "actionKeys", "inputs", "dateInput"))
        valid(raw.opt("kind") == "automation-save"); SharedAutomationProtocol.id(raw.getString("spaceId")); SharedAutomationProtocol.id(raw.getString("projectId"))
        nullableId(raw.opt("ruleId")); valid(raw.isNull("ruleId") == raw.isNull("revision")); if (!raw.isNull("revision")) integer(raw.opt("revision"), 1, Int.MAX_VALUE - 1)
        text(raw.opt("title"), 200); nullableId(raw.opt("ownerId")); valid(raw.has("ownerId") && raw.opt("enabled") is Boolean)
        val definition = raw.getJSONObject("definition")
        keys(definition, setOf("schemaVersion", "trigger", "conditions", "actions", "calendarMode", "calendarContext"))
        integer(definition.opt("schemaVersion"), 1, 1); valid(definition.opt("calendarMode") in setOf("profane", "sacred", "lunar")); calendar(definition.getJSONObject("calendarContext"))
        val trigger = definition.getJSONObject("trigger"); keys(trigger, setOf("type"), setOf("leadDays", "time", "target", "recurrence"))
        valid(trigger.opt("type") in SharedAutomationProtocol.triggers)
        if (trigger.has("leadDays")) integer(trigger.opt("leadDays"), 1, 366)
        if (trigger.has("time")) text(trigger.opt("time"), 5)
        if (trigger.has("target")) valid(trigger.opt("target") in setOf("project", "tasks"))
        // A complete recurrence is produced by the existing native calendar controls; validate its shape without requiring the other form fields.
        trigger.optJSONObject("recurrence")?.let { recurrence ->
            val probe = copy(definition).put("trigger", JSONObject().put("type", "schedule").put("time", "09:00").put("target", "tasks").put("recurrence", recurrence))
                .put("conditions", JSONArray()).put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0)))
            SharedAutomationProtocol.definition(probe)
        }
        val conditions = rows(definition.getJSONArray("conditions")); valid(conditions.size <= 20)
        conditions.forEach { condition ->
            val field = condition.getString("field"); valid(field in setOf("project", "status", "label", "assignee", "priority", "custom"))
            keys(condition, setOf("field", "operator", "value") + if (field == "custom") setOf("fieldId") else emptySet())
            valid(condition.opt("operator") in setOf("eq", "ne", "missing", "present", "contains", "notContains", "gt", "gte", "lt", "lte"))
            scalar(condition.opt("value")); if (field == "custom") text(condition.opt("fieldId"), 100)
        }
        val actions = rows(definition.getJSONArray("actions")); valid(actions.size in 1..10)
        actions.forEach { action ->
            val type = action.getString("type"); valid(type in SharedAutomationProtocol.actions)
            when (type) {
                "due" -> {
                    keys(action, setOf("type", "mode"), setOf("date", "offset")); valid(action.opt("mode") in setOf("set", "shift", "clear"))
                    if (action.has("date")) text(action.opt("date"), 10)
                    action.optJSONObject("offset")?.let { offset -> keys(offset, setOf("amount", "unit")); integer(offset.opt("amount"), -74000, 74000); valid(offset.opt("unit") in setOf("day", "month", "year")) }
                }
                "createTemplate" -> {
                    keys(action, setOf("type", "templateId", "options"), setOf("unavailable")); text(action.opt("templateId"), 100)
                    if (action.has("unavailable")) valid(action.opt("unavailable") == true && action.optString("templateId").isEmpty())
                    action.put("options", templateOptions(raw.getString("spaceId"), raw.getString("projectId"), action.get("options")))
                }
                "notify" -> { keys(action, setOf("type", "recipientIds", "message")); val ids = action.getJSONArray("recipientIds"); valid(ids.length() <= 50); (0 until ids.length()).forEach { SharedAutomationProtocol.id(ids.getString(it)) }; text(action.opt("message"), 1000) }
                "custom" -> { keys(action, setOf("type", "fieldId", "value")); text(action.opt("fieldId"), 100); scalar(action.opt("value")) }
                else -> { keys(action, setOf("type", "value")); scalar(action.opt("value")) }
            }
        }
        val conditionKeys = localKeys(raw.getJSONArray("conditionKeys"), conditions.size)
        val actionKeys = localKeys(raw.getJSONArray("actionKeys"), actions.size)
        val allowedInputs = setOf("trigger.leadDays", "trigger.interval", "calendar.timeZone") + actionKeys.flatMap { listOf("a:$it:value", "a:$it:offset") } + conditionKeys.map { "c:$it:value" }
        val inputs = raw.getJSONObject("inputs"); valid(inputs.length() <= allowedInputs.size)
        inputs.keys().forEach { key -> valid(key in allowedInputs); text(inputs.opt(key), 20000) }
        val input = raw.getJSONObject("dateInput"); keys(input, setOf("mode", "version", "timeZone", "gregorianYearStart"))
        valid(input.opt("mode") in setOf("profane", "sacred", "lunar")); calendar(copy(input).apply { remove("mode") })
        return copy(raw)
    }
    fun definition(raw: JSONObject): JSONObject {
        val edit = edit(raw); val result = copy(edit.getJSONObject("definition")); val inputs = edit.getJSONObject("inputs")
        if (inputs.has("calendar.timeZone")) {
            val zone = inputs.getString("calendar.timeZone").trim()
            valid((zone == "UTC" || zone.contains('/')) && runCatching { ZoneId.of(zone) }.isSuccess, "INVALID_CALENDAR_CONTEXT")
            result.getJSONObject("calendarContext").put("timeZone", zone)
            result.getJSONObject("trigger").optJSONObject("recurrence")?.put("calendarContext", copy(result.getJSONObject("calendarContext")))
        }
        fun whole(key: String, minimum: Int, maximum: Int): Int? {
            if (!inputs.has(key)) return null
            return inputs.getString(key).trim().toIntOrNull()?.takeIf { it in minimum..maximum }
                ?: throw IllegalArgumentException("AUTOMATION_INVALID")
        }
        val trigger = result.getJSONObject("trigger")
        if (trigger.getString("type") == "dueSoon") whole("trigger.leadDays", 1, 366)?.let { trigger.put("leadDays", it) }
        if (trigger.getString("type") == "schedule") whole("trigger.interval", 1, 99)?.let { trigger.getJSONObject("recurrence").put("interval", it) }
        fun number(row: JSONObject, key: String, whole: Boolean) {
            if (!inputs.has(key)) return
            val value = inputs.getString(key).trim()
            if (value.isEmpty() && !whole) row.put("value", JSONObject.NULL)
            else if (whole) row.put("value", value.toIntOrNull()?.takeIf { it in 0..3 } ?: throw IllegalArgumentException("AUTOMATION_INVALID"))
            else row.put("value", value.replace(',', '.').toDoubleOrNull()?.takeIf(Double::isFinite) ?: throw IllegalArgumentException("CUSTOM_FIELD_INVALID"))
        }
        rows(result.getJSONArray("conditions")).forEachIndexed { index, row ->
            val key = "c:${edit.getJSONArray("conditionKeys").getString(index)}:value"
            if (row.getString("operator") !in setOf("missing", "present")) number(row, key, row.getString("field") == "priority")
        }
        rows(result.getJSONArray("actions")).forEachIndexed { index, row ->
            val key = edit.getJSONArray("actionKeys").getString(index)
            number(row, "a:$key:value", row.getString("type") == "priority")
            if (row.getString("type") == "due" && row.getString("mode") == "shift") whole("a:$key:offset", -74000, 74000)?.let { row.getJSONObject("offset").put("amount", it) }
            valid(!row.optBoolean("unavailable"), "AUTOMATION_TEMPLATE_BLOCKED")
        }
        val safe = SharedAutomationProtocol.definition(result)
        if (trigger.getString("type") == "schedule" && trigger.getString("target") == "project") {
            valid(rows(safe.getJSONArray("conditions")).all { it.getString("field") == "project" } &&
                rows(safe.getJSONArray("actions")).all { it.getString("type") in setOf("createTemplate", "notify") }, "AUTOMATION_PROJECT_TARGET")
        }
        return safe
    }
    fun command(raw: JSONObject, operation: String): JSONObject {
        val edit = edit(raw); valid(UUID.fromString(operation).toString() == operation)
        val title = edit.getString("title").trim(); valid(title.isNotEmpty(), "INVALID_TITLE")
        valid(!edit.isNull("ownerId"), "AUTOMATION_OWNER_REQUIRED"); SharedAutomationProtocol.id(edit.getString("ownerId"))
        val payload = JSONObject().put("operationId", operation).put("title", title).put("ownerId", edit.getString("ownerId"))
            .put("enabled", edit.getBoolean("enabled")).put("deleted", false).put("definition", definition(edit))
        if (!edit.isNull("revision")) payload.put("expectedRevision", edit.getInt("revision"))
        return JSONObject().put("kind", "automation-save").put("sprintId", edit.get("ruleId"))
            .put("body", JSONObject().put("requestId", operation).put("projectId", edit.getString("projectId")).put("payload", payload))
    }
    fun verify(raw: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        val edit = edit(raw); valid(edit.getString("projectId") == project && !data.optBoolean("offlineCache"), "AUTOMATION_SCOPE_CHANGED")
        valid(!queued, "AUTOMATION_LOCAL_QUEUE")
        val context = data.getJSONObject("project")
        valid(context.optString("id") == project && context.optString("spaceId") == edit.getString("spaceId"), "AUTOMATION_SCOPE_CHANGED")
        valid(context.getJSONObject("permissions").optBoolean("editTasks"), "SHARED_PROJECT_FORBIDDEN")
        if (!edit.isNull("ruleId")) {
            val rule = SharedAutomationProtocol.rule(data.getJSONObject("rule"), project)
            valid(rule.getString("id") == edit.getString("ruleId") && rule.getBoolean("canManage") && !rule.getBoolean("deleted"), "SHARED_PROJECT_FORBIDDEN")
            valid(rule.getInt("revision") == edit.getInt("revision"), "AUTOMATION_CONFLICT")
        }
        val oldOwner = data.optJSONObject("rule")?.opt("ownerId") ?: data.opt("actorId")
        valid(edit.opt("ownerId") == oldOwner || context.getJSONObject("permissions").optBoolean("manageProjects"), "SHARED_PROJECT_FORBIDDEN")
        validateCatalog(edit, data)
        command(edit, UUID.randomUUID().toString())
    }
    /** Current names never enter the journal. Catalog checks complement the authoritative server validation. */
    fun validateCatalog(raw: JSONObject, data: JSONObject) {
        val edit = edit(raw); val definition = definition(edit)
        val project = data.getJSONObject("project"); valid(project.optString("archivedAt") in setOf("", "null"), "SHARED_PROJECT_FORBIDDEN")
        val members = rows(data.getJSONArray("members")).map { it.getString("userId") }.toSet()
        val statuses = rows(data.getJSONArray("statuses")).map { it.getString("id") }.toSet()
        val labels = rows(data.getJSONArray("labels")).map { it.getString("id") }.toSet()
        val fields = CustomFieldProtocol.definitions(edit.getString("spaceId"), edit.getString("projectId"), data.getJSONArray("customFieldDefinitions")).associateBy { it.getString("id") }
        valid(edit.opt("ownerId") in members, "AUTOMATION_OWNER_REQUIRED")
        fun typed(row: JSONObject, contains: Boolean = false) {
            val field = fields[row.getString("fieldId")]?.takeUnless { it.getBoolean("archived") } ?: error("CUSTOM_FIELD_UNAVAILABLE")
            val value = row.get("value")
            val safe = if (contains) { valid(field.getString("type") == "multi"); JSONArray().put(value) } else value
            CustomFieldProtocol.normalize(field, safe, null, input = false)
        }
        rows(definition.getJSONArray("conditions")).forEach { row ->
            val field = row.getString("field"); val operator = row.getString("operator"); val custom = if (field == "custom") fields[row.getString("fieldId")]?.takeUnless { it.getBoolean("archived") } ?: error("CUSTOM_FIELD_UNAVAILABLE") else null
            valid(operator in operators(field, custom?.getString("type")), "AUTOMATION_INVALID")
            if (operator !in setOf("missing", "present")) when (field) {
                "project" -> valid(row.opt("value") == edit.getString("projectId"), "AUTOMATION_INVALID")
                "status" -> valid(row.opt("value") in statuses, "AUTOMATION_INVALID")
                "label" -> valid(row.opt("value") in labels, "AUTOMATION_INVALID")
                "assignee" -> valid(row.isNull("value") || row.opt("value") in members, "INVALID_ASSIGNEE")
                "priority" -> integer(row.get("value"), 0, 3)
                "custom" -> typed(row, operator in setOf("contains", "notContains"))
            }
        }
        rows(definition.getJSONArray("actions")).forEach { row -> when (row.getString("type")) {
            "status" -> valid(row.opt("value") in statuses, "AUTOMATION_INVALID")
            "assignee" -> valid(row.isNull("value") || row.opt("value") in members, "INVALID_ASSIGNEE")
            "addLabels", "removeLabels" -> valid((0 until row.getJSONArray("value").length()).all { row.getJSONArray("value").getString(it) in labels }, "AUTOMATION_INVALID")
            "notify" -> valid((0 until row.getJSONArray("recipientIds").length()).all { row.getJSONArray("recipientIds").getString(it) in members }, "AUTOMATION_RECIPIENT_UNAVAILABLE")
            "custom" -> typed(row)
            "createTemplate" -> valid(rows(data.getJSONArray("templates")).any { it.opt("id") == row.opt("templateId") && it.opt("kind") == "task" }, "AUTOMATION_TASK_TEMPLATE_REQUIRED")
        } }
    }
    fun operators(field: String, type: String? = null): List<String> = when {
        field == "label" -> listOf("contains", "notContains")
        field == "priority" || field == "custom" && type in setOf("number", "date") -> listOf("eq", "ne", "missing", "present", "gt", "gte", "lt", "lte")
        field == "custom" && type == "multi" -> listOf("eq", "ne", "missing", "present", "contains", "notContains")
        else -> listOf("eq", "ne", "missing", "present")
    }
    /** Save responses may include live content, but only these checked receipt identifiers persist. */
    fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        val body = command.getJSONObject("body"); val payload = body.getJSONObject("payload")
        val minimal = response.has("ruleId")
        val rule = if (minimal) {
            keys(response, setOf("ruleId", "revision", "enabled", "deleted")); copy(response).put("id", response.getString("ruleId"))
        } else SharedAutomationProtocol.rule(response.optJSONObject("rule") ?: response, body.getString("projectId"))
        SharedAutomationProtocol.id(rule.getString("id"))
        valid(command.isNull("sprintId") || command.getString("sprintId") == rule.getString("id"), "AUTOMATION_RECEIPT_INVALID")
        valid(integer(rule.opt("revision"), 1, Int.MAX_VALUE).toLong() == if (payload.has("expectedRevision")) payload.getInt("expectedRevision").toLong() + 1 else 1L, "AUTOMATION_RECEIPT_INVALID")
        valid(rule.opt("enabled") is Boolean && rule.getBoolean("enabled") == payload.getBoolean("enabled") && rule.opt("deleted") == false, "AUTOMATION_RECEIPT_INVALID")
        if (!minimal) valid(rule.getString("title") == payload.getString("title") && rule.optString("ownerId") == payload.getString("ownerId"), "AUTOMATION_RECEIPT_INVALID")
        return JSONObject().put("ruleId", rule.getString("id")).put("revision", rule.getInt("revision")).put("enabled", rule.getBoolean("enabled")).put("deleted", false)
    }
}

internal object SharedAutomationEditorJournalContract : CommandJournalContract {
    override val namespace = "automation-editor-v1"
    override val definitiveErrors = (SharedAutomationProtocol.errors + CustomFieldProtocol.errors + WorkflowLifecycle.errors) -
        setOf("SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED", "BACKGROUND_RETRY", "BACKGROUND_LEASE_EXPIRED")
    override fun validateEdit(edit: JSONObject) = SharedAutomationEditorProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String) = SharedAutomationEditorProtocol.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) = SharedAutomationEditorProtocol.verify(edit, data, project, queued)
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = error("AUTOMATION_EXPLICIT_COPY_REQUIRED")
    override fun receipt(command: JSONObject, response: JSONObject) = SharedAutomationEditorProtocol.receipt(command, response)
}
