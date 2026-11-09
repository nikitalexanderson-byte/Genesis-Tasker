package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.LocalDate
import java.util.UUID

/** C1 uses the existing server manifest and mutation receipts; previews are never synthetic success. */
internal object SharedTemplateProtocol {
    val languages = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
    val starters = setOf("system:event", "system:publication", "system:launch", "system:control")
    val transfer = listOf("descriptions", "tags", "labels", "customFields", "assignees", "checklists", "subtasks", "dependencies", "dates", "approvals")
    val errors = setOf("TEMPLATE_INVALID", "TEMPLATE_REFERENCE_INVALID", "TEMPLATE_DATE_INVALID", "TEMPLATE_DATE_OUTSIDE_RANGE", "TEMPLATE_LANGUAGE_INVALID",
        "TEMPLATE_OPERATION_REQUIRED", "TEMPLATE_OPERATION_REUSED", "TEMPLATE_CONFLICT", "TEMPLATE_PREVIEW_CHANGED", "TEMPLATE_LIST_CHANGED", "TEMPLATE_PAGE_INVALID",
        "TEMPLATE_SIZE_LIMIT", "TEMPLATE_LIMIT", "TEMPLATE_OPEN_STATUS_REQUIRED", "TEMPLATE_FIELD_MAPPING_COLLISION", "TEMPLATE_FIELD_CREATE_FORBIDDEN",
        "TEMPLATE_FIELD_VALUE_UNMAPPED", "TEMPLATE_APPROVERS_REQUIRED", "TEMPLATE_CATEGORY_CREATE_FORBIDDEN", "INVALID_CALENDAR_TIME_ZONE", "INVALID_BOARD_DISPLAY",
        "TEMPLATE_APPLY_BLOCKED", "TEMPLATE_UNAVAILABLE", "TEMPLATE_FORBIDDEN", "TEMPLATE_SOURCE_UNAVAILABLE", "TEMPLATE_SOURCE_SCOPE_UNAVAILABLE",
        "TEMPLATE_SOURCE_NOT_PROJECT", "TEMPLATE_DESTINATION_INVALID", "TEMPLATE_STATUS_MAPPING_INVALID", "TEMPLATE_CATEGORY_MAPPING_INVALID",
        "TEMPLATE_FIELD_MAPPING_INVALID", "TEMPLATE_RESOURCE_LIMIT", "TEMPLATE_PROJECT_LIMIT", "TEMPLATE_TASK_LIMIT",
        "TASK_RELATION_CYCLE", "INVALID_TITLE", "INVALID_TEXT", "INVALID_DEPENDENCIES", "PLANNING_ESTIMATE_INVALID") + WorkflowLifecycle.errors + CustomFieldProtocol.errors
    private fun valid(value: Boolean, code: String = "TEMPLATE_PROTOCOL") = SharedTemplateManifest.valid(value, code)
    fun id(value: String): String = value.also { valid(runCatching { UUID.fromString(it).toString() == it }.getOrDefault(false)) }
    fun templateId(value: String): String = value.also { valid(it in starters || runCatching { id(it) }.isSuccess) }
    fun language(value: String) = value.also { valid(it in languages) }
    fun copy(value: JSONObject) = SharedTemplateManifest.copy(value)
    fun rows(value: JSONArray, maximum: Int = 500) = SharedTemplateManifest.rows(value, maximum)
    private fun keys(value: JSONObject, allowed: Set<String>) = SharedTemplateManifest.keys(value, allowed)
    private fun count(value: Any?, min: Int = 0, max: Int = Int.MAX_VALUE) = SharedTemplateManifest.integer(value, min, max)
    private fun bool(value: Any?) { valid(value is Boolean) }
    private fun text(value: Any?, max: Int = 160, required: Boolean = false) = SharedTemplateManifest.text(value, max, required)
    private fun digest(value: Any?): String = text(value, 64).also { valid(it.matches(Regex("[a-f0-9]{64}"))) }
    private fun nullableId(value: Any?): String? = if (value == null || value == JSONObject.NULL) null else id(text(value, 100))
    fun cursor(value: String?) = value?.also { valid(it.length in 1..16000) }
    private fun date(value: Any?): String = text(value, 10).also {
        val parsed = runCatching { LocalDate.parse(it) }.getOrNull()
        valid(it.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")) && parsed != null && parsed.year in 1900..2100, "TEMPLATE_DATE_INVALID")
    }

    fun summary(raw: JSONObject): JSONObject {
        templateId(raw.getString("id")); text(raw.opt("title"), 160, true)
        count(raw.opt("revision"), 1); count(raw.opt("projectCount"), 1, 50); count(raw.opt("taskCount"), 0, 500)
        valid(raw.opt("kind") in setOf("task", "project")); bool(raw.opt("system")); bool(raw.opt("deleted")); bool(raw.opt("canEdit"))
        if (raw.getBoolean("system")) valid(raw.getString("id") in starters && !raw.getBoolean("canEdit") && !raw.getBoolean("deleted") && raw.isNull("projectId") && raw.isNull("spaceId") && raw.isNull("ownerId"))
        else { id(raw.getString("spaceId")); id(raw.getString("projectId")); text(raw.opt("ownerId"), 100, true); valid(raw.getString("id") !in starters) }
        return copy(raw)
    }
    fun library(space: String, raw: JSONObject, old: JSONObject? = null, requestedCursor: String? = null): JSONObject {
        id(space); cursor(requestedCursor)
        valid(raw.opt("hasMore") is Boolean)
        val items = rows(raw.getJSONArray("templates"), 50).map(::summary)
        valid(items.all { !it.getBoolean("system") && it.getString("spaceId") == space })
        val systems = rows(raw.getJSONArray("systemTemplates"), 4).map(::summary)
        valid(systems.all { it.getBoolean("system") } && systems.map { it.getString("id") }.distinct().size == systems.size)
        val next = if (raw.isNull("nextCursor")) null else cursor(raw.getString("nextCursor"))
        val total = count(raw.opt("total"))
        val previous = old?.let { valid(requestedCursor != null && it.opt("spaceId") == space && it.optString("nextCursor") == requestedCursor); rows(it.getJSONArray("templates"), Int.MAX_VALUE) }.orEmpty()
        valid(raw.getBoolean("hasMore") == (next != null) && (next == null || next != requestedCursor))
        valid(previous.isEmpty() || total == old?.getInt("total"), "TEMPLATE_LIST_CHANGED")
        val combined = previous + items
        valid(combined.map { it.getString("id") }.distinct().size == combined.size && combined.size <= total)
        valid(next != null || combined.size == total)
        return JSONObject().put("spaceId", space).put("templates", JSONArray(combined)).put("systemTemplates", if (old == null) JSONArray(systems) else old.getJSONArray("systemTemplates"))
            .put("total", total).put("nextCursor", next ?: JSONObject.NULL).put("hasMore", next != null)
    }
    fun source(space: String, id: String, raw: JSONObject): JSONObject {
        val value = summary(raw); valid(value.getString("id") == templateId(id))
        if (!value.getBoolean("system")) valid(value.getString("spaceId") == SharedTemplateProtocol.id(space))
        val manifest = SharedTemplateManifest.validate(value.getJSONObject("manifest"))
        valid(manifest.getString("kind") == value.getString("kind") && manifest.getJSONArray("projects").length() == value.getInt("projectCount") && manifest.getJSONArray("tasks").length() == value.getInt("taskCount"))
        issues(value.getJSONArray("notices")); value.optJSONObject("libraryPermissions")?.let { permissions -> for (key in listOf("editTasks", "createProjects", "manageProjects")) bool(permissions.opt(key)) }
        return value.put("manifest", manifest)
    }
    fun issues(raw: JSONArray): JSONArray {
        rows(raw, Int.MAX_VALUE).forEach { issue ->
            valid(text(issue.opt("code"), 100, true).matches(Regex("[A-Z0-9_]+")))
            for (key in listOf("title", "date", "option", "sourceUserId", "taskKey", "projectKey", "fieldKey", "fieldRef", "itemKey")) if (issue.has(key) && !issue.isNull(key)) text(issue.opt(key), 1000)
            if (issue.has("count")) count(issue.opt("count"))
        }
        return JSONArray(raw.toString())
    }

    /** PHP represents empty dictionaries as []; only an empty array may become a map. */
    fun dictionary(raw: Any?): JSONObject = when (raw) {
        null, JSONObject.NULL -> JSONObject()
        is JSONObject -> copy(raw)
        is JSONArray -> { valid(raw.length() == 0); JSONObject() }
        else -> throw IllegalArgumentException("TEMPLATE_PROTOCOL")
    }
    /** Canonical defaults match PHP; mapping dictionaries stay maps even when empty. */
    fun options(raw: JSONObject): JSONObject {
        keys(raw, setOf("spaceId", "projectId", "parentProjectId", "boardStatusId", "anchorDate", "title", "language", "include", "statusMap", "categoryMap", "fieldMap", "optionMap", "memberMap", "fieldValues"))
        val result = copy(raw).put("spaceId", id(raw.getString("spaceId"))).put("language", language(raw.getString("language"))).put("anchorDate", date(raw.opt("anchorDate")))
        for (key in listOf("projectId", "parentProjectId", "boardStatusId")) result.put(key, nullableId(raw.opt(key)) ?: JSONObject.NULL)
        result.put("title", if (raw.isNull("title")) JSONObject.NULL else text(raw.opt("title"), 160, true))
        val include = dictionary(raw.opt("include")); keys(include, transfer.toSet())
        result.put("include", JSONObject().apply { transfer.forEach { flag -> val value = include.opt(flag) ?: true; bool(value); put(flag, value) } })
        for (name in listOf("statusMap", "categoryMap", "fieldMap", "optionMap", "memberMap", "fieldValues")) {
            val mapping = dictionary(raw.opt(name)); valid(mapping.length() <= 500)
            mapping.keys().forEach { source ->
                SharedTemplateManifest.key(source)
                if (name in setOf("optionMap", "fieldValues")) {
                    val nested = dictionary(mapping.get(source)); mapping.put(source, nested); valid(nested.length() <= 200)
                    nested.keys().forEach { field ->
                        if (name == "fieldValues") valid(field.matches(Regex("[A-Za-z0-9:_-]{1,205}"))) else SharedTemplateManifest.key(field)
                        if (name == "optionMap") { val target = nested.opt(field); if (target != JSONObject.NULL) SharedTemplateManifest.key(text(target, 100)) }
                    }
                } else if (!mapping.isNull(source)) SharedTemplateManifest.key(text(mapping.opt(source), 100))
            }
            result.put(name, mapping)
        }
        return result
    }
    fun preview(space: String, template: String, request: JSONObject, raw: JSONObject): JSONObject {
        valid(options(request).getString("spaceId") == id(space) && raw.opt("templateId") == templateId(template))
        digest(raw.opt("fingerprint")); count(raw.opt("revision"), 1); bool(raw.opt("canApply"))
        valid(PlanningLifecycle.canonical(options(raw.getJSONObject("options"))) == PlanningLifecycle.canonical(options(request)), "TEMPLATE_PREVIEW_CHANGED")
        valid(raw.opt("calendarMode") in SharedTemplateManifest.modes && raw.opt("kind") in setOf("task", "project")); SharedTemplateManifest.context(raw.getJSONObject("calendarContext"))
        val projects = rows(raw.getJSONArray("projects"), 50); valid(projects.isNotEmpty())
        val tasks = rows(raw.getJSONArray("tasks")); valid(tasks.map { it.getString("key") }.distinct().size == tasks.size)
        tasks.forEach { task ->
            SharedTemplateManifest.key(task.getString("key")); text(task.opt("title"), 160, true)
            SharedTemplateManifest.estimate(task.opt("storyPoints")); SharedTemplateManifest.estimate(task.opt("estimateHours"))
        }
        for (name in listOf("members", "statuses", "categories", "fields", "sourceFields", "newFields")) rows(raw.getJSONArray(name), when (name) { "newFields" -> 10000; "fields" -> 5000; else -> 1000 })
        issues(raw.getJSONArray("notices")); issues(raw.getJSONArray("blockers"))
        valid(raw.getBoolean("canApply") == (raw.getJSONArray("blockers").length() == 0))
        return copy(raw)
    }

    /** Typed preview overrides preserve raw input in the draft until an explicit review normalizes it. */
    fun fieldInputs(request: JSONObject, catalog: JSONObject, manifest: JSONObject? = null): JSONObject {
        val result = options(request); val overrides = result.getJSONObject("fieldValues")
        val tasks = rows(catalog.getJSONArray("tasks")).associateBy { it.getString("key") }
        val sourceTasks = manifest?.let { rows(it.getJSONArray("tasks")).associateBy { task -> task.getString("key") } }.orEmpty()
        val existing = rows(catalog.getJSONArray("fields"), 5000)
        val created = rows(catalog.getJSONArray("newFields"), 10000)
        overrides.keys().asSequence().toList().forEach { key ->
            if (!result.getJSONObject("include").getBoolean("subtasks") && key !in tasks && sourceTasks[key]?.isNull("parentKey") == false) { overrides.remove(key); return@forEach }
            val task = tasks[key] ?: error("TEMPLATE_REFERENCE_INVALID")
            val fields = (existing.map { copy(it).put("key", it.getString("id")) } + created.filter { it.getString("projectKey") == task.getString("projectKey") }.map { copy(it).put("key", it.getString("ref")) }).associateBy { it.getString("key") }
            val values = dictionary(overrides.get(key))
            values.keys().forEach { ref ->
                val field = fields[ref] ?: error("TEMPLATE_FIELD_MAPPING_INVALID")
                val input = SharedTemplateManifest.optionValue(field, values.get(ref), true)
                val normalized = CustomFieldProtocol.normalize(SharedTemplateManifest.fieldAdapter(field), input, input)
                values.put(ref, SharedTemplateManifest.optionValue(field, normalized, false))
            }
            overrides.put(key, values)
        }
        return result
    }

    /** Editing drafts may contain incomplete text; only a fully valid manifest can become a network command. */
    fun edit(raw: JSONObject): JSONObject {
        keys(raw, setOf("kind", "spaceId", "projectId", "templateId", "request", "review", "inputs", "dateInput"))
        valid(raw.opt("kind") in setOf("template-save", "template-apply"), "TEMPLATE_DRAFT_INVALID")
        id(raw.getString("spaceId")); id(raw.getString("projectId"))
        if (!raw.isNull("templateId")) templateId(raw.getString("templateId"))
        if (!raw.isNull("review")) digest(raw.opt("review"))
        if (!raw.isNull("dateInput")) {
            val calendar = copy(raw.getJSONObject("dateInput")); valid(calendar.opt("mode") in SharedTemplateManifest.modes)
            calendar.remove("mode"); SharedTemplateManifest.context(calendar)
        }
        val request = raw.getJSONObject("request"); val inputs = raw.getJSONObject("inputs")
        valid(inputs.length() <= 5000); inputs.keys().forEach { path -> text(path, 500, true); text(inputs.opt(path), 200) }
        valid(request.toString().toByteArray(Charsets.UTF_8).size <= 6_000_000, "TEMPLATE_SIZE_LIMIT")
        if (raw.getString("kind") == "template-save") {
            keys(request, setOf("projectId", "title", "expectedRevision", "manifest", "deleted", "cloneTemplateId", "sourceProjectId", "sourceTaskId", "capture"))
            id(request.getString("projectId")); text(request.opt("title"), 160)
            if (request.has("expectedRevision")) count(request.opt("expectedRevision"))
            if (request.has("deleted")) bool(request.opt("deleted"))
            if (request.has("manifest")) SharedTemplateManifest.validate(request.getJSONObject("manifest"), complete = false)
            if (request.has("cloneTemplateId")) templateId(request.getString("cloneTemplateId"))
            if (request.has("sourceProjectId")) id(request.getString("sourceProjectId"))
            if (request.has("sourceTaskId")) id(request.getString("sourceTaskId"))
            if (request.has("capture")) {
                val capture = request.getJSONObject("capture"); keys(capture, setOf("calendarMode", "calendarContext", "anchorDate"))
                valid(capture.opt("calendarMode") in SharedTemplateManifest.modes); SharedTemplateManifest.context(capture.getJSONObject("calendarContext")); date(capture.opt("anchorDate"))
                valid(request.has("sourceProjectId") && !request.has("manifest") && raw.isNull("templateId"))
            }
        } else { valid(!raw.isNull("templateId")); options(request); valid(inputs.length() == 0) }
        return copy(raw)
    }
    fun newEdit(space: String, project: String, kind: String, template: String?, request: JSONObject) = JSONObject().put("kind", kind)
        .put("spaceId", id(space)).put("projectId", id(project)).put("templateId", template?.let(::templateId) ?: JSONObject.NULL)
        .put("request", copy(request)).put("review", JSONObject.NULL).put("inputs", JSONObject())
    fun command(raw: JSONObject, operation: String): JSONObject {
        val edit = edit(raw); valid(UUID.fromString(operation).toString() == operation)
        val request = copy(edit.getJSONObject("request"))
        if (edit.getString("kind") == "template-save") {
            text(request.opt("title"), 160, true)
            if (request.has("manifest")) request.put("manifest", SharedTemplateManifest.validate(materialize(request.getJSONObject("manifest"), edit.getJSONObject("inputs"))))
            else {
                valid(!edit.isNull("templateId") || request.has("capture"), "TEMPLATE_MANIFEST_REQUIRED")
                valid(edit.getJSONObject("inputs").length() == 0)
            }
            if (!edit.isNull("templateId")) { id(edit.getString("templateId")); valid(request.has("expectedRevision")) }
        } else {
            valid(!edit.isNull("review"), "TEMPLATE_REVIEW_REQUIRED")
            request.put("fingerprint", digest(edit.opt("review")))
        }
        request.put("operationId", operation)
        return JSONObject().put("kind", edit.getString("kind")).put("sprintId", edit.get("templateId"))
            .put("body", JSONObject().put("requestId", operation).put("spaceId", edit.getString("spaceId")).put("projectId", edit.getString("projectId")).put("request", request))
    }
    private fun materialize(manifest: JSONObject, inputs: JSONObject): JSONObject {
        val result = copy(manifest)
        val fields = rows(result.getJSONArray("fields"), 200).associateBy { it.getString("key") }
        rows(result.getJSONArray("tasks")).forEach { task ->
            val values = task.getJSONObject("customValues")
            values.keys().asSequence().toList().forEach { key -> fields[key]?.let { field ->
                val input = SharedTemplateManifest.optionValue(field, values.get(key), true)
                val value = CustomFieldProtocol.normalize(SharedTemplateManifest.fieldAdapter(field), input, input)
                values.put(key, SharedTemplateManifest.optionValue(field, value, false))
            } }
        }
        inputs.keys().forEach { path ->
            val parts = path.split('/'); valid(parts.size >= 3, "TEMPLATE_DRAFT_INVALID")
            if (parts.size == 3 && parts[0] == "tagProject" && parts[2] == "pending") {
                val project = rows(result.getJSONArray("projects"), 50).singleOrNull { it.getString("key") == parts[1] } ?: error("TEMPLATE_REFERENCE_INVALID")
                val tag = inputs.getString(path).trim(); text(tag, 80)
                if (tag.isNotEmpty()) {
                    val values = project.getJSONArray("tags"); val next = ((0 until values.length()).map(values::getString) + tag).distinct()
                    valid(next.size <= 30); project.put("tags", JSONArray(next))
                }
                return@forEach
            }
            val task = rows(result.getJSONArray("tasks")).singleOrNull { it.getString("key") == parts[1] } ?: error("TEMPLATE_REFERENCE_INVALID")
            val text = inputs.getString(path).trim().replace(',', '.')
            when {
                parts.size == 3 && parts[0] == "estimate" && parts[2] in setOf("storyPoints", "estimateHours") -> {
                    val number = if (text.isBlank()) JSONObject.NULL else {
                        val value = text.toBigDecimalOrNull(); valid(value != null && value >= BigDecimal.ZERO && value <= BigDecimal("1000000") && value.stripTrailingZeros().scale() <= 2, "PLANNING_ESTIMATE_INVALID")
                        requireNotNull(value).toDouble()
                    }
                    task.put(parts[2], number)
                }
                parts.size == 3 && parts[0] == "tag" && parts[2] == "pending" -> {
                    val tag = inputs.getString(path).trim(); text(tag, 80)
                    if (tag.isNotEmpty()) {
                        val values = task.getJSONArray("tags"); val tags = (0 until values.length()).map(values::getString)
                        val next = (tags + tag).distinct(); valid(next.size <= 30); task.put("tags", JSONArray(next))
                    }
                }
                parts.size == 4 && parts[0] == "offset" && parts[2] in setOf("due", "start") && parts[3] == "amount" -> {
                    val amount = text.toIntOrNull(); valid(amount != null, "TEMPLATE_DATE_INVALID"); task.getJSONObject(parts[2]).put("amount", amount)
                }
                parts.size == 5 && parts[0] == "checklistOffset" && parts[4] == "amount" -> {
                    val list = rows(task.getJSONArray("checklists"), 20).singleOrNull { it.getString("key") == parts[2] } ?: error("TEMPLATE_REFERENCE_INVALID")
                    val item = rows(list.getJSONArray("items"), 300).singleOrNull { it.getString("key") == parts[3] } ?: error("TEMPLATE_REFERENCE_INVALID")
                    val amount = text.toIntOrNull(); valid(amount != null, "TEMPLATE_DATE_INVALID"); item.getJSONObject("due").put("amount", amount)
                }
                else -> error("TEMPLATE_DRAFT_INVALID")
            }
        }
        return result
    }
    fun verify(raw: JSONObject, data: JSONObject, project: String, queued: Boolean) {
        val edit = edit(raw); valid(edit.getString("projectId") == id(project) && !data.optBoolean("offlineCache"), "TEMPLATE_SCOPE_CHANGED")
        valid(!queued, "TEMPLATE_LOCAL_QUEUE")
        val scope = data.getJSONObject("project"); valid(scope.opt("id") == project && scope.opt("spaceId") == edit.getString("spaceId"), "TEMPLATE_SCOPE_CHANGED")
        if (edit.getString("kind") == "template-save") {
            val request = edit.getJSONObject("request"); val library = data.getJSONObject("library")
            valid(library.opt("id") == request.getString("projectId") && library.opt("spaceId") == edit.getString("spaceId") && library.getJSONObject("permissions").getBoolean("editTasks"), "TEMPLATE_PERMISSION_CHANGED")
            if (!edit.isNull("templateId")) {
                val source = data.getJSONObject("source")
                valid(source.opt("id") == edit.getString("templateId") && source.getBoolean("canEdit"), "TEMPLATE_PERMISSION_CHANGED")
                valid(source.getInt("revision") == request.getInt("expectedRevision"), "TEMPLATE_CONFLICT")
            }
        } else {
            val fresh = preview(edit.getString("spaceId"), edit.getString("templateId"), edit.getJSONObject("request"), data.getJSONObject("preview"))
            valid(fresh.getBoolean("canApply"), "TEMPLATE_REVIEW_REQUIRED")
            valid(fresh.getString("fingerprint") == edit.opt("review"), "TEMPLATE_PREVIEW_CHANGED")
        }
    }
    fun receipt(command: JSONObject, raw: JSONObject): JSONObject {
        val body = command.getJSONObject("body"); val request = body.getJSONObject("request")
        valid(request.getString("operationId") == body.getString("requestId"), "TEMPLATE_RECEIPT_INVALID")
        if (command.getString("kind") == "template-save") {
            id(raw.getString("id")); count(raw.opt("revision"), 1); bool(raw.opt("deleted"))
            valid(command.isNull("sprintId") || command.getString("sprintId") == raw.getString("id"), "TEMPLATE_RECEIPT_INVALID")
            valid(raw.getBoolean("deleted") == request.optBoolean("deleted"), "TEMPLATE_RECEIPT_INVALID")
            valid(raw.getInt("revision") == if (command.isNull("sprintId")) 1 else request.getInt("expectedRevision") + 1, "TEMPLATE_RECEIPT_INVALID")
        } else {
            valid(raw.opt("operationId") == request.getString("operationId") && raw.opt("templateId") == command.getString("sprintId"), "TEMPLATE_RECEIPT_INVALID")
            id(raw.getString("rootProjectId")); nullableId(raw.opt("rootTaskId")); count(raw.opt("projectCount"), 0, 50); count(raw.opt("taskCount"), 0, 500)
            val projects = dictionary(raw.get("projectIds")); val tasks = dictionary(raw.get("taskIds"))
            val projectCount = raw.getInt("projectCount"); val taskCount = raw.getInt("taskCount")
            valid(projects.length() == if (projectCount == 0) 1 else projectCount, "TEMPLATE_RECEIPT_INVALID")
            valid(tasks.length() == taskCount, "TEMPLATE_RECEIPT_INVALID")
            for (map in listOf(projects, tasks)) map.keys().forEach { key -> SharedTemplateManifest.key(key); id(map.getString(key)) }
            valid(projects.keys().asSequence().map { projects.getString(it) }.toSet().contains(raw.getString("rootProjectId")), "TEMPLATE_RECEIPT_INVALID")
            valid(if (taskCount == 0) raw.isNull("rootTaskId") else tasks.keys().asSequence().any { tasks.getString(it) == raw.opt("rootTaskId") }, "TEMPLATE_RECEIPT_INVALID")
            if (!request.isNull("projectId")) valid(projectCount == 0 && raw.getString("rootProjectId") == request.getString("projectId"), "TEMPLATE_RECEIPT_INVALID")
            issues(raw.getJSONArray("notices"))
        }
        return copy(raw)
    }
}

internal object SharedTemplateJournalContract : CommandJournalContract {
    override val namespace = "templates-v1"
    override val definitiveErrors = SharedTemplateProtocol.errors
    override fun validateEdit(edit: JSONObject) = SharedTemplateProtocol.edit(edit)
    override fun command(edit: JSONObject, requestId: String) = SharedTemplateProtocol.command(edit, requestId)
    override fun verify(edit: JSONObject, data: JSONObject, project: String, queued: Boolean) = SharedTemplateProtocol.verify(edit, data, project, queued)
    override fun rebase(edit: JSONObject, data: JSONObject, project: String): JSONObject = throw IllegalArgumentException("TEMPLATE_EXPLICIT_COPY_REQUIRED")
    override fun receipt(command: JSONObject, response: JSONObject) = SharedTemplateProtocol.receipt(command, response)
}
