package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode

class PersonalAffairsRoutingTest {
    private val list = GoogleTaskList("list", "Reading", "account-a")
    private val task = LocalTask("task", "Read", sourceFieldsJson = listTaskFields(list, CalendarMode.LUNAR).toString())
    private val structure = WorkspaceStructure(projects = listOf(
        GenesisProject("project", null, null, "Project", "", emptyList(), "active", 0)),
        taskListLinks = listOf(TaskListProjectLink("list", "project")))

    @Test fun listMembershipKeepsGoogleAccountsSeparate() {
        assertTrue(task.belongsToList(list))
        assertFalse(task.belongsToList(list.copy(accountId = "account-b")))
        assertFalse(task.belongsToList(list.copy(id = "other-list")))
    }
    @Test fun explicitChaosPlacementWinsOverTheListProject() {
        assertEquals("project", personalTaskProjectId(task, structure))
        assertNull(personalTaskProjectId(task.copy(projectId = "__genesis_inbox__"), structure))
        assertNull(personalTaskProjectId(task.copy(projectId = "deleted-project"), structure))
        assertNull(personalTaskProjectId(task, WorkspaceStructure()))
        assertEquals("project", personalTaskProjectId(task.copy(projectId = "project"), structure))
    }
}
