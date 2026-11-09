package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** Bounded native reader for the existing bulk API. Reports and ACL-bound names never enter the journal. */
internal object SharedBulkProtocol {
    const val QUERY_SCOPE = "00000000-0000-4000-8000-000000000006"
    val kinds = listOf("priority", "assignee", "status", "due", "labels", "move", "archive", "trash")
    val states = setOf("preview", "running", "done", "cancelled", "failed")
    val commands = setOf("confirm", "cancel", "advance", "resume")
    val errors = setOf("BULK_INVALID", "BULK_PAGE_INVALID", "BULK_PREVIEW_EXPIRED", "BULK_TREE_CHANGED", "BULK_NO_DUE",
        "BULK_STATUS_REQUIRED", "BULK_NOT_ALLOWED", "BULK_INVALID_ITEM", "BULK_RETRY", "BACKGROUND_RETRY",
        "SHARED_TASK_CONFLICT", "SHARED_QUERY_CHANGED", "SHARED_REQUEST_ID_CONFLICT", "SHARED_PROJECT_FORBIDDEN",
        "SHARED_PROJECT_NOT_FOUND", "SHARED_FORBIDDEN", "INVALID_ASSIGNEE", "INVALID_STATUS", "INVALID_LABEL",
        "INVALID_DUE_DATE", "TASK_MOVE_RELATIONS", "TASK_PARENT_COMPLETED", "TASK_CHILDREN_INCOMPLETE", "TASK_APPROVAL_REQUIRED",
        "CUSTOM_FIELD_MOVE_REQUIRES_MAPPING", "INVALID_TRASH_RETENTION", "VIEW_LIST_CHANGED", "VIEW_PAGE_INVALID", "VIEW_INVALID", "VIEW_FILTER_UNAVAILABLE")
    fun errorCode(code: String) = code in errors || Regex("WORKFLOW_[A-Z_]{1,80}").matches(code)
    private fun valid(value: Boolean) { require(value) { "BULK_PROTOCOL" } }
    private fun keys(value: JSONObject, expected: Set<String>) = valid(value.keys().asSequence().toSet() == expected)
    fun id(value: String): String { valid(Regex("[A-Za-z0-9_-]{1,100}").matches(value)); return value }
    fun operation(value: String): String { valid(runCatching { UUID.fromString(value).toString() == value }.getOrDefault(false)); return value }
    private fun text(value: JSONObject, key: String, max: Int = 5000): String {
        val raw = value.opt(key); valid(raw is String && raw.length <= max); return raw as String
    }
    private fun number(value: JSONObject, key: String, min: Long = 0, max: Long = Int.MAX_VALUE.toLong()): Long {
        val raw = value.opt(key); valid(raw is Int || raw is Long); val result = (raw as Number).toLong()
        valid(result in min..max); return result
    }
    private fun boolean(value: JSONObject, key: String): Boolean { valid(value.opt(key) is Boolean); return value.getBoolean(key) }
    private fun nullableText(value: JSONObject, key: String, max: Int = 5000): Any {
        valid(value.has(key)); return if (value.isNull(key)) JSONObject.NULL else text(value, key, max)
    }
    private fun code(value: JSONObject, key: String): Any = nullableText(value, key, 100).also {
        valid(it == JSONObject.NULL || Regex("[A-Z][A-Z0-9_]{0,99}").matches(it as String))
    }
    private fun date(value: String): String { valid(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(value)); LocalDate.parse(value); return value }
    private fun time(value: String): String { Instant.parse(value); return value }
    fun sort(value: String): String {
        valid(value in setOf("position", "dueDate", "priority", "updatedAt", "title", "createdAt", "createdAtAsc") ||
            Regex("custom:[A-Za-z0-9_-]{1,100}:(asc|desc)").matches(value)); return value
    }
    fun cursor(value: String?): String? { valid(value == null || value.length in 1..16000); return value }
    private fun refs(value: JSONArray, minimum: Int = 1): JSONArray {
        valid(value.length() in minimum..1000); val result = JSONArray(); val unique = mutableSetOf<String>()
        for (index in 0 until value.length()) {
            val row = value.getJSONObject(index); keys(row, setOf("id", "projectId", "revision"))
            val task = id(text(row, "id", 100)); valid(unique.add(task))
            result.put(JSONObject().put("id", task).put("projectId", id(text(row, "projectId", 100))).put("revision", number(row, "revision", 1)))
        }
        return result
    }
    fun reference(task: JSONObject): JSONObject = JSONObject().put("id", id(text(task, "id", 100)))
        .put("projectId", id(text(task, "projectId", 100))).put("revision", number(task, "revision", 1))
    fun selection(raw: JSONObject): JSONObject {
        return when (text(raw, "mode", 4)) {
            "page" -> { keys(raw, setOf("mode", "items")); JSONObject().put("mode", "page").put("items", refs(raw.getJSONArray("items"))) }
            "all" -> {
                keys(raw, setOf("mode", "filter", "sort", "queryVersion"))
                val filter = raw.getJSONObject("filter"); valid(filter.toString().toByteArray(Charsets.UTF_8).size <= 32000)
                val version = text(raw, "queryVersion", 256); valid(version.isNotEmpty())
                JSONObject().put("mode", "all").put("filter", JSONObject(filter.toString())).put("sort", sort(text(raw, "sort", 120))).put("queryVersion", version)
            }
            else -> error("BULK_PROTOCOL")
        }
    }
    fun action(raw: JSONObject): JSONObject {
        val kind = text(raw, "kind", 10); valid(kind in kinds)
        val result = JSONObject().put("kind", kind)
        when (kind) {
            "priority" -> { keys(raw, setOf("kind", "priority")); result.put("priority", number(raw, "priority", 0, 3)) }
            "assignee" -> { keys(raw, setOf("kind", "assigneeId")); val assignee = nullableText(raw, "assigneeId", 100)
                result.put("assigneeId", if (assignee == JSONObject.NULL) assignee else id(assignee as String)) }
            "status" -> {
                keys(raw, setOf("kind", "statusIds")); val map = raw.getJSONObject("statusIds"); valid(map.length() in 1..1000)
                val safe = JSONObject(); map.keys().asSequence().sorted().forEach { project -> safe.put(id(project), id(text(map, project, 100))) }; result.put("statusIds", safe)
            }
            "due" -> {
                val mode = text(raw, "mode", 5); result.put("mode", mode)
                when (mode) {
                    "set" -> { keys(raw, setOf("kind", "mode", "date")); result.put("date", date(text(raw, "date", 10))) }
                    "shift" -> { keys(raw, setOf("kind", "mode", "days")); val days = number(raw, "days", -36600, 36600); valid(days != 0L); result.put("days", days) }
                    "clear" -> keys(raw, setOf("kind", "mode"))
                    else -> error("BULK_PROTOCOL")
                }
            }
            "labels" -> {
                keys(raw, setOf("kind", "mode", "labelIds")); val mode = text(raw, "mode", 6); valid(mode in setOf("add", "remove"))
                val labels = raw.getJSONArray("labelIds"); valid(labels.length() in 1..1000); val unique = mutableSetOf<String>()
                for (i in 0 until labels.length()) { valid(labels.get(i) is String); valid(unique.add(id(labels.getString(i)))) }
                result.put("mode", mode).put("labelIds", JSONArray(unique.toList().sorted()))
            }
            "move" -> { keys(raw, setOf("kind", "projectId", "statusId")); result.put("projectId", id(text(raw, "projectId", 100))).put("statusId", id(text(raw, "statusId", 100))) }
            "trash" -> { keys(raw, setOf("kind", "retentionDays")); result.put("retentionDays", number(raw, "retentionDays", 1, 30)) }
            "archive" -> keys(raw, setOf("kind"))
        }
        return result
    }
    /** Local origin is deliberately excluded from the frozen PHP body. */
    fun origin(raw: JSONObject): JSONObject {
        keys(raw, setOf("filter", "sort", "title"))
        val filter = raw.getJSONObject("filter")
        valid(filter.toString().toByteArray(Charsets.UTF_8).size <= 32000)
        return JSONObject().put("filter", JSONObject(filter.toString())).put("sort", sort(text(raw, "sort", 120)))
            .put("title", text(raw, "title", 5000))
    }
    fun context(edit: JSONObject): String = if (edit.optString("scope") == "query") QUERY_SCOPE else id(edit.getString("projectId"))
    fun edit(raw: JSONObject): JSONObject {
        val selected = selection(raw.getJSONObject("selection")); val action = action(raw.getJSONObject("action"))
        if (raw.optString("scope") == "query") {
            keys(raw, setOf("scope", "origin", "selection", "action")); val origin = origin(raw.getJSONObject("origin"))
            if (selected.getString("mode") == "all") valid(PlanningLifecycle.canonical(selected.getJSONObject("filter")) ==
                PlanningLifecycle.canonical(origin.getJSONObject("filter")) && selected.getString("sort") == origin.getString("sort"))
            return JSONObject().put("scope", "query").put("origin", origin).put("selection", selected).put("action", action)
        }
        keys(raw, setOf("projectId", "selection", "action")); val project = id(text(raw, "projectId", 100)); valid(project != QUERY_SCOPE)
        if (selected.getString("mode") == "page") PlanningLifecycle.rows(selected.getJSONArray("items")).forEach { valid(it.getString("projectId") == project) }
        else { val projects = selected.getJSONObject("filter").getJSONArray("projectIds"); valid(projects.length() == 1 && projects.get(0) == project) }
        return JSONObject().put("projectId", project).put("selection", selected).put("action", action)
    }
    fun counts(raw: JSONObject): JSONObject {
        val names = listOf("selected", "affected", "pending", "succeeded", "skipped", "failed", "cancelled"); val result = JSONObject()
        names.forEach { result.put(it, number(raw, it)) }
        valid(result.getLong("selected") <= result.getLong("affected") && names.drop(2).sumOf { result.getLong(it) } == result.getLong("affected")); return result
    }
    private fun paged(raw: JSONObject, result: JSONObject, integerCursor: Boolean = false): JSONObject {
        val more = boolean(raw, "hasMore"); val next = nullableTextOrNumber(raw, integerCursor)
        valid(more == (next != JSONObject.NULL)); return result.put("hasMore", more).put("nextCursor", next)
    }
    private fun nullableTextOrNumber(raw: JSONObject, integer: Boolean): Any {
        valid(raw.has("nextCursor")); return if (raw.isNull("nextCursor")) JSONObject.NULL
        else if (integer) number(raw, "nextCursor", 1, 9_007_199_254_740_991L) else cursor(text(raw, "nextCursor", 16000))!!
    }
    fun scope(raw: JSONObject, maximumProjects: Int = 100): JSONObject {
        val projects = raw.getJSONArray("projects"); valid(projects.length() <= maximumProjects); val safe = JSONArray()
        PlanningLifecycle.rows(projects).forEach { row ->
            val statuses = row.getJSONArray("statuses"); valid(statuses.length() <= 1000)
            safe.put(JSONObject().put("id", id(text(row, "id", 100))).put("spaceId", id(text(row, "spaceId", 100)))
                .put("title", text(row, "title")).put("taskCount", number(row, "taskCount"))
                .put("statuses", JSONArray(PlanningLifecycle.rows(statuses).map { status -> JSONObject().put("id", id(text(status, "id", 100)))
                    .put("title", text(status, "title")).put("isDone", boolean(status, "isDone")) })))
        }
        return paged(raw, JSONObject().put("total", number(raw, "total")).put("projects", safe))
    }
    fun options(raw: JSONObject): JSONObject {
        val options = raw.getJSONArray("options"); valid(options.length() <= 100)
        return paged(raw, JSONObject().put("options", JSONArray(PlanningLifecycle.rows(options).map { JSONObject()
            .put("id", id(text(it, "id", 100))).put("title", text(it, "title")) })))
    }
    private fun actionInfo(raw: JSONObject): JSONObject {
        val safe = JSONObject().put("unavailable", boolean(raw, "unavailable"))
        for (key in listOf("projectTitle", "statusTitle", "assigneeName")) if (raw.has(key)) safe.put(key, nullableText(raw, key))
        for ((key, fields) in listOf("labels" to listOf("id", "title", "spaceTitle"), "statuses" to listOf("id", "projectId", "projectTitle", "statusTitle"))) if (raw.has(key)) {
            val rows = raw.getJSONArray(key); valid(rows.length() <= 1000)
            safe.put(key, JSONArray(PlanningLifecycle.rows(rows).map { row -> JSONObject().apply { fields.forEach { field -> put(field, text(row, field)) } } }))
        }
        return safe
    }
    fun report(raw: JSONObject, expectedId: String? = null, after: Long = 0): JSONObject {
        val op = operation(text(raw, "id", 36)); valid(expectedId == null || op == expectedId)
        val state = text(raw, "state", 9); valid(state in states); val mode = text(raw, "mode", 4); valid(mode in setOf("page", "all"))
        val results = raw.getJSONArray("items"); valid(results.length() <= 100); var previous = after
        val items = JSONArray(PlanningLifecycle.rows(results).map { row ->
            val position = number(row, "cursor", 1, 9_007_199_254_740_991L); valid(position > previous); previous = position
            val itemState = text(row, "state", 9); valid(itemState in setOf("pending", "succeeded", "skipped", "failed", "cancelled"))
            val safe = JSONObject().put("cursor", position).put("selected", boolean(row, "selected")).put("state", itemState).put("code", code(row, "code"))
            if (row.has("id") && row.has("projectId") && row.has("projectTitle")) {
                safe.put("id", id(text(row, "id", 100))).put("projectId", id(text(row, "projectId", 100))).put("projectTitle", text(row, "projectTitle"))
                    .put("available", boolean(row, "available"))
                if (row.has("title")) safe.put("title", text(row, "title"))
                if (row.has("trashed")) safe.put("trashed", boolean(row, "trashed"))
            } else valid(listOf("id", "projectId", "projectTitle", "title", "available", "trashed").none(row::has))
            safe
        })
        val result = JSONObject().put("id", op).put("state", state).put("mode", mode).put("action", action(raw.getJSONObject("action")))
            .put("expiresAt", time(text(raw, "expiresAt", 64))).put("errorCode", code(raw, "errorCode"))
            .put("retryAt", nullableText(raw, "retryAt", 64).also { if (it != JSONObject.NULL) time(it as String) })
            .put("actionInfo", actionInfo(raw.getJSONObject("actionInfo"))).put("counts", counts(raw.getJSONObject("counts"))).put("items", items)
        val action = result.getJSONObject("action"); val info = result.getJSONObject("actionInfo")
        if (!info.getBoolean("unavailable")) when (action.getString("kind")) {
            "move" -> valid(info.opt("projectTitle") is String && info.opt("statusTitle") is String)
            "assignee" -> if (!action.isNull("assigneeId")) valid(info.opt("assigneeName") is String)
            "labels" -> valid(info.opt("labels") is JSONArray)
            "status" -> valid(info.opt("statuses") is JSONArray)
        }
        paged(raw, result, true)
        if (result.getBoolean("hasMore")) valid(results.length() > 0 && result.getLong("nextCursor") == previous)
        return result
    }
    fun history(raw: JSONObject): JSONObject {
        val operations = raw.getJSONArray("operations"); valid(operations.length() <= 20)
        return paged(raw, JSONObject().put("operations", JSONArray(PlanningLifecycle.rows(operations).map { row ->
            val state = text(row, "state", 9); valid(state in states)
            val mode = nullableText(row, "mode", 4); valid(mode == JSONObject.NULL || mode in setOf("page", "all"))
            JSONObject().put("id", operation(text(row, "id", 36))).put("state", state).put("createdAt", time(text(row, "createdAt", 64)))
                .put("errorCode", code(row, "errorCode")).put("action", if (row.isNull("action")) JSONObject.NULL else action(row.getJSONObject("action")))
                .put("mode", mode).put("counts", counts(row.getJSONObject("counts")))
        })))
    }
}

