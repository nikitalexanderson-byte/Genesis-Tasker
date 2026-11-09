package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal interface PlanningJournalStorage {
    fun <T> locked(block: () -> T): T
    fun read(key: String): String?
    fun write(key: String, value: String)
    fun remove(key: String)
}

/** The storage transaction covers the read, CAS check and committed encrypted write. */
internal class PlanningJournal(private val storage: PlanningJournalStorage,
    private val now: () -> Long = System::currentTimeMillis, private val token: () -> String = { UUID.randomUUID().toString() },
    private val contract: CommandJournalContract? = null) {
    companion object {
        const val MAX_BYTES = 8_000_000
        const val MAX_COPIES = 8
        val DEFINITIVE_ERRORS = setOf("PLANNING_CONFLICT", "PLANNING_ACTIVE_SPRINT", "SPRINT_COMPLETED",
            "SPRINT_DATES_INVALID", "SPRINT_CONTEXT_INVALID", "INVALID_CALENDAR_CONTEXT", "SPRINT_OUTCOMES_REQUIRED",
            "SPRINT_STATE_INVALID", "PLANNING_DISABLED", "PLANNING_ESTIMATE_INVALID", "INVALID_TITLE", "INVALID_TEXT")
    }
    private fun key(account: String, project: String): String {
        require(account.isNotBlank() && account.length <= 255 && PlanningLifecycle.id(project)) { "PLANNING_DRAFT_SCOPE" }
        return "${contract?.namespace ?: "planning-v1"}:${account.length}:$account:${project.length}:$project"
    }
    private val definitiveErrors get() = contract?.definitiveErrors ?: DEFINITIVE_ERRORS
    private fun validateEdit(edit: JSONObject) = contract?.validateEdit(edit) ?: PlanningLifecycle.validateEdit(edit)
    private fun command(edit: JSONObject, request: String) = contract?.command(edit, request) ?: PlanningLifecycle.command(edit, request)
    private fun clone(value: JSONObject) = JSONObject(value.toString())
    private fun validate(account: String, project: String, record: JSONObject): JSONObject {
        require(record.keys().asSequence().toSet() == setOf("version", "accountId", "projectId", "stamp", "savedAt", "edit", "phase", "command", "attempts", "error", "receipt")) { "PLANNING_DRAFT_INVALID" }
        require(record.get("version") is Int && record.getInt("version") == 1 && record.getString("accountId") == account && record.getString("projectId") == project) { "PLANNING_DRAFT_SCOPE" }
        require(UUID.fromString(record.getString("stamp")).toString() == record.getString("stamp")) { "PLANNING_DRAFT_INVALID" }
        require((record.get("savedAt") is Long || record.get("savedAt") is Int) && record.getLong("savedAt") >= 0) { "PLANNING_DRAFT_INVALID" }
        val edit = validateEdit(record.getJSONObject("edit"))
        val attempts = record.get("attempts")
        require((attempts is Int || attempts is Long) && (attempts as Number).toLong() in 0 until Int.MAX_VALUE.toLong()) { "PLANNING_DRAFT_INVALID" }
        val command = record.opt("command").takeUnless { it == JSONObject.NULL }
        if (command != null) {
            require(command is String && command.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "PLANNING_DRAFT_INVALID" }
            val value = JSONObject(command as String)
            require(value.keys().asSequence().toSet() == setOf("kind", "sprintId", "body")) { "PLANNING_DRAFT_INVALID" }
            val generated = command(edit, value.getJSONObject("body").getString("requestId"))
            require(PlanningLifecycle.canonical(value) == PlanningLifecycle.canonical(generated)) { "PLANNING_DRAFT_INVALID" }
        }
        val failureCode = record.opt("error").takeUnless { it == JSONObject.NULL }
        require(failureCode == null || failureCode is String && Regex("[A-Z0-9_]{1,100}").matches(failureCode)) { "PLANNING_DRAFT_INVALID" }
        val hasReceipt = !record.isNull("receipt")
        when (record.getString("phase")) {
            "editing" -> require(command == null && record.getInt("attempts") == 0 && failureCode == null && !hasReceipt)
            "pending" -> require(command != null && !hasReceipt)
            "rejected" -> require(command != null && record.getInt("attempts") == 1 && failureCode in definitiveErrors && !hasReceipt)
            "received" -> {
                require(command != null && record.getInt("attempts") > 0 && failureCode == null && hasReceipt)
                val receipt = receipt(project, JSONObject(command as String), record.getJSONObject("receipt"))
                require(PlanningLifecycle.canonical(receipt) == PlanningLifecycle.canonical(record.getJSONObject("receipt"))) { "PLANNING_DRAFT_INVALID" }
            }
            else -> error("PLANNING_DRAFT_INVALID")
        }
        return clone(record)
    }
    private fun read(account: String, project: String): JSONObject? = storage.read(key(account, project))?.let { raw ->
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "PLANNING_DRAFT_INVALID" }
        validate(account, project, JSONObject(raw))
    }
    fun load(account: String, project: String): JSONObject? = storage.locked { read(account, project) }
    private fun copiesKey(account: String, project: String) = "copies:" + key(account, project)
    private fun uuid(value: String): Boolean = runCatching { UUID.fromString(value).toString() == value }.getOrDefault(false)
    private fun readCopies(account: String, project: String): List<JSONObject> {
        val raw = storage.read(copiesKey(account, project)) ?: return emptyList()
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "PLANNING_DRAFT_INVALID" }
        val envelope = JSONObject(raw)
        require(envelope.keys().asSequence().toSet() == setOf("version", "accountId", "projectId", "copies") &&
            envelope.get("version") is Int && envelope.getInt("version") == 1 &&
            envelope.getString("accountId") == account && envelope.getString("projectId") == project) { "PLANNING_DRAFT_SCOPE" }
        val copies = PlanningLifecycle.rows(envelope.getJSONArray("copies"))
        require(copies.size <= MAX_COPIES && copies.map { it.getString("id") }.toSet().size == copies.size) { "PLANNING_DRAFT_INVALID" }
        copies.forEach { entry ->
            require(entry.keys().asSequence().toSet() == setOf("id", "stamp", "savedAt", "edit") &&
                uuid(entry.getString("id")) && uuid(entry.getString("stamp")) &&
                (entry.get("savedAt") is Long || entry.get("savedAt") is Int) && entry.getLong("savedAt") >= 0) { "PLANNING_DRAFT_INVALID" }
            validateEdit(entry.getJSONObject("edit"))
        }
        return copies.map(::clone)
    }
    fun copies(account: String, project: String): List<JSONObject> = storage.locked { readCopies(account, project) }
    private fun writeCopies(account: String, project: String, copies: List<JSONObject>) {
        require(copies.size <= MAX_COPIES) { "PLANNING_DRAFT_LIMIT" }
        val raw = JSONObject().put("version", 1).put("accountId", account).put("projectId", project).put("copies", JSONArray(copies)).toString()
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "PLANNING_DRAFT_LIMIT" }
        storage.write(copiesKey(account, project), raw)
    }
    /** A stale editor may save its own version without replacing the active draft or command. */
    fun saveCopy(account: String, project: String, id: String, stamp: String?, edit: JSONObject): JSONObject = storage.locked {
        require(uuid(id)) { "PLANNING_DRAFT_INVALID" }
        val copies = readCopies(account, project)
        require(copies.find { it.getString("id") == id }?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        val next = JSONObject().put("id", id).put("stamp", token()).put("savedAt", now()).put("edit", validateEdit(edit))
        writeCopies(account, project, copies.filterNot { it.getString("id") == id } + next)
        clone(next)
    }
    fun removeCopy(account: String, project: String, id: String, stamp: String) = storage.locked {
        val copies = readCopies(account, project)
        require(copies.find { it.getString("id") == id }?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        writeCopies(account, project, copies.filterNot { it.getString("id") == id })
    }
    /** Explicit selection preserves the previous input first. A pending command cannot be replaced. */
    fun useCopy(account: String, project: String, id: String, copyStamp: String, stamp: String?): JSONObject = storage.locked {
        val old = current(account, project, stamp)
        require(old == null || old.getString("phase") in setOf("editing", "rejected")) { "PLANNING_DRAFT_PENDING" }
        val copies = readCopies(account, project)
        val selected = copies.find { it.getString("id") == id && it.getString("stamp") == copyStamp }
        require(selected != null) { "PLANNING_DRAFT_CHANGED" }
        val edit = selected!!.getJSONObject("edit")
        if (old != null && copies.none { PlanningLifecycle.canonical(it.getJSONObject("edit")) == PlanningLifecycle.canonical(old.getJSONObject("edit")) }) {
            val archived = JSONObject().put("id", token()).put("stamp", token()).put("savedAt", now()).put("edit", old.getJSONObject("edit"))
            writeCopies(account, project, copies + archived)
        }
        persist(account, project, JSONObject().put("version", 1).put("accountId", account).put("projectId", project)
            .put("edit", edit).put("phase", "editing").put("command", JSONObject.NULL)
            .put("attempts", 0).put("error", JSONObject.NULL).put("receipt", JSONObject.NULL))
    }
    private fun current(account: String, project: String, stamp: String?): JSONObject? {
        val record = read(account, project)
        require(record?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        return record
    }
    private fun persist(account: String, project: String, record: JSONObject): JSONObject {
        val next = clone(record).put("stamp", token()).put("savedAt", now())
        validate(account, project, next)
        val raw = next.toString()
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "PLANNING_DRAFT_INVALID" }
        storage.write(key(account, project), raw)
        return clone(next)
    }
    fun save(account: String, project: String, stamp: String?, edit: JSONObject): JSONObject = storage.locked {
        val old = current(account, project, stamp)
        require(old == null || old.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        persist(account, project, JSONObject().put("version", 1).put("accountId", account).put("projectId", project)
            .put("edit", validateEdit(edit)).put("phase", "editing").put("command", JSONObject.NULL)
            .put("attempts", 0).put("error", JSONObject.NULL).put("receipt", JSONObject.NULL))
    }
    fun prepare(account: String, project: String, stamp: String, fresh: JSONObject, hasTaskQueue: Boolean,
        remaining: List<JSONObject>? = null, requestId: String = UUID.randomUUID().toString()): JSONObject = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(old.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        if (contract != null) contract.verify(old.getJSONObject("edit"), fresh, project, hasTaskQueue)
        else PlanningLifecycle.verify(old.getJSONObject("edit"), fresh, project, hasTaskQueue, remaining)
        val command = command(old.getJSONObject("edit"), requestId).toString()
        persist(account, project, old.put("phase", "pending").put("command", command))
    }
    /** A durable attempt marker precedes every HTTPS write, including a replay. */
    fun beginAttempt(account: String, project: String, stamp: String): JSONObject = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(old.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        persist(account, project, old.put("attempts", old.getInt("attempts") + 1).put("error", JSONObject.NULL))
    }
    fun failed(account: String, project: String, stamp: String, code: String): JSONObject = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(old.getString("phase") == "pending" && old.getInt("attempts") > 0) { "PLANNING_DRAFT_PENDING" }
        require(Regex("[A-Z0-9_]{1,100}").matches(code)) { "PLANNING_DRAFT_INVALID" }
        // A rejected replay cannot prove that the original request did not commit.
        if (old.getInt("attempts") == 1 && code in definitiveErrors) old.put("phase", "rejected")
        persist(account, project, old.put("error", code))
    }
    fun succeeded(account: String, project: String, stamp: String, response: JSONObject): JSONObject = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(old.getString("phase") == "pending" && old.getInt("attempts") > 0) { "PLANNING_DRAFT_PENDING" }
        val receipt = receipt(project, JSONObject(old.getString("command")), response)
        persist(account, project, old.put("phase", "received").put("error", JSONObject.NULL).put("receipt", receipt))
    }
    fun rebase(account: String, project: String, stamp: String, fresh: JSONObject, remaining: List<JSONObject>? = null): JSONObject = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(editable(old)) { "PLANNING_DRAFT_PENDING" }
        val edit = contract?.rebase(old.getJSONObject("edit"), fresh, project) ?: PlanningLifecycle.rebase(old.getJSONObject("edit"), fresh, project, remaining)
        persist(account, project, old.put("edit", edit).put("phase", "editing").put("command", JSONObject.NULL)
            .put("attempts", 0).put("error", JSONObject.NULL).put("receipt", JSONObject.NULL))
    }
    private fun editable(record: JSONObject) = record.getString("phase") in setOf("editing", "rejected") ||
        record.getString("phase") == "pending" && record.getInt("attempts") == 0
    fun remove(account: String, project: String, stamp: String) = storage.locked {
        val old = requireNotNull(current(account, project, stamp))
        require(editable(old) || old.getString("phase") == "received") { "PLANNING_DRAFT_PENDING" }
        storage.remove(key(account, project))
    }
    private fun receipt(project: String, command: JSONObject, response: JSONObject): JSONObject {
        if (contract != null) return contract.receipt(command, response)
        val body = command.getJSONObject("body")
        if (command.getString("kind") == "settings") {
            val config = response.getJSONObject("config")
            require(config.get("enabled") is Boolean && config.getBoolean("enabled") == body.getBoolean("enabled") &&
                config.getString("estimateUnit") == body.getString("estimateUnit") && config.getLong("revision") == body.getLong("expectedRevision") + 1) { "PLANNING_RECEIPT_INVALID" }
            return JSONObject().put("config", JSONObject().put("enabled", config.getBoolean("enabled"))
                .put("estimateUnit", config.getString("estimateUnit")).put("revision", config.getLong("revision")))
        }
        val sprint = response.getJSONObject("sprint")
        require(PlanningLifecycle.id(sprint.getString("id")) && sprint.getString("projectId") == project &&
            (command.isNull("sprintId") || command.getString("sprintId") == sprint.getString("id")) &&
            sprint.getLong("revision") == body.getLong("expectedRevision") + 1) { "PLANNING_RECEIPT_INVALID" }
        require(sprint.getString("state") in setOf("planning", "active", "completed")) { "PLANNING_RECEIPT_INVALID" }
        if (command.getString("kind") == "transition") require(sprint.getString("state") == if (body.getString("action") == "start") "active" else "completed") { "PLANNING_RECEIPT_INVALID" }
        val safe = JSONObject()
        for (key in listOf("id", "projectId", "state", "title", "goal", "startDate", "endDate", "calendarMode", "calendarContext", "revision", "estimateUnit", "createdAt", "updatedAt", "startedAt", "completedAt")) {
            if (sprint.has(key)) safe.put(key, sprint.get(key))
        }
        return JSONObject().put("sprint", safe)
    }
}
