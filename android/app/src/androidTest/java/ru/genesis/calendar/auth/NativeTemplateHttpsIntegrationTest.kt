package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.UUID

class NativeTemplateHttpsIntegrationTest {
    private val fixture = TemplateHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun uuid() = UUID.randomUUID().toString()
    private fun save(request: JSONObject, id: String? = null): JSONObject {
        val edit = SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-save", id, request.put("projectId", fixture.project))
        val command = SharedTemplateProtocol.command(edit, uuid()); return fixture.client.sharedTemplateCommand(fixture.generation, command)
    }
    @Test fun nativeHttpsKeystoreRecoveryApplyReplayAndCaptureKeepTheRealGraph() {
        val manifest = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("templates/rich-manifest.json").bufferedReader().use { it.readText() })
        val values = manifest.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues")
        values.put("field:select", "option:first").put("field:multi", JSONArray().put("option:first"))
        val id = save(JSONObject().put("title", "Reusable native graph").put("manifest", manifest)).getString("id")
        val source = fixture.source(id); assertEquals(4, source.getInt("taskCount")); assertEquals(2, source.getInt("projectCount"))
        val options = JSONObject().put("spaceId", fixture.space).put("language", "ru").put("anchorDate", "2026-10-20")
            .put("memberMap", JSONObject().put("synthetic:owner", fixture.actor).put("synthetic:reviewer", fixture.actor))
        val preview = fixture.preview(id, options); assertTrue(preview.getJSONArray("blockers").toString(), preview.getBoolean("canApply"))
        val edit = SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-apply", id, options).put("review", preview.getString("fingerprint"))
        val saved = fixture.service().save(fixture.project, null, edit)
        assertEquals(saved.toString(), fixture.service().load(fixture.project).toString())
        val pending = fixture.service().prepare(fixture.project, saved.getString("stamp"))
        // Drop only after the real native HTTPS API has committed. A new service instance must replay the same command.
        try { fixture.service { true }.send(fixture.project, pending.getString("stamp")); fail("Lost reply expected") } catch (_: AuthFailure) { }
        val uncertain = fixture.service().load(fixture.project)!!; assertEquals("pending", uncertain.getString("phase")); assertEquals(1, uncertain.getInt("attempts"))
        val received = fixture.service().send(fixture.project, uncertain.getString("stamp")); assertEquals("received", received.getString("phase"))
        assertEquals(pending.getString("command"), received.getString("command"))
        assertEquals(received.toString(), fixture.service().send(fixture.project, received.getString("stamp")).toString())
        val receipt = received.getJSONObject("receipt"); val root = receipt.getString("rootProjectId"); val tasks = receipt.getJSONObject("taskIds")
        val parent = fixture.client.sharedTask(fixture.generation, root, tasks.getString("task:parent")).getJSONObject("task")
        val child = fixture.client.sharedTask(fixture.generation, root, tasks.getString("task:child")).getJSONObject("task")
        assertEquals(4, receipt.getInt("taskCount")); assertEquals(7, parent.getJSONObject("customFields").length())
        assertEquals(0.0, parent.getDouble("storyPoints"), 0.0); assertEquals(1.25, parent.getDouble("estimateHours"), 0.0)
        assertTrue(child.isNull("storyPoints")); assertEquals(0.0, child.getDouble("estimateHours"), 0.0)
        assertEquals(parent.getString("id"), child.getString("parentTaskId"))
        assertEquals(tasks.getString("task:leaf"), child.getJSONArray("dependsOnIds").getString(0))
        assertEquals(child.getString("id"), parent.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("linkedTaskId"))
        val captured = save(JSONObject().put("title", "Captured native task").put("sourceProjectId", root).put("sourceTaskId", parent.getString("id"))
            .put("capture", JSONObject().put("calendarMode", "lunar").put("calendarContext", manifest.getJSONObject("calendarContext")).put("anchorDate", "2026-10-20")))
        val capturedSource = fixture.source(captured.getString("id")); assertEquals("task", capturedSource.getString("kind")); assertEquals(2, capturedSource.getInt("taskCount"))
        fixture.viewer { viewer, token ->
            try { viewer.sharedTemplate(token, fixture.space, id, "ru", false); fail("Viewer read private source") } catch (_: Exception) { }
        }
    }
    @Test fun nativeHttpsStarterLanguagesCopyEditArchiveRestoreAndPreviewStayAvailable() {
        for (language in SharedTemplateProtocol.languages) for (starter in SharedTemplateProtocol.starters) fixture.source(starter, language)
        val original = fixture.source("system:publication")
        val id = save(JSONObject().put("title", "Native starter copy").put("cloneTemplateId", "system:publication").put("manifest", original.getJSONObject("manifest"))).getString("id")
        val changed = save(JSONObject().put("title", "Renamed native template").put("expectedRevision", 1).put("manifest", fixture.source(id).getJSONObject("manifest")), id)
        assertEquals(2, changed.getInt("revision")); assertEquals("Renamed native template", fixture.source(id).getString("title"))
        assertTrue(save(JSONObject().put("title", "Renamed native template").put("expectedRevision", 2).put("deleted", true), id).getBoolean("deleted"))
        assertTrue(fixture.source(id, deleted = true).getBoolean("deleted"))
        assertFalse(save(JSONObject().put("title", "Renamed native template").put("expectedRevision", 3).put("deleted", false), id).getBoolean("deleted"))
        val library = SharedTemplateProtocol.library(fixture.space, fixture.client.sharedTemplates(fixture.generation, fixture.space, "ru", false, null))
        assertEquals(1, library.getInt("total")); assertEquals(4, library.getJSONArray("systemTemplates").length())
        for (mode in listOf("profane", "sacred", "lunar")) {
            val manifest = JSONObject(original.getJSONObject("manifest").toString()).put("calendarMode", mode)
            manifest.getJSONArray("tasks").getJSONObject(0).put("due", JSONObject().put("unit", "month").put("amount", 1))
            val calendarId = save(JSONObject().put("title", "Native calendar $mode").put("manifest", manifest)).getString("id")
            val options = JSONObject().put("spaceId", fixture.space).put("language", "ru").put("anchorDate", "2026-01-31").put("projectId", fixture.project)
            val preview = fixture.preview(calendarId, options)
            assertEquals(mode, preview.getString("calendarMode")); assertEquals(10, preview.getJSONArray("tasks").getJSONObject(0).getString("dueDate").length)
        }
    }
}
