package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.util.UUID

/** The existing portable C1 document. It contains content, never source grants, files or discussions. */
internal object SharedTemplateManifest {
    const val MAX_BYTES = 5_000_000
    val modes = setOf("profane", "sacred", "lunar")
    val taskFields = setOf("key", "projectKey", "parentKey", "title", "description", "entryType", "statusKey", "categoryKey", "priority", "tags",
        "assigneeId", "approvalRequired", "approverIds", "labelKeys", "dependsOnKeys", "due", "start", "startTime", "endTime", "checklists", "customValues", "storyPoints", "estimateHours")
    fun copy(value: JSONObject) = JSONObject(value.toString())
    fun rows(array: JSONArray, maximum: Int = 500): List<JSONObject> {
        valid(array.length() <= maximum)
        return (0 until array.length()).map { array.get(it).also { row -> valid(row is JSONObject) } as JSONObject }
    }
    fun key(value: String): String = value.also { valid(it.matches(Regex("[A-Za-z0-9:_-]{1,100}"))) }
    fun keys(value: JSONObject, allowed: Set<String>) { valid(value.keys().asSequence().all { it in allowed }) }
    fun valid(value: Boolean, code: String = "TEMPLATE_INVALID") { require(value) { code } }
    fun text(value: Any?, maximum: Int = 160, required: Boolean = false): String {
        valid(value is String && value.codePointCount(0, value.length) <= maximum && (!required || value.trim().isNotEmpty()))
        return value as String
    }
    fun integer(value: Any?, minimum: Int, maximum: Int): Int {
        valid((value is Int || value is Long) && (value as Number).toLong() in minimum.toLong()..maximum.toLong())
        return (value as Number).toInt()
    }
    private fun nullableKey(value: Any?): String? = if (value == null || value == JSONObject.NULL) null else key(text(value, 100))
    private fun unique(values: List<JSONObject>): Map<String, JSONObject> {
        val result = values.associateBy { key(it.getString("key")) }
        valid(result.size == values.size, "TEMPLATE_REFERENCE_INVALID")
        return result
    }
    fun stringKeys(value: JSONArray, maximum: Int = 500): List<String> {
        valid(value.length() <= maximum)
        val result = (0 until value.length()).map { key(text(value.get(it), 100)) }
        valid(result.size == result.distinct().size, "TEMPLATE_REFERENCE_INVALID")
        return result
    }
    fun context(raw: JSONObject): JSONObject {
        keys(raw, setOf("version", "timeZone", "gregorianYearStart"))
        valid(raw.opt("version") == 2 && raw.opt("gregorianYearStart") in setOf("january", "march"))
        valid(DataExportProtocol.timeZone(text(raw.opt("timeZone"), 200)) != null, "INVALID_CALENDAR_TIME_ZONE")
        return copy(raw)
    }
    fun estimate(value: Any?): Any {
        if (value == null || value == JSONObject.NULL) return JSONObject.NULL
        valid(value is Number && value.toDouble().isFinite(), "PLANNING_ESTIMATE_INVALID")
        val decimal = value.toString().toBigDecimalOrNull()
        valid(decimal != null && decimal >= BigDecimal.ZERO && decimal <= BigDecimal("1000000") && decimal.stripTrailingZeros().scale() <= 2, "PLANNING_ESTIMATE_INVALID")
        return value
    }
    fun offset(raw: Any?): JSONObject? {
        if (raw == null || raw == JSONObject.NULL) return null
        valid(raw is JSONObject, "TEMPLATE_DATE_INVALID")
        raw as JSONObject
        keys(raw, setOf("amount", "unit"))
        valid(raw.opt("unit") in setOf("day", "month", "year"), "TEMPLATE_DATE_INVALID")
        val limit = when (raw.getString("unit")) { "day" -> 74000; "month" -> 2400; else -> 200 }
        integer(raw.opt("amount"), -limit, limit)
        return copy(raw)
    }
    private fun colour(value: Any?) { valid(value is String && value.matches(Regex("#[0-9a-fA-F]{6}"))) }
    private fun tags(value: JSONArray) { valid(value.length() <= 30); (0 until value.length()).forEach { text(value.get(it), 80) } }

