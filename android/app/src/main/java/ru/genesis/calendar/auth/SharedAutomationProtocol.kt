package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Bounded reader for the incumbent typed DSL. No expression or JSON editor is exposed to users. */
internal object SharedAutomationProtocol {
    val triggers = setOf("created", "status", "assignee", "completed", "dueSoon", "due", "schedule")
    val actions = setOf("status", "assignee", "priority", "addLabels", "removeLabels", "due", "custom", "createTemplate", "notify")
    val runStates = setOf("pending", "succeeded", "skipped", "cancelled", "failed")
    val errors = setOf("AUTOMATION_INVALID", "AUTOMATION_CONFLICT", "AUTOMATION_STALE", "AUTOMATION_CONDITIONS_NOT_MET",
        "AUTOMATION_LOOP_GUARD", "AUTOMATION_CHAIN_LIMIT", "AUTOMATION_RATE_LIMIT", "AUTOMATION_RULE_LIMIT", "AUTOMATION_EFFECT_LIMIT",
        "AUTOMATION_TASK_TEMPLATE_REQUIRED", "AUTOMATION_TEMPLATE_BLOCKED", "AUTOMATION_TASK_REQUIRED", "AUTOMATION_DUE_REQUIRED",
        "AUTOMATION_SERIES_DUPLICATE", "AUTOMATION_RECIPIENT_UNAVAILABLE", "AUTOMATION_RETRY_UNAVAILABLE", "AUTOMATION_CURSOR_INVALID",
        "AUTOMATION_OPERATION_REUSED", "AUTOMATION_OPERATION_REQUIRED", "AUTOMATION_SIZE_LIMIT", "SHARED_PROJECT_FORBIDDEN",
        "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED", "BACKGROUND_RETRY", "BACKGROUND_LEASE_EXPIRED",
        "TEMPLATE_INVALID", "TEMPLATE_UNAVAILABLE", "TEMPLATE_FORBIDDEN", "TEMPLATE_SOURCE_UNAVAILABLE", "TEMPLATE_SOURCE_SCOPE_UNAVAILABLE",
        "TEMPLATE_DATE_INVALID", "TEMPLATE_DATE_OUTSIDE_RANGE", "TEMPLATE_OPEN_STATUS_REQUIRED", "TEMPLATE_REFERENCE_INVALID",
        "TEMPLATE_FIELD_MAPPING_INVALID", "TEMPLATE_FIELD_MAPPING_COLLISION", "TEMPLATE_FIELD_VALUE_UNMAPPED", "TEMPLATE_STATUS_MAPPING_INVALID",
        "TEMPLATE_OPERATION_REQUIRED", "TEMPLATE_PREVIEW_CHANGED", "TEMPLATE_RESOURCE_LIMIT", "SERIES_INVALID", "INVALID_CALENDAR_CONTEXT", "INVALID_ASSIGNEE", "INVALID_TITLE", "INVALID_TEXT",
        "AUTOMATION_ACTION_REJECTED", "AUTOMATION_TASK_UNAVAILABLE")
    fun errorCode(code: String) = code in errors || Regex("(?:CUSTOM_FIELD|WORKFLOW)_[A-Z_]{1,80}").matches(code)
    private fun valid(condition: Boolean) { require(condition) { "AUTOMATION_PROTOCOL" } }
    fun id(value: String) = SharedBulkProtocol.id(value)
    fun templateId(value: String): String { valid(Regex("[A-Za-z0-9:_-]{1,100}").matches(value)); return value }
    private fun keys(value: JSONObject, expected: Set<String>) = valid(value.keys().asSequence().toSet() == expected)
    private fun text(value: JSONObject, key: String, max: Int = 5000): String {
        val raw = value.opt(key); valid(raw is String && raw.length <= max); return raw as String
    }
    private fun number(value: JSONObject, key: String, min: Int = 0, max: Int = Int.MAX_VALUE): Int {
        val raw = value.opt(key); valid(raw is Int || raw is Long)
        valid((raw as Number).toLong() in min.toLong()..max.toLong()); return raw.toInt()
    }
    private fun bool(value: JSONObject, key: String): Boolean { valid(value.opt(key) is Boolean); return value.getBoolean(key) }
    private fun nullable(value: JSONObject, key: String, transform: (String) -> String = { it }): Any {
        valid(value.has(key)); return if (value.isNull(key)) JSONObject.NULL else transform(text(value, key))
    }
    private fun time(value: String) = value.also { Instant.parse(it) }
    private fun clone(value: JSONObject) = JSONObject(value.toString())
    private fun rows(value: JSONArray, max: Int): List<JSONObject> {
        valid(value.length() <= max); return (0 until value.length()).map(value::getJSONObject)
    }
    private fun scalar(value: Any?) {
        valid(value == JSONObject.NULL || value is String && value.length <= 20000 || value is Boolean || value is Number && value.toDouble().isFinite() ||
            value is JSONArray && value.length() <= 200 && (0 until value.length()).all { value.opt(it) is String && value.getString(it).length <= 100 })
    }
    fun definition(raw: JSONObject): JSONObject {
        valid(raw.toString().toByteArray(Charsets.UTF_8).size <= 200000)
        keys(raw, setOf("schemaVersion", "trigger", "conditions", "actions", "calendarMode", "calendarContext"))
        valid(number(raw, "schemaVersion", 1, 1) == 1 && text(raw, "calendarMode") in setOf("profane", "sacred", "lunar"))
        val context = raw.getJSONObject("calendarContext")
        keys(context, setOf("version", "timeZone", "gregorianYearStart")); number(context, "version", 1, 2)
        ZoneId.of(text(context, "timeZone", 200)); valid(text(context, "gregorianYearStart") in setOf("january", "march"))
        val trigger = raw.getJSONObject("trigger"); val type = text(trigger, "type")
        val triggerKeys = mutableSetOf("type"); valid(type in triggers)
        if (type == "dueSoon") { triggerKeys += "leadDays"; number(trigger, "leadDays", 1, 366) }
        if (type in setOf("dueSoon", "due", "schedule")) { triggerKeys += "time"; valid(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(text(trigger, "time"))) }
        if (type == "schedule") {
            triggerKeys += setOf("target", "recurrence"); valid(text(trigger, "target") in setOf("project", "tasks"))
            recurrence(trigger.getJSONObject("recurrence"), context)
        }
        keys(trigger, triggerKeys)
        rows(raw.getJSONArray("conditions"), 20).forEach { condition ->
            val field = text(condition, "field"); valid(field in setOf("project", "status", "label", "assignee", "priority", "custom"))
            keys(condition, setOf("field", "operator", "value") + if (field == "custom") setOf("fieldId") else emptySet())
            valid(text(condition, "operator") in setOf("eq", "ne", "missing", "present", "contains", "notContains", "gt", "gte", "lt", "lte"))
            valid(condition.has("value")); scalar(condition.opt("value")); if (field == "custom") id(text(condition, "fieldId"))
        }
        val actions = rows(raw.getJSONArray("actions"), 10); valid(actions.isNotEmpty())
        actions.forEach { action ->
            val kind = text(action, "type"); valid(kind in this.actions)
            when (kind) {
                "status" -> { keys(action, setOf("type", "value")); id(text(action, "value")) }
                "assignee" -> { keys(action, setOf("type", "value")); nullable(action, "value", ::id) }
                "priority" -> { keys(action, setOf("type", "value")); number(action, "value", 0, 3) }
                "addLabels", "removeLabels" -> { keys(action, setOf("type", "value")); val ids = action.getJSONArray("value"); valid(ids.length() <= 30); (0 until ids.length()).forEach { id(ids.getString(it)) } }
                "custom" -> { keys(action, setOf("type", "fieldId", "value")); id(text(action, "fieldId")); valid(action.has("value")); scalar(action.opt("value")) }
                "notify" -> { keys(action, setOf("type", "recipientIds", "message")); val ids = action.getJSONArray("recipientIds"); valid(ids.length() in 1..50); (0 until ids.length()).forEach { id(ids.getString(it)) }; text(action, "message", 1000) }
                "createTemplate" -> {
                    if (action.optBoolean("unavailable")) { keys(action, setOf("type", "templateId", "options", "unavailable")); bool(action, "unavailable"); valid(text(action, "templateId").isEmpty()) }
                    else { keys(action, setOf("type", "templateId", "options")); templateId(text(action, "templateId")); action.getJSONObject("options") }
                }
                "due" -> when (text(action, "mode")) {
                    "clear" -> keys(action, setOf("type", "mode"))
                    "set" -> { keys(action, setOf("type", "mode", "date")); val date = text(action, "date"); valid(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(date)); LocalDate.parse(date) }
                    "shift" -> {
                        keys(action, setOf("type", "mode", "offset")); val offset = action.getJSONObject("offset"); keys(offset, setOf("amount", "unit"))
                        val limit = when (text(offset, "unit")) { "day" -> 74000; "month" -> 2400; "year" -> 200; else -> { valid(false); 0 } }
                        number(offset, "amount", -limit, limit)
                    }
                    else -> valid(false)
                }
            }
        }
        return clone(raw)
    }
    private fun recurrence(raw: JSONObject, context: JSONObject) {
        keys(raw, setOf("enabled", "mode", "pattern", "interval", "rangeStart", "rangeEnd", "invalidDayPolicy", "calendarContext", "days", "months", "pyatas"))
        valid(bool(raw, "enabled") && text(raw, "invalidDayPolicy") == "skip")
        valid(PlanningLifecycle.canonical(raw.getJSONObject("calendarContext")) == PlanningLifecycle.canonical(context)); number(raw, "interval", 1, 99)
        val mode = text(raw, "mode"); val pattern = text(raw, "pattern")
        valid(pattern in when (mode) {
            "classic" -> setOf("daily", "weekdays", "monthly", "yearly"); "genesis" -> setOf("pyata-days", "month-days")
            "lunar" -> setOf("lunar-days", "lunar-decades", "lunar-decade-days", "lunar-phases", "lunar-yearly"); else -> emptySet()
        })
        val start = text(raw, "rangeStart"); val end = text(raw, "rangeEnd")
        fun date(value: String) { valid(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(value) && value in "1900-01-01".."2100-12-31"); LocalDate.parse(value) }
        date(start); if (end.isNotEmpty()) { date(end); valid(end >= start) }
        val dayMax = if (mode == "classic") 7 else when (pattern) { "pyata-days" -> 5; "lunar-decades" -> 3; "lunar-decade-days" -> 10; "lunar-phases" -> 2; else -> 30 }
        for ((key, max) in listOf("days" to dayMax, "months" to if (pattern == "lunar-yearly") 13 else 72, "pyatas" to if (pattern == "lunar-decade-days") 3 else 6)) {
            val values = raw.getJSONArray(key); valid(values.length() <= max)
            val numbers = (0 until values.length()).map { index ->
                val value = values.get(index); valid(value is Int && value in 1..max); value as Int
            }
            valid(numbers.distinct().size == numbers.size && (key != "days" || numbers.isNotEmpty()) && (key != "months" || pattern != "lunar-yearly" || numbers.isNotEmpty()))
        }
    }
    fun rule(raw: JSONObject, project: String, withDefinition: Boolean = true): JSONObject {
        keys(raw, setOf("id", "projectId", "ownerId", "title", "enabled", "revision", "deleted", "canManage", "createdAt", "updatedAt") +
            if (withDefinition) setOf("definition") else emptySet())
        id(text(raw, "id")); valid(id(text(raw, "projectId")) == project); nullable(raw, "ownerId", ::id); text(raw, "title", 200)
        bool(raw, "enabled"); bool(raw, "deleted"); bool(raw, "canManage"); number(raw, "revision", 1)
        time(text(raw, "createdAt")); time(text(raw, "updatedAt")); if (withDefinition) definition(raw.getJSONObject("definition"))
        return clone(raw)
    }
    fun list(raw: JSONObject, project: String): JSONObject {
        keys(raw, setOf("rules", "nextCursor", "canCreate", "workerCompletedAt"))
        val values = rows(raw.getJSONArray("rules"), 50); values.forEach { rule(it, project, false) }
        valid(values.map { it.getString("id") }.distinct().size == values.size)
        nullable(raw, "nextCursor", ::id); bool(raw, "canCreate"); nullable(raw, "workerCompletedAt", ::time)
        return clone(raw)
    }
    fun runs(raw: JSONObject, ruleId: String): JSONObject {
        keys(raw, setOf("runs", "nextCursor")); val values = rows(raw.getJSONArray("runs"), 50)
        values.forEach { run ->
            keys(run, setOf("id", "ruleId", "revision", "taskId", "taskTitle", "state", "attempts", "retryCount", "errorCode", "result", "createdAt", "finishedAt"))
            id(text(run, "id")); valid(id(text(run, "ruleId")) == ruleId); number(run, "revision", 1)
            nullable(run, "taskId", ::id); nullable(run, "taskTitle"); valid(!run.isNull("taskId") || run.isNull("taskTitle"))
            valid(text(run, "state") in runStates); number(run, "attempts"); number(run, "retryCount", 0, 3)
            nullable(run, "errorCode") { code -> valid(Regex("[A-Z][A-Z0-9_]{0,99}").matches(code)); code }
            time(text(run, "createdAt")); nullable(run, "finishedAt", ::time)
            valid(run.has("result")); if (!run.isNull("result")) effects(run.getJSONObject("result"))
        }
        valid(values.map { it.getString("id") }.distinct().size == values.size); nullable(raw, "nextCursor", ::id)
        return clone(raw)
    }
    private fun effects(raw: JSONObject) {
        keys(raw, setOf("updated", "patch", "createdTaskCount", "notifications", "notices")); bool(raw, "updated")
        valid(raw.opt("patch") is JSONObject || raw.opt("patch") is JSONArray && raw.getJSONArray("patch").length() == 0)
        val patch = SharedTemplateProtocol.dictionary(raw.get("patch"))
        valid(patch.keys().asSequence().all { it in setOf("statusId", "assigneeId", "priority", "labelIds", "dueDate", "customFields") })
        if (patch.has("statusId")) id(text(patch, "statusId"))
        if (patch.has("assigneeId")) nullable(patch, "assigneeId", ::id)
        if (patch.has("priority")) number(patch, "priority", 0, 3)
        if (patch.has("dueDate")) nullable(patch, "dueDate") { value -> valid(LocalDate.parse(value).toString() == value); value }
        if (patch.has("customFields")) CustomFieldProtocol.values(patch.get("customFields"))
        if (patch.has("labelIds")) {
            val ids = patch.getJSONArray("labelIds"); valid(ids.length() <= 200); (0 until ids.length()).forEach { id(ids.getString(it)) }
        }
        number(raw, "createdTaskCount", 0, 50); number(raw, "notifications")
        val notices = raw.getJSONArray("notices"); valid(notices.length() <= 100); (0 until notices.length()).forEach { valid(notices.get(it) is String && notices.getString(it).length <= 5000) }
        valid(raw.toString().length <= 200000)
    }
    fun preview(raw: JSONObject, owner: String, task: String?): JSONObject {
        keys(raw, setOf("matches", "ownerId", "taskId", "taskRevision", "effects", "dryRun"))
        valid(bool(raw, "dryRun") && text(raw, "ownerId") == id(owner)); bool(raw, "matches")
        valid(if (task == null) raw.isNull("taskId") && raw.isNull("taskRevision") else text(raw, "taskId") == id(task))
        if (task != null) number(raw, "taskRevision", 1)
        valid(raw.isNull("effects") != raw.getBoolean("matches"))
        if (!raw.isNull("effects")) effects(raw.getJSONObject("effects"))
        return clone(raw)
    }
    fun edit(raw: JSONObject): JSONObject {
        val kind = text(raw, "kind"); valid(kind in setOf("enabled", "deleted", "retry"))
        keys(raw, setOf("projectId", "ruleId", "revision", "kind") + if (kind == "retry") setOf("runId") else setOf("value"))
        id(text(raw, "projectId")); id(text(raw, "ruleId")); number(raw, "revision", 1)
        if (kind == "retry") id(text(raw, "runId")) else bool(raw, "value")
        return clone(raw)
    }
}

