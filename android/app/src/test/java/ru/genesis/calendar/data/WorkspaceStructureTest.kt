package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test

class WorkspaceStructureTest {
    @Test fun webCompatibleStructureRoundtripAndOrdering() {
        val parent=GenesisProject("p1",null,"work","Проект","Описание",listOf("важно"),"active",1)
        val child=GenesisProject("p2","p1","work","Подпроект","",emptyList(),"completed",0)
        val structure=WorkspaceStructure(projects=listOf(child,parent),
            taskListLinks=listOf(TaskListProjectLink("google-list", "p2")))
        val encoded=WorkspaceStructureCodec.encode(structure)
        val decoded=WorkspaceStructureCodec.decode(encoded)
        assertEquals(structure,decoded)
        assertEquals(listOf("p1" to 0,"p2" to 1),WorkspaceStructureCodec.ordered(decoded).map { it.first.id to it.second })
        assertEquals("personal",decoded.categories.first().id)
        assertTrue(encoded.contains("\"taskListLinks\""))
        assertFalse(encoded.contains("revision")) // local CAS is not part of the encrypted web document
    }

    @Test fun rejectsCycleDanglingReferencesAndDuplicateIds() {
        val root=GenesisProject("a",null,null,"A","",emptyList(),"active",0)
        val child=root.copy(id="b",parentId="a",title="B")
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceStructureCodec.encode(WorkspaceStructure(projects=listOf(root.copy(parentId="b"),child)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceStructureCodec.encode(WorkspaceStructure(projects=listOf(root.copy(categoryId="missing"))))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceStructureCodec.encode(WorkspaceStructure(projects=listOf(root,root)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceStructureCodec.encode(WorkspaceStructure(taskListLinks=listOf(TaskListProjectLink("g","missing"))))
        }
    }

    @Test fun mergingStructureKeepsOtherEncryptedWorkspaceSections() {
        val cloud="""{"projects":[],"categories":[],"taskListLinks":[],"habits":[{"id":"h1"}],"moodEntries":[{"id":"m1"}],"syncMetadata":{"version":3},"futureSection":{"keep":true}}"""
        val project=GenesisProject("p1",null,"work","Рабочий","",emptyList(),"active",0)
        val merged=org.json.JSONObject(WorkspaceStructureCodec.mergeIntoDecryptedWorkspace(cloud,
            WorkspaceStructure(projects=listOf(project))))
        assertEquals("p1",merged.getJSONArray("projects").getJSONObject(0).getString("id"))
        assertEquals("h1",merged.getJSONArray("habits").getJSONObject(0).getString("id"))
        assertEquals("m1",merged.getJSONArray("moodEntries").getJSONObject(0).getString("id"))
        assertEquals(3,merged.getJSONObject("syncMetadata").getInt("version"))
        assertTrue(merged.getJSONObject("futureSection").getBoolean("keep"))
    }

    @Test fun preProjectTaskRecordStillOpensInInbox() {
        val previous="""{"title":"Старая задача","description":"описание","dueDate":"2026-09-23","time":"","zoneId":"Europe/Moscow","priority":5,"reminderAt":null}"""
        val task=LocalTask.from(TaskRecord("local","old",previous,4,false),previous)
        assertEquals("Старая задача",task.title)
        assertNull(task.projectId)
        assertNull(task.categoryId)
        assertEquals("",task.project)
        assertEquals(4,task.revision)
    }

    @Test fun projectSubtreeDeletionIncludesEveryNestedDescendantOnly() {
        val root=GenesisProject("root",null,null,"Root","",emptyList(),"active",0)
        val child=root.copy(id="child",parentId="root",title="Child")
        val grandchild=root.copy(id="grandchild",parentId="child",title="Grandchild")
        val sibling=root.copy(id="sibling",title="Sibling")

        assertEquals(setOf("root","child","grandchild"),
            WorkspaceStructureCodec.projectSubtreeIds(listOf(root,child,grandchild,sibling),"root"))
        assertEquals(emptySet<String>(),
            WorkspaceStructureCodec.projectSubtreeIds(listOf(root),"missing"))
    }
}
