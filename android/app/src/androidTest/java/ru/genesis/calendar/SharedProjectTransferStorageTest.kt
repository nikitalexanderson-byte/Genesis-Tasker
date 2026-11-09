package ru.genesis.calendar

import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.WorkspaceStructureRepository

class SharedProjectTransferStorageTest {
    @Test fun localMoveRollsBackOnConflictAndThenRemovesWholeTree() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val structure = WorkspaceStructureRepository(app)
        val root = GenesisProject(UUID.randomUUID().toString(), null, null,
            "Тест переноса", "", emptyList(), "active", 0)
        val child = GenesisProject(UUID.randomUUID().toString(), root.id, null,
            "Подпроект", "", emptyList(), "active", 0)
        val task = LocalTask(title = "Проверка переноса", projectId = child.id)
        try {
            structure.saveProject(root)
            structure.saveProject(child)
            val saved = app.repository.save(task)
            val revision = structure.workspace.first().revision
            try {
                structure.removeImportedProjectTree(root.id, revision, setOf(root.id, child.id),
                    mapOf(saved.id to saved.revision + 1))
                fail("A changed task revision must stop the entire local move")
            } catch (_: IllegalArgumentException) { }
            assertNotNull(app.repository.get(saved.id))
            assertTrue(structure.workspace.first().projects.any { it.id == root.id })
            structure.removeImportedProjectTree(root.id, revision, setOf(root.id, child.id),
                mapOf(saved.id to saved.revision))
            assertNull(app.repository.get(saved.id))
            assertFalse(structure.workspace.first().projects.any { it.id in setOf(root.id, child.id) })
        } finally {
            app.repository.get(task.id)?.let { app.repository.delete(it.id, it.revision) }
            if (structure.workspace.first().projects.any { it.id == root.id }) structure.deleteProject(root.id)
        }
    }
}
