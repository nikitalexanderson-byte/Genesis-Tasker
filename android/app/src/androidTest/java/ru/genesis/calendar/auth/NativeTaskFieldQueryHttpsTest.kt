package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.ui.SharedTaskListReader

/** Actual Android HTTPS/PHP predicates, page boundaries, historical choices and reader ACL. */
class NativeTaskFieldQueryHttpsTest {
    private val fixture = FieldEditorHttpsFixture()
    private val fields = mutableMapOf<String, JSONObject>()
    @Before fun open() {
        fixture.open()
        for (type in CustomFieldProtocol.types) {
            val edit = CustomFieldEditorProtocol.newEdit(fixture.space, fixture.project).apply {
                getJSONObject("draft").put("title", "Поле $type").put("type", type).put("showList", true)
                    .put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "first").put("title", "Действующий").put("archived", false))
                        .put(JSONObject().put("id", "old").put("title", "Сохранённый исторический выбор").put("archived", false)) else JSONArray())
            }
            fields[type] = save(edit)
        }
    }
    @After fun close() { fixture.close() }
    private fun save(edit: JSONObject): JSONObject {
        val service = fixture.service(); val local = service.save(fixture.project, null, edit)
        val preview = service.preview(fixture.project, local.getString("stamp")); val pending = service.prepare(fixture.project, preview.getString("stamp"))
        val receipt = service.send(fixture.project, pending.getString("stamp")); service.remove(fixture.project, receipt.getString("stamp"))
        return receipt.getJSONObject("receipt").getJSONObject("field")
    }
    private fun id(type: String) = fields.getValue(type).getString("id")
    private fun filter() = JSONObject().put("projectIds", JSONArray().put(fixture.project))
    private fun query(filter: JSONObject, cursor: String? = null, sort: String = "position") = fixture.base.client.querySharedTasks(fixture.base.generation, filter, cursor, sort)
    private fun typed(type: String, op: String, value: Any?) = filter().put("customFields", JSONArray().put(CustomFieldQueryProtocol.criterion(fields.getValue(type), op, value)))
    private var status = ""
    private fun create(index: Int): JSONObject {
        if (status.isBlank()) status = fixture.snapshot().getJSONArray("statuses").getJSONObject(0).getString("id")
        val values = JSONObject().put(id("text"), if (index == 102) "needleBeyondPage" else "Запись $index")
            .put(id("select"), "old").put(id("multi"), JSONArray().put("old").put("first"))
            .put(id("date"), if (index % 2 == 0) "2026-10-21" else "2026-10-22").put(id("url"), "https://example.invalid/$index")
        if (index % 3 != 0) values.put(id("number"), if (index == 1) 0 else index).put(id("checkbox"), index % 2 == 0)
        return fixture.base.client.createSharedTask(fixture.base.generation, fixture.project, JSONObject().put("title", "Задача $index").put("statusId", status)
            .put("customFields", values).put("dueDate", if (index % 2 == 0) "2026-10-21" else "2026-10-22")).getJSONObject("task")
    }
    @Test fun allPagesTypedQueriesCountsAndSearchUseServerValuesIncludingHistoricalChoices() {
        val ids = (0..102).map { create(it).getString("id") }.toSet()
        val sort = "custom:${id("number")}:desc"
        val first = query(filter(), sort = sort); assertEquals(103, first.getInt("total")); assertEquals(100, first.getJSONArray("tasks").length()); assertTrue(first.getBoolean("hasMore"))
        val next = query(filter(), first.getString("nextCursor"), sort)
        val returned = listOf(first, next).flatMap { page -> PlanningLifecycle.rows(page.getJSONArray("tasks")).map { it.getString("id") } }
        assertEquals(103, returned.size); assertEquals(ids, returned.toSet()); assertEquals(52, first.getJSONObject("dateCounts").getInt("2026-10-21"))
        assertEquals(101.0, first.getJSONArray("tasks").getJSONObject(0).getJSONObject("customFields").getDouble(id("number")), 0.0)
        assertEquals(1, query(typed("number", "eq", "0")).getInt("total")); assertEquals(34, query(typed("checkbox", "eq", false)).getInt("total"))
        assertEquals(35, query(typed("checkbox", "missing", null)).getInt("total")); assertEquals(34, query(typed("checkbox", "ne", false)).getInt("total"))
        assertEquals(1, query(filter().put("q", "needleBeyondPage")).getInt("total")); assertEquals(51, query(typed("date", "gt", "2026-10-21")).getInt("total"))
        val old = fields.getValue("select")
        fields["select"] = save(CustomFieldEditorProtocol.newEdit(fixture.space, fixture.project, old).apply {
            getJSONObject("draft").getJSONArray("options").getJSONObject(1).put("archived", true)
        })
        assertEquals(103, query(typed("select", "eq", "old")).getInt("total")); assertEquals(103, query(filter().put("q", "исторический")).getInt("total"))
        assertEquals(103, query(typed("multi", "contains", JSONArray().put("old"))).getInt("total"))
        val changed = runCatching { query(filter(), first.getString("nextCursor"), sort) }.exceptionOrNull()
        assertTrue(changed is AuthApiError && changed.code == "SHARED_QUERY_CHANGED")
        val invalid = runCatching { query(filter().put("customFields", JSONArray().put(JSONObject().put("fieldId", id("checkbox")).put("op", "gt").put("value", false)))) }.exceptionOrNull()
        assertTrue(invalid is AuthApiError && invalid.code == "CUSTOM_FIELD_FILTER_INVALID")
    }
    @Test fun aProjectViewerCanReadAndFilterValuesButRevocationClearsTheNativePage() = runBlocking {
        create(1)
        val invitation = fixture.base.client.inviteSharedMember(fixture.base.generation, fixture.project,
            JSONObject().put("email", "improvements-viewer@example.invalid").put("role", "viewer"))
        fixture.base.viewer { viewer, generation ->
            viewer.acceptSharedInvitation(generation, JSONObject().put("id", invitation.getJSONObject("invitation").getString("id")))
            val snapshot = viewer.sharedProject(generation, fixture.project); val project = snapshot.getJSONObject("project")
            assertEquals("viewer", project.getString("role")); assertFalse(project.getString("spaceRole") in setOf("owner", "admin"))
            val reader = SharedTaskListReader(object : SharedWorkspaceGateway {
                override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String) = viewer.querySharedTasks(generation, filter, cursor, sort)
            })
            runBlocking {
                reader.configure(typed("checkbox", "eq", false), "custom:${id("number")}:asc", snapshot.getJSONArray("customFieldDefinitions").toString())
                reader.refresh(); assertEquals(1, reader.pageState.value!!.getInt("total")); assertFalse(reader.lost)
                val viewerId = viewer.session(generation).getJSONObject("user").getString("uid")
                fixture.base.client.removeSharedMember(fixture.base.generation, fixture.project, viewerId)
                reader.refresh(); assertTrue(reader.lost); assertNull(reader.pageState.value)
            }
        }
    }
}
