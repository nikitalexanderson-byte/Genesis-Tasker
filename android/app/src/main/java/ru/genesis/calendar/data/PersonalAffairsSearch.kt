package ru.genesis.calendar.data

import org.json.JSONObject

/** Filters the caller's ordered, account-scoped tasks without changing their ownership. */
internal fun searchPersonalAffairs(tasks: List<LocalTask>, structure: WorkspaceStructure,
    lists: List<GoogleTaskList>, query: String, categoryId: String?): List<LocalTask> {
    val terms = query.trim().split(Regex("\\s+")).filter(String::isNotBlank)
    val projects = structure.projects.associateBy { it.id }
    return tasks.filter { task ->
        val project = projects[personalTaskProjectId(task, structure)]
        val inCategory = categoryId == null || (project?.categoryId ?: task.categoryId) == categoryId
        if (!inCategory) return@filter false
        val tags = runCatching {
            val values = JSONObject(task.sourceFieldsJson).optJSONArray("tags")
            (0 until (values?.length() ?: 0)).map { "#${values?.optString(it).orEmpty().removePrefix("#")}" }
        }.getOrDefault(emptyList())
        val fields = listOf(task.title, task.description, project?.title.orEmpty()) + tags +
            lists.filter { task.belongsToList(it) }.map { it.title }
        terms.all { term -> fields.any { it.contains(term, ignoreCase = true) } }
    }
}
