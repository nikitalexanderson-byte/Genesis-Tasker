package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** Definitions keep relative periods; only the server resolves them into today's ACL query. */
internal object SavedViewProtocol {
    const val SCOPE = "00000000-0000-4000-8000-000000000005"
    val errors = setOf("VIEW_INVALID", "VIEW_CONFLICT", "VIEW_SCOPE_IMMUTABLE", "VIEW_REQUEST_REQUIRED", "VIEW_LIMIT",
        "VIEW_FILTER_UNAVAILABLE", "VIEW_PAGE_INVALID", "VIEW_LIST_CHANGED", "VIEW_RECEIPT_INVALID", "VIEW_PROTOCOL",
        "INVALID_CALENDAR_CONTEXT", "INVALID_CALENDAR_MODE") + CustomFieldQueryProtocol.errors
    val sorts = listOf("position", "createdAt", "createdAtAsc", "priority", "dueDate", "title", "updatedAt")
    val relatives = listOf("none", "overdue", "this-week", "this-month")
    fun copy(raw: JSONObject) = JSONObject(raw.toString())
    private fun valid(ok: Boolean, code: String = "VIEW_INVALID") { require(ok) { code } }
    private fun keys(raw: JSONObject, expected: Set<String>) = valid(raw.keys().asSequence().toSet() == expected)
    fun nullableId(raw: Any?): String? = if (raw == JSONObject.NULL || raw == null) null else CustomFieldProtocol.id(raw as String)
    fun filter(raw: Any): JSONObject {
        if (raw is JSONArray && raw.length() == 0) return JSONObject()
        valid(raw is JSONObject)
        return copy(raw as JSONObject)
    }
    /** Syntax check, without silently replacing an unavailable field or calendar context. */
    fun definition(raw: JSONObject): JSONObject {
        val value = copy(raw)
        keys(value, setOf("version", "title", "filter", "sort", "relative", "calendarMode", "calendarContext"))
        valid(value.opt("version") == 1 && value.opt("title") is String && value.getString("title").codePointCount(0, value.getString("title").length) <= 160)
        valid(value.opt("sort") in sorts || Regex("custom:[A-Za-z0-9_-]{1,100}:(asc|desc)").matches(value.optString("sort")))
        valid(value.opt("relative") in relatives && value.opt("calendarMode") in setOf("profane", "sacred", "lunar"))
        val context = value.getJSONObject("calendarContext")
        keys(context, setOf("version", "timeZone", "gregorianYearStart"))
        valid(context.opt("version") == 2 && context.opt("timeZone") is String && context.getString("timeZone").length <= 100 &&
            context.opt("gregorianYearStart") in setOf("january", "march"))
        // Invalid zone text is editable. It cannot be applied or submitted (ready()).
        val criteria = filter(value.get("filter"))
        val lists = setOf("projectIds", "statusIds", "assigneeIds", "labelIds", "tags", "ids")
        val strings = setOf("spaceId", "q", "createdBy", "from", "to", "dueFrom", "dueTo", "completion", "scheduled", "unscheduled")
        val toggles = setOf("undated", "approvalPending", "archived", "includeArchived", "backlog")
        val nullableIds = setOf("sprintId", "parentTaskId")
        valid(criteria.keys().asSequence().all { it in lists + strings + toggles + nullableIds + setOf("priority", "customFields") })
        lists.forEach { key -> if (criteria.has(key)) {
            val rows = criteria.getJSONArray(key); valid(rows.length() <= 200)
            for (index in 0 until rows.length()) valid(rows.get(index) is String && rows.getString(index).length <= 200)
        } }
        strings.forEach { if (criteria.has(it)) valid(criteria.opt(it) is String && criteria.getString(it).length <= 1000) }
        toggles.forEach { if (criteria.has(it)) valid(criteria.opt(it) is Boolean) }
        nullableIds.forEach { if (criteria.has(it)) nullableId(criteria.get(it)) }
        for (key in listOf("scheduled", "unscheduled")) if (criteria.has(key)) valid(criteria.getString(key) in setOf("date", "time"))
        if (criteria.has("priority")) { val rows = criteria.getJSONArray("priority"); valid(rows.length() <= 4)
            for (index in 0 until rows.length()) valid(rows.get(index) is Int && rows.getInt(index) in 0..3) }
        if (criteria.has("completion")) valid(criteria.getString("completion") in setOf("any", "open", "completed"))
        if (criteria.has("customFields")) { val rows = criteria.getJSONArray("customFields"); valid(rows.length() <= 20)
            for (index in 0 until rows.length()) { val row = rows.getJSONObject(index)
                valid(row.keys().asSequence().all { it in setOf("fieldId", "op", "value") })
                CustomFieldProtocol.id(row.getString("fieldId"))
                valid(row.opt("op") in setOf("eq", "ne", "exists", "missing", "contains", "gt", "gte", "lt", "lte"))
                if (row.has("value")) CustomFieldProtocol.values(JSONObject().put("value", row.get("value")))
            }
        }
        value.put("filter", criteria)
        valid(value.toString().toByteArray(Charsets.UTF_8).size <= 8000)
        return value
    }
    fun ready(raw: JSONObject): JSONObject = definition(raw).also { value ->
        valid(value.getString("title").trim().isNotBlank())
        ZoneId.of(value.getJSONObject("calendarContext").getString("timeZone"))
        val criteria = value.getJSONObject("filter")
        for (key in listOf("from", "to", "dueFrom", "dueTo")) if (criteria.has(key)) LocalDate.parse(criteria.getString(key))
        valid(value.getString("relative") == "none" || !criteria.has("dueFrom") && !criteria.has("dueTo"))
        valid(!criteria.has("dueFrom") || !criteria.has("dueTo") || criteria.getString("dueFrom") <= criteria.getString("dueTo"))
    }
    /** PHP binds the filter to the outer visibility scope; frozen legacy bodies stay unchanged. */
    fun scopedDefinition(definition: JSONObject, space: Any): JSONObject = ready(definition).also {
        val filter = it.getJSONObject("filter")
        if (space == JSONObject.NULL) filter.remove("spaceId") else filter.put("spaceId", space)
        it.put("title", it.getString("title").trim())
    }
    fun view(raw: JSONObject): JSONObject {
        val value = copy(raw)
        keys(value, setOf("id", "spaceId", "visibility", "revision", "canEdit", "updatedAt", "definition", "invalid"))
        CustomFieldProtocol.id(value.getString("id")); nullableId(value.get("spaceId"))
        valid(value.opt("visibility") in setOf("personal", "shared") && value.opt("canEdit") is Boolean && value.opt("invalid") is Boolean, "VIEW_PROTOCOL")
        valid((value.opt("revision") is Int || value.opt("revision") is Long) && value.getLong("revision") in 1 until Int.MAX_VALUE.toLong(), "VIEW_PROTOCOL")
        valid(value.opt("updatedAt") is String && value.getString("updatedAt").length <= 100, "VIEW_PROTOCOL")
        valid(value.isNull("definition") || value.opt("definition") is JSONObject, "VIEW_PROTOCOL")
        if (!value.getBoolean("invalid")) {
            val editable = runCatching { definition(value.getJSONObject("definition")) }.getOrNull()
            if (editable == null) value.put("invalid", true) else value.put("definition", editable)
        }
        valid(value.toString().toByteArray(Charsets.UTF_8).size <= 16000, "VIEW_PROTOCOL")
        return value
    }
    fun page(raw: JSONObject): JSONObject = copy(raw).also { value ->
        val rows = value.getJSONArray("views"); valid(rows.length() <= 100, "VIEW_PROTOCOL")
        valid(value.opt("total") is Int && value.getInt("total") >= rows.length() && value.opt("hasMore") is Boolean, "VIEW_PROTOCOL")
        valid(value.has("nextCursor") && (value.isNull("nextCursor") || value.opt("nextCursor") is String && value.getString("nextCursor").isNotBlank() && value.getString("nextCursor").length <= 16000), "VIEW_PROTOCOL")
        valid(value.getBoolean("hasMore") == !value.isNull("nextCursor"), "VIEW_PROTOCOL")
        val ids = mutableSetOf<String>()
        for (index in 0 until rows.length()) { val row = view(rows.getJSONObject(index)); valid(ids.add(row.getString("id")), "VIEW_PROTOCOL"); rows.put(index, row) }
    }
    fun edit(raw: JSONObject): JSONObject = copy(raw).also { value ->
        val required = setOf("kind", "source", "spaceId", "visibility", "definition")
        valid(value.keys().asSequence().toSet().let { it.containsAll(required) && (it - required - "inputCalendar").isEmpty() })
        valid(value.opt("kind") in setOf("view-save", "view-delete"))
        nullableId(value.get("spaceId")); valid(value.opt("visibility") in setOf("personal", "shared"))
        valid(value.getString("visibility") != "shared" || !value.isNull("spaceId"))
        if (!value.isNull("source")) view(value.getJSONObject("source"))
        valid(value.isNull("definition") || value.opt("definition") is JSONObject)
        if (value.has("inputCalendar") && !value.isNull("inputCalendar")) {
            val input = value.getJSONObject("inputCalendar")
            keys(input, setOf("mode", "version", "timeZone", "gregorianYearStart"))
            valid(input.opt("mode") in setOf("profane", "sacred", "lunar") && input.opt("version") == 2 && input.opt("gregorianYearStart") in setOf("january", "march"))
            ZoneId.of(input.getString("timeZone"))
        }
        valid(value.toString().toByteArray(Charsets.UTF_8).size <= 30000)
    }
    fun newEdit(definition: JSONObject?, source: JSONObject? = null): JSONObject = edit(JSONObject()
        .put("kind", "view-save").put("source", source ?: JSONObject.NULL).put("spaceId", source?.get("spaceId") ?: JSONObject.NULL)
        .put("visibility", source?.getString("visibility") ?: "personal").put("definition", definition ?: JSONObject.NULL).put("inputCalendar", JSONObject.NULL))
    fun command(raw: JSONObject, request: String): JSONObject {
        val value = edit(raw); CustomFieldProtocol.id(request)
        val source = value.optJSONObject("source"); val deleting = value.getString("kind") == "view-delete"
        valid(!deleting || source != null)
        val body = JSONObject().put("requestId", request)
        if (source != null) body.put("expectedRevision", source.getLong("revision"))
        if (!deleting) body.put("spaceId", value.get("spaceId")).put("visibility", value.get("visibility"))
            .put("definition", ready(value.getJSONObject("definition")).apply { put("title", getString("title").trim()) })
        return JSONObject().put("kind", if (deleting) "view-delete" else if (source == null) "view-create" else "view-update")
            .put("sprintId", source?.getString("id") ?: JSONObject.NULL).put("body", body)
    }
}