/** The journal carries identifiers and a fixed command; it never stores titles, definitions or run logs. */
internal object SharedAutomationJournalContract : CommandJournalContract {
    override val namespace = "automations-v1"
    override val definitiveErrors = (SharedAutomationProtocol.errors + CustomFieldProtocol.errors + WorkflowLifecycle.errors) -
        setOf("SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED", "BACKGROUND_RETRY", "BACKGROUND_LEASE_EXPIRED")
    override fun validateEdit(edit: JSONObject) = SharedAutomationProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String): JSONObject {
        val safe = validateEdit(edit); val kind = safe.getString("kind")
        val payload = JSONObject().put("operationId", SharedBulkProtocol.operation(requestId)).put("expectedRevision", safe.getInt("revision"))
        if (kind != "retry") payload.put(kind, safe.getBoolean("value"))
        if (kind == "deleted") payload.put("enabled", false)
        return JSONObject().put("kind", kind).put("sprintId", safe.getString("ruleId")).put("body", JSONObject().put("requestId", requestId).put("projectId", safe.getString("projectId")).put("payload", payload)
            .apply { if (kind == "retry") put("runId", safe.getString("runId")) })
    }
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        val safe = validateEdit(edit); require(safe.getString("projectId") == project) { "AUTOMATION_SCOPE_CHANGED" }
        val rule = SharedAutomationProtocol.rule(data.getJSONObject("rule"), project)
        require(rule.getString("id") == safe.getString("ruleId") && rule.getBoolean("canManage")) { "SHARED_PROJECT_FORBIDDEN" }
        require(rule.getInt("revision") == safe.getInt("revision")) { "AUTOMATION_CONFLICT" }
        if (safe.getString("kind") == "retry") require(rule.getBoolean("enabled") && !rule.getBoolean("deleted")) { "AUTOMATION_RETRY_UNAVAILABLE" }
        if (safe.getString("kind") == "enabled") require(!rule.getBoolean("deleted")) { "AUTOMATION_STALE" }
        if (safe.getString("kind") != "retry") require(rule.getBoolean(safe.getString("kind")) != safe.getBoolean("value")) { "AUTOMATION_STALE" }
    }
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = error("AUTOMATION_CONFLICT")
    override fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        val body = command.getJSONObject("body"); val payload = body.getJSONObject("payload"); val id = command.getString("sprintId")
        if (command.getString("kind") == "retry") {
            val minimal = response.has("ruleId")
            require(response.keys().asSequence().toSet() == if (minimal) setOf("ruleId", "runId", "retryCount") else setOf("id", "state", "retryCount")) { "AUTOMATION_RECEIPT_INVALID" }
            require((!minimal || response.optString("ruleId") == id) && response.optString(if (minimal) "runId" else "id") == body.getString("runId") &&
                (minimal || response.optString("state") == "pending") && response.opt("retryCount") is Int && response.getInt("retryCount") in 1..3) { "AUTOMATION_RECEIPT_INVALID" }
            return JSONObject().put("ruleId", id).put("runId", body.getString("runId")).put("retryCount", response.getInt("retryCount"))
        }
        val minimal = response.has("ruleId")
        val rule = if (minimal) {
            require(response.keys().asSequence().toSet() == setOf("ruleId", "revision", "enabled", "deleted") && response.getString("ruleId") == id) { "AUTOMATION_RECEIPT_INVALID" }
            JSONObject(response.toString()).put("id", response.getString("ruleId"))
        } else response.getJSONObject("rule").also { SharedAutomationProtocol.rule(it, body.getString("projectId")) }
        val kind = command.getString("kind")
        require(rule.opt("revision") is Int && rule.opt("enabled") is Boolean && rule.opt("deleted") is Boolean &&
            rule.getString("id") == id && rule.getInt("revision").toLong() == payload.getInt("expectedRevision").toLong() + 1 &&
            rule.getBoolean(kind) == payload.getBoolean(kind) && (kind != "deleted" || !rule.getBoolean("enabled"))) { "AUTOMATION_RECEIPT_INVALID" }
        return JSONObject().put("ruleId", id).put("revision", rule.getInt("revision")).put("enabled", rule.getBoolean("enabled")).put("deleted", rule.getBoolean("deleted"))
    }
}
