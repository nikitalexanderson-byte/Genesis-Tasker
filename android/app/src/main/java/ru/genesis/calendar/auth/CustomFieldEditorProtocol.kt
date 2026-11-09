package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Editable input, the reviewed server definition and the immutable PUT have separate lifetimes. */
internal object CustomFieldEditorProtocol {
    private val settings = setOf("id", "title", "type", "projectId", "options", "position", "required", "showCard", "showList", "archived")
    private fun valid(ok: Boolean, code: String = "CUSTOM_FIELD_DRAFT_INVALID") { require(ok) { code } }
    fun copy(raw: JSONObject) = JSONObject(raw.toString())
    private fun keys(raw: JSONObject, expected: Set<String>) = valid(raw.keys().asSequence().toSet() == expected)
    private fun text(raw: Any?, limit: Int): String {
        valid(raw is String && raw.codePointCount(0, raw.length) <= limit)
        return raw as String
    }
    private fun integer(raw: Any?, minimum: Int, maximum: Int): Int {
        valid((raw is Int || raw is Long) && (raw as Number).toLong() in minimum.toLong()..maximum.toLong())
        return (raw as Number).toInt()
    }
    private fun definition(space: String, project: String, raw: JSONObject): JSONObject {
        keys(raw, settings + setOf("spaceId", "revision", "predecessorId"))
        return CustomFieldProtocol.definitions(space, project, JSONArray().put(raw)).single()
    }
    private fun draft(field: JSONObject): JSONObject = JSONObject().apply { settings.forEach { put(it, field.get(it)) } }
    fun newEdit(space: String, project: String, source: JSONObject? = null): JSONObject {
        CustomFieldProtocol.id(space); CustomFieldProtocol.id(project)
        val base = source?.let { definition(space, project, it) }
        val input = base?.let(::draft) ?: JSONObject().put("id", UUID.randomUUID().toString()).put("title", "")
            .put("type", "text").put("projectId", project).put("options", JSONArray()).put("position", 0)
            .put("required", false).put("showCard", true).put("showList", false).put("archived", false)
        return edit(JSONObject().put("kind", "field-definition-save").put("spaceId", space).put("projectId", project)
            .put("base", base ?: JSONObject.NULL).put("draft", input).put("positionInput", input.getInt("position").toString())
            .put("review", JSONObject.NULL).put("confirmReplacement", false))
    }
    /** Empty titles and an unfinished position survive recreation, but cannot become a command. */
    fun edit(raw: JSONObject): JSONObject {
        val value = copy(raw)
        valid(value.toString().toByteArray(Charsets.UTF_8).size <= 4_000_000)
        keys(value, setOf("kind", "spaceId", "projectId", "base", "draft", "positionInput", "review", "confirmReplacement"))
        valid(value.opt("kind") == "field-definition-save")
        val space = CustomFieldProtocol.id(value.getString("spaceId")); val project = CustomFieldProtocol.id(value.getString("projectId"))
        val base = if (value.isNull("base")) null else definition(space, project, value.getJSONObject("base"))
        base?.let { valid(it.getInt("revision") < Int.MAX_VALUE) }
        val input = value.getJSONObject("draft"); keys(input, settings)
        CustomFieldProtocol.id(input.getString("id")); valid(base == null || base.getString("id") == input.getString("id"))
        valid(input.has("projectId") && (input.isNull("projectId") || input.opt("projectId") == project), "CUSTOM_FIELD_SCOPE_CHANGED")
        text(input.opt("title"), 160); valid(input.opt("type") in CustomFieldProtocol.types)
        integer(input.opt("position"), -100000, 100000); text(value.opt("positionInput"), 8)
        for (key in listOf("required", "showCard", "showList", "archived")) valid(input.opt(key) is Boolean)
        val options = PlanningLifecycle.rows(input.getJSONArray("options")); valid(input.toString().toByteArray(Charsets.UTF_8).size <= 1_000_000 && options.count { it.opt("archived") == false } <= 200)
        valid(input.getString("type") in setOf("select", "multi") || options.isEmpty())
        options.forEach { option ->
            keys(option, setOf("id", "title", "archived")); CustomFieldProtocol.id(option.getString("id"))
            text(option.opt("title"), 160); valid(option.opt("archived") is Boolean)
        }
        valid(options.map { it.getString("id") }.distinct().size == options.size)
        valid(value.opt("confirmReplacement") is Boolean && value.has("review"))
        if (!value.isNull("review")) {
            val review = CustomFieldDefinitionProtocol.preview(space, project, requestInput(value), value.getJSONObject("review"))
            val replaces = base != null && base.getString("type") != input.getString("type") && review.getInt("valueCount") > 0
            valid(review.getBoolean("replaceType") == replaces, "CUSTOM_FIELD_PROTOCOL")
        }
        valid(!value.getBoolean("confirmReplacement") || !value.isNull("review") && value.getJSONObject("review").getBoolean("replaceType"))
        return value
    }
    private fun requestInput(value: JSONObject): JSONObject {
        val input = copy(value.getJSONObject("draft"))
        val position = value.getString("positionInput").toIntOrNull()
        valid(position != null && position in -100000..100000, "CUSTOM_FIELD_POSITION_INVALID")
        valid(input.getString("title").isNotBlank(), "INVALID_TITLE")
        PlanningLifecycle.rows(input.getJSONArray("options")).forEach { valid(it.getString("title").isNotBlank(), "INVALID_TITLE") }
        return input.put("position", position).put("expectedRevision", value.optJSONObject("base")?.getInt("revision") ?: 0)
    }
    fun request(raw: JSONObject) = requestInput(edit(raw))
    fun changed(raw: JSONObject): JSONObject = edit(copy(raw).put("review", JSONObject.NULL).put("confirmReplacement", false))
    fun reviewed(raw: JSONObject, review: JSONObject): JSONObject = edit(copy(raw).put("review", review).put("confirmReplacement", false))
    fun restore(raw: JSONObject, historical: JSONObject): JSONObject {
        val value = edit(raw); val space = value.getString("spaceId"); val project = value.getString("projectId")
        val source = definition(space, project, historical)
        valid(!value.isNull("base") && source.getString("id") == value.getJSONObject("base").getString("id"), "CUSTOM_FIELD_SCOPE_CHANGED")
        return changed(value.put("draft", draft(source)).put("positionInput", source.getInt("position").toString()))
    }
    /** No project-management permission can stand in for the current role in the space. */
    fun authorize(space: String, project: String, data: JSONObject) {
        val parent = data.getJSONObject("space"); val child = data.getJSONObject("project")
        valid(!data.optBoolean("offlineCache") && !parent.optBoolean("offlineCache") && !child.optBoolean("offlineCache") &&
            parent.opt("id") == space && child.opt("id") == project && child.opt("spaceId") == space, "CUSTOM_FIELD_SCOPE_CHANGED")
        valid(parent.opt("role") in setOf("owner", "admin"), "SHARED_SPACE_FORBIDDEN")
        // A fresh project snapshot already passed server read ACL. Its permission map has six write flags, no read flag.
        val permissions = child.getJSONObject("permissions")
        valid(child.opt("role") in setOf("owner", "manager", "member", "commenter", "viewer") &&
            (!permissions.has("read") || permissions.opt("read") == true) && child.isNull("archivedAt"), "SHARED_PROJECT_FORBIDDEN")
    }
    fun verify(raw: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        val value = edit(raw); valid(value.getString("projectId") == project, "CUSTOM_FIELD_SCOPE_CHANGED")
        authorize(value.getString("spaceId"), project, data); valid(!queued, "CUSTOM_FIELD_LOCAL_QUEUE")
        valid(!value.isNull("review"), "CUSTOM_FIELD_PREVIEW_REQUIRED")
        val fresh = CustomFieldDefinitionProtocol.preview(value.getString("spaceId"), project, request(value), data.getJSONObject("preview"))
        valid(PlanningLifecycle.canonical(fresh) == PlanningLifecycle.canonical(value.getJSONObject("review")), "CUSTOM_FIELD_CONFLICT")
        command(value, UUID.randomUUID().toString())
    }
    fun command(raw: JSONObject, operation: String): JSONObject {
        val value = edit(raw); valid(UUID.fromString(operation).toString() == operation)
        valid(!value.isNull("review"), "CUSTOM_FIELD_PREVIEW_REQUIRED")
        val review = value.getJSONObject("review")
        valid(!review.getBoolean("replaceType") || value.getBoolean("confirmReplacement"), "CUSTOM_FIELD_TYPE_TRANSITION_REQUIRED")
        val payload = request(value).put("fingerprint", review.getString("fingerprint")).put("operationId", operation)
            .put("replaceType", review.getBoolean("replaceType"))
        return JSONObject().put("kind", "field-definition-save").put("sprintId", payload.getString("id"))
            .put("body", JSONObject().put("requestId", operation).put("spaceId", value.getString("spaceId")).put("projectId", value.getString("projectId"))
                .put("payload", payload).put("review", review).put("predecessorId", value.optJSONObject("base")?.get("predecessorId") ?: JSONObject.NULL))
    }
    /** The complete reviewed settings and successor link must be acknowledged before releasing a command. */
    fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        try {
            keys(response, setOf("field", "previousFieldId"))
            val body = command.getJSONObject("body"); val payload = body.getJSONObject("payload"); val review = body.getJSONObject("review")
            val returned = definition(body.getString("spaceId"), body.getString("projectId"), response.getJSONObject("field"))
            val replaces = review.getBoolean("replaceType"); val id = payload.getString("id")
            valid(if (replaces) response.opt("previousFieldId") == id && returned.getString("id") != id && returned.opt("predecessorId") == id
                else response.isNull("previousFieldId") && returned.getString("id") == id && returned.opt("predecessorId") == body.get("predecessorId"))
            valid(returned.getInt("revision").toLong() == if (replaces) 1L else payload.getInt("expectedRevision").toLong() + 1)
            val expected = copy(review.getJSONObject("field")); expected.put("id", returned.getString("id"))
            val settingsReturned = copy(returned).apply { remove("revision"); remove("predecessorId") }
            valid(PlanningLifecycle.canonical(settingsReturned) == PlanningLifecycle.canonical(expected))
            return copy(response)
        } catch (failure: Exception) { throw IllegalArgumentException("CUSTOM_FIELD_RECEIPT_INVALID", failure) }
    }
}

internal object CustomFieldEditorJournalContract : CommandJournalContract {
    override val namespace = "field-definition-editor-v1"
    override val definitiveErrors = CustomFieldProtocol.errors + setOf("INVALID_TITLE", "INVALID_TEXT", "WORKFLOW_FIELD_IN_USE")
    override fun validateEdit(edit: JSONObject) = CustomFieldEditorProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String) = CustomFieldEditorProtocol.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) = CustomFieldEditorProtocol.verify(edit, data, project, queued)
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject {
        val value = CustomFieldEditorProtocol.edit(edit)
        CustomFieldEditorProtocol.authorize(value.getString("spaceId"), project, data)
        val id = value.getJSONObject("draft").getString("id")
        val current = CustomFieldProtocol.definitions(value.getString("spaceId"), project, data.getJSONArray("fields")).find { it.getString("id") == id }
        require(value.isNull("base") || current != null) { "CUSTOM_FIELD_UNAVAILABLE" }
        return CustomFieldEditorProtocol.changed(value.put("base", current ?: JSONObject.NULL))
    }
    override fun receipt(command: JSONObject, response: JSONObject) = CustomFieldEditorProtocol.receipt(command, response)
}
