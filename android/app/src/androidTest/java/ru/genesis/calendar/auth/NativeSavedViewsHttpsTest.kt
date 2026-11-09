package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.ui.SharedTaskListReader
import java.util.UUID

/** Actual Android transport, encrypted journal, view ACL and cross-project task query. */
class NativeSavedViewsHttpsTest {
    private val fixture = SavedViewHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun task(project: String, index: Int, values: JSONObject = JSONObject()): JSONObject {
        val base = fixture.base; val status = base.client.sharedProject(base.generation, project).getJSONArray("statuses").getJSONObject(0).getString("id")
        return base.client.createSharedTask(base.generation, project, JSONObject().put("title", "B5 Android task $index").put("statusId", status)
            .put("customFields", values).put("priority", index % 4).put("dueDate", if (index % 2 == 0) "2026-10-21" else "2026-10-22")).getJSONObject("task")
    }
    @Test fun savedFieldConditionsReadEveryProjectPageWithExactCountsAndTypedZero() {
        val base = fixture.base
        val field = JSONObject().put("id", UUID.randomUUID().toString()).put("title", "B5 numeric 🌿").put("type", "number").put("projectId", JSONObject.NULL)
            .put("options", JSONArray()).put("position", 0).put("required", false).put("showCard", true).put("showList", true).put("archived", false).put("expectedRevision", 0)
        val review = base.client.previewSharedFieldDefinition(base.generation, base.space, base.project, field)
        base.client.saveSharedFieldDefinition(base.generation, base.space, field.put("fingerprint", review.getString("fingerprint")).put("operationId", UUID.randomUUID().toString()).put("replaceType", false))
        val second = base.client.createSharedProject(base.generation, base.space, JSONObject().put("title", "B5 second project").put("layout", "list")).getJSONObject("project").getString("id")
        val expected = (0..102).map { index -> task(if (index % 2 == 0) base.project else second, index, JSONObject().put(field.getString("id"), 0)).getString("id") }.toSet()
        val edit = fixture.edit().apply { getJSONObject("definition").put("sort", "custom:${field.getString("id")}:asc").getJSONObject("filter")
            .put("projectIds", JSONArray().put(base.project).put(second)).put("customFields", JSONArray().put(JSONObject().put("fieldId", field.getString("id")).put("op", "eq").put("value", 0))) }
        val view = fixture.save(edit); val filter = JSONObject().put("savedViewId", view.getString("id"))
        val first = fixture.query(filter); assertEquals(103, first.getInt("total")); assertEquals(100, first.getJSONArray("tasks").length())
        val next = fixture.query(filter, first.getString("nextCursor"))
        val ids = (PlanningLifecycle.rows(first.getJSONArray("tasks")) + PlanningLifecycle.rows(next.getJSONArray("tasks"))).map { it.getString("id") }
        assertEquals(103, ids.size); assertEquals(expected, ids.toSet()); assertEquals(52, first.getJSONObject("dateCounts").getInt("2026-10-21"))
        assertEquals(1, first.getJSONArray("tasks").getJSONObject(0).getInt("revision")); assertEquals("lunar", view.getJSONObject("definition").getString("calendarMode"))
        val fields = base.client.sharedSavedViewFields(base.generation, base.space).getJSONArray("fields")
        assertTrue(PlanningLifecycle.rows(fields).any { it.getString("id") == field.getString("id") })
    }
    @Test fun lostCreateRenameAndDeleteRepliesReplayExactJournalCommandsAndStaleRevisionFails() {
        var service = fixture.service(); val local = service.save(null, fixture.edit()); val pending = service.prepare(local.getString("stamp"))
        fixture.loseReply = true; assertThrows(Exception::class.java) { service.send(pending.getString("stamp")) }
        service = fixture.service(); val restored = service.load()!!; val command = restored.getString("command")
        val received = service.send(restored.getString("stamp")); val view = received.getJSONObject("receipt").getJSONObject("view")
        assertEquals(command, fixture.commands.last()); assertEquals(fixture.commands.first(), fixture.commands.last()); service.remove(received.getString("stamp"))
        val edit = SavedViewProtocol.newEdit(SavedViewProtocol.copy(view.getJSONObject("definition")).put("title", "B5 Android renamed"), view)
        var record = service.save(null, edit); record = service.prepare(record.getString("stamp")); record = service.send(record.getString("stamp")); service.remove(record.getString("stamp"))
        assertEquals(2, record.getJSONObject("receipt").getJSONObject("view").getInt("revision"))
        val stale = runCatching { fixture.base.client.sendSharedSavedView(fixture.base.generation, SavedViewProtocol.command(edit, UUID.randomUUID().toString())) }.exceptionOrNull()
        assertTrue(stale is AuthApiError && stale.code == "VIEW_CONFLICT")
        val current = fixture.base.client.sharedSavedView(fixture.base.generation, view.getString("id"))
        record = service.save(null, SavedViewProtocol.newEdit(current.getJSONObject("definition"), current).put("kind", "view-delete")); record = service.prepare(record.getString("stamp"))
        fixture.loseReply = true; assertThrows(Exception::class.java) { service.send(record.getString("stamp")) }
        val recovered = fixture.service().load()!!; val done = fixture.service().send(recovered.getString("stamp"))
        assertTrue(done.getJSONObject("receipt").getBoolean("ok")); assertEquals(fixture.commands[fixture.commands.size - 2], fixture.commands.last())
        assertThrows(Exception::class.java) { fixture.base.client.sharedSavedView(fixture.base.generation, view.getString("id")) }
    }
    @Test fun sharedViewGrantsNoProjectRightsAndRevokedMetadataCannotLeaveTaskCounts() = runBlocking {
        val base = fixture.base; task(base.project, 1)
        val shared = fixture.save(fixture.edit(shared = true)); val personal = fixture.save(fixture.edit("B5 Android private"))
        val invitation = base.client.inviteSharedMember(base.generation, base.project, JSONObject().put("email", "improvements-viewer@example.invalid").put("role", "viewer"))
        base.viewer { viewer, generation ->
            viewer.acceptSharedInvitation(generation, JSONObject().put("id", invitation.getJSONObject("invitation").getString("id")))
            val visible = viewer.sharedSavedViews(generation, null).getJSONArray("views")
            assertTrue(PlanningLifecycle.rows(visible).any { it.getString("id") == shared.getString("id") })
            assertFalse(PlanningLifecycle.rows(visible).any { it.getString("id") == personal.getString("id") })
            assertFalse(viewer.sharedSavedView(generation, shared.getString("id")).getBoolean("canEdit"))
            val edit = SavedViewProtocol.newEdit(shared.getJSONObject("definition"), shared)
            assertThrows(Exception::class.java) { viewer.sendSharedSavedView(generation, SavedViewProtocol.command(edit, UUID.randomUUID().toString())) }
            val reader = SharedTaskListReader(object : SharedWorkspaceGateway {
                override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String) = viewer.querySharedTasks(generation, filter, cursor, sort)
            })
            runBlocking {
                reader.configure(JSONObject().put("savedViewId", shared.getString("id")), "position", "shared"); reader.refresh()
                assertEquals(1, reader.pageState.value!!.getInt("total"))
                val viewerId = viewer.session(generation).getJSONObject("user").getString("uid")
                base.client.removeSharedMember(base.generation, base.project, viewerId); reader.refresh()
                assertNull(reader.pageState.value); assertTrue(reader.error.isNotBlank())
                assertThrows(Exception::class.java) { viewer.querySharedTasks(generation, JSONObject().put("savedViewId", shared.getString("id")), null) }
            }
        }
        Unit
    }
}