    /** Partial titles and number input survive editing; complete validation happens before a command is frozen. */
    fun validate(raw: JSONObject, complete: Boolean = true): JSONObject {
        valid(raw.toString().toByteArray(Charsets.UTF_8).size <= MAX_BYTES, "TEMPLATE_SIZE_LIMIT")
        keys(raw, setOf("schemaVersion", "kind", "calendarMode", "calendarContext", "projects", "labels", "fields", "tasks"))
        valid(raw.opt("schemaVersion") == 1 && raw.opt("kind") in setOf("task", "project") && raw.opt("calendarMode") in modes)
        context(raw.getJSONObject("calendarContext"))
        val projects = rows(raw.getJSONArray("projects"), 50)
        valid(projects.isNotEmpty() && (raw.getString("kind") != "task" || projects.size == 1))
        val projectMap = unique(projects)
        val labels = rows(raw.getJSONArray("labels"), 50); val labelMap = unique(labels)
        labels.forEach { label ->
            keys(label, setOf("key", "title", "color")); text(label.opt("title"), 40, complete); colour(label.opt("color"))
        }
        val statusProjects = mutableMapOf<String, String>(); val categoryProjects = mutableMapOf<String, String>()
        val seenProjects = mutableSetOf<String>()
        projects.forEachIndexed { index, project ->
            keys(project, setOf("key", "parentKey", "title", "description", "layout", "kind", "statuses", "categories", "labelKeys", "tags", "boardStatusKey"))
            val id = project.getString("key"); val parent = nullableKey(project.opt("parentKey"))
            text(project.opt("title"), 160, complete); text(project.opt("description"), 5000)
            valid(project.opt("layout") in setOf("list", "board") && project.opt("kind") in setOf("project", "task-list"))
            if (complete) valid(if (index == 0) parent == null else parent in seenProjects, "TEMPLATE_REFERENCE_INVALID")
            val statuses = rows(project.getJSONArray("statuses"), 30)
            statuses.forEach { status ->
                keys(status, setOf("key", "title", "isDone", "color", "taskTitleLines", "visibleTaskCount"))
                val statusId = key(status.getString("key")); valid(statusProjects.put(statusId, id) == null, "TEMPLATE_REFERENCE_INVALID")
                text(status.opt("title"), 80, complete); valid(status.opt("isDone") is Boolean); colour(status.opt("color"))
                integer(status.opt("taskTitleLines"), 0, 3); integer(status.opt("visibleTaskCount"), 0, 1000)
            }
            if (complete) valid(statuses.any { !it.getBoolean("isDone") } && statuses.any { it.getBoolean("isDone") }, "TEMPLATE_OPEN_STATUS_REQUIRED")
            rows(project.getJSONArray("categories"), 50).forEach { category ->
                keys(category, setOf("key", "title", "color")); val categoryId = key(category.getString("key"))
                valid(categoryProjects.put(categoryId, id) == null, "TEMPLATE_REFERENCE_INVALID")
                text(category.opt("title"), 80, complete); colour(category.opt("color"))
            }
            tags(project.getJSONArray("tags"))
            val projectLabels = stringKeys(project.getJSONArray("labelKeys"))
            val board = nullableKey(project.opt("boardStatusKey"))
            if (complete) valid(projectLabels.all { it in labelMap } && (board == null || statusProjects[board] == parent), "TEMPLATE_REFERENCE_INVALID")
            seenProjects += id
        }
        val fields = rows(raw.getJSONArray("fields"), 200); val fieldMap = unique(fields)
        fields.forEach { field ->
            keys(field, setOf("key", "projectKey", "title", "type", "options", "required", "showCard", "showList", "position"))
            val project = nullableKey(field.opt("projectKey")); valid(project == null || project in projectMap, "TEMPLATE_REFERENCE_INVALID")
            text(field.opt("title"), 160, complete); valid(field.opt("type") in CustomFieldProtocol.types)
            for (flag in listOf("required", "showCard", "showList")) valid(field.opt(flag) is Boolean)
            integer(field.opt("position"), -100000, 100000)
            val options = rows(field.getJSONArray("options"), 10000)
            require(options.count { it.opt("archived") == false } <= 200 && field.toString().toByteArray(Charsets.UTF_8).size <= 1_000_000) { "TEMPLATE_INVALID" }
            valid(field.getString("type") in setOf("select", "multi") || options.isEmpty())
            valid(options.map { key(it.getString("id")) }.distinct().size == options.size, "TEMPLATE_REFERENCE_INVALID")
            options.forEach { option -> keys(option, setOf("id", "title", "archived")); text(option.opt("title"), 160, complete); valid(option.opt("archived") is Boolean) }
        }
        val tasks = rows(raw.getJSONArray("tasks")); val taskMap = unique(tasks)
        if (complete && raw.getString("kind") == "task") valid(tasks.count { it.isNull("parentKey") } == 1)
        val checklistKeys = mutableSetOf<String>(); val seenTasks = mutableSetOf<String>()
        val graph = taskMap.keys.associateWith { mutableListOf<String>() }
        tasks.forEach { task ->
            keys(task, taskFields)
            val id = task.getString("key"); val project = key(task.getString("projectKey")); val parent = nullableKey(task.opt("parentKey"))
            val status = key(task.getString("statusKey")); val category = nullableKey(task.opt("categoryKey"))
            text(task.opt("title"), 160, complete); text(task.opt("description"), 20000)
            valid(task.opt("entryType") in setOf("task", "meeting", "event")); integer(task.opt("priority"), 0, 3); tags(task.getJSONArray("tags"))
            nullableKey(task.opt("assigneeId")); val approvers = stringKeys(task.getJSONArray("approverIds"), 200)
            valid(task.opt("approvalRequired") is Boolean && (task.getBoolean("approvalRequired") || approvers.isEmpty()))
            val labelsForTask = stringKeys(task.getJSONArray("labelKeys")); val dependencies = stringKeys(task.getJSONArray("dependsOnKeys"), 50)
            offset(task.opt("due")); offset(task.opt("start"))
            for (time in listOf("startTime", "endTime")) valid(task.isNull(time) || task.opt(time) is String && task.getString(time).matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")), "TEMPLATE_DATE_INVALID")
            valid(task.isNull("startTime") == task.isNull("endTime"), "TEMPLATE_DATE_INVALID")
            estimate(task.opt("storyPoints")); estimate(task.opt("estimateHours"))
            if (complete) valid(project in projectMap && statusProjects[status] == project && (category == null || categoryProjects[category] == project)
                && (parent == null || parent in seenTasks && taskMap[parent]?.opt("projectKey") == project)
                && labelsForTask.all { it in labelMap } && dependencies.all { it != id && taskMap[it]?.opt("projectKey") == project }, "TEMPLATE_REFERENCE_INVALID")
            var itemCount = 0
            rows(task.getJSONArray("checklists"), 20).forEach { list ->
                keys(list, setOf("key", "title", "items")); valid(checklistKeys.add(key(list.getString("key"))), "TEMPLATE_REFERENCE_INVALID"); text(list.opt("title"), 160, complete)
                rows(list.getJSONArray("items"), 300).forEach { item ->
                    valid(++itemCount <= 300); keys(item, setOf("key", "title", "assigneeId", "due", "linkedTaskKey"))
                    valid(checklistKeys.add(key(item.getString("key"))), "TEMPLATE_REFERENCE_INVALID"); text(item.opt("title"), 500, complete)
                    nullableKey(item.opt("assigneeId")); offset(item.opt("due")); val link = nullableKey(item.opt("linkedTaskKey"))
                    if (complete && link != null) { valid(taskMap[link]?.opt("projectKey") == project, "TEMPLATE_REFERENCE_INVALID"); graph.getValue(id).add(link) }
                }
            }
            val values = task.getJSONObject("customValues")
            valid(values.length() <= 200)
            values.keys().forEach { fieldId ->
                val field = fieldMap[fieldId]
                if (complete) {
                    valid(field != null && (field.isNull("projectKey") || field.opt("projectKey") == project), "TEMPLATE_REFERENCE_INVALID")
                    val adapter = fieldAdapter(requireNotNull(field)); val value = optionValue(field, values.get(fieldId), true)
                    CustomFieldProtocol.normalize(adapter, value, value, input = false)
                }
            }
            if (complete) {
                graph.getValue(id).addAll(dependencies)
                if (parent != null) graph.getValue(parent).add(id)
            }
            seenTasks += id
        }
        if (complete) {
            val visiting = mutableSetOf<String>(); val visited = mutableSetOf<String>()
            fun visit(id: String) {
                if (id in visited) return
                valid(visiting.add(id), "TASK_RELATION_CYCLE")
                graph.getValue(id).forEach(::visit); visiting.remove(id); visited.add(id)
            }
            graph.keys.forEach(::visit)
        }
        return copy(raw)
    }

    /** Field inputs use safe opaque IDs internally; source keys (including ':') round-trip unchanged. */
    fun inputId(key: String): String = "tpl_" + MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
    fun fieldAdapter(field: JSONObject): JSONObject = copy(field).put("id", inputId(field.getString("key")))
        .put("archived", false)
        .put("options", JSONArray(rows(field.getJSONArray("options"), 10000).map { copy(it).put("id", inputId(it.getString("id"))) }))
    fun optionValue(field: JSONObject, value: Any?, toInput: Boolean): Any {
        fun convert(id: String): String = if (toInput) inputId(id) else rows(field.getJSONArray("options"), 10000).firstOrNull { inputId(it.getString("id")) == id }?.getString("id") ?: error("CUSTOM_FIELD_OPTION_UNAVAILABLE")
        return when {
            value == null || value == JSONObject.NULL -> JSONObject.NULL
            field.opt("type") == "select" && value is String -> convert(value)
            field.opt("type") == "multi" && value is JSONArray -> JSONArray((0 until value.length()).map { convert(value.getString(it)) })
            else -> value
        }
    }
    fun newProject(id: String, title: String, open: String, done: String, parent: String? = null): JSONObject = JSONObject()
        .put("key", key(id)).put("parentKey", parent ?: JSONObject.NULL).put("title", title).put("description", "").put("layout", "board").put("kind", "project")
        .put("boardStatusKey", JSONObject.NULL).put("categories", JSONArray()).put("labelKeys", JSONArray()).put("tags", JSONArray())
        .put("statuses", JSONArray(listOf(false to open, true to done).map { (completed, name) -> JSONObject().put("key", UUID.randomUUID().toString()).put("title", name)
            .put("isDone", completed).put("color", "#2d6c68").put("taskTitleLines", if (completed) 2 else 0).put("visibleTaskCount", if (completed) 5 else 0) }))
    fun newTask(id: String, project: String, status: String, title: String): JSONObject = JSONObject().put("key", key(id)).put("projectKey", key(project)).put("parentKey", JSONObject.NULL)
        .put("title", title).put("description", "").put("entryType", "task").put("statusKey", key(status)).put("categoryKey", JSONObject.NULL).put("priority", 0)
        .put("assigneeId", JSONObject.NULL).put("approvalRequired", false).put("approverIds", JSONArray()).put("tags", JSONArray()).put("labelKeys", JSONArray())
        .put("dependsOnKeys", JSONArray()).put("due", JSONObject.NULL).put("start", JSONObject.NULL).put("startTime", JSONObject.NULL).put("endTime", JSONObject.NULL)
        .put("checklists", JSONArray()).put("customValues", JSONObject()).put("storyPoints", JSONObject.NULL).put("estimateHours", JSONObject.NULL)
}
