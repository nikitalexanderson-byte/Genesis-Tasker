package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.util.UUID

class NativeBWorkflowsHttpsTest {
    private val fixture = TemplateHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()

    @Test fun checklistsChildrenZeroPriorityAndConversionUseRealServerGuards() {
        val client = fixture.client; val gen = fixture.generation; val project = fixture.project
        val statuses = client.sharedProject(gen, project).getJSONArray("statuses")
        val open = (0 until statuses.length()).map(statuses::getJSONObject).first { it.optInt("isDone") == 0 }.getString("id")
        val done = (0 until statuses.length()).map(statuses::getJSONObject).first { it.optInt("isDone") == 1 }.getString("id")
        val lists = JSONArray().put(JSONObject().put("id", "native-list").put("title", "Перед выпуском").put("items",
            JSONArray().put(JSONObject().put("id", "native-item").put("title", "Проверить сохранение").put("done", false)
                .put("assigneeId", JSONObject.NULL).put("dueDate", JSONObject.NULL).put("linkedTaskId", JSONObject.NULL))))
        var parent = client.createSharedTask(gen, project, JSONObject().put("title", "Родитель").put("statusId", open)
            .put("priority", 0).put("checklists", lists)).getJSONObject("task")
        var child = client.createSharedTask(gen, project, JSONObject().put("title", "Подзадача").put("statusId", open)
            .put("parentTaskId", parent.getString("id"))).getJSONObject("task")
        fun patch(row: JSONObject, changes: JSONObject) = client.updateSharedTask(gen, project, row.getString("id"),
            changes.put("expectedRevision", row.getInt("revision"))).getJSONObject("task")
        fun rejected(row: JSONObject, changes: JSONObject, code: String) {
            val error = runCatching { patch(row, changes) }.exceptionOrNull()
            assertTrue("Expected the server's typed task error", error is AuthApiError)
            assertEquals(code, (error as AuthApiError).code)
        }
        rejected(parent, JSONObject().put("parentTaskId", child.getString("id")), "TASK_RELATION_CYCLE")
        child = patch(child, JSONObject().put("statusId", done))
        parent = client.sharedTask(gen, project, parent.getString("id")).getJSONObject("task")
        rejected(parent, JSONObject().put("statusId", done), "TASK_CHECKLIST_INCOMPLETE")
        val operation = UUID.randomUUID().toString()
        val first = client.convertSharedChecklist(gen, project, parent.getString("id"), "native-item", parent.getInt("revision"), operation)
        val repeat = client.convertSharedChecklist(gen, project, parent.getString("id"), "native-item", parent.getInt("revision"), operation)
        assertEquals(first.getString("taskId"), repeat.getString("taskId"))
        parent = client.sharedTask(gen, project, parent.getString("id")).getJSONObject("task")
        assertEquals(0, parent.getInt("priority"))
        assertEquals(first.getString("taskId"), parent.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("linkedTaskId"))
        assertEquals(parent.getString("id"), client.sharedTask(gen, project, child.getString("id")).getJSONObject("task").getString("parentTaskId"))
        val matching = client.querySharedTasks(gen, JSONObject().put("projectIds", JSONArray().put(project))
            .put("priority", JSONArray().put(0)), null).getJSONArray("tasks")
        assertTrue((0 until matching.length()).any { matching.getJSONObject(it).getString("id") == parent.getString("id") })
        assertTrue((0 until matching.length()).all { matching.getJSONObject(it).getInt("priority") == 0 })
    }

    @Test fun notificationConflictPreservesFalseZeroAndIndependentChangesAndWatchIsIdempotent() {
        val client = fixture.client; val gen = fixture.generation
        val original = client.notificationSettings(gen)
        try {
            val own = JSONObject(original.getJSONObject("settings").toString()).put("reminderDays", 0)
            own.getJSONObject("types").put("comments", false)
            val independent = JSONObject(original.getJSONObject("settings").toString()).put("timeZoneMode", "fixed").put("timeZone", "Asia/Tokyo")
            val remote = client.saveNotificationSettings(gen, independent, original.getInt("revision"))
            val conflict = runCatching { client.saveNotificationSettings(gen, own, original.getInt("revision")) }.exceptionOrNull()
            assertTrue(conflict is AuthFailure)
            assertEquals(AuthFailure.Kind.CONFLICT, (conflict as AuthFailure).kind)
            val rebased = rebaseNotificationSettings(original.getJSONObject("settings"), own, remote.getJSONObject("settings"))
            val saved = client.saveNotificationSettings(gen, rebased, remote.getInt("revision")).getJSONObject("settings")
            assertEquals(0, saved.getInt("reminderDays")); assertFalse(saved.getJSONObject("types").getBoolean("comments"))
            assertEquals("Asia/Tokyo", saved.getString("timeZone"))
            val status = client.sharedProject(gen, fixture.project).getJSONArray("statuses").getJSONObject(0).getString("id")
            val task = client.createSharedTask(gen, fixture.project, JSONObject().put("title", "Наблюдение").put("statusId", status)).getJSONObject("task")
            val before = client.sharedTaskWatch(gen, fixture.project, task.getString("id"), null).getBoolean("watching")
            repeat(2) { assertEquals(!before, client.sharedTaskWatch(gen, fixture.project, task.getString("id"), !before).getBoolean("watching")) }
            assertEquals(before, client.sharedTaskWatch(gen, fixture.project, task.getString("id"), before).getBoolean("watching"))
        } finally {
            val current = client.notificationSettings(gen)
            client.saveNotificationSettings(gen, original.getJSONObject("settings"), current.getInt("revision"))
        }
    }
}
