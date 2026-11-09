package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/** Loopback synthetic actors only; cookies and CSRF never enter tracked fixtures or output. */
class ProjectAccessHttpIntegrationTest {
    private class Http(private val origin: String, actor: String) {
        private val client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()
        private val cookie: String; private var csrf = ""
        init {
            require(origin == "http://127.0.0.1:4338" && actor in setOf("editor", "viewer"))
            val signed = client.send(HttpRequest.newBuilder(URI("$origin/__fixture/sign-in?actor=$actor")).GET().build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(302, signed.statusCode()); cookie = signed.headers().firstValue("set-cookie").orElseThrow().substringBefore(';')
            require(cookie.matches(Regex("GENESISSESSID=[A-Za-z0-9,-]{16,256}")))
            val session = call("/session")
            require(session.getJSONObject("user").getString("email") == "improvements-$actor@example.invalid")
            csrf = AuthProtocol.csrf(session.getString("csrf"))
        }
        fun call(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject {
            require(path.startsWith('/') && !path.contains("..") && method in setOf("GET", "POST", "PATCH"))
            val builder = HttpRequest.newBuilder(URI("$origin/api$path")).timeout(Duration.ofSeconds(60))
                .header("Cookie", cookie).header("Accept", "application/json")
            if (body != null) builder.header("X-CSRF-Token", csrf).header("Content-Type", "application/json; charset=utf-8")
            val response = client.send(builder.method(method, body?.let { HttpRequest.BodyPublishers.ofString(it.toString()) } ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
            val result = JSONObject(response.body())
            if (response.statusCode() !in 200..299) throw AuthApiError(result.optString("error", "HTTP_${response.statusCode()}"))
            return result
        }
    }
    @Test fun realPhpReviewCasRevocationInheritanceAndLostResponseReplayAgreeWithTheNativeJournal() {
        val origin = System.getenv("GENESIS_PROJECT_ACCESS_HTTP_TEST")
        assumeTrue("Local project access integration fixture is opt-in", origin != null)
        require(origin == "http://127.0.0.1:4338")
        val file = File(requireNotNull(System.getenv("GENESIS_PROJECT_ACCESS_HTTP_TARGET"))).canonicalFile
        require(file.name == "native-project-access-http-target.json" && file.parentFile?.name == "output")
        val target = JSONObject(file.readText()); val space = target.getString("spaceId"); val user = target.getString("userId")
        val http = Http(origin, "editor"); val viewer = Http(origin, "viewer"); val route = "/shared/spaces/$space/members/$user/project-access"
        val directory = ProjectAccessProtocol.members(space, http.call("/shared/spaces/$space"))
        assertEquals("Проверка проектного доступа", directory.getJSONObject("space").getString("title"))
        val initial = ProjectAccessProtocol.snapshot(space, user, http.call(route))
        require(initial.getBoolean("allProjects")); assertTrue(initial.getJSONArray("projects").length() >= target.getInt("expectedProjects"))
        val calls = mutableListOf<String>(); var lose = true
        val access = object : ProjectAccessDraftAccess {
            override fun check() = Unit
            override fun state(space: String, user: String) = http.call(route)
            override fun preview(space: String, user: String, draft: JSONObject) = http.call(route, draft)
            override fun hasTaskQueue() = false
            override fun send(space: String, user: String, body: JSONObject): JSONObject {
                calls += body.toString(); val result = http.call(route, body, "PATCH")
                if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return result
            }
        }
        val storage = MemoryPlanningStorage()
        fun service() = ProjectAccessDraftService(PlanningJournal(storage, contract = ProjectAccessJournalContract), "synthetic-http-actor", access)
        val desired = accessFixture("preview").getJSONObject("desired")
        val edit = ProjectAccessProtocol.newEdit(initial).put("draft", desired)
        var source = service().save(space, user, null, edit)
        source = service().preview(space, user, source.getString("stamp")).getJSONObject("record")
        http.call("/shared/spaces/$space/projects", JSONObject().put("title", "Synthetic concurrent project ${UUID.randomUUID()}"))
        assertEquals("PROJECT_ACCESS_CONFLICT", assertThrows(IllegalArgumentException::class.java) { service().prepare(space, user, source.getString("stamp")) }.message)
        assertEquals(source.toString(), service().load(space, user)!!.toString())
        source = service().preview(space, user, source.getString("stamp")).getJSONObject("record")
        source = service().prepare(space, user, source.getString("stamp"))
        try {
            assertThrows(AuthFailure::class.java) { service().send(space, user, source.getString("stamp")) }
            source = service().load(space, user)!!; assertEquals("pending", source.getString("phase"))
            source = service().send(space, user, source.getString("stamp")); assertEquals("received", source.getString("phase"))
            assertEquals(2, calls.size); assertEquals(calls[0], calls[1])
            val after = ProjectAccessProtocol.snapshot(space, user, http.call(route)); assertEquals(initial.getLong("revision") + 1, after.getLong("revision"))
            val grants = ProjectAccessProtocol.rows(desired.getJSONArray("grants"))
            val denied = grants.first { it.getString("role") == "none" }.getString("projectId")
            assertThrows(AuthApiError::class.java) { viewer.call("/shared/projects/$denied") }
            val root = grants.first { it.getBoolean("includeDescendants") }.getString("projectId")
            assertEquals("member", viewer.call("/shared/projects/$root").getJSONObject("project").getString("role"))
            val future = http.call("/shared/spaces/$space/projects", JSONObject().put("title", "Synthetic inherited child ${UUID.randomUUID()}").put("parentId", root)).getJSONObject("project")
            assertEquals("member", viewer.call("/shared/projects/${future.getString("id")}").getJSONObject("project").getString("role"))
            val replay = http.call(route, ProjectAccessProtocol.body(JSONObject(source.getString("command"))), "PATCH")
            assertEquals(source.getJSONObject("receipt").getLong("revision"), replay.getLong("revision"))
        } finally {
            val restore = JSONObject().put("allProjects", true).put("grants", JSONArray())
            val preview = http.call(route, restore)
            http.call(route, restore.put("expectedFingerprint", preview.getString("fingerprint")).put("operationId", "native-access-restore:${UUID.randomUUID()}"), "PATCH")
            assertTrue(http.call(route).getBoolean("allProjects"))
        }
    }
}
