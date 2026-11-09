package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.genesis.calendar.data.GenesisCategory
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.WorkspaceStructure

class PersonalProjectTransferTest {
    @Test fun nestedProjectPayloadKeepsEachTaskAndCategoryInItsOwnProject() {
        val root = GenesisProject("root", null, "work", "Главный", "Описание", listOf("команда"), "active", 0)
        val child = GenesisProject("child", "root", "work", "Вложенный", "", emptyList(), "active", 0)
        val unrelated = GenesisProject("other", null, null, "Другой", "", emptyList(), "active", 1)
        val structure = WorkspaceStructure(projects = listOf(root, child, unrelated),
            categories = listOf(GenesisCategory("work", "Работа", "#2d6c68", 0)))
        val tree = personalProjectTree(root, structure)
        assertEquals(listOf("root", "child"), tree.map { it.id })
        val task = LocalTask(id = "task-1", title = "  Проверить   перенос  ", projectId = "child",
            categoryId = "work", date = "2026-10-12")
        val payload = personalProjectImportPayload(root, tree, listOf(task), structure.categories,
            "00000000-0000-0000-0000-000000000001", "copy", "destination", "board")
        val projects = payload.getJSONArray("projects")
        assertTrue(projects.getJSONObject(0).isNull("parentSourceId"))
        assertEquals("команда", projects.getJSONObject(0).getJSONArray("tags").getString(0))
        assertEquals("destination", payload.getString("targetParentId"))
        assertEquals("board", payload.getString("targetStatusId"))
        assertEquals("root", projects.getJSONObject(1).getString("parentSourceId"))
        val categories = payload.getJSONArray("categories")
        assertEquals(2, categories.length())
        assertEquals("child", categories.getJSONObject(1).getString("projectSourceId"))
        val publishedTask = payload.getJSONArray("tasks").getJSONObject(0)
        assertEquals("child", publishedTask.getString("projectSourceId"))
        assertEquals("work", publishedTask.getString("categorySourceId"))
        assertEquals("Проверить перенос", publishedTask.getString("title"))
        assertFalse(publishedTask.getBoolean("done"))
    }
}
