package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.UUID

/** The fixture alone seeds mutations; the application bridge exposes only metadata reads and preview. */
class NativeFieldDefinitionsHttpsTest {
    private val fixture = TemplateHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun id() = UUID.randomUUID().toString()
    private fun save(body: JSONObject, review: JSONObject): JSONObject = fixture.raw("PUT", "/api/shared/spaces/${fixture.space}/custom-fields",
        JSONObject(body.toString()).put("fingerprint", review.getString("fingerprint")).put("operationId", id()).put("replaceType", review.getBoolean("replaceType")))
    private fun denied(work: () -> Unit) {
        val failure = runCatching(work).exceptionOrNull(); assertNotNull("The API must deny a reader outside the space", failure)
        assertTrue(failure is AuthFailure && failure.httpStatus in setOf(403, 404) || failure is AuthApiError && failure.code in
            setOf("SHARED_FORBIDDEN", "SHARED_SPACE_FORBIDDEN", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND"))
    }
    @Test fun nativeMetadataPreviewAndHistoryKeepAllTypesAndValuesAcrossTheServersArchivedSuccessor() {
        val client = fixture.client; val token = fixture.generation
        assertEquals(0, client.sharedFieldDefinitions(token, fixture.space, fixture.project, true).getJSONArray("fields").length())
        val bodies = linkedMapOf<String, JSONObject>()
        for ((position, type) in CustomFieldProtocol.types.withIndex()) {
            val body = JSONObject().put("id", id()).put("projectId", fixture.project).put("title", "Поле $type 🌿").put("type", type)
                .put("position", position).put("required", false).put("showCard", true).put("showList", false).put("archived", false).put("expectedRevision", 0)
                .put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "first").put("title", "Первый").put("archived", false)) else JSONArray())
            val review = client.previewSharedFieldDefinition(token, fixture.space, fixture.project, body)
            assertTrue(review.getBoolean("preservesPreviousValues")); assertFalse(review.getBoolean("replaceType")); assertEquals(0, review.getInt("valueCount"))
            assertEquals(position, client.sharedFieldDefinitions(token, fixture.space, fixture.project, true).getJSONArray("fields").length())
            save(body, review); bodies[type] = body
        }
        val snapshot = client.sharedProject(token, fixture.project)
        val number = bodies.getValue("number").getString("id"); val checkbox = bodies.getValue("checkbox").getString("id"); val select = bodies.getValue("select").getString("id")
        val task = fixture.raw("POST", "/api/shared/projects/${fixture.project}/tasks", JSONObject().put("title", "Сохранить ноль и false")
            .put("statusId", snapshot.getJSONArray("statuses").getJSONObject(0).getString("id"))
            .put("customFields", JSONObject().put(number, 0).put(checkbox, false).put(select, "first"))).getJSONObject("task").getString("id")
        val change = JSONObject(bodies.getValue("number").toString()).put("expectedRevision", 1).put("type", "text")
        val review = client.previewSharedFieldDefinition(token, fixture.space, fixture.project, change)
        assertEquals(1, review.getInt("valueCount")); assertTrue(review.getBoolean("replaceType"))
        val receipt = save(change, review); assertEquals(number, receipt.getString("previousFieldId"))
        val successor = receipt.getJSONObject("field").getString("id"); assertNotEquals(number, successor)
        val removeChoice = JSONObject(bodies.getValue("select").toString()).put("expectedRevision", 1).put("options", JSONArray())
        val choiceReview = client.previewSharedFieldDefinition(token, fixture.space, fixture.project, removeChoice)
        assertFalse(choiceReview.getBoolean("replaceType")); assertEquals(1, choiceReview.getInt("valueCount"))
        assertTrue(choiceReview.getJSONObject("field").getJSONArray("options").getJSONObject(0).getBoolean("archived"))
        save(removeChoice, choiceReview)
        val fields = client.sharedFieldDefinitions(token, fixture.space, fixture.project, true).getJSONArray("fields")
        assertEquals(8, fields.length()); assertEquals(CustomFieldProtocol.types, PlanningLifecycle.rows(fields).map { it.getString("type") }.toSet())
        assertTrue(PlanningLifecycle.rows(fields).single { it.getString("id") == number }.getBoolean("archived"))
        assertEquals(number, PlanningLifecycle.rows(fields).single { it.getString("id") == successor }.getString("predecessorId"))
        assertEquals(7, client.sharedFieldDefinitions(token, fixture.space, fixture.project, false).getJSONArray("fields").length())
        val history = client.sharedFieldHistory(token, fixture.space, number).getJSONArray("versions")
        assertEquals(2, history.length()); assertTrue(history.getJSONObject(0).getJSONObject("field").getBoolean("archived"))
        val values = client.sharedTask(token, fixture.project, task).getJSONObject("task").getJSONObject("customFields")
        assertEquals(0, values.getInt(number)); assertEquals(false, values.get(checkbox)); assertEquals("first", values.getString(select)); assertFalse(values.has(successor))
        fixture.viewer { viewer, generation ->
            denied { viewer.sharedFieldDefinitions(generation, fixture.space, fixture.project, true) }
            denied { viewer.sharedFieldHistory(generation, fixture.space, number) }
            denied { viewer.previewSharedFieldDefinition(generation, fixture.space, fixture.project, JSONObject(bodies.getValue("checkbox").toString()).put("expectedRevision", 1)) }
        }
    }
}
