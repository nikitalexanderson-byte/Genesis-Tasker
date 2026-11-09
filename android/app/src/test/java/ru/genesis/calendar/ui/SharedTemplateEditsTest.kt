package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.SharedTemplateManifest
import ru.genesis.calendar.auth.templateRich

class SharedTemplateEditsTest {
    @Test fun actualProjectMembersAndPreviewMembersKeepTheirOwnIdentityAndDisplayName() {
        val member = JSONObject().put("userId", "member:actual").put("displayName", "Real project member")
        assertEquals("member:actual", templateMemberId(member)); assertEquals("Real project member", templateMemberTitle(member))
        val preview = JSONObject().put("id", "member:preview").put("title", "Preview member")
        assertEquals("member:preview", templateMemberId(preview)); assertEquals("Preview member", templateMemberTitle(preview))
    }
    @Test fun androidGmtDefaultsHavePortableEquivalentRulesWhileRegionalTimeZonesStayIntact() {
        val prefs = ru.genesis.calendar.data.UiPreferences()
        for (id in listOf("GMT", "Z", "UTC")) {
            val calendar = SharedCustomCalendar.initial(prefs, java.time.ZoneId.of(id))
            assertEquals("UTC", calendar.context.timeZone)
            assertNotNull(ru.genesis.calendar.auth.DataExportProtocol.timeZone(calendar.context.timeZone))
        }
        for (id in listOf("Europe/Moscow", "America/New_York")) assertEquals(id,
            SharedCustomCalendar.initial(prefs, java.time.ZoneId.of(id)).context.timeZone)
    }
    @Test fun aConfirmedFieldTypeChangeClearsOnlyThatFieldsValuesAndOptionsWithoutMutatingTheOriginal() {
        val source = templateRich(); val before = source.toString()
        val unchanged = SharedTemplateEdits.changeFieldType(source, "field:number", "number")
        assertEquals(before, unchanged.toString())
        val changed = SharedTemplateEdits.changeFieldType(source, "field:number", "text")
        val task = changed.getJSONArray("tasks").getJSONObject(0)
        assertFalse(task.getJSONObject("customValues").has("field:number"))
        assertEquals(false, task.getJSONObject("customValues").get("field:checkbox"))
        assertEquals("text", SharedTemplateEdits.rows(changed.getJSONArray("fields")).single { it.getString("key") == "field:number" }.getString("type"))
        assertEquals(before, source.toString())
        assertThrows(IllegalArgumentException::class.java) { SharedTemplateEdits.changeFieldType(source, "field:number", "executable") }
    }
    @Test fun removingABranchClearsOnlyItsDependentReferencesAndLeavesTheInputUntouched() {
        val source = templateRich(); val before = source.toString()
        val result = SharedTemplateEdits.removeTasks(source, SharedTemplateEdits.descendants(source, "tasks", "task:child"))
        SharedTemplateManifest.validate(result)
        assertEquals(3, result.getJSONArray("tasks").length())
        assertTrue(result.getJSONArray("tasks").getJSONObject(0).getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).isNull("linkedTaskKey"))
        assertEquals(before, source.toString())
        val project = SharedTemplateEdits.removeProject(source, "nested"); SharedTemplateManifest.validate(project)
        assertEquals(1, project.getJSONArray("projects").length()); assertEquals(3, project.getJSONArray("tasks").length())
        assertThrows(IllegalArgumentException::class.java) { SharedTemplateEdits.removeProject(source, "root") }
    }
    @Test fun statusCategoryLabelAndFieldRemovalKeepTheRemainingGraphValid() {
        val source = templateRich()
        val status = SharedTemplateEdits.removeStatus(source, "root", "root:open", "root:done")
        assertEquals("root:done", status.getJSONArray("projects").getJSONObject(1).getString("boardStatusKey"))
        assertEquals("root:done", status.getJSONArray("tasks").getJSONObject(0).getString("statusKey"))
        val category = SharedTemplateEdits.removeCategory(source, "root", "category:first"); SharedTemplateManifest.validate(category)
        assertTrue(category.getJSONArray("tasks").getJSONObject(0).isNull("categoryKey"))
        val label = SharedTemplateEdits.removeLabel(source, "label:first"); SharedTemplateManifest.validate(label)
        assertEquals(0, label.getJSONArray("projects").getJSONObject(0).getJSONArray("labelKeys").length())
        assertEquals(0, label.getJSONArray("tasks").getJSONObject(0).getJSONArray("labelKeys").length())
        val field = SharedTemplateEdits.removeField(source, "field:number"); SharedTemplateManifest.validate(field)
        assertFalse(field.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues").has("field:number"))
        assertEquals(false, field.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues").get("field:checkbox"))
    }
    @Test fun reparentingRejectsCyclesAndCrossProjectParentsAndCanMoveANodeAfterItsNewParent() {
        val source = templateRich()
        assertThrows(IllegalArgumentException::class.java) { SharedTemplateEdits.reparentTask(source, "task:parent", "task:child") }
        assertThrows(IllegalArgumentException::class.java) { SharedTemplateEdits.reparentTask(source, "task:nested", "task:parent") }
        val noDependency = SharedTemplateEdits.update(source, "tasks", "task:child") { it.put("dependsOnKeys", org.json.JSONArray()) }
        val moved = SharedTemplateEdits.reparentTask(noDependency, "task:parent", "task:leaf")
        SharedTemplateManifest.validate(moved)
        val rows = SharedTemplateEdits.rows(moved.getJSONArray("tasks"))
        assertTrue(rows.indexOfFirst { it.getString("key") == "task:leaf" } < rows.indexOfFirst { it.getString("key") == "task:parent" })
        assertTrue(rows.indexOfFirst { it.getString("key") == "task:parent" } < rows.indexOfFirst { it.getString("key") == "task:child" })
    }
    @Test fun aNewTaskCanBeCreatedInANewlyChosenSubprojectWithoutChangingExistingTasks() {
        val source = templateRich(); val created = SharedTemplateEdits.addTask(source, "nested", "Own nested task")
        SharedTemplateManifest.validate(created.first)
        val task = SharedTemplateEdits.rows(created.first.getJSONArray("tasks")).single { it.getString("key") == created.second }
        assertEquals("nested", task.getString("projectKey")); assertEquals("nested:open", task.getString("statusKey")); assertTrue(task.isNull("parentKey"))
        assertEquals(4, source.getJSONArray("tasks").length())
    }
}
