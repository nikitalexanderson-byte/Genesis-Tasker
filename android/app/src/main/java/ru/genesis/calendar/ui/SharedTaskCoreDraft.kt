package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject

internal const val SHARED_TASK_CORE_BASE = "_genesisTaskCoreBase"
internal const val SHARED_TASK_CORE_CONFLICTS = "_genesisTaskCoreConflicts"
private val coreKeys = listOf("priority", "parentTaskId", "checklists")
private val editorKeys = listOf("title", "description", "dueDate", "categoryId")

internal fun sharedTaskCoreSnapshot(task: JSONObject): JSONObject = JSONObject().apply {
    (coreKeys + editorKeys).forEach { key ->
        val value = task.opt(key) ?: if (key == "checklists") JSONArray() else if (key == "priority") 0 else JSONObject.NULL
        put(key, if (value is JSONArray) JSONArray(value.toString()) else value)
    }
}

private fun sameCoreValue(first: Any?, second: Any?): Boolean = when {
    first is JSONObject && second is JSONObject -> first.keys().asSequence().toSet() == second.keys().asSequence().toSet() &&
        first.keys().asSequence().all { sameCoreValue(first.opt(it), second.opt(it)) }
    first is JSONArray && second is JSONArray -> first.length() == second.length() &&
        (0 until first.length()).all { sameCoreValue(first.opt(it), second.opt(it)) }
    else -> first == second
}

private fun canonicalCore(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
        JSONObject.quote(it) + ":" + canonicalCore(value.opt(it))
    }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonicalCore(value.opt(it)) }
    is String -> JSONObject.quote(value)
    null, JSONObject.NULL -> "null"
    else -> value.toString()
}
private fun coreFingerprint(value: Any?) = java.security.MessageDigest.getInstance("SHA-256")
    .digest(canonicalCore(value).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
/** Save only fingerprints, so a 300-item editor cannot duplicate its text into the Activity Bundle. */
internal fun sharedTaskCoreBaseline(task: JSONObject): JSONObject = JSONObject().put("_fingerprints", true).apply {
    val snapshot = sharedTaskCoreSnapshot(task)
    (coreKeys + editorKeys).forEach { put(it, coreFingerprint(snapshot.opt(it))) }
}
private fun coreMatches(base: JSONObject?, key: String, value: Any?): Boolean = base != null &&
    if (base.optBoolean("_fingerprints")) base.optString(key) == coreFingerprint(value)
    else sameCoreValue(base.opt(key), value) // Preserve existing local candidate drafts.

internal fun sharedTaskCoreResolved(details: JSONObject) = (details.optJSONArray(SHARED_TASK_CORE_CONFLICTS)?.length() ?: 0) == 0
internal data class SharedTaskEditorRebase(val details: JSONObject, val fields: JSONObject)

internal fun sharedTaskEditorFields(title: String, description: String, due: String, category: String) = JSONObject()
    .put("title", title).put("description", description).put("dueDate", due.ifBlank { null } ?: JSONObject.NULL)
    .put("categoryId", category.ifBlank { null } ?: JSONObject.NULL)

/** Explicit three-way refresh. Never silently replaces an edited field with a newer server value. */
internal fun rebaseSharedTaskEditor(task: JSONObject, details: JSONObject, fields: JSONObject,
    customFields: List<JSONObject> = emptyList()): SharedTaskEditorRebase {
    val base = details.optJSONObject(SHARED_TASK_CORE_BASE)
    val latest = sharedTaskCoreSnapshot(task)
    val result = rebaseSharedTaskDetailDraft(task, details, customFields)
    val fieldResult = JSONObject(fields.toString())
    val oldConflicts = details.optJSONArray(SHARED_TASK_CORE_CONFLICTS) ?: JSONArray()
    val conflicts = JSONArray()
    (coreKeys + editorKeys).forEach { key ->
        val own = (if (key in coreKeys) details else fields).opt(key) ?: JSONObject.NULL
        val remote = latest.opt(key)
        val changed = !coreMatches(base, key, own)
        val oldConflict = (0 until oldConflicts.length()).any { oldConflicts.optString(it) == key }
        if (changed) {
            (if (key in coreKeys) result else fieldResult).put(key, own)
            if (!sameCoreValue(own, remote) && (oldConflict || !coreMatches(base, key, remote)))
                conflicts.put(key)
        } else (if (key in coreKeys) result else fieldResult).put(key, remote)
    }
    result.put(SHARED_TASK_CORE_BASE, sharedTaskCoreBaseline(task)).put(SHARED_TASK_CORE_CONFLICTS, conflicts)
    return SharedTaskEditorRebase(result, fieldResult)
}

internal fun resolveSharedTaskEditor(details: JSONObject, fields: JSONObject, keepLocal: Boolean, latestTask: JSONObject): SharedTaskEditorRebase {
    val result = JSONObject(details.toString()); val fieldResult = JSONObject(fields.toString())
    val remote = sharedTaskCoreSnapshot(latestTask)
    check((coreKeys + editorKeys).all { coreMatches(details.optJSONObject(SHARED_TASK_CORE_BASE), it, remote.opt(it)) })
    val conflicts = details.getJSONArray(SHARED_TASK_CORE_CONFLICTS)
    if (!keepLocal) for (index in 0 until conflicts.length()) {
        val key = conflicts.getString(index)
        (if (key in coreKeys) result else fieldResult).put(key, remote.get(key))
    }
    result.put(SHARED_TASK_CORE_BASE, sharedTaskCoreBaseline(latestTask))
    result.remove(SHARED_TASK_CORE_CONFLICTS); result.remove("_genesisTaskCoreServer")
    return SharedTaskEditorRebase(result, fieldResult)
}