internal object SharedBulkJournalContract : CommandJournalContract {
    override val namespace = "bulk-v1"
    override val definitiveErrors = SharedBulkProtocol.errors - setOf("BULK_RETRY", "BACKGROUND_RETRY")
    override fun validateEdit(edit: JSONObject) = SharedBulkProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String): JSONObject {
        val safe = validateEdit(edit)
        return JSONObject().put("kind", "preview").put("sprintId", JSONObject.NULL).put("body", JSONObject()
            .put("requestId", SharedBulkProtocol.operation(requestId)).put("selection", safe.getJSONObject("selection")).put("action", safe.getJSONObject("action")))
    }
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        val safe = validateEdit(edit); require(SharedBulkProtocol.context(safe) == project) { "BULK_SCOPE_CHANGED" }
        require(!queued) { "BULK_LOCAL_QUEUE" }; val scope = SharedBulkProtocol.scope(data, 1000)
        val projects = PlanningLifecycle.rows(scope.getJSONArray("projects"))
        require(scope.getLong("total") > 0 && !scope.getBoolean("hasMore") && projects.isNotEmpty() &&
            projects.map { it.getString("id") }.toSet().size == projects.size && projects.all { it.getLong("taskCount") > 0 } &&
            projects.sumOf { it.getLong("taskCount") } == scope.getLong("total")) { "BULK_SCOPE_CHANGED" }
        if (project != SharedBulkProtocol.QUERY_SCOPE) require(projects.all { it.getString("id") == project }) { "BULK_SCOPE_CHANGED" }
        else if (safe.getJSONObject("action").getString("kind") == "status") {
            val map = safe.getJSONObject("action").getJSONObject("statusIds")
            require(map.keys().asSequence().toSet() == projects.map { it.getString("id") }.toSet()) { "BULK_STATUS_REQUIRED" }
            projects.forEach { row -> require(PlanningLifecycle.rows(row.getJSONArray("statuses")).any { it.getString("id") == map.getString(row.getString("id")) }) { "INVALID_STATUS" } }
        }
    }
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = error("BULK_RESELECT_REQUIRED")
    override fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        if (response.keys().asSequence().toSet() == setOf("operationId")) return JSONObject().put("operationId", SharedBulkProtocol.operation(response.getString("operationId")))
        val report = SharedBulkProtocol.report(response); val body = command.getJSONObject("body")
        require(PlanningLifecycle.canonical(report.getJSONObject("action")) == PlanningLifecycle.canonical(body.getJSONObject("action")) &&
            report.getString("mode") == body.getJSONObject("selection").getString("mode")) { "BULK_RECEIPT_INVALID" }
        if (report.getString("mode") == "page") require(report.getJSONObject("counts").getInt("selected") == body.getJSONObject("selection").getJSONArray("items").length()) { "BULK_RECEIPT_INVALID" }
        return JSONObject().put("operationId", report.getString("id"))
    }
}

