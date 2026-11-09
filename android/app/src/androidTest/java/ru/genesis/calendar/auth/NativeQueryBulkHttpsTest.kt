package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.ui.SharedBulkState
import java.util.UUID

class NativeQueryBulkHttpsTest {
    private val fixture = QueryBulkHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun state(origin: JSONObject = fixture.origin()) = SharedBulkState(fixture.gateway, SharedBulkProtocol.QUERY_SCOPE, origin.getJSONObject("filter"), origin.getString("sort"),
        SharedBulkFormData.initial().saved(), "", {}, {}, {}, {}, origin, fixture.calendar())
    @Test fun lostAllResultsPreviewReplaysAfterTheSavedViewIsDeletedAndALaterQueueAppears() = runBlocking {
        val base = fixture.base
        val edit = fixture.views.edit().apply { getJSONObject("definition").put("filter", fixture.origin().getJSONObject("filter")) }
        val view = fixture.views.save(edit)
        val origin = fixture.origin().put("filter", JSONObject().put("savedViewId", view.getString("id"))).put("sort", "position")
        val first = state(origin); first.load(); assertEquals(4, first.tasks!!.getInt("total")); first.selectAll(); first.configureQuery()
        fixture.loseReply = true; first.preview(); assertEquals("pending", first.phase); assertEquals(1, fixture.sent.size)
        base.client.sendSharedSavedView(base.generation, SavedViewProtocol.command(SavedViewProtocol.newEdit(view.getJSONObject("definition"), view).put("kind", "view-delete"), UUID.randomUUID().toString()))
        fixture.queued = true
        val recovered = state(fixture.origin("Другая выборка")); recovered.load(); assertNull(recovered.tasks); assertEquals(0, fixture.projectReads)
        recovered.retry(); assertEquals("received", recovered.phase); assertEquals(fixture.sent[0], fixture.sent[1]); assertEquals(4, recovered.report!!.getJSONObject("counts").getInt("selected"))
        recovered.command("confirm"); assertEquals("BULK_LOCAL_QUEUE", recovered.error)
        fixture.queued = false; val report = fixture.finish(recovered.operationId); assertEquals(4, report.getJSONObject("counts").getInt("succeeded"))
        fixture.tasks.forEach { task -> assertEquals(0, base.client.sharedTask(base.generation, task.getString("projectId"), task.getString("id")).getJSONObject("task").getInt("priority")) }
    }
    @Test fun explicitPageStatusMappingAppliesEachProjectsOwnStatusWithoutFetchingAllTasks() = runBlocking {
        val state = state(); state.load(); state.change(state.form.selectPage(fixture.tasks.take(2))); state.configureQuery()
        var form = state.form.change("kind", "status")
        val expected = state.scopeProjects.associate { project ->
            val status = PlanningLifecycle.rows(project.getJSONArray("statuses")).last { !it.getBoolean("isDone") }.getString("id")
            form = form.status(project.getString("id"), status); project.getString("id") to status
        }
        state.change(form); assertTrue(state.ready); state.preview(); assertEquals("received", state.phase)
        assertEquals(expected.keys, JSONObject(fixture.sent.single()).getJSONObject("action").getJSONObject("statusIds").keys().asSequence().toSet())
        val report = fixture.finish(state.operationId); assertEquals(2, report.getJSONObject("counts").getInt("succeeded"))
        fixture.tasks.take(2).forEach { task -> assertEquals(expected[task.getString("projectId")], fixture.base.client.sharedTask(fixture.base.generation, task.getString("projectId"), task.getString("id")).getJSONObject("task").getString("statusId")) }
    }
    @Test fun encryptedIncompleteInputSurvivesNewStorageAndRevokedProjectCannotEnterPageScope() = runBlocking {
        val state = state(); state.load(); state.change(state.form.change("kind", "due").change("dueMode", "shift").change("days", "-")); assertTrue(state.saveInput())
        val restored = state(fixture.origin("Новая выборка")); restored.load(); assertEquals("-", restored.form.text("days")); assertEquals("lunar", JSONObject(restored.calendarJson!!).getString("mode"))
        assertFalse(restored.ready); assertTrue(fixture.sent.isEmpty())
        val raw = fixture.base.app.getSharedPreferences("genesis.shared.bulk-input.v1", 0).all.values.joinToString()
        assertFalse(raw.contains("Задачи двух проектов")); assertFalse(raw.contains("dueMode"))
        val base = fixture.base
        val invitation = base.client.inviteSharedMember(base.generation, base.project, JSONObject().put("email", "improvements-viewer@example.invalid").put("role", "viewer"))
        base.viewer { viewer, generation ->
            viewer.acceptSharedInvitation(generation, JSONObject().put("id", invitation.getJSONObject("invitation").getString("id")))
            val refs = JSONObject().put("mode", "page").put("items", JSONArray(fixture.tasks.take(2).map(SharedBulkProtocol::reference)))
            assertThrows(Exception::class.java) { viewer.sharedBulkScope(generation, refs, null) }
            base.client.removeSharedMember(base.generation, base.project, viewer.session(generation).getJSONObject("user").getString("uid"))
            assertThrows(Exception::class.java) { viewer.querySharedTasks(generation, JSONObject().put("projectIds", JSONArray().put(base.project)), null) }
        }
        Unit
    }
}
