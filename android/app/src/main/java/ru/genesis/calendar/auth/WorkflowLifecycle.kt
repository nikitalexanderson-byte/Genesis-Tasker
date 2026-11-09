package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.security.MessageDigest
import java.util.UUID

/** The native projection deliberately excludes tasks, members and C3 values/options/defaults. */
internal object WorkflowLifecycle {
    val roles = listOf("owner", "manager", "member", "commenter", "viewer")
    val coreFields = listOf("description", "assigneeId", "dueDate", "startDate", "categoryId", "labels", "storyPoints", "estimateHours")
    val errors = setOf("WORKFLOW_CONFLICT", "WORKFLOW_INVALID", "WORKFLOW_PROJECT_REQUIRED", "WORKFLOW_FIELD_UNAVAILABLE",
        "WORKFLOW_NO_SAFE_ENTRY", "WORKFLOW_NO_SAFE_EXIT", "WORKFLOW_WIP_LIMIT", "WORKFLOW_REQUIRED_FIELDS",
        "WORKFLOW_TRANSITION_FORBIDDEN", "WORKFLOW_ROLE_FORBIDDEN", "WORKFLOW_STATUS_UNCONFIGURED",
        "WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE", "WORKFLOW_FIELD_IN_USE")
    fun rows(array: JSONArray): List<JSONObject> = PlanningLifecycle.rows(array)
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun keys(value: JSONObject, expected: Set<String>) { require(value.keys().asSequence().toSet() == expected) { "WORKFLOW_INVALID" } }
    fun integer(value: Any, min: Long = 0, max: Long = Int.MAX_VALUE.toLong()): Long {
        require((value is Int || value is Long) && (value as Number).toLong() in min..max) { "WORKFLOW_INVALID" }
        return (value as Number).toLong()
    }
    private fun id(value: String) = PlanningLifecycle.id(value)
    private fun field(value: String) = value in coreFields || value.startsWith("custom:") && id(value.removePrefix("custom:"))
    private fun strings(value: JSONArray, max: Int): List<String> {
        require(value.length() <= max) { "WORKFLOW_INVALID" }
        val list = (0 until value.length()).map { value.get(it).also { item -> require(item is String) { "WORKFLOW_INVALID" } } as String }
        require(list.toSet().size == list.size) { "WORKFLOW_INVALID" }
        return list
    }
    /** Drafts allow incomplete roles and numeric text; commands and server snapshots do not. */
    fun definition(value: JSONObject, draft: Boolean = false): JSONObject {
        require(value.get("enabled") is Boolean) { "WORKFLOW_INVALID" }
        val statuses = rows(value.getJSONArray("statuses")); val edges = rows(value.getJSONArray("transitions"))
        require(statuses.size <= 60 && edges.size <= 1860 && statuses.map { it.getString("statusId") }.toSet().size == statuses.size) { "WORKFLOW_INVALID" }
        statuses.forEach { rule ->
            keys(rule, setOf("statusId", "wipLimit", "requiredFields"))
            require(id(rule.getString("statusId")) && strings(rule.getJSONArray("requiredFields"), 208).all(::field)) { "WORKFLOW_INVALID" }
            val limit = rule.get("wipLimit")
            if (limit != JSONObject.NULL) {
                if (draft && limit is String) require(limit.length <= 32) { "WORKFLOW_INVALID" }
                else integer(limit, max = 1_000_000)
            }
        }
        val seen = mutableSetOf<String>()
        edges.forEach { edge ->
            keys(edge, setOf("fromStatusId", "toStatusId", "roles"))
            val from = edge.get("fromStatusId"); val to = edge.getString("toStatusId")
            require((from == JSONObject.NULL || from is String && id(from)) && id(to) && from != to && seen.add("$from:$to")) { "WORKFLOW_INVALID" }
            val allowed = strings(edge.getJSONArray("roles"), 5)
            require(allowed.all { it in roles } && (draft || allowed.isNotEmpty())) { "WORKFLOW_INVALID" }
        }
        return JSONObject().put("enabled", value.getBoolean("enabled")).put("statuses", JSONArray(statuses)).put("transitions", JSONArray(edges))
    }
    fun config(value: JSONObject): JSONObject = definition(value).put("revision", integer(value.get("revision")))
    fun snapshot(projectId: String, value: JSONObject): JSONObject {
        require(id(projectId)) { "WORKFLOW_INVALID" }
        val context = value.getJSONObject("context"); val project = context.getJSONObject("project")
        require(project.getString("id") == projectId && project.getString("title").length <= 1000 && project.getString("role") in roles) { "WORKFLOW_INVALID" }
        val permissions = project.getJSONObject("permissions")
        require(permissions.get("manageProjects") is Boolean) { "WORKFLOW_PERMISSION_CHANGED" }
        val statuses = rows(context.getJSONArray("statuses")).map { status ->
            require(id(status.getString("id")) && status.getString("title").length <= 1000) { "WORKFLOW_INVALID" }
            val done = status.get("isDone")
            require(done is Boolean || done is Int && done in 0..1) { "WORKFLOW_INVALID" }
            JSONObject().put("id", status.getString("id")).put("title", status.getString("title"))
                .put("isDone", done == true || done == 1).put("revision", integer(status.get("revision")))
        }
        require(statuses.size <= 30 && statuses.map { it.getString("id") }.toSet().size == statuses.size) { "WORKFLOW_INVALID" }
        val fields = rows(context.getJSONArray("customFieldDefinitions")).map { field ->
            require(id(field.getString("id")) && field.getString("title").length <= 1000 && field.getString("type").length <= 50) { "WORKFLOW_INVALID" }
            val archived = field.get("archived")
            require(archived is Boolean) { "WORKFLOW_INVALID" }
            JSONObject().put("id", field.getString("id")).put("title", field.getString("title"))
                .put("type", field.getString("type")).put("archived", archived)
        }
        require(fields.size <= 200 && fields.map { it.getString("id") }.toSet().size == fields.size) { "WORKFLOW_INVALID" }
        val result = JSONObject().put("config", config(value.getJSONObject("config"))).put("counts", counts(value.get("counts")))
            .put("context", JSONObject().put("project", JSONObject().put("id", projectId).put("title", project.getString("title"))
                .put("role", project.getString("role")).put("permissions", JSONObject().put("manageProjects", permissions.getBoolean("manageProjects"))))
                .put("statuses", JSONArray(statuses)).put("customFieldDefinitions", JSONArray(fields)))
        if (value.optBoolean("offlineCache")) result.put("offlineCache", true)
        return result
    }
    fun counts(value: Any): JSONObject {
        if (value is JSONArray) { require(value.length() == 0) { "WORKFLOW_INVALID" }; return JSONObject() }
        require(value is JSONObject && value.length() <= 60) { "WORKFLOW_INVALID" }
        return JSONObject().apply { (value as JSONObject).keys().forEach { key -> require(id(key)) { "WORKFLOW_INVALID" }; put(key, integer(value.get(key))) } }
    }
    fun fingerprint(data: JSONObject): String = MessageDigest.getInstance("SHA-256").digest(PlanningLifecycle.canonical(
        JSONObject().put("revision", data.getJSONObject("config").getLong("revision")).put("context", data.getJSONObject("context")))
        .toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    fun newEdit(data: JSONObject, disableOnly: Boolean = false): JSONObject {
        val draft = definition(data.getJSONObject("config")); val statuses = rows(data.getJSONObject("context").getJSONArray("statuses"))
        val rules = rows(draft.getJSONArray("statuses"))
        draft.put("statuses", JSONArray(statuses.map { status -> rules.find { it.getString("statusId") == status.getString("id") }?.let(::copy)
            ?: JSONObject().put("statusId", status.getString("id")).put("wipLimit", JSONObject.NULL).put("requiredFields", JSONArray()) }))
        if (data.getJSONObject("config").getLong("revision") == 0L && rules.isEmpty()) {
            draft.put("transitions", JSONArray((listOf<String?>(null) + statuses.map { it.getString("id") }).flatMap { from ->
                statuses.filter { it.getString("id") != from }.map { to -> JSONObject().put("fromStatusId", from ?: JSONObject.NULL)
                    .put("toStatusId", to.getString("id")).put("roles", JSONArray(roles)) }
            }))
        }
        draft.put("enabled", !disableOnly)
        return JSONObject().put("kind", "workflow").put("expectedRevision", data.getJSONObject("config").getLong("revision"))
            .put("fingerprint", fingerprint(data)).put("disableOnly", disableOnly).put("draft", draft)
    }
    fun validateEdit(value: JSONObject): JSONObject {
        keys(value, setOf("kind", "expectedRevision", "fingerprint", "disableOnly", "draft"))
        require(value.getString("kind") == "workflow" && value.get("disableOnly") is Boolean && Regex("[a-f0-9]{64}").matches(value.getString("fingerprint"))) { "WORKFLOW_INVALID" }
        keys(value.getJSONObject("draft"), setOf("enabled", "statuses", "transitions"))
        require(!value.getBoolean("disableOnly") || !value.getJSONObject("draft").getBoolean("enabled")) { "WORKFLOW_INVALID" }
        integer(value.get("expectedRevision")); definition(value.getJSONObject("draft"), draft = true)
        return copy(value)
    }
    fun requirePermission(data: JSONObject, projectId: String) {
        require(!data.optBoolean("offlineCache") && data.getJSONObject("context").getJSONObject("project").getString("id") == projectId &&
            data.getJSONObject("context").getJSONObject("project").getJSONObject("permissions").getBoolean("manageProjects")) { "WORKFLOW_PERMISSION_CHANGED" }
    }
    fun normalized(edit: JSONObject): JSONObject {
        validateEdit(edit)
        val draft = copy(edit.getJSONObject("draft"))
        rows(draft.getJSONArray("statuses")).forEach { rule ->
            val limit = rule.get("wipLimit")
            if (limit is String) rule.put("wipLimit", if (limit.isEmpty()) JSONObject.NULL else {
                require(Regex("0|[1-9][0-9]{0,6}").matches(limit)) { "WORKFLOW_INVALID" }
                limit.toInt().also { require(it <= 1_000_000) { "WORKFLOW_INVALID" } }
            })
        }
        return definition(draft)
    }
    fun verify(edit: JSONObject, data: JSONObject, projectId: String, hasQueue: Boolean) {
        validateEdit(edit); requirePermission(data, projectId)
        require(!hasQueue) { "WORKFLOW_LOCAL_QUEUE" }
        require(edit.getLong("expectedRevision") == data.getJSONObject("config").getLong("revision") && edit.getString("fingerprint") == fingerprint(data)) { "WORKFLOW_CONFLICT" }
        if (edit.getBoolean("disableOnly")) return
        val definition = normalized(edit)
        val statuses = rows(data.getJSONObject("context").getJSONArray("statuses")); val ids = statuses.map { it.getString("id") }.toSet()
        val rules = rows(definition.getJSONArray("statuses")); val edges = rows(definition.getJSONArray("transitions"))
        require(rules.map { it.getString("statusId") }.toSet() == ids && rules.size == ids.size) { "WORKFLOW_STATUS_UNCONFIGURED" }
        val fields = rows(data.getJSONObject("context").getJSONArray("customFieldDefinitions")).filter { !it.getBoolean("archived") }.map { "custom:${it.getString("id")}" }.toSet() + coreFields
        rules.forEach { rule ->
            require(strings(rule.getJSONArray("requiredFields"), 208).all { it in fields }) { "WORKFLOW_FIELD_UNAVAILABLE" }
            val done = statuses.first { it.getString("id") == rule.getString("statusId") }.getBoolean("isDone")
            require(!done || rule.isNull("wipLimit")) { "WORKFLOW_INVALID" }
            if (definition.getBoolean("enabled") && !rule.isNull("wipLimit")) require(data.getJSONObject("counts").optLong(rule.getString("statusId")) <= rule.getLong("wipLimit")) { "WORKFLOW_WIP_LIMIT" }
        }
        require(edges.all { it.getString("toStatusId") in ids && (it.isNull("fromStatusId") || it.getString("fromStatusId") in ids) }) { "WORKFLOW_STATUS_UNCONFIGURED" }
        require(edges.any { it.isNull("fromStatusId") && strings(it.getJSONArray("roles"), 5).contains("owner") }) { "WORKFLOW_NO_SAFE_ENTRY" }
        val safe = statuses.filter { it.getBoolean("isDone") }.map { it.getString("id") }.toMutableSet()
        do { val before = safe.size; edges.filter { !it.isNull("fromStatusId") && it.getString("toStatusId") in safe && "owner" in strings(it.getJSONArray("roles"), 5) }.forEach { safe.add(it.getString("fromStatusId")) } } while (safe.size > before)
        require(safe == ids) { "WORKFLOW_NO_SAFE_EXIT" }
    }
    fun command(edit: JSONObject, requestId: String): JSONObject {
        validateEdit(edit)
        require(UUID.fromString(requestId).toString() == requestId) { "WORKFLOW_INVALID" }
        val body = JSONObject().put("requestId", requestId).put("expectedRevision", edit.getLong("expectedRevision"))
        if (edit.getBoolean("disableOnly")) body.put("enabled", false)
        else { val definition = normalized(edit); body.put("enabled", definition.getBoolean("enabled")).put("statuses", definition.getJSONArray("statuses")).put("transitions", definition.getJSONArray("transitions")) }
        return JSONObject().put("kind", "workflow").put("sprintId", JSONObject.NULL).put("body", body)
    }
    fun rebase(edit: JSONObject, data: JSONObject, projectId: String): JSONObject {
        validateEdit(edit); requirePermission(data, projectId)
        // Keep removed references visible until the author explicitly removes them.
        val result = copy(edit).put("expectedRevision", data.getJSONObject("config").getLong("revision")).put("fingerprint", fingerprint(data))
        val rules = result.getJSONObject("draft").getJSONArray("statuses")
        rows(data.getJSONObject("context").getJSONArray("statuses")).filter { status -> rows(rules).none { it.getString("statusId") == status.getString("id") } }.forEach { rules.put(JSONObject().put("statusId", it.getString("id")).put("wipLimit", JSONObject.NULL).put("requiredFields", JSONArray())) }
        return result
    }
    fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        val config = config(response.getJSONObject("config")); val body = command.getJSONObject("body")
        require(config.getLong("revision") == body.getLong("expectedRevision") + 1 && config.getBoolean("enabled") == body.getBoolean("enabled")) { "WORKFLOW_RECEIPT_INVALID" }
        if (body.has("statuses")) require(equivalent(config, body)) { "WORKFLOW_RECEIPT_INVALID" }
        return JSONObject().put("config", config).put("counts", counts(response.get("counts")))
    }
    private fun equivalent(a: JSONObject, b: JSONObject): Boolean {
        fun sorted(value: JSONObject): String {
            val result = definition(value)
            result.put("statuses", JSONArray(rows(result.getJSONArray("statuses")).sortedBy { it.getString("statusId") }.map { it.put("requiredFields", JSONArray(strings(it.getJSONArray("requiredFields"), 208).sorted())) }))
            result.put("transitions", JSONArray(rows(result.getJSONArray("transitions")).sortedBy { "${it.opt("fromStatusId")}:${it.getString("toStatusId")}" }.map { it.put("roles", JSONArray(strings(it.getJSONArray("roles"), 5).sorted())) }))
            return PlanningLifecycle.canonical(result)
        }
        return sorted(a) == sorted(b)
    }
    fun history(previous: JSONObject?, page: JSONObject, before: Long?, ceiling: Long): JSONObject {
        val versions = rows(page.getJSONArray("versions")); require(versions.size <= 50) { "WORKFLOW_HISTORY_INVALID" }
        var last = before ?: (ceiling + 1)
        val safe = versions.map { version ->
            val config = config(version); val revision = config.getLong("revision")
            require(revision in 1 until last && revision <= ceiling) { "WORKFLOW_HISTORY_INVALID" }; last = revision
            Instant.parse(version.getString("createdAt"))
            config.put("createdAt", version.getString("createdAt"))
        }
        val cursor = page.get("nextCursor")
        require(cursor == JSONObject.NULL || versions.size == 50 && integer(cursor, 1) == last) { "WORKFLOW_HISTORY_INVALID" }
        if (previous != null) require(previous.get("nextCursor") != JSONObject.NULL && previous.getLong("nextCursor") == before) { "WORKFLOW_HISTORY_INVALID" }
        val combined = (previous?.let { rows(it.getJSONArray("versions")) } ?: emptyList()) + safe
        require(combined.size <= 10000 && combined.map { it.getLong("revision") }.toSet().size == combined.size) { "WORKFLOW_HISTORY_INVALID" }
        return JSONObject().put("versions", JSONArray(combined)).put("nextCursor", cursor)
    }
}
