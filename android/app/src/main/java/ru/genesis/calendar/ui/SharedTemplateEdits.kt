package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTemplateManifest
import java.util.UUID

/** Local graph edits have no effects on live projects or tasks. The final manifest is validated before sending. */
internal object SharedTemplateEdits {
    fun copy(raw: JSONObject) = JSONObject(raw.toString())
    fun rows(raw: JSONArray) = SharedTemplateManifest.rows(raw, Int.MAX_VALUE)
    private fun filter(raw: JSONArray, keep: (JSONObject) -> Boolean) = JSONArray(rows(raw).filter(keep))
    fun update(raw: JSONObject, collection: String, id: String, action: (JSONObject) -> Unit): JSONObject {
        require(collection in setOf("projects", "tasks", "fields", "labels"))
        val result = copy(raw); action(rows(result.getJSONArray(collection)).single { it.getString("key") == id }); return result
    }
    fun descendants(raw: JSONObject, collection: String, id: String): Set<String> {
        val result = mutableSetOf(id); val all = rows(raw.getJSONArray(collection))
        while (true) {
            val before = result.size; all.filter { it.opt("parentKey") in result }.forEach { result.add(it.getString("key")) }
            if (result.size == before) break
        }
        return result
    }
    fun removeTasks(raw: JSONObject, ids: Set<String>): JSONObject {
        val result = copy(raw); result.put("tasks", filter(result.getJSONArray("tasks")) { it.getString("key") !in ids })
        rows(result.getJSONArray("tasks")).forEach { task ->
            task.put("dependsOnKeys", JSONArray((0 until task.getJSONArray("dependsOnKeys").length()).map { task.getJSONArray("dependsOnKeys").getString(it) }.filterNot { it in ids }))
            rows(task.getJSONArray("checklists")).forEach { list -> rows(list.getJSONArray("items")).forEach { item -> if (item.opt("linkedTaskKey") in ids) item.put("linkedTaskKey", JSONObject.NULL) } }
        }
        return result
    }
    fun removeProject(raw: JSONObject, id: String): JSONObject {
        require(raw.getJSONArray("projects").getJSONObject(0).getString("key") != id)
        val ids = descendants(raw, "projects", id)
        val taskIds = rows(raw.getJSONArray("tasks")).filter { it.getString("projectKey") in ids }.map { it.getString("key") }.toSet()
        val result = removeTasks(raw, taskIds)
        result.put("projects", filter(result.getJSONArray("projects")) { it.getString("key") !in ids })
        val fields = rows(result.getJSONArray("fields")).filter { it.opt("projectKey") in ids }.map { it.getString("key") }
        fields.forEach { key -> rows(result.getJSONArray("tasks")).forEach { it.getJSONObject("customValues").remove(key) } }
        result.put("fields", filter(result.getJSONArray("fields")) { it.getString("key") !in fields })
        return result
    }
    fun removeStatus(raw: JSONObject, project: String, id: String, replacement: String): JSONObject {
        require(id != replacement)
        val result = copy(raw); val owner = rows(result.getJSONArray("projects")).single { it.getString("key") == project }
        require(rows(owner.getJSONArray("statuses")).any { it.getString("key") == replacement })
        owner.put("statuses", filter(owner.getJSONArray("statuses")) { it.getString("key") != id })
        rows(result.getJSONArray("tasks")).filter { it.getString("projectKey") == project && it.getString("statusKey") == id }.forEach { it.put("statusKey", replacement) }
        rows(result.getJSONArray("projects")).filter { it.opt("parentKey") == project && it.opt("boardStatusKey") == id }.forEach { it.put("boardStatusKey", replacement) }
        return result
    }
    fun removeCategory(raw: JSONObject, project: String, id: String): JSONObject {
        val result = copy(raw); val owner = rows(result.getJSONArray("projects")).single { it.getString("key") == project }
        owner.put("categories", filter(owner.getJSONArray("categories")) { it.getString("key") != id })
        rows(result.getJSONArray("tasks")).filter { it.getString("projectKey") == project && it.opt("categoryKey") == id }.forEach { it.put("categoryKey", JSONObject.NULL) }
        return result
    }
    fun removeLabel(raw: JSONObject, id: String): JSONObject {
        val result = copy(raw); result.put("labels", filter(result.getJSONArray("labels")) { it.getString("key") != id })
        for (collection in listOf("projects", "tasks")) rows(result.getJSONArray(collection)).forEach { row ->
            val values = row.getJSONArray("labelKeys"); row.put("labelKeys", JSONArray((0 until values.length()).map(values::getString).filterNot { it == id }))
        }
        return result
    }
    fun removeField(raw: JSONObject, id: String): JSONObject {
        val result = copy(raw); result.put("fields", filter(result.getJSONArray("fields")) { it.getString("key") != id })
        rows(result.getJSONArray("tasks")).forEach { it.getJSONObject("customValues").remove(id) }; return result
    }
    /** Called only after explicit confirmation when there are values or options to clear. */
    fun changeFieldType(raw: JSONObject, id: String, type: String): JSONObject {
        require(type in setOf("text", "number", "date", "checkbox", "url", "select", "multi"))
        val result = copy(raw); val field = rows(result.getJSONArray("fields")).single { it.getString("key") == id }
        if (field.getString("type") == type) return result
        field.put("type", type).put("options", JSONArray())
        rows(result.getJSONArray("tasks")).forEach { it.getJSONObject("customValues").remove(id) }
        return result
    }
    fun reparentTask(raw: JSONObject, id: String, parent: String?): JSONObject {
        val result = copy(raw); val all = rows(result.getJSONArray("tasks")); val task = all.single { it.getString("key") == id }
        if (parent != null) require(all.any { it.getString("key") == parent && it.getString("projectKey") == task.getString("projectKey") } && parent !in descendants(raw, "tasks", id))
        require(raw.getString("kind") != "task" || parent != null || all.none { it.getString("key") != id && it.isNull("parentKey") })
        task.put("parentKey", parent ?: JSONObject.NULL)
        val remaining = all.toMutableList(); val ordered = mutableListOf<JSONObject>(); val added = mutableSetOf<String>()
        while (remaining.isNotEmpty()) {
            val row = remaining.firstOrNull { it.isNull("parentKey") || it.getString("parentKey") in added } ?: error("TASK_RELATION_CYCLE")
            remaining.remove(row); ordered.add(row); added.add(row.getString("key"))
        }
        result.put("tasks", JSONArray(ordered)); return result
    }
    fun addTask(raw: JSONObject, project: String, title: String = "", parent: String? = null): Pair<JSONObject, String> {
        val result = copy(raw); val owner = rows(result.getJSONArray("projects")).single { it.getString("key") == project }
        val status = rows(owner.getJSONArray("statuses")).firstOrNull { !it.getBoolean("isDone") } ?: error("TEMPLATE_OPEN_STATUS_REQUIRED")
        val id = UUID.randomUUID().toString()
        if (parent != null) require(rows(result.getJSONArray("tasks")).any { it.getString("key") == parent && it.getString("projectKey") == project })
        require(raw.getString("kind") != "task" || parent != null || rows(raw.getJSONArray("tasks")).none { it.isNull("parentKey") })
        require(result.getJSONArray("tasks").length() < 500)
        result.getJSONArray("tasks").put(SharedTemplateManifest.newTask(id, project, status.getString("key"), title).put("parentKey", parent ?: JSONObject.NULL))
        return result to id
    }
}
