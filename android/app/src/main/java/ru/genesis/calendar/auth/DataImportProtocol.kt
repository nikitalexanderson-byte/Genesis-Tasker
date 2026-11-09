package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

internal object DataImportProtocol {
    private val keyPattern = Regex("[A-Za-z0-9:_-]{1,100}")
    private val hashPattern = Regex("[a-f0-9]{64}")
    private val fieldTypes = setOf("text", "number", "date", "select", "multi", "checkbox", "url")
    private val selectionFields = setOf("format", "spaceId", "projectId", "parentProjectId", "parse", "memberMap", "statusMap", "labelMap", "fieldMap", "optionMap", "fieldDefaults")
    val definitiveErrors = setOf("DATA_PREVIEW_CHANGED", "DATA_APPLY_BLOCKED", "DATA_PREVIEW_REQUIRED", "DATA_OPERATION_REUSED",
        "DATA_IMPORT_UNDONE", "DATA_IMPORT_REMOVED", "DATA_DESTINATION_INVALID", "DATA_RESOURCE_LIMIT", "DATA_FILE_TOO_LARGE",
        "DATA_JSON_INVALID", "DATA_CSV_INVALID", "DATA_INVALID", "DATA_REFERENCE_INVALID", "DATA_VERSION_UNSUPPORTED")
    fun errorCode(code: String) = code.matches(Regex("(?:DATA|CUSTOM_FIELD|TEMPLATE_FIELD)_[A-Z0-9_]{1,80}")) ||
        code in setOf("REQUEST_TOO_LARGE", "TASK_CHILDREN_INCOMPLETE", "TASK_CHECKLIST_INCOMPLETE")
    private fun check(ok: Boolean) { require(ok) { "DATA_IMPORT_INVALID" } }
    private fun text(raw: JSONObject, key: String, limit: Int, empty: Boolean = false): String = (raw.opt(key) as? String).also {
        check(it != null && it.length <= limit && (empty || it.isNotBlank()))
    }!!
    private fun number(raw: JSONObject, key: String, minimum: Int = 0, maximum: Int = Int.MAX_VALUE): Int {
        val value = raw.opt(key); check(value is Int || value is Long)
        val count = (value as Number).toLong(); check(count in minimum.toLong()..maximum.toLong()); return count.toInt()
    }
    private fun exact(raw: JSONObject, fields: Set<String>) { check(raw.keys().asSequence().toSet() == fields) }
    private fun clone(raw: JSONObject) = JSONObject(raw.toString())
    private fun objectValue(value: Any?): JSONObject = when (value) {
        is JSONObject -> value
        is JSONArray -> { check(value.length() == 0); JSONObject() }
        else -> { check(false); JSONObject() }
    }
    private fun nullableId(raw: JSONObject, key: String): String? = raw.opt(key).takeUnless { it == JSONObject.NULL }?.also {
        check(it is String && PlanningLifecycle.id(it))
    } as String?
    fun source(raw: JSONObject): JSONObject {
        exact(raw, setOf("id", "name", "bytes", "sha256"))
        check(PlanningLifecycle.id(text(raw, "id", 36)) && hashPattern.matches(text(raw, "sha256", 64)))
        text(raw, "name", 200); number(raw, "bytes", 1, DataExportProtocol.FILE_LIMIT)
        return clone(raw)
    }
    private fun map(value: Any?, nullable: Boolean): JSONObject {
        val raw = objectValue(value); check(raw.length() <= 30_000)
        raw.keys().forEach { key ->
            val target = raw.get(key)
            check(keyPattern.matches(key) && (nullable && target == JSONObject.NULL || target is String && keyPattern.matches(target)))
        }
        return clone(raw)
    }
    fun selection(raw: JSONObject): JSONObject {
        exact(raw, selectionFields)
        check(text(raw, "format", 10) in setOf("json", "csv", "trello") && PlanningLifecycle.id(text(raw, "spaceId", 36)))
        val project = nullableId(raw, "projectId"); val parent = nullableId(raw, "parentProjectId"); check(project == null || parent == null)
        val parse = raw.optJSONObject("parse") ?: error("DATA_IMPORT_INVALID")
        exact(parse, setOf("title", "openTitle", "doneTitle", "calendarMode", "calendarContext", "delimiter", "dateFormat", "columns", "customColumns", "doneStatusKeys"))
        text(parse, "title", 160); text(parse, "openTitle", 80); text(parse, "doneTitle", 80)
        check(text(parse, "calendarMode", 10) in setOf("profane", "sacred", "lunar"))
        val calendar = parse.optJSONObject("calendarContext") ?: error("DATA_IMPORT_INVALID")
        exact(calendar, setOf("version", "timeZone", "gregorianYearStart")); check(calendar.opt("version") == 2)
        check(DataExportProtocol.timeZone(text(calendar, "timeZone", 200)) != null && text(calendar, "gregorianYearStart", 10) in setOf("january", "march"))
        check(text(parse, "delimiter", 1, true) in setOf(",", ";", "\t") && text(parse, "dateFormat", 3) in setOf("iso", "dmy", "mdy"))
        val columns = objectValue(parse.opt("columns")); check(columns.keys().asSequence().all { it in DataExportProtocol.columns })
        columns.keys().forEach { number(columns, it, 0, 499) }
        val custom = parse.optJSONArray("customColumns") ?: error("DATA_IMPORT_INVALID"); check(custom.length() <= 200)
        val indexes = mutableSetOf<Int>()
        for (index in 0 until custom.length()) {
            val column = custom.getJSONObject(index); exact(column, setOf("column", "title", "type"))
            check(indexes.add(number(column, "column", 0, 499)) && text(column, "type", 20) in fieldTypes); text(column, "title", 160)
        }
        val done = parse.optJSONArray("doneStatusKeys") ?: error("DATA_IMPORT_INVALID"); check(done.length() <= 30_000)
        for (index in 0 until done.length()) check(done.opt(index) is String && keyPattern.matches(done.getString(index)))
        val result = clone(raw)
        for (key in listOf("memberMap", "statusMap", "labelMap", "fieldMap")) result.put(key, map(raw.opt(key), key != "fieldMap"))
        val options = clone(objectValue(raw.opt("optionMap"))); check(options.length() <= 2000)
        options.keys().forEach { check(keyPattern.matches(it)); options.put(it, map(options.get(it), false)) }; result.put("optionMap", clone(options))
        val defaults = objectValue(raw.opt("fieldDefaults")); check(defaults.length() <= 200)
        defaults.keys().forEach { key ->
            check(keyPattern.matches(key))
            when (val value = defaults.get(key)) {
                JSONObject.NULL -> Unit
                is String -> check(value.length <= 5000)
                is Boolean -> Unit
                is Number -> check(value.toDouble().isFinite())
                is JSONArray -> { check(value.length() <= 200); for (index in 0 until value.length()) check(value.opt(index) is String && keyPattern.matches(value.getString(index))) }
                else -> check(false)
            }
        }
        result.put("fieldDefaults", clone(defaults)); check(result.toString().toByteArray(Charsets.UTF_8).size <= 2_000_000)
        return result
    }
    fun edit(raw: JSONObject): JSONObject {
        exact(raw, setOf("kind", "source", "selection", "review")); check(raw.opt("kind") == "data-import")
        val result = JSONObject().put("kind", "data-import").put("source", source(raw.getJSONObject("source"))).put("selection", selection(raw.getJSONObject("selection")))
        val review = raw.opt("review")
        if (review == JSONObject.NULL) result.put("review", JSONObject.NULL) else {
            check(review is JSONObject); review as JSONObject
            exact(review, setOf("fingerprint", "canApply", "projectCount", "taskCount"))
            check(hashPattern.matches(text(review, "fingerprint", 64)) && review.opt("canApply") is Boolean)
            number(review, "projectCount", 0, 1000); number(review, "taskCount", 0, 100_000); result.put("review", clone(review))
        }
        return result
    }
    fun review(preview: JSONObject) = JSONObject().put("fingerprint", preview.getString("fingerprint")).put("canApply", preview.getBoolean("canApply"))
        .put("projectCount", preview.getInt("projectCount")).put("taskCount", preview.getInt("taskCount"))
    fun preview(raw: JSONObject): JSONObject = try { checkedPreview(raw) }
        catch (failure: Exception) { throw IllegalArgumentException("DATA_IMPORT_INVALID", failure) }
    private fun checkedPreview(raw: JSONObject): JSONObject {
        check(raw.opt("previewVersion") == 1 && raw.opt("sampleLimit") == 100 && hashPattern.matches(text(raw, "fingerprint", 64)) && raw.opt("canApply") is Boolean)
        number(raw, "projectCount", 0, 1000); number(raw, "taskCount", 0, 100_000)
        val counts = raw.getJSONObject("sourceCounts")
        for (key in listOf("projects", "tasks", "comments", "history", "attachments", "series", "templates")) number(counts, key)
        check(counts.getInt("tasks") == raw.getInt("taskCount"))
        for (key in listOf("blockers", "notices")) issues(raw.getJSONArray(key))
        check(raw.getBoolean("canApply") == (raw.getJSONArray("blockers").length() == 0))
        val result = clone(raw)
        for (key in listOf("memberMap", "statusMap", "labelMap", "fieldMap")) result.put(key, map(raw.opt(key), key != "fieldMap"))
        val options = clone(objectValue(raw.opt("optionMap")))
        options.keys().forEach { check(keyPattern.matches(it)); options.put(it, map(options.get(it), true)) }
        result.put("optionMap", options)
        result.put("issueTitles", clone(objectValue(raw.opt("issueTitles"))))
        return DataImportPreview.validate(result)
    }
    private fun issues(rows: JSONArray): JSONArray {
        check(rows.length() <= 100_000)
        for (index in 0 until rows.length()) { val row = rows.getJSONObject(index); check(text(row, "code", 100).matches(Regex("[A-Z][A-Z0-9_]{0,99}"))); text(row, "field", 5000, true) }
        return rows
    }
    fun receipt(raw: JSONObject, space: String, operation: String? = null, expected: JSONObject? = null): JSONObject {
        check(PlanningLifecycle.id(text(raw, "importId", 36)) && PlanningLifecycle.id(text(raw, "rootProjectId", 36)) && raw.opt("spaceId") == space)
        val actualOperation = text(raw, "operationId", 100); check(keyPattern.matches(actualOperation) && raw.opt("duplicate") is Boolean)
        check(operation == null || actualOperation == operation || raw.getBoolean("duplicate"))
        check(raw.opt("state") in setOf("active", "undone", "removed") && raw.opt("canUndo") is Boolean)
        val projects = number(raw, "projectCount", 0, 1000); val tasks = number(raw, "taskCount", 0, 100_000)
        if (expected != null) check(projects == expected.getInt("projectCount") && tasks == expected.getInt("taskCount"))
        issues(raw.getJSONArray("notices"))
        val safe = JSONObject()
        for (key in listOf("importId", "operationId", "spaceId", "rootProjectId", "projectCount", "taskCount", "duplicate", "state", "canUndo")) safe.put(key, raw.get(key))
        val notices = raw.getJSONArray("notices")
        val noticeCount = if (raw.has("noticeCount")) number(raw, "noticeCount", notices.length()) else notices.length()
        safe.put("notices", JSONArray((0 until minOf(100, notices.length())).map(notices::getJSONObject))).put("noticeCount", noticeCount)
        if (raw.has("createdAt")) safe.put("createdAt", text(raw, "createdAt", 50))
        return clone(safe)
    }
}

