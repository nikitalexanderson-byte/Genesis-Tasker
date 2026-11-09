package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/** Real PHP API with guarded synthetic actors; this is not Android HttpsURLConnection or Google acceptance. */
class SharedTemplateHttpIntegrationTest {
    private fun uuid() = UUID.randomUUID().toString()
    private class Http(actor: String = "editor") {
        private val origin = requireNotNull(System.getenv("GENESIS_TEMPLATES_HTTP_TEST")).also { require(it == "http://127.0.0.1:4338") }
        private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()
        private val cookie: String
        private var csrf = ""
        val user: String
        init {
            require(actor in setOf("editor", "viewer"))
            val response = client.send(HttpRequest.newBuilder(URI("$origin/__fixture/sign-in?actor=$actor")).GET().build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(302, response.statusCode()); cookie = response.headers().firstValue("set-cookie").orElseThrow().substringBefore(';')
            require(cookie.matches(Regex("GENESISSESSID=[A-Za-z0-9,-]{16,256}")))
            val session = call("/session"); require(session.getJSONObject("user").getString("email") == "improvements-$actor@example.invalid")
            user = session.getJSONObject("user").getString("uid"); csrf = AuthProtocol.csrf(session.getString("csrf"))
        }
        fun call(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject {
            require(path.startsWith('/') && !path.contains(".."))
            val request = HttpRequest.newBuilder(URI("$origin/api$path")).timeout(Duration.ofSeconds(60)).header("Cookie", cookie).header("Accept", "application/json")
            if (body != null) request.header("X-CSRF-Token", csrf).header("Content-Type", "application/json; charset=utf-8")
            val response = client.send(request.method(method, body?.let { HttpRequest.BodyPublishers.ofString(it.toString()) } ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
            val json = JSONObject(response.body())
            if (response.statusCode() !in 200..299) throw AuthApiError(json.optString("error", "HTTP_${response.statusCode()}"))
            return json
        }
        fun command(value: JSONObject): JSONObject {
            val body = value.getJSONObject("body"); val request = body.getJSONObject("request")
            val path = if (value.getString("kind") == "template-save") "/shared/spaces/${body.getString("spaceId")}/templates" + if (value.isNull("sprintId")) "" else "/${value.getString("sprintId")}" else "/shared/templates/${value.getString("sprintId").replace(":", "%3A")}/apply"
            val method = if (value.getString("kind") == "template-save" && !value.isNull("sprintId")) "PATCH" else "POST"
            assertTrue(allowedSharedRoute(method, path)); return call(path, request, method)
        }
    }
    private fun isolated(block: (Http, String, String) -> Unit) {
        assumeTrue("Local template HTTP fixture is opt-in", System.getenv("GENESIS_TEMPLATES_HTTP_TEST") != null)
        val http = Http(); val title = "C1 native integration ${uuid()}"
        val space = http.call("/shared/spaces", JSONObject().put("title", title)).getJSONObject("space").getString("id")
        try {
            val project = http.call("/shared/spaces/$space/projects", JSONObject().put("title", "Synthetic template library")).getJSONObject("project").getString("id")
            block(http, space, project)
        } finally {
            val snapshot = http.call("/shared/spaces/$space").getJSONObject("space")
            require(snapshot.getString("title") == title)
            http.call("/shared/spaces/$space", JSONObject().put("expectedRevision", snapshot.getInt("revision")), "DELETE")
        }
    }
    private fun edit(space: String, project: String, request: JSONObject) = SharedTemplateProtocol.newEdit(space, project, "template-save", null, request.put("projectId", project))
    private fun save(http: Http, draft: JSONObject): JSONObject {
        val command = SharedTemplateProtocol.command(draft, uuid()); return SharedTemplateProtocol.receipt(command, http.command(command))
    }

    @Test fun actualPhpRichPreviewApplyAndLostReplyPreserveRelationsFieldsEstimatesAndOneReceipt() = isolated { http, space, project ->
        val manifest = templateRich(); val values = manifest.getJSONArray("tasks").getJSONObject(0).getJSONObject("customValues")
        values.put("field:select", "option:first").put("field:multi", JSONArray().put("option:first"))
        val created = save(http, edit(space, project, JSONObject().put("title", "Own reusable graph").put("manifest", manifest)))
        val id = created.getString("id")
        val source = SharedTemplateProtocol.source(space, id, http.call("/shared/templates/$id?language=ru&deleted=false").getJSONObject("template"))
        assertEquals(4, source.getInt("taskCount")); assertEquals(2, source.getInt("projectCount"))
        val options = templateOptions().put("spaceId", space).put("title", "Synthetic applied graph")
            .put("memberMap", JSONObject().put("synthetic:owner", http.user).put("synthetic:reviewer", http.user))
        val preview = SharedTemplateProtocol.preview(space, id, options, http.call("/shared/templates/$id/preview", options))
        assertTrue(preview.getJSONArray("blockers").toString(), preview.getBoolean("canApply")); assertEquals(4, preview.getJSONArray("tasks").length())
        val draft = SharedTemplateProtocol.newEdit(space, project, "template-apply", id, options).put("review", preview.getString("fingerprint"))
        var loseReply = true; val wire = mutableListOf<String>(); val storage = MemoryPlanningStorage()
        val access = object : SharedTemplateAccess {
            override fun check() = Unit
            override fun project(id: String) = http.call("/shared/projects/$id").getJSONObject("project")
            override fun source(space: String, id: String, language: String, deleted: Boolean) = http.call("/shared/templates/$id?language=$language&deleted=$deleted").getJSONObject("template")
            override fun preview(id: String, request: JSONObject) = http.call("/shared/templates/$id/preview", request)
            override fun hasTaskQueue() = false
            override fun send(command: JSONObject): JSONObject {
                wire.add(command.toString()); val receipt = http.command(command)
                if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return receipt
            }
        }
        fun service() = SharedTemplateDraftService(PlanningJournal(storage, contract = SharedTemplateJournalContract), "synthetic-http-account", access)
        val saved = service().save(project, null, draft); val pending = service().prepare(project, saved.getString("stamp"))
        assertThrows(AuthFailure::class.java) { service().send(project, pending.getString("stamp")) }
        val uncertain = service().load(project)!!; val received = service().send(project, uncertain.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(wire[0], wire[1])
        val receipt = received.getJSONObject("receipt"); assertEquals(2, receipt.getInt("projectCount")); assertEquals(4, receipt.getInt("taskCount"))
        val root = receipt.getString("rootProjectId"); val snapshot = http.call("/shared/projects/$root")
        val taskIds = receipt.getJSONObject("taskIds"); val parent = http.call("/shared/projects/$root/tasks/${taskIds.getString("task:parent")}").getJSONObject("task")
        val child = http.call("/shared/projects/$root/tasks/${taskIds.getString("task:child")}").getJSONObject("task")
        assertEquals(taskIds.getString("task:parent"), child.getString("parentTaskId")); assertEquals(taskIds.getString("task:leaf"), child.getJSONArray("dependsOnIds").getString(0))
        assertEquals(0.0, parent.getDouble("storyPoints"), 0.0); assertEquals(1.25, parent.getDouble("estimateHours"), 0.0)
        assertTrue(child.isNull("storyPoints")); assertEquals(0.0, child.getDouble("estimateHours"), 0.0)
        assertEquals(taskIds.getString("task:child"), parent.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("linkedTaskId"))
        assertEquals(7, snapshot.getJSONArray("customFieldDefinitions").length()); assertEquals(7, parent.getJSONObject("customFields").length())
        assertEquals(3, snapshot.getJSONArray("tasks").length()); assertEquals(http.user, parent.getString("assigneeId"))
        assertEquals(2, wire.size); service().send(project, received.getString("stamp")); assertEquals(2, wire.size)
        val captured = save(http, edit(space, project, JSONObject().put("title", "Captured task with children").put("sourceProjectId", root).put("sourceTaskId", parent.getString("id"))
            .put("capture", JSONObject().put("calendarMode", "sacred").put("calendarContext", manifest.getJSONObject("calendarContext")).put("anchorDate", "2026-10-20"))))
        val capturedId = captured.getString("id")
        val capturedSource = SharedTemplateProtocol.source(space, capturedId, http.call("/shared/templates/$capturedId?language=ru&deleted=false").getJSONObject("template"))
        assertEquals("task", capturedSource.getString("kind")); assertEquals(2, capturedSource.getInt("taskCount"))
        val viewer = Http("viewer"); assertThrows(AuthApiError::class.java) { viewer.call("/shared/templates/$id?language=ru&deleted=false") }
    }

    @Test fun actualPhpLibraryPagesChangedCursorArchiveRestoreAndCapturedTaskStayReadable() = isolated { http, space, project ->
        val copiedManifest = templateStarters().getJSONObject(1).getJSONObject("manifest")
        val first = save(http, edit(space, project, JSONObject().put("title", "First source").put("manifest", copiedManifest).put("cloneTemplateId", "system:publication")))
        repeat(50) { index -> save(http, edit(space, project, JSONObject().put("title", "Copy $index").put("manifest", copiedManifest).put("cloneTemplateId", first.getString("id")))) }
        val route = "/shared/spaces/$space/templates?language=ru&deleted=false"
        val page = SharedTemplateProtocol.library(space, http.call(route)); assertEquals(50, page.getJSONArray("templates").length())
        val cursor = page.getString("nextCursor"); val encoded = java.net.URLEncoder.encode(cursor, "UTF-8")
        val complete = SharedTemplateProtocol.library(space, http.call("$route&cursor=$encoded"), page, cursor); assertEquals(51, complete.getJSONArray("templates").length())
        val update = SharedTemplateProtocol.newEdit(space, project, "template-save", first.getString("id"), JSONObject().put("projectId", project).put("title", "Archived source").put("expectedRevision", 1).put("deleted", true))
        assertTrue(save(http, update).getBoolean("deleted"))
        assertEquals("TEMPLATE_LIST_CHANGED", assertThrows(AuthApiError::class.java) { http.call("$route&cursor=$encoded") }.code)
        val archived = SharedTemplateProtocol.source(space, first.getString("id"), http.call("/shared/templates/${first.getString("id")}?language=ru&deleted=true").getJSONObject("template"))
        assertTrue(archived.getBoolean("deleted"))
        update.getJSONObject("request").put("expectedRevision", 2).put("deleted", false); assertFalse(save(http, update).getBoolean("deleted"))
        for (language in SharedTemplateProtocol.languages) {
            val source = http.call("/shared/templates/system%3Apublication?language=$language&deleted=false").getJSONObject("template")
            SharedTemplateProtocol.source(space, "system:publication", source)
        }
    }
}
