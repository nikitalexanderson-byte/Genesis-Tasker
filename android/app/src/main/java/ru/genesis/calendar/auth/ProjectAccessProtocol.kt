package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Only IDs and reviewed hashes enter the encrypted draft, never the private project catalog. */
internal object ProjectAccessProtocol {
    val roles = listOf("member", "commenter", "viewer", "none")
    val permissionKeys = listOf("createProjects", "editTasks", "organizeTasks", "comment", "manageProjects", "inviteMembers")
    val errors = setOf("INVALID_PROJECT_ACCESS", "PROJECT_ACCESS_CONFLICT", "PROJECT_ACCESS_OPERATION_REUSED", "LAST_OWNER",
        "PROJECT_ACCESS_MANAGER_UNRESTRICTED", "PROJECT_ACCESS_PERMISSION_CHANGED", "PROJECT_ACCESS_REVIEW_REQUIRED", "PROJECT_ACCESS_LOCAL_QUEUE", "PROJECT_ACCESS_RECEIPT_INVALID")
    private fun valid(ok: Boolean) { require(ok) { "INVALID_PROJECT_ACCESS" } }
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun keys(value: JSONObject, expected: Set<String>) = valid(value.keys().asSequence().toSet() == expected)
    fun id(value: String) = value.also { valid(Regex("[A-Za-z0-9_-]{1,100}").matches(it)) }
    private fun text(value: JSONObject, key: String, max: Int = 1000): String {
        val raw = value.opt(key); valid(raw is String && raw.length <= max); return raw as String
    }
    private fun bool(value: JSONObject, key: String): Boolean { valid(value.opt(key) is Boolean); return value.getBoolean(key) }
    private fun count(value: JSONObject, key: String): Long {
        val raw = value.opt(key); valid(raw is Int || raw is Long)
        return (raw as Number).toLong().also { valid(it in 0..Int.MAX_VALUE.toLong()) }
    }
    private fun digest(value: JSONObject, key: String) = text(value, key, 64).also { valid(Regex("[a-f0-9]{64}").matches(it)) }
    fun rows(value: JSONArray, max: Int = 20_000): List<JSONObject> { valid(value.length() <= max); return PlanningLifecycle.rows(value) }
    private fun distinct(values: List<JSONObject>, key: String) = valid(values.map { id(text(it, key, 100)) }.distinct().size == values.size)
    private fun nullableRole(value: JSONObject, key: String) {
        valid(value.has(key) && (value.isNull(key) || value.opt(key) in roles + listOf("owner", "manager")))
    }
    fun scope(space: String, user: String): String {
        id(space); id(user); return hash("${space.length}:$space:${user.length}:$user")
    }
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    fun permissions(raw: JSONObject, read: Boolean = false): JSONObject {
        val names = permissionKeys + if (read) listOf("read") else emptyList()
        keys(raw, names.toSet()); val result = JSONObject().apply { names.forEach { put(it, bool(raw, it)) } }
        if (read && !result.getBoolean("read")) valid(permissionKeys.none { result.getBoolean(it) })
        return result
    }
    fun draft(raw: JSONObject, server: Boolean = false): JSONObject {
        keys(raw, setOf("allProjects", "grants")); val all = bool(raw, "allProjects")
        val grants = rows(raw.getJSONArray("grants"), 5000); distinct(grants, "projectId")
        grants.forEach { keys(it, setOf("projectId", "role", "includeDescendants")); valid(text(it, "role", 20) in roles); bool(it, "includeDescendants") }
        return JSONObject().put("allProjects", all).put("grants", JSONArray(if (all && server) emptyList() else grants.sortedBy { it.getString("projectId") }))
    }
    private fun projects(raw: JSONArray): JSONArray {
        val projects = rows(raw); distinct(projects, "id")
        projects.forEach { row ->
            text(row, "title"); count(row, "revision"); count(row, "assignedTaskCount"); nullableRole(row, "role")
            for (key in listOf("isInbox", "inTrash")) valid(row.opt(key) is Int && row.getInt(key) in 0..1)
            valid(row.has("parentId") && (row.isNull("parentId") || id(text(row, "parentId", 100)) != row.getString("id")))
            valid(row.has("archivedAt") && (row.isNull("archivedAt") || row.opt("archivedAt") is String))
        }
        return JSONArray(projects.map(::copy))
    }
    fun members(space: String, raw: JSONObject): JSONObject {
        id(space); val parent = raw.getJSONObject("space"); valid(parent.opt("id") == space)
        require(parent.opt("role") == "owner") { "PROJECT_ACCESS_PERMISSION_CHANGED" }
        val members = rows(raw.getJSONArray("members"), 200); distinct(members, "userId")
        return JSONObject().put("space", JSONObject().put("id", space).put("title", text(parent, "title"))).put("members", JSONArray(members.map { row ->
            valid(row.opt("role") in setOf("owner", "admin", "member", "guest"))
            JSONObject().put("userId", row.getString("userId")).put("displayName", text(row, "displayName")).put("role", row.getString("role"))
        }))
    }
    fun snapshot(space: String, user: String, raw: JSONObject): JSONObject {
        scope(space, user); valid(!raw.optBoolean("offlineCache") && raw.opt("spaceId") == space && raw.opt("userId") == user)
        valid(raw.opt("memberRole") in setOf("owner", "admin", "member", "guest")); digest(raw, "fingerprint"); count(raw, "revision")
        bool(raw, "restricted"); bool(raw, "canOrganizeTasks"); draft(JSONObject().put("allProjects", raw.get("allProjects")).put("grants", raw.get("grants")))
        permissions(raw.getJSONObject("spacePermissions")); valid(raw.has("permissionsOverride"))
        if (!raw.isNull("permissionsOverride")) permissions(raw.getJSONObject("permissionsOverride"))
        return copy(raw).put("projects", projects(raw.getJSONArray("projects")))
    }
    fun edit(raw: JSONObject): JSONObject {
        keys(raw, setOf("kind", "spaceId", "userId", "expectedRevision", "fingerprint", "review", "draft"))
        valid(raw.opt("kind") == "project-access"); scope(text(raw, "spaceId", 100), text(raw, "userId", 100))
        count(raw, "expectedRevision"); digest(raw, "fingerprint"); valid(raw.has("review")); if (!raw.isNull("review")) digest(raw, "review")
        draft(raw.getJSONObject("draft")); return copy(raw)
    }
    fun newEdit(raw: JSONObject): JSONObject = JSONObject().put("kind", "project-access").put("spaceId", raw.getString("spaceId")).put("userId", raw.getString("userId"))
        .put("expectedRevision", raw.getLong("revision")).put("fingerprint", raw.getString("fingerprint")).put("review", JSONObject.NULL)
        .put("draft", draft(JSONObject().put("allProjects", raw.get("allProjects")).put("grants", raw.get("grants"))))
    fun preview(edit: JSONObject, raw: JSONObject): JSONObject {
        edit(edit); digest(raw, "fingerprint"); count(raw, "revision"); val catalog = projects(raw.getJSONArray("projects")); val ids = rows(catalog).map { it.getString("id") }.toSet()
        val desired = draft(raw.getJSONObject("desired"), true)
        valid(PlanningLifecycle.canonical(desired) == PlanningLifecycle.canonical(draft(edit.getJSONObject("draft"), true)))
        val changes = rows(raw.getJSONArray("changes")); distinct(changes, "projectId")
        val projectMap = rows(catalog).associateBy { it.getString("id") }
        changes.forEach { row ->
            val project = requireNotNull(projectMap[row.getString("projectId")]); valid(text(row, "title") == project.getString("title"))
            nullableRole(row, "from"); nullableRole(row, "to")
            valid(count(row, "clearedAssignments") == if (row.isNull("to")) project.getLong("assignedTaskCount") else 0L)
            val before = permissions(row.getJSONObject("beforePermissions"), true); val after = permissions(row.getJSONObject("afterPermissions"), true)
            valid(before.getBoolean("read") == !row.isNull("from") && after.getBoolean("read") == !row.isNull("to"))
        }
        val blockers = rows(raw.getJSONArray("blockers")); distinct(blockers, "projectId")
        blockers.forEach { valid(it.opt("code") == "LAST_OWNER" && it.getString("projectId") in ids) }
        val effective = when (val value = raw.opt("effectiveRoles")) {
            is JSONObject -> value
            is JSONArray -> { valid(value.length() == 0); JSONObject() }
            else -> { valid(false); JSONObject() }
        }
        effective.keys().forEach { key -> valid(key in ids && (effective.isNull(key) || effective.opt(key) in roles + listOf("owner", "manager"))) }
        return copy(raw).put("projects", catalog).put("desired", desired).put("effectiveRoles", copy(effective))
    }
    private fun reviewHash(raw: JSONObject) = hash(PlanningLifecycle.canonical(JSONObject().put("fingerprint", raw.get("fingerprint")).put("revision", raw.get("revision"))
        .put("desired", raw.get("desired")).put("changes", raw.get("changes")).put("blockers", raw.get("blockers"))))
    fun reviewed(edit: JSONObject, rawPreview: JSONObject): JSONObject {
        val verified = preview(edit, rawPreview)
        return copy(edit).put("fingerprint", verified.getString("fingerprint")).put("expectedRevision", verified.getLong("revision")).put("review", reviewHash(verified))
    }
    fun command(raw: JSONObject, requestId: String): JSONObject {
        edit(raw); valid(UUID.fromString(requestId).toString() == requestId)
        require(!raw.isNull("review")) { "PROJECT_ACCESS_REVIEW_REQUIRED" }
        return JSONObject().put("kind", "project-access").put("sprintId", JSONObject.NULL).put("body", draft(raw.getJSONObject("draft"), true)
            .put("requestId", requestId).put("expectedRevision", raw.getLong("expectedRevision"))
            .put("operationId", "project-access:$requestId").put("expectedFingerprint", raw.getString("fingerprint")))
    }
    fun body(command: JSONObject): JSONObject = copy(command.getJSONObject("body")).apply { remove("requestId"); remove("expectedRevision") }
    fun receipt(command: JSONObject, raw: JSONObject): JSONObject {
        try {
        val body = body(command); valid(raw.opt("operationId") == body.getString("operationId")); count(raw, "changed")
        valid(count(raw, "revision") == command.getJSONObject("body").getLong("expectedRevision") + 1)
        valid(PlanningLifecycle.canonical(draft(JSONObject().put("allProjects", raw.get("allProjects")).put("grants", raw.get("grants")), true)) ==
            PlanningLifecycle.canonical(draft(JSONObject().put("allProjects", body.get("allProjects")).put("grants", body.get("grants")), true)))
        return JSONObject().put("operationId", raw.getString("operationId")).put("revision", raw.getLong("revision")).put("changed", raw.getLong("changed"))
            .put("allProjects", raw.getBoolean("allProjects")).put("grants", raw.getJSONArray("grants"))
        } catch (failure: Exception) { throw IllegalArgumentException("PROJECT_ACCESS_RECEIPT_INVALID", failure) }
    }
    fun verify(raw: JSONObject, fresh: JSONObject, scopeKey: String, queue: Boolean) {
        edit(raw); valid(scopeKey == scope(raw.getString("spaceId"), raw.getString("userId")))
        require(!queue) { "PROJECT_ACCESS_LOCAL_QUEUE" }; val value = preview(raw, fresh)
        require(raw.getString("fingerprint") == value.getString("fingerprint") && raw.getLong("expectedRevision") == value.getLong("revision")) { "PROJECT_ACCESS_CONFLICT" }
        require(!raw.isNull("review") && raw.getString("review") == reviewHash(value)) { "PROJECT_ACCESS_REVIEW_REQUIRED" }
        require(value.getJSONArray("blockers").length() == 0) { "LAST_OWNER" }
    }
}

internal object ProjectAccessJournalContract : CommandJournalContract {
    override val namespace = "project-access-v1"
    override val definitiveErrors = ProjectAccessProtocol.errors - setOf("PROJECT_ACCESS_PERMISSION_CHANGED", "PROJECT_ACCESS_LOCAL_QUEUE", "PROJECT_ACCESS_REVIEW_REQUIRED", "PROJECT_ACCESS_RECEIPT_INVALID")
    override fun validateEdit(edit: JSONObject) = ProjectAccessProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String) = ProjectAccessProtocol.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) = ProjectAccessProtocol.verify(edit, data, project, queued)
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject {
        ProjectAccessProtocol.edit(edit)
        require(project == ProjectAccessProtocol.scope(edit.getString("spaceId"), edit.getString("userId"))) { "INVALID_PROJECT_ACCESS" }
        return JSONObject(edit.toString()).put("fingerprint", data.getString("fingerprint")).put("expectedRevision", data.getLong("revision")).put("review", JSONObject.NULL)
    }
    override fun receipt(command: JSONObject, response: JSONObject) = ProjectAccessProtocol.receipt(command, response)
}
