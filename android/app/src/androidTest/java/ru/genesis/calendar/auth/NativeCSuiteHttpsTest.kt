package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.UUID

/** Cross-feature acceptance: production Android protocols, TLS, current PHP and isolated synthetic actors. */
class NativeCSuiteHttpsTest {
    private val fixture = TemplateHttpsFixture()
    private val client get() = fixture.client
    private val gen get() = fixture.generation
    private fun id() = UUID.randomUUID().toString()
    private fun rows(array: JSONArray) = (0 until array.length()).map(array::getJSONObject)
    private fun done(status: JSONObject) = status.optInt("isDone") == 1 || status.optBoolean("isDone")
    private fun values(data: JSONObject, task: JSONObject): Map<String, String> {
        val fields = rows(data.getJSONArray("fields")).associateBy { it.getString("key") }
        val values = task.getJSONObject("customValues")
        return values.keys().asSequence().associate { key ->
            val field = fields.getValue(key); val options = rows(field.getJSONArray("options")).associate { it.getString("id") to it.getString("title") }
            val value = when (field.getString("type")) {
                "select" -> if (values.isNull(key)) JSONObject.NULL else options.getValue(values.getString(key))
                "multi" -> if (values.isNull(key)) JSONObject.NULL else JSONArray((0 until values.getJSONArray(key).length()).map { options.getValue(values.getJSONArray(key).getString(it)) }.sorted())
                else -> values.get(key)
            }
            "${field.getString("title")}:${field.getString("type")}" to PlanningLifecycle.canonical(value)
        }
    }
    private fun context() = JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march")
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    private fun export(project: String?, scope: String = "tree", who: AuthSessionClient = client, token: Long = gen): JSONObject =
        who.exportSharedData(token, fixture.space, JSONObject().put("scope", if (project == null) "space" else scope)
            .put("projectId", project ?: JSONObject.NULL).put("format", "json").put("from", JSONObject.NULL).put("to", JSONObject.NULL)
            .put("undated", true).put("archived", false).put("calendarMode", "lunar").put("calendarContext", context()).put("titles", JSONObject()))
    private fun reportOptions(project: String) = JSONObject().put("filter", JSONObject().put("projectIds", JSONArray().put(project)))
        .put("from", LocalDate.now().minusDays(1).toString()).put("to", LocalDate.now().plusDays(1).toString())
        .put("calendarMode", "lunar").put("calendarContext", context()).put("cycleStartStatusIds", JSONArray())
    private fun selection() = JSONObject().put("format", "json").put("spaceId", fixture.space).put("projectId", JSONObject.NULL).put("parentProjectId", JSONObject.NULL)
        .put("parse", JSONObject().put("title", "C-suite roundtrip").put("openTitle", "Open").put("doneTitle", "Done").put("calendarMode", "lunar")
            .put("calendarContext", context()).put("delimiter", ",").put("dateFormat", "iso").put("columns", JSONObject()).put("customColumns", JSONArray()).put("doneStatusKeys", JSONArray()))
        .apply { for (key in listOf("memberMap", "statusMap", "labelMap", "fieldMap", "optionMap", "fieldDefaults")) put(key, JSONObject()) }
    private fun graph(): JSONObject {
        val manifest = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("templates/rich-manifest.json").bufferedReader().use { it.readText() })
        manifest.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues")
            .put("field:select", "option:first").put("field:multi", JSONArray().put("option:first"))
        val saved = client.sharedTemplateCommand(gen, SharedTemplateProtocol.command(
            SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-save", null,
                JSONObject().put("projectId", fixture.project).put("title", "C-suite linked graph").put("manifest", manifest)), id()))
        val template = saved.getString("id")
        val request = JSONObject().put("spaceId", fixture.space).put("language", "ru").put("anchorDate", LocalDate.now().toString())
            .put("memberMap", JSONObject().put("synthetic:owner", fixture.actor).put("synthetic:reviewer", fixture.actor))
        val preview = fixture.preview(template, request)
        assertTrue(preview.getJSONArray("blockers").toString(), preview.getBoolean("canApply"))
        return client.sharedTemplateCommand(gen, SharedTemplateProtocol.command(
            SharedTemplateProtocol.newEdit(fixture.space, fixture.project, "template-apply", template, request).put("review", preview.getString("fingerprint")), id()))
    }
    private fun denied(action: () -> Unit) {
        val failure = runCatching(action).exceptionOrNull()
        assertTrue("Expected current ACL to deny the request; got $failure", failure is AuthFailure && failure.httpStatus in setOf(403, 404) ||
            failure is AuthApiError && failure.code in setOf("SHARED_FORBIDDEN", "SHARED_SPACE_FORBIDDEN", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND"))
    }
    @Test fun templatesFieldsExportImportReportsAndUndoUseOneRealGraph() {
        val graph = graph(); val root = graph.getString("rootProjectId")
        val exported = export(root); val source = JSONObject(exported.getString("content"))
        assertEquals(2, exported.getInt("projectCount")); assertEquals(4, exported.getInt("taskCount"))
        assertEquals(setOf("text", "number", "date", "select", "multi", "checkbox", "url"), rows(source.getJSONArray("fields")).map { it.getString("type") }.toSet())
        val desired = selection()
        rows(source.getJSONArray("members")).forEach { desired.getJSONObject("memberMap").put(it.getString("key"), fixture.actor) }
        val preview = DataImportProtocol.preview(client.previewSharedData(gen, desired, exported.getString("content")))
        assertTrue(preview.getJSONArray("blockers").toString(), preview.getBoolean("canApply"))
        val operation = id()
        val received = DataImportProtocol.receipt(client.applySharedData(gen, desired, exported.getString("content"), operation, preview.getString("fingerprint")), fixture.space, operation)
        val replay = DataImportProtocol.receipt(client.applySharedData(gen, desired, exported.getString("content"), operation, preview.getString("fingerprint")), fixture.space, operation)
        assertEquals(received.getString("importId"), replay.getString("importId"))
        val copyRoot = received.getString("rootProjectId"); assertNotEquals(root, copyRoot)
        val copy = JSONObject(export(copyRoot).getString("content")); val before = rows(source.getJSONArray("tasks")); val after = rows(copy.getJSONArray("tasks"))
        val restoredFields = rows(copy.getJSONArray("fields")).map { "${it.getString("title")}:${it.getString("type")}:${it.getBoolean("archived")}" }
        // Export also includes any pre-existing space-wide fields applicable to the destination tree.
        assertTrue(restoredFields.containsAll(rows(source.getJSONArray("fields")).map { "${it.getString("title")}:${it.getString("type")}:${it.getBoolean("archived")}" }))
        assertEquals(before.map { it.getString("title") }.toSet(), after.map { it.getString("title") }.toSet())
        val oldTitles = before.associate { it.getString("key") to it.getString("title") }; val newTitles = after.associate { it.getString("key") to it.getString("title") }
        for (task in before) {
            val restored = after.single { it.getString("title") == task.getString("title") }
            assertNotEquals(task.getString("key"), restored.getString("key"))
            assertEquals(task.optString("parentKey").let(oldTitles::get), restored.optString("parentKey").let(newTitles::get))
            assertEquals((0 until task.getJSONArray("dependsOnKeys").length()).map { oldTitles[task.getJSONArray("dependsOnKeys").getString(it)] }.toSet(),
                (0 until restored.getJSONArray("dependsOnKeys").length()).map { newTitles[restored.getJSONArray("dependsOnKeys").getString(it)] }.toSet())
            assertEquals(task.getJSONArray("checklists").length(), restored.getJSONArray("checklists").length())
            assertEquals("Points, including null and known zero, survive template/export/import", task.get("storyPoints"), restored.get("storyPoints"))
            assertEquals("Hours remain a separate estimate", task.get("estimateHours"), restored.get("estimateHours"))
            assertEquals(values(source, task), values(copy, restored))
        }
        val importedOptions = reportOptions(copyRoot)
        val importedReport = TeamReportProtocol.snapshot(importedOptions, client.sharedTeamReport(gen, importedOptions))
        assertTrue("Imported history must not masquerade as newly observed work", importedReport.getJSONObject("unknown").getInt("count") > 0)
        val statuses = client.sharedProject(gen, fixture.project).getJSONArray("statuses")
        var task = client.createSharedTask(gen, fixture.project, JSONObject().put("title", "Observed report event").put("statusId", statuses.getJSONObject(0).getString("id"))).getJSONObject("task")
        val start = rows(statuses).first { !done(it) && it.getString("id") != task.getString("statusId") }.getString("id")
        val done = rows(statuses).first(::done).getString("id")
        task = client.updateSharedTask(gen, fixture.project, task.getString("id"), JSONObject().put("expectedRevision", task.getInt("revision")).put("statusId", start)).getJSONObject("task")
        task = client.updateSharedTask(gen, fixture.project, task.getString("id"), JSONObject().put("expectedRevision", task.getInt("revision")).put("statusId", done)).getJSONObject("task")
        val options = reportOptions(fixture.project).put("cycleStartStatusIds", JSONArray().put(start))
        val report = TeamReportProtocol.snapshot(options, client.sharedTeamReport(gen, options))
        assertEquals(1, report.getJSONObject("summary").getJSONObject("completed").getInt("count"))
        assertEquals(1, report.getJSONObject("cycle").getJSONObject("known").getInt("count"))
        val page = TeamReportProtocol.sources(report, "completed", client.sharedTeamReportTasks(gen, report.getString("token"), "completed", null))
        assertEquals(task.getString("id"), page.getJSONArray("tasks").getJSONObject(0).getString("id"))
        TeamReportProtocol.check(client.checkSharedTeamReport(gen, report.getString("token")))
        val changed = after.first { it.isNull("parentKey") }
        val changedProject = changed.getString("projectKey"); val changedId = changed.getString("key")
        val current = client.sharedTask(gen, changedProject, changedId).getJSONObject("task")
        client.updateSharedTask(gen, changedProject, changedId, JSONObject().put("expectedRevision", current.getInt("revision")).put("description", "Later user edit must survive undo"))
        val conflict = runCatching { client.undoSharedData(gen, received.getString("importId")) }.exceptionOrNull()
        assertTrue(conflict is AuthApiError && conflict.code == "DATA_UNDO_CONFLICT")
        assertEquals("Later user edit must survive undo", client.sharedTask(gen, changedProject, changedId).getJSONObject("task").getString("description"))
        assertEquals(4, export(root).getInt("taskCount"))
    }
    @Test fun automationWorkerAndRestrictedMemberAgreeAcrossReportsExportAndDirectReads() {
        val root = graph().getString("rootProjectId")
        val member = fixture.raw("POST", "/__fixture/add-member", JSONObject().put("spaceId", fixture.space)).getString("userId")
        val grant = JSONObject().put("allProjects", false).put("grants", JSONArray().put(JSONObject().put("projectId", root).put("role", "member").put("includeDescendants", true)))
        fun access(draft: JSONObject): JSONObject {
            val preview = client.previewSharedProjectAccess(gen, fixture.space, member, draft)
            return client.saveSharedProjectAccess(gen, fixture.space, member, JSONObject(draft.toString()).put("expectedFingerprint", preview.getString("fingerprint")).put("operationId", id()))
        }
        access(grant)
        fixture.viewer { viewer, token ->
            assertEquals("member", viewer.sharedProject(token, root).getJSONObject("project").getString("role"))
            denied { viewer.sharedProject(token, fixture.project) }
            val allowed = JSONObject(export(null, who = viewer, token = token).getString("content"))
            assertEquals(2, allowed.getJSONArray("projects").length())
            assertFalse(rows(allowed.getJSONArray("projects")).any { it.getString("key") == fixture.project })
            val options = reportOptions(root)
            val report = TeamReportProtocol.snapshot(options, viewer.sharedTeamReport(token, options))
            assertFalse(rows(report.getJSONObject("catalog").getJSONArray("projects")).any { it.getString("id") == fixture.project })
        }
        val definition = JSONObject().put("schemaVersion", 1).put("trigger", JSONObject().put("type", "created")).put("conditions", JSONArray())
            .put("actions", JSONArray().put(JSONObject().put("type", "priority").put("value", 0))).put("calendarMode", "lunar").put("calendarContext", context())
        val rule = client.saveSharedAutomation(gen, root, null, JSONObject().put("operationId", id()).put("title", "C-suite real worker").put("enabled", true).put("definition", definition)).getJSONObject("rule")
        val snapshot = client.sharedProject(gen, root)
        val task = client.createSharedTask(gen, root, JSONObject().put("title", "C-suite worker target").put("priority", 3)
            .put("statusId", rows(snapshot.getJSONArray("statuses")).first { !done(it) }.getString("id"))).getJSONObject("task")
        fixture.raw("POST", "/__fixture/worker", JSONObject().put("spaceId", fixture.space))
        val runs = client.sharedAutomationRuns(gen, root, rule.getString("id"), null).getJSONArray("runs")
        assertEquals(1, runs.length()); assertEquals("succeeded", runs.getJSONObject(0).getString("state"))
        val updated = client.sharedTask(gen, root, task.getString("id")).getJSONObject("task")
        assertEquals(0, updated.getInt("priority"))
        fixture.raw("POST", "/__fixture/worker", JSONObject().put("spaceId", fixture.space))
        assertEquals(updated.getInt("revision"), client.sharedTask(gen, root, task.getString("id")).getJSONObject("task").getInt("revision"))
        access(JSONObject().put("allProjects", false).put("grants", JSONArray()))
        fixture.viewer { viewer, token ->
            denied { viewer.sharedProject(token, root) }
            denied { viewer.sharedTask(token, root, task.getString("id")) }
            denied { export(root, who = viewer, token = token) }
            val options = reportOptions(root)
            val failure = runCatching { viewer.sharedTeamReport(token, options) }.exceptionOrNull()
            assertNotNull("Revoked project must not produce a report", failure)
        }
    }
}
