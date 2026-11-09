package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class NativeFieldEditorHttpsTest {
    private val fixture = FieldEditorHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun draft(type: String, source: JSONObject? = null) = CustomFieldEditorProtocol.newEdit(fixture.space, fixture.project, source).apply {
        getJSONObject("draft").put("title", "Поле $type 🌿").put("type", type).put("options", if (type in setOf("select", "multi"))
            JSONArray().put(JSONObject().put("id", "first").put("title", "Первый").put("archived", false)) else JSONArray())
    }
    private fun review(edit: JSONObject): JSONObject {
        val service = fixture.service(); val saved = service.save(fixture.project, null, edit)
        return service.preview(fixture.project, saved.getString("stamp"))
    }
    private fun save(edit: JSONObject): JSONObject {
        val service = fixture.service(); val reviewed = review(edit)
        val pending = service.prepare(fixture.project, reviewed.getString("stamp"))
        val received = service.send(fixture.project, pending.getString("stamp")); val field = received.getJSONObject("receipt").getJSONObject("field")
        service.remove(fixture.project, received.getString("stamp")); return field
    }
    @Test fun normalizationCannotAddArchivedChoicesBeyondTheLimitOrChangeThePreviousTaskValue() {
        val initial = save(draft("select"))
        val status = fixture.snapshot().getJSONArray("statuses").getJSONObject(0).getString("id")
        val task = fixture.base.client.createSharedTask(fixture.base.generation, fixture.project, JSONObject().put("title", "Retain old choice")
            .put("statusId", status).put("customFields", JSONObject().put(initial.getString("id"), "first"))).getJSONObject("task")
        val edited = draft("select", initial).apply { getJSONObject("draft").put("options", JSONArray((1..200).map { index -> JSONObject().put("id", "new-$index").put("title", "New $index").put("archived", false) })) }
        val service = fixture.service(); val own = service.save(fixture.project, null, edited)
        val failure = runCatching { service.preview(fixture.project, own.getString("stamp")) }.exceptionOrNull()
        assertEquals("CUSTOM_FIELD_OPTIONS_LIMIT", when (failure) { is AuthApiError -> failure.code; is CustomFieldFailure -> failure.code; else -> failure?.message })
        assertEquals("editing", service.load(fixture.project)!!.getString("phase")); assertEquals(1, fixture.bodies.size)
        val fresh = fixture.base.client.sharedTask(fixture.base.generation, fixture.project, task.getString("id")).getJSONObject("task")
        assertEquals("first", fresh.getJSONObject("customFields").getString(initial.getString("id")))
    }
    @Test fun keystoreLostReplyAndSuccessorKeepTheExactPutAndPreviousTaskValue() {
        val service = fixture.service(); val reviewed = review(draft("number")); val pending = service.prepare(fixture.project, reviewed.getString("stamp"))
        fixture.loseReply = true
        assertTrue(runCatching { service.send(fixture.project, pending.getString("stamp")) }.exceptionOrNull() is AuthFailure)
        val recovered = fixture.service().load(fixture.project)!!
        assertEquals("pending", recovered.getString("phase")); assertEquals(1, recovered.getInt("attempts"))
        assertTrue(runCatching { fixture.service().remove(fixture.project, recovered.getString("stamp")) }.isFailure)
        val received = fixture.service().send(fixture.project, recovered.getString("stamp"))
        assertEquals(fixture.bodies[0], fixture.bodies[1]); val source = received.getJSONObject("receipt").getJSONObject("field")
        assertEquals(1, fixture.base.client.sharedFieldDefinitions(fixture.base.generation, fixture.space, fixture.project, true).getJSONArray("fields").length())
        fixture.service().remove(fixture.project, received.getString("stamp"))
        val status = fixture.snapshot().getJSONArray("statuses").getJSONObject(0).getString("id")
        val task = fixture.base.client.createSharedTask(fixture.base.generation, fixture.project, JSONObject().put("title", "Ноль остаётся нулём").put("statusId", status)
            .put("customFields", JSONObject().put(source.getString("id"), 0))).getJSONObject("task").getString("id")
        val replacement = review(draft("text", source)); assertTrue(replacement.getJSONObject("edit").getJSONObject("review").getBoolean("replaceType"))
        assertTrue(runCatching { fixture.service().prepare(fixture.project, replacement.getString("stamp")) }.isFailure)
        val confirmed = fixture.service().save(fixture.project, replacement.getString("stamp"), replacement.getJSONObject("edit").put("confirmReplacement", true))
        val prepared = fixture.service().prepare(fixture.project, confirmed.getString("stamp"))
        val successor = fixture.service().send(fixture.project, prepared.getString("stamp")).getJSONObject("receipt")
        assertEquals(source.getString("id"), successor.getString("previousFieldId")); assertEquals(1, successor.getJSONObject("field").getInt("revision"))
        val old = fixture.base.client.sharedFieldHistory(fixture.base.generation, fixture.space, source.getString("id")).getJSONArray("versions").getJSONObject(0).getJSONObject("field")
        assertTrue(old.getBoolean("archived")); assertEquals(2, old.getInt("revision"))
        val values = fixture.base.client.sharedTask(fixture.base.generation, fixture.project, task).getJSONObject("task").getJSONObject("customFields")
        assertEquals(0, values.getInt(source.getString("id"))); assertFalse(values.has(successor.getJSONObject("field").getString("id")))
    }
    @Test fun allSevenWritersAndAnOmittedArchivedChoiceRetainFalseAndTheOldSelection() {
        val fields = CustomFieldProtocol.types.associateWith { save(draft(it)) }
        val selected = fields.getValue("select"); val checkbox = fields.getValue("checkbox")
        val task = fixture.base.client.createSharedTask(fixture.base.generation, fixture.project, JSONObject().put("title", "Прежний выбор и false")
            .put("statusId", fixture.snapshot().getJSONArray("statuses").getJSONObject(0).getString("id"))
            .put("customFields", JSONObject().put(selected.getString("id"), "first").put(checkbox.getString("id"), false))).getJSONObject("task").getString("id")
        val next = draft("select", selected).apply { getJSONObject("draft").put("options", JSONArray()) }
        val updated = save(next)
        assertTrue(updated.getJSONArray("options").getJSONObject(0).getBoolean("archived"))
        val values = fixture.base.client.sharedTask(fixture.base.generation, fixture.project, task).getJSONObject("task").getJSONObject("customFields")
        assertEquals("first", values.getString(selected.getString("id"))); assertEquals(false, values.get(checkbox.getString("id")))
        assertEquals(7, fixture.base.client.sharedFieldDefinitions(fixture.base.generation, fixture.space, fixture.project, true).getJSONArray("fields").length())
    }
    @Test fun aRealProjectManagerWithoutSpaceAdminCannotPreviewOrPutDefinitions() {
        val invitation = fixture.base.client.inviteSharedMember(fixture.base.generation, fixture.project, JSONObject().put("email", "improvements-viewer@example.invalid").put("role", "manager"))
        fixture.base.viewer { viewer, generation ->
            viewer.acceptSharedInvitation(generation, JSONObject().put("id", invitation.getJSONObject("invitation").getString("id")))
            val project = viewer.sharedProject(generation, fixture.project).getJSONObject("project")
            assertEquals("manager", project.getString("role")); assertTrue(project.getJSONObject("permissions").getBoolean("manageProjects"))
            assertFalse(project.getString("spaceRole") in setOf("owner", "admin"))
            val edit = draft("text"); val request = CustomFieldEditorProtocol.request(edit)
            for (work in listOf<() -> Unit>({ viewer.sharedFieldEditorContext(generation, fixture.space, fixture.project) },
                { viewer.previewSharedFieldDefinition(generation, fixture.space, fixture.project, request) },
                { viewer.saveSharedFieldDefinition(generation, fixture.space, request.put("operationId", java.util.UUID.randomUUID().toString()).put("fingerprint", "a".repeat(64)).put("replaceType", false)) })) {
                val failure = runCatching(work).exceptionOrNull(); assertNotNull(failure)
                assertTrue(failure is AuthApiError && failure.code == "SHARED_SPACE_FORBIDDEN" || failure is IllegalArgumentException && failure.message == "SHARED_SPACE_FORBIDDEN" || failure is AuthFailure && failure.httpStatus == 403)
            }
        }
    }
}