internal object DataImportJournalContract : CommandJournalContract {
    override val namespace = "data-import-v1"
    override val definitiveErrors = DataImportProtocol.definitiveErrors
    override fun validateEdit(edit: JSONObject) = DataImportProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String): JSONObject {
        val valid = validateEdit(edit); val review = valid.getJSONObject("review")
        require(review.getBoolean("canApply") && PlanningLifecycle.id(requestId)) { "DATA_PREVIEW_REQUIRED" }
        return JSONObject().put("kind", "data-import").put("sprintId", JSONObject.NULL).put("body", JSONObject()
            .put("requestId", requestId).put("source", valid.getJSONObject("source")).put("selection", valid.getJSONObject("selection")).put("review", review))
    }
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        require(!queued) { "DATA_LOCAL_QUEUE" }; require(PlanningLifecycle.id(project))
        val valid = validateEdit(edit); val expected = valid.optJSONObject("review") ?: error("DATA_PREVIEW_REQUIRED")
        val current = DataImportProtocol.preview(data)
        require(current.getBoolean("canApply") && PlanningLifecycle.canonical(expected) == PlanningLifecycle.canonical(DataImportProtocol.review(current))) { "DATA_PREVIEW_CHANGED" }
    }
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = validateEdit(edit).put("review", DataImportProtocol.review(DataImportProtocol.preview(data)))
    override fun receipt(command: JSONObject, response: JSONObject): JSONObject {
        val body = command.getJSONObject("body")
        return DataImportProtocol.receipt(response, body.getJSONObject("selection").getString("spaceId"), body.getString("requestId"), body.getJSONObject("review"))
    }
}
