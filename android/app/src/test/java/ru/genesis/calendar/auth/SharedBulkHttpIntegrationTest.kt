package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/** Guarded local HTTP acceptance; only this test's newly created synthetic projects are changed. */
class SharedBulkHttpIntegrationTest {
    private class Http(private val origin: String) {
        private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()
        private val cookie: String; private var csrf = ""
        init {
            require(origin == "http://127.0.0.1:4338")
            val signed = client.send(HttpRequest.newBuilder(URI("$origin/__fixture/sign-in?actor=editor")).GET().build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(302, signed.statusCode()); cookie = signed.headers().firstValue("set-cookie").orElseThrow().substringBefore(';')
            require(cookie.matches(Regex("GENESISSESSID=[A-Za-z0-9,-]{16,256}")))
            val session = call("/session"); require(session.getJSONObject("user").getString("email") == "improvements-editor@example.invalid")
            csrf = AuthProtocol.csrf(session.getString("csrf"))
        }
        fun call(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject {
            require(path.startsWith('/') && !path.contains(".."))
            if (path.startsWith("/shared/bulk") || path.startsWith("/shared/views/options"))
                require(allowedSharedRoute(method, path)) { "Bulk HTTP route is not allowed by the native transport" }
            val builder = HttpRequest.newBuilder(URI("$origin/api$path")).timeout(Duration.ofSeconds(60)).header("Cookie", cookie).header("Accept", "application/json")
            if (body != null) builder.header("X-CSRF-Token", csrf).header("Content-Type", "application/json; charset=utf-8")
            val response = client.send(builder.method(method, body?.let { HttpRequest.BodyPublishers.ofString(it.toString()) } ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
            val value = JSONObject(response.body())
            if (response.statusCode() !in 200..299) throw AuthApiError(value.optString("error", "HTTP_${response.statusCode()}"))
            return value
        }
        fun encoded(value: Any) = URLEncoder.encode(value.toString(), "UTF-8")
        fun report(id: String, after: Long = 0) = SharedBulkProtocol.report(call("/shared/bulk/$id?after=$after"), id, after)
        fun command(id: String, command: String) = SharedBulkProtocol.report(call("/shared/bulk/$id/$command", JSONObject().put("after", 0)), id)
        fun finish(id: String): JSONObject {
            var report = command(id, "confirm")
            repeat(25) { if (report.getString("state") != "running") return report; report = command(id, "advance") }
            error("Synthetic bulk operation did not converge")
        }
    }
    @Test fun phpPreviewReplayAllResultsEightActionsAndPartialConflictsKeepExactReceipts() {
        val origin = System.getenv("GENESIS_BULK_HTTP_TEST"); assumeTrue("Local bulk HTTP fixture is opt-in", origin != null)
        require(origin == "http://127.0.0.1:4338")
        val target = File(requireNotNull(System.getenv("GENESIS_BULK_HTTP_TARGET"))).canonicalFile
        require(target.parentFile?.name == "output" && target.name == "native-export-http-target.json")
        val space = CustomFieldProtocol.id(JSONObject(target.readText()).getString("spaceId")); val http = Http(origin)
        val projects = mutableListOf<String>(); var label: JSONObject? = null
        try {
            repeat(2) { index ->
                val project = http.call("/shared/spaces/$space/projects", JSONObject().put("title", "C1 HTTP $index ${UUID.randomUUID()}").put("layout", "list")).getJSONObject("project")
                projects += CustomFieldProtocol.id(project.getString("id"))
            }
            val project = projects.first(); val other = projects.last(); val source = http.call("/shared/projects/$project"); val destination = http.call("/shared/projects/$other")
            val open = source.getJSONArray("statuses").getJSONObject(0).getString("id"); val targetStatus = destination.getJSONArray("statuses").getJSONObject(0).getString("id")
            val records = (0 until 131).map { index -> http.call("/shared/projects/$project/tasks", JSONObject().put("title", "C1 fixture $index")
                .put("statusId", open).put("priority", 3).put("dueDate", "2026-10-20").put("requestId", UUID.randomUUID().toString())).getJSONObject("task") }
            val filter = JSONObject().put("projectIds", JSONArray().put(project)).put("q", "C1 fixture")
            val page = http.call("/shared/tasks?filter=${http.encoded(filter)}&sort=priority"); assertEquals(100, page.getJSONArray("tasks").length()); assertEquals(131, page.getInt("total"))
            val selection = JSONObject().put("mode", "all").put("filter", filter).put("sort", "priority").put("queryVersion", page.getString("queryVersion"))
            val store = MemoryPlanningStorage(); var lose = true; val sent = mutableListOf<String>(); val operationIds = mutableSetOf<String>()
            val access = object : SharedBulkAccess {
                override fun check() { }
                override fun hasTaskQueue() = false
                override fun scope(selection: JSONObject) = SharedBulkProtocol.scope(http.call("/shared/bulk/scope", JSONObject().put("selection", selection)))
                override fun preview(body: JSONObject): JSONObject {
                    sent += body.toString(); val report = SharedBulkProtocol.report(http.call("/shared/bulk/preview", body)); operationIds += report.getString("id")
                    if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return report
                }
            }
            fun service() = SharedBulkDraftService(PlanningJournal(store, contract = SharedBulkJournalContract), "synthetic-editor", access)
            val saved = service().save(project, null, JSONObject().put("projectId", project).put("selection", selection).put("action", bulkActionFixture()))
            val prepared = service().prepare(project, saved.getString("stamp"))
            assertThrows(AuthFailure::class.java) { service().send(project, prepared.getString("stamp")) }
            val pending = service().load(project)!!; val received = service().send(project, pending.getString("stamp"))
            assertEquals(sent[0], sent[1]); assertEquals(1, operationIds.size); val operation = received.getJSONObject("receipt").getString("operationId")
            var report = http.report(operation); assertEquals("preview", report.getString("state")); assertEquals(131, report.getJSONObject("counts").getInt("selected"))
            assertTrue(report.getBoolean("hasMore")); val last = http.report(operation, report.getLong("nextCursor")); assertEquals(31, last.getJSONArray("items").length()); assertFalse(last.getBoolean("hasMore"))
            report = http.finish(operation); assertEquals(131, report.getJSONObject("counts").getInt("succeeded")); assertEquals(0, report.getJSONObject("counts").getInt("pending"))
            val firstId = records.first().getString("id"); val first = http.call("/shared/projects/$project/tasks/$firstId").getJSONObject("task"); assertEquals(0, first.getInt("priority"))
            http.command(operation, "confirm"); assertEquals(first.getInt("revision"), http.call("/shared/projects/$project/tasks/$firstId").getJSONObject("task").getInt("revision"))
            val history = SharedBulkProtocol.history(http.call("/shared/bulk")); assertEquals(1, PlanningLifecycle.rows(history.getJSONArray("operations")).count { it.getString("id") == operation })
            service().remove(project, received.getString("stamp"))
            fun single(taskId: String, action: JSONObject): JSONObject {
                val task = http.call("/shared/projects/$project/tasks/$taskId").getJSONObject("task")
                val selected = JSONObject().put("mode", "page").put("items", JSONArray().put(SharedBulkProtocol.reference(task)))
                val request = SharedBulkJournalContract.command(JSONObject().put("projectId", project).put("selection", selected).put("action", action), UUID.randomUUID().toString()).getJSONObject("body")
                val preview = SharedBulkProtocol.report(http.call("/shared/bulk/preview", request)); assertEquals("preview", preview.getString("state"))
                return http.finish(preview.getString("id"))
            }
            assertEquals(1, single(firstId, JSONObject().put("kind", "assignee").put("assigneeId", JSONObject.NULL)).getJSONObject("counts").getInt("succeeded"))
            assertEquals(1, single(firstId, JSONObject().put("kind", "status").put("statusIds", JSONObject().put(project, open))).getJSONObject("counts").getInt("succeeded"))
            single(firstId, JSONObject().put("kind", "due").put("mode", "shift").put("days", -2))
            assertEquals("2026-10-18", http.call("/shared/projects/$project/tasks/$firstId").getJSONObject("task").getString("dueDate"))
            label = http.call("/shared/spaces/$space/labels", JSONObject().put("title", "C1 ${UUID.randomUUID().toString().take(12)}").put("color", "#2d6c68")).getJSONObject("label")
            single(firstId, JSONObject().put("kind", "labels").put("mode", "add").put("labelIds", JSONArray().put(label.getString("id"))))
            val labelled = http.call("/shared/projects/$project/tasks/$firstId").getJSONObject("task"); assertTrue(labelled.getJSONArray("labelIds").toString().contains(label.getString("id")))
            val options = SharedBulkProtocol.options(http.call("/shared/views/options?kind=labels&filter=${http.encoded(JSONObject().put("projectIds", JSONArray().put(project)))}"))
            assertTrue(PlanningLifecycle.rows(options.getJSONArray("options")).any { it.getString("id") == label.getString("id") })
            // A concurrent edit skips exactly that task, leaving the other selected task successful.
            val pair = records.take(2).map { http.call("/shared/projects/$project/tasks/${it.getString("id")}").getJSONObject("task") }
            val conflict = SharedBulkProtocol.report(http.call("/shared/bulk/preview", JSONObject().put("requestId", UUID.randomUUID().toString())
                .put("selection", JSONObject().put("mode", "page").put("items", JSONArray(pair.map(SharedBulkProtocol::reference))))
                .put("action", JSONObject().put("kind", "priority").put("priority", 1))))
            http.call("/shared/projects/$project/tasks/$firstId", JSONObject().put("requestId", UUID.randomUUID().toString()).put("expectedRevision", pair.first().getInt("revision")).put("priority", 2))
            val partial = http.finish(conflict.getString("id")); assertEquals(1, partial.getJSONObject("counts").getInt("skipped")); assertEquals(1, partial.getJSONObject("counts").getInt("succeeded"))
            assertEquals("SHARED_TASK_CONFLICT", PlanningLifecycle.rows(partial.getJSONArray("items")).first { it.getString("id") == firstId }.getString("code"))
            val moved = single(records[2].getString("id"), JSONObject().put("kind", "move").put("projectId", other).put("statusId", targetStatus))
            assertEquals(other, moved.getJSONArray("items").getJSONObject(0).getString("projectId"))
            val parent = records[3].getString("id")
            http.call("/shared/projects/$project/tasks", JSONObject().put("title", "C1 synthetic child").put("statusId", open).put("parentTaskId", parent).put("requestId", UUID.randomUUID().toString()))
            val archived = single(parent, JSONObject().put("kind", "archive")); assertEquals(2, archived.getJSONObject("counts").getInt("affected")); assertEquals(2, archived.getJSONObject("counts").getInt("succeeded"))
            assertThrows(AuthApiError::class.java) { http.call("/shared/projects/$project/tasks/$parent") }
            val archivedCard = http.call("/shared/projects/$project/tasks/$parent?archived=true").getJSONObject("task")
            assertEquals(parent, archivedCard.getString("id")); assertFalse(archivedCard.isNull("archivedAt"))
            val trashed = single(records[4].getString("id"), JSONObject().put("kind", "trash").put("retentionDays", 1))
            assertTrue(trashed.getJSONArray("items").getJSONObject(0).getBoolean("trashed")); assertFalse(trashed.getJSONArray("items").getJSONObject(0).getBoolean("available"))
            assertFalse(store.records.values.any { it.contains("C1 fixture") })
        } finally {
            label?.let { http.call("/shared/spaces/$space/labels/${it.getString("id")}", JSONObject().put("expectedRevision", it.getInt("revision")), "DELETE") }
            for (project in projects) {
                val current = http.call("/shared/projects/$project").getJSONObject("project"); require(current.getString("title").startsWith("C1 HTTP "))
                http.call("/shared/projects/$project/archive", JSONObject())
            }
        }
    }
}