/** A complete scope is bounded and checked across pages, never silently truncated. */
internal class SharedBulkScopePages {
    private val projects = mutableListOf<JSONObject>()
    private val ids = mutableSetOf<String>()
    private val cursors = mutableSetOf<String>()
    private var total: Long? = null
    private var finished = false
    var cursor: String? = null; private set
    fun add(raw: JSONObject): Boolean {
        require(!finished) { "BULK_SCOPE_CHANGED" }
        val page = SharedBulkProtocol.scope(raw)
        require(total == null || total == page.getLong("total")) { "BULK_SCOPE_CHANGED" }; total = page.getLong("total")
        val rows = PlanningLifecycle.rows(page.getJSONArray("projects"))
        require(rows.isNotEmpty() || !page.getBoolean("hasMore")) { "BULK_SCOPE_CHANGED" }
        rows.forEach { require(ids.add(it.getString("id")) && it.getLong("taskCount") > 0) { "BULK_SCOPE_CHANGED" }; projects += it }
        require(projects.size <= 1000) { "BULK_SCOPE_LIMIT" }
        cursor = if (page.getBoolean("hasMore")) page.getString("nextCursor").also { require(cursors.add(it)) { "BULK_SCOPE_CHANGED" } } else null
        finished = cursor == null
        if (finished) require(projects.sumOf { it.getLong("taskCount") } == total) { "BULK_SCOPE_CHANGED" }
        else require(projects.size < 1000) { "BULK_SCOPE_LIMIT" }
        return finished
    }
    fun result(): JSONObject {
        require(finished) { "BULK_SCOPE_CHANGED" }
        return JSONObject().put("total", total).put("projects", JSONArray(projects)).put("hasMore", false).put("nextCursor", JSONObject.NULL)
    }
}
