package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import java.util.UUID

class NativeLegacyFieldOptionsHttpsTest {
    @Test fun archived201DefinitionRemainsEditableAndAReceiptKeepsThePreviousTaskChoice() {
        val args = InstrumentationRegistry.getArguments()
        val space = args.getString("genesisLegacySpace"); val project = args.getString("genesisLegacyProject")
        val field = args.getString("genesisLegacyField"); val task = args.getString("genesisLegacyTask")
        assumeTrue("Explicit isolated legacy fixture required", listOf(space, project, field, task).all { it != null })
        val fixture = TemplateHttpsFixture(); fixture.open()
        try {
            val ownSpace = fixture.raw("GET", "/api/shared/spaces/$space").getJSONObject("space")
            assertTrue(ownSpace.getString("title").startsWith("C3 options compatibility "))
            val catalog = fixture.client.sharedFieldDefinitions(fixture.generation, space!!, project!!, true)
            val latest = PlanningLifecycle.rows(catalog.getJSONArray("fields")).single { it.getString("id") == field }
            assertEquals(201, latest.getJSONArray("options").length()); assertTrue(latest.getJSONArray("options").getJSONObject(200).getBoolean("archived"))
            val edit = CustomFieldEditorProtocol.newEdit(space, project, latest)
            val input = JSONObject(edit.getJSONObject("draft").toString()).put("expectedRevision", latest.getInt("revision"))
            input.put("title", "Native legacy choices " + latest.getInt("revision"))
            val review = fixture.client.previewSharedFieldDefinition(fixture.generation, space, project, input)
            val response = fixture.client.saveSharedFieldDefinition(fixture.generation, space, input.put("fingerprint", review.getString("fingerprint"))
                .put("operationId", UUID.randomUUID().toString()).put("replaceType", false))
            assertEquals(201, response.getJSONObject("field").getJSONArray("options").length())
            val history = fixture.client.sharedFieldHistory(fixture.generation, space, field!!).getJSONArray("versions")
            assertTrue(PlanningLifecycle.rows(history).any { it.getJSONObject("field").getJSONArray("options").length() == 201 })
            val original = fixture.client.sharedTask(fixture.generation, project, task!!).getJSONObject("task")
            assertEquals("legacy-old", original.getJSONObject("customFields").getString(field!!))
        } finally { fixture.close() }
    }
}
