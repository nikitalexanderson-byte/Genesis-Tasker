package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test
import ru.genesis.calendar.auth.allowedAssistantRoute
import ru.genesis.calendar.auth.LinkedGoogleAccount
import java.time.LocalDate

class AssistantPlanProtocolTest {
    private val today = LocalDate.of(2026, 10, 26)
    private fun project(title: String, parent: String = "") = JSONObject().put("title", title).put("parentProject", parent)
        .put("description", "").put("category", "").put("tags", JSONArray())
    private fun task() = JSONObject().put("title", "Прочитать длинное русское название задачи")
        .put("description", "Сохранить весь текст").put("startDate", "2026-10-27").put("dueDate", "2026-10-28")
        .put("time", "18:30").put("project", "Книга").put("taskList", "").put("tags", JSONArray().put("чтение"))
        .put("priority", 5).put("reminderMinutes", 30)
    private fun plan() = JSONObject().put("projects", JSONArray().put(project("Книга"))).put("taskLists", JSONArray()).put("tasks", JSONArray().put(task()))
    private fun valid(value: JSONObject, structure: WorkspaceStructure = WorkspaceStructure()) = runCatching {
        AssistantPlanProtocol.validate(value, structure, emptyList(), emptyList(), today)
    }.isSuccess
    @Test fun acceptsFutureTaskAndNestedProjects() {
        val plan = plan(); plan.getJSONArray("projects").put(project("Глава", "Книга"))
        assertTrue(valid(plan))
    }
    @Test fun rejectsCycleBeforeCreation() {
        val plan = plan(); plan.put("projects", JSONArray().put(project("Книга", "Глава")).put(project("Глава", "Книга")))
        assertFalse(valid(plan))
    }
    @Test fun rejectsAmbiguousExistingProjectAndMissingTaskDestination() {
        val project = GenesisProject("a", null, null, "Книга", "", emptyList(), "active", 0)
        assertFalse(valid(plan(), WorkspaceStructure(projects = listOf(project, project.copy(id = "b")))))
        val plan = plan(); plan.getJSONArray("tasks").getJSONObject(0).put("taskList", "Неизвестный список")
        assertFalse(valid(plan))
    }
    @Test fun rejectsPastInvalidAndReversedDates() {
        for ((start, end) in listOf("2026-10-25" to "2026-10-27", "2026-02-30" to "2026-11-01", "2026-10-28" to "2026-10-27")) {
            val plan = plan(); plan.getJSONArray("tasks").getJSONObject(0).put("startDate", start).put("dueDate", end)
            assertFalse(valid(plan))
        }
    }
    @Test fun transportAllowsOnlyExactStatusAndPlan() {
        assertTrue(allowedAssistantRoute("GET", "/assistant/status"))
        assertTrue(allowedAssistantRoute("POST", "/assistant/plan"))
        assertFalse(allowedAssistantRoute("DELETE", "/assistant/plan"))
        assertFalse(allowedAssistantRoute("GET", "/assistant/status?url=https://example.com"))
    }
    @Test fun listAccountIsExplicitAndNeverFallsBackToAnotherAccountsNamesake() {
        val accounts = listOf(LinkedGoogleAccount("a", "a@example.com", "A", true, true, true), LinkedGoogleAccount("b", "b@example.com", "B", false, true, true))
        val existing = listOf(GoogleTaskList("list-a", "Работа", "a", "a@example.com"))
        val row = JSONObject().put("title", "Работа").put("project", "").put("accountEmail", "b@example.com")
        assertNull(AssistantPlanProtocol.resolveList(row, existing, accounts))
        val plan = plan().put("taskLists", JSONArray().put(row))
        AssistantPlanProtocol.validate(plan, WorkspaceStructure(), existing, accounts, today)
        row.put("accountEmail", "")
        assertTrue(runCatching { AssistantPlanProtocol.validate(plan, WorkspaceStructure(), existing, accounts, today) }.isFailure)
    }
    @Test fun duplicatedParentNamesCannotChooseAnArbitraryProject() {
        val existing = GenesisProject("a", null, null, "Родитель", "", emptyList(), "active", 0)
        val plan = plan().put("projects", JSONArray().put(project("Дочерний", "Родитель"))).put("tasks", JSONArray())
        assertFalse(valid(plan, WorkspaceStructure(projects = listOf(existing, existing.copy(id = "b")))))
    }
}
