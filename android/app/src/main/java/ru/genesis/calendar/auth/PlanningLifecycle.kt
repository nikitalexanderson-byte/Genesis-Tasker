package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Drafts contain entered values and task references, never cached titles or permissions. */
internal object PlanningLifecycle {
    private val identifier = Regex("[A-Za-z0-9_-]{1,200}")
    private val digest = Regex("[a-f0-9]{64}")
    const val MAX_TASKS = 20_000
    fun id(value: String): Boolean = identifier.matches(value)
    fun rows(value: JSONArray): List<JSONObject> = (0 until value.length()).map(value::getJSONObject)
    private fun keys(value: JSONObject, allowed: Set<String>) {
        require(value.keys().asSequence().toSet() == allowed) { "PLANNING_DRAFT_INVALID" }
    }
    private fun revision(value: JSONObject, key: String = "expectedRevision"): Int {
        val number = value.get(key)
        require(number is Int || number is Long) { "PLANNING_DRAFT_INVALID" }
        val result = (number as Number).toLong()
        require(result in 0..Int.MAX_VALUE.toLong()) { "PLANNING_DRAFT_INVALID" }
        return result.toInt()
    }
    private fun text(value: JSONObject, key: String, limit: Int) {
        val raw = value.get(key)
        require(raw is String && raw.codePointCount(0, raw.length) <= limit) { "PLANNING_DRAFT_INVALID" }
    }
    private fun reference(value: JSONObject, key: String, nullable: Boolean = false) {
        require(nullable && value.has(key) && value.isNull(key) || value.opt(key) is String && id(value.getString(key))) { "PLANNING_DRAFT_INVALID" }
    }
    fun validateEdit(value: JSONObject): JSONObject {
        revision(value)
        when (value.getString("kind")) {
            "settings" -> {
                keys(value, setOf("kind", "expectedRevision", "enabled", "estimateUnit"))
                require(value.get("enabled") is Boolean && value.getString("estimateUnit") in setOf("points", "hours")) { "PLANNING_DRAFT_INVALID" }
            }
            "sprint" -> {
                keys(value, setOf("kind", "expectedRevision", "sprintId", "draft"))
                reference(value, "sprintId", true)
                val draft = value.getJSONObject("draft")
                keys(draft, setOf("title", "goal", "startDate", "endDate", "calendarMode", "calendarContext"))
                text(draft, "title", 160); text(draft, "goal", 5000)
                for (key in listOf("startDate", "endDate")) {
                    val date = draft.getString(key)
                    require(date.isEmpty() || Regex("\\d{4}-\\d{2}-\\d{2}").matches(date)) { "PLANNING_DRAFT_INVALID" }
                }
                require(draft.getString("calendarMode") in setOf("profane", "sacred", "lunar")) { "PLANNING_DRAFT_INVALID" }
                val context = draft.getJSONObject("calendarContext")
                keys(context, setOf("version", "timeZone", "gregorianYearStart"))
                require(context.get("version") is Int && context.getInt("version") in 1..2) { "PLANNING_DRAFT_INVALID" }
                text(context, "timeZone", 200); ZoneId.of(context.getString("timeZone"))
                require(context.getString("gregorianYearStart") in setOf("january", "march")) { "PLANNING_DRAFT_INVALID" }
            }
            "transition" -> {
                keys(value, setOf("kind", "expectedRevision", "sprintId", "fingerprint", "action", "tasks", "choices"))
                reference(value, "sprintId")
                require(digest.matches(value.getString("fingerprint"))) { "PLANNING_DRAFT_INVALID" }
                require(value.getString("action") in setOf("start", "complete")) { "PLANNING_DRAFT_INVALID" }
                val tasks = taskReferences(value.getJSONArray("tasks"))
                val choices = value.getJSONObject("choices")
                require(choices.keys().asSequence().all { taskId -> taskId in tasks && choices.opt(taskId) is String &&
                    choices.getString(taskId).let { it.isEmpty() || id(it) } }) { "PLANNING_DRAFT_INVALID" }
                if (value.getString("action") == "start") require(tasks.isEmpty() && choices.length() == 0) { "PLANNING_DRAFT_INVALID" }
            }
            else -> error("PLANNING_DRAFT_INVALID")
        }
        return JSONObject(value.toString())
    }
    fun taskReferences(tasks: JSONArray): Map<String, Int> {
        require(tasks.length() <= MAX_TASKS) { "PLANNING_DRAFT_INVALID" }
        val result = linkedMapOf<String, Int>()
        rows(tasks).forEach { task ->
            keys(task, setOf("id", "revision")); reference(task, "id")
            require(result.put(task.getString("id"), revision(task, "revision")) == null) { "PLANNING_DRAFT_INVALID" }
        }
        return result
    }
    fun referenceForTask(task: JSONObject, projectId: String): JSONObject {
        reference(task, "id")
        require(task.getString("projectId") == projectId && !task.optBoolean("offlineCache")) { "PLANNING_CONFLICT" }
        return JSONObject().put("id", task.getString("id")).put("revision", revision(task, "revision"))
    }
    fun requirePermission(edit: JSONObject, fresh: JSONObject, projectId: String) {
        require(!fresh.optBoolean("offlineCache")) { "PLANNING_PERMISSION_CHANGED" }
        val rights = fresh.getJSONObject("context").getJSONObject("permissions")
        require(rights.getBoolean(if (edit.getString("kind") == "settings") "manageProjects" else "organizeTasks")) { "PLANNING_PERMISSION_CHANGED" }
        require(rows(fresh.getJSONArray("sprints")).all { it.getString("projectId") == projectId }) { "PLANNING_DRAFT_INVALID" }
    }
    /** Called only with uncached server reads and the complete unfinished-task collection. */
    fun verify(edit: JSONObject, fresh: JSONObject, projectId: String, pendingTasks: Boolean,
        remaining: List<JSONObject>? = null) {
        validateEdit(edit); requirePermission(edit, fresh, projectId)
        require(!pendingTasks) { "PLANNING_LOCAL_QUEUE" }
        val kind = edit.getString("kind")
        val sprints = rows(fresh.getJSONArray("sprints"))
        val config = fresh.getJSONObject("config")
        if (kind == "settings") {
            require(config.getInt("revision") == edit.getInt("expectedRevision")) { "PLANNING_CONFLICT" }
            require(edit.getBoolean("enabled") || sprints.none { it.getString("state") == "active" }) { "PLANNING_ACTIVE_SPRINT" }
            return
        }
        require(config.getBoolean("enabled")) { "PLANNING_DISABLED" }
        val sprint = edit.opt("sprintId").takeUnless { it == JSONObject.NULL }?.let { id -> sprints.find { it.getString("id") == id } }
        require(edit.isNull("sprintId") || sprint != null) { "SPRINT_STATE_INVALID" }
        require((sprint?.getInt("revision") ?: 0) == edit.getInt("expectedRevision")) { "PLANNING_CONFLICT" }
        require(sprint?.getString("state") != "completed") { "SPRINT_COMPLETED" }
        if (kind == "sprint") {
            val draft = edit.getJSONObject("draft")
            require(draft.getString("title").trim().isNotEmpty()) { "PLANNING_DRAFT_INVALID" }
            val start = LocalDate.parse(draft.getString("startDate")); val end = LocalDate.parse(draft.getString("endDate"))
            require(ChronoUnit.DAYS.between(start, end) in 0..3660) { "SPRINT_DATES_INVALID" }
            require(draft.getJSONObject("calendarContext").getInt("version") == 2) { "SPRINT_CONTEXT_INVALID" }
            return
        }
        require(edit.getString("fingerprint") == fresh.getString("fingerprint")) { "PLANNING_CONFLICT" }
        if (edit.getString("action") == "start") {
            require(sprint?.getString("state") == "planning") { "SPRINT_STATE_INVALID" }
            require(sprints.none { it.getString("state") == "active" }) { "PLANNING_ACTIVE_SPRINT" }
        } else {
            require(sprint?.getString("state") == "active") { "SPRINT_STATE_INVALID" }
            require(remaining != null && remaining.all { it.getString("projectId") == projectId && !it.optBoolean("offlineCache") }) { "PLANNING_CONFLICT" }
            val expected = taskReferences(edit.getJSONArray("tasks"))
            val actual = taskReferences(JSONArray(remaining!!.map { referenceForTask(it, projectId) }))
            require(actual == expected) { "PLANNING_CONFLICT" }
            val choices = edit.getJSONObject("choices")
            require(choices.keys().asSequence().toSet() == expected.keys && expected.keys.all { taskId ->
                val target = choices.getString(taskId)
                target == "backlog" || target != edit.getString("sprintId") && sprints.any { it.getString("id") == target && it.getString("state") != "completed" }
            }) { "SPRINT_OUTCOMES_REQUIRED" }
        }
    }
    fun command(edit: JSONObject, requestId: String): JSONObject {
        validateEdit(edit); require(id(requestId)) { "PLANNING_DRAFT_INVALID" }
        val kind = edit.getString("kind")
        val body = when (kind) {
            "settings" -> JSONObject().put("enabled", edit.getBoolean("enabled")).put("estimateUnit", edit.getString("estimateUnit"))
            "sprint" -> JSONObject(edit.getJSONObject("draft").toString())
            else -> JSONObject().put("fingerprint", edit.getString("fingerprint")).put("action", edit.getString("action")).apply {
                if (edit.getString("action") == "complete") put("outcomes", JSONArray(rows(edit.getJSONArray("tasks")).map { task ->
                    val target = edit.getJSONObject("choices").getString(task.getString("id"))
                    require(target.isNotEmpty()) { "SPRINT_OUTCOMES_REQUIRED" }
                    JSONObject().put("taskId", task.getString("id")).put("expectedRevision", task.getInt("revision"))
                        .put("destinationSprintId", if (target == "backlog") JSONObject.NULL else target)
                }))
            }
        }.put("requestId", requestId).put("expectedRevision", edit.getInt("expectedRevision"))
        return JSONObject().put("kind", kind).put("sprintId", if (kind == "settings") JSONObject.NULL else edit.get("sprintId")).put("body", body)
    }
    /** Rebase is explicit. Only unchanged task revisions retain their carry-over decisions. */
    fun rebase(edit: JSONObject, fresh: JSONObject, projectId: String, remaining: List<JSONObject>? = null): JSONObject {
        validateEdit(edit); requirePermission(edit, fresh, projectId)
        val next = JSONObject(edit.toString())
        if (edit.getString("kind") == "settings") return next.put("expectedRevision", fresh.getJSONObject("config").getInt("revision"))
        if (edit.getString("kind") == "sprint" && edit.isNull("sprintId")) return next
        val sprint = rows(fresh.getJSONArray("sprints")).find { it.getString("id") == edit.getString("sprintId") }
        require(sprint != null && sprint.getString("state") != "completed") { "SPRINT_STATE_INVALID" }
        next.put("expectedRevision", sprint!!.getInt("revision"))
        if (edit.getString("kind") == "transition") {
            next.put("fingerprint", fresh.getString("fingerprint"))
            if (edit.getString("action") == "complete") {
                require(remaining != null && remaining.size <= MAX_TASKS && remaining.all { it.getString("projectId") == projectId }) { "PLANNING_CONFLICT" }
                val previous = taskReferences(edit.getJSONArray("tasks")); val oldChoices = edit.getJSONObject("choices"); val choices = JSONObject()
                val targets = rows(fresh.getJSONArray("sprints")).filter { it.getString("id") != sprint.getString("id") && it.getString("state") != "completed" }.map { it.getString("id") }.toSet()
                val refs = JSONArray()
                remaining!!.forEach { task ->
                    val ref = referenceForTask(task, projectId)
                    val id = ref.getString("id"); val rev = ref.getInt("revision"); refs.put(ref)
                    val choice = oldChoices.optString(id)
                    if (previous[id] == rev && (choice == "backlog" || choice in targets)) choices.put(id, choice)
                }
                taskReferences(refs); next.put("tasks", refs).put("choices", choices)
            }
        }
        return validateEdit(next)
    }
    fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }
}