internal object SavedViewJournalContract : CommandJournalContract {
    override val namespace = "saved-views-v1"
    override val definitiveErrors = SavedViewProtocol.errors - setOf("VIEW_RECEIPT_INVALID", "VIEW_PROTOCOL", "VIEW_PAGE_INVALID", "VIEW_LIST_CHANGED", "SHARED_QUERY_CHANGED")
    override fun validateEdit(edit: JSONObject) = SavedViewProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String) = SavedViewProtocol.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        require(project == SavedViewProtocol.SCOPE) { "PLANNING_DRAFT_SCOPE" }
        SavedViewProtocol.command(edit, SavedViewProtocol.SCOPE)
        val source = edit.optJSONObject("source") ?: return
        val current = SavedViewProtocol.view(data.getJSONObject("view"))
        require(current.getString("id") == source.getString("id") && current.getLong("revision") == source.getLong("revision")) { "VIEW_CONFLICT" }
        require(current.getBoolean("canEdit")) { "SHARED_FORBIDDEN" }
        require(current.get("spaceId") == edit.get("spaceId") && current.getString("visibility") == edit.getString("visibility")) { "VIEW_SCOPE_IMMUTABLE" }
    }
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = SavedViewProtocol.edit(edit).also {
        val current = SavedViewProtocol.view(data.getJSONObject("view"))
        require(current.getBoolean("canEdit")) { "SHARED_FORBIDDEN" }
        require(it.getJSONObject("source").getString("id") == current.getString("id")) { "VIEW_PROTOCOL" }
        require(current.get("spaceId") == it.get("spaceId") && current.get("visibility") == it.get("visibility")) { "VIEW_SCOPE_IMMUTABLE" }
        it.put("source", current) // Keep the user's conditions; only explicit rebase changes the base revision.
    }
    override fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        if (command.getString("kind") == "view-delete") {
            require(response.opt("ok") == true) { "VIEW_RECEIPT_INVALID" }
            return JSONObject().put("ok", true)
        }
        val view = SavedViewProtocol.view(response.getJSONObject("view")); val body = command.getJSONObject("body")
        require(!view.getBoolean("invalid") && (command.isNull("sprintId") || view.getString("id") == command.getString("sprintId")) &&
            view.getLong("revision") == (if (command.isNull("sprintId")) 1L else body.getLong("expectedRevision") + 1) &&
            view.get("spaceId") == body.get("spaceId") && view.get("visibility") == body.get("visibility") &&
            PlanningLifecycle.canonical(view.getJSONObject("definition")) == PlanningLifecycle.canonical(SavedViewProtocol.scopedDefinition(body.getJSONObject("definition"), body.get("spaceId")))) { "VIEW_RECEIPT_INVALID" }
        return JSONObject().put("view", view)
    }
}
