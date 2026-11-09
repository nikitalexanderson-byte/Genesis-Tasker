package ru.genesis.calendar.auth

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

/** Opt-in loopback only; rules, tasks and jobs belong solely to this test's new synthetic project. */
class SharedAutomationHttpIntegrationTest {
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
        fun call(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST", setup: Boolean = false): JSONObject {
            require(path.startsWith('/') && !path.contains(".."))
            if (path.contains("/automations")) require(allowedSharedRoute(method, path) || setup && method == "POST" && path.matches(Regex("/shared/projects/[a-f0-9-]{36}/automations")))
            val request = HttpRequest.newBuilder(URI("$origin/api$path")).timeout(Duration.ofSeconds(60)).header("Cookie", cookie).header("Accept", "application/json")
            if (body != null) request.header("X-CSRF-Token", csrf).header("Content-Type", "application/json; charset=utf-8")
            val response = client.send(request.method(method, body?.let { HttpRequest.BodyPublishers.ofString(it.toString()) } ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
            val data = JSONObject(response.body()); if (response.statusCode() !in 200..299) throw AuthApiError(data.optString("error", "HTTP_${response.statusCode()}"))
            return data
        }
    }
    @Test fun phpLibraryAndRunPagesPreserveReceiptsCasAndPausedRestoreThroughAllowedNativeRoutes() {
        val origin = System.getenv("GENESIS_AUTOMATIONS_HTTP_TEST"); assumeTrue("Local automation HTTP fixture is opt-in", origin != null)
        require(origin == "http://127.0.0.1:4338")
        val target = File(requireNotNull(System.getenv("GENESIS_AUTOMATIONS_HTTP_TARGET"))).canonicalFile
        require(target.parentFile?.name == "output" && target.name == "native-export-http-target.json")
        val space = SharedAutomationProtocol.id(JSONObject(target.readText()).getString("spaceId")); val http = Http(origin)
        var created: String? = null
        try {
            val project = http.call("/shared/spaces/$space/projects", JSONObject().put("title", "C2 HTTP ${UUID.randomUUID()}").put("layout", "list")).getJSONObject("project").getString("id")
            created = project; val root = "/shared/projects/$project/automations"
            val rules = (0 until 51).map { index -> http.call(root, JSONObject().put("operationId", UUID.randomUUID().toString()).put("title", "C2 fixture $index")
                .put("enabled", false).put("definition", automationDefinitionFixture()), setup = true).getJSONObject("rule") }
            val first = SharedAutomationProtocol.list(http.call("$root?deleted=false"), project)
            assertEquals(50, first.getJSONArray("rules").length()); assertFalse(first.isNull("nextCursor"))
            val second = SharedAutomationProtocol.list(http.call("$root?deleted=false&cursor=${first.getString("nextCursor")}"), project)
            assertEquals(1, second.getJSONArray("rules").length()); assertTrue(second.isNull("nextCursor"))
            val id = rules.first().getString("id"); var rule = SharedAutomationProtocol.rule(http.call("$root/$id").getJSONObject("rule"), project)
            assertTrue(rule.getBoolean("canManage")); assertEquals("lunar", rule.getJSONObject("definition").getString("calendarMode"))
            assertEquals("America/New_York", rule.getJSONObject("definition").getJSONObject("calendarContext").getString("timeZone"))
            val enable = JSONObject().put("operationId", UUID.randomUUID().toString()).put("expectedRevision", rule.getInt("revision")).put("enabled", true)
            val receipt = http.call("$root/$id", enable, "PATCH")
            assertEquals(PlanningLifecycle.canonical(receipt), PlanningLifecycle.canonical(http.call("$root/$id", enable, "PATCH")))
            rule = SharedAutomationProtocol.rule(http.call("$root/$id").getJSONObject("rule"), project); assertEquals(2, rule.getInt("revision"))
            val snapshot = http.call("/shared/projects/$project"); val status = snapshot.getJSONArray("statuses").getJSONObject(0).getString("id")
            repeat(51) { index -> http.call("/shared/projects/$project/tasks", JSONObject().put("title", "C2 run task $index").put("statusId", status).put("requestId", UUID.randomUUID().toString())) }
            val history = SharedAutomationProtocol.runs(http.call("$root/$id/runs"), id); assertEquals(50, history.getJSONArray("runs").length())
            val older = SharedAutomationProtocol.runs(http.call("$root/$id/runs?cursor=${history.getString("nextCursor")}"), id); assertEquals(1, older.getJSONArray("runs").length())
            val run = history.getJSONArray("runs").getJSONObject(0)
            assertTrue(run.getString("taskTitle").startsWith("C2 run task")); assertEquals("pending", run.getString("state"))
            val failure = assertThrows(AuthApiError::class.java) { http.call("$root/$id/runs/${run.getString("id")}/retry", JSONObject().put("operationId", UUID.randomUUID().toString()).put("expectedRevision", 2)) }
            assertEquals("AUTOMATION_RETRY_UNAVAILABLE", failure.code)
            fun change(patch: JSONObject): JSONObject {
                val body = JSONObject(patch.toString()).put("operationId", UUID.randomUUID().toString()).put("expectedRevision", rule.getInt("revision"))
                val result = http.call("$root/$id", body, "PATCH"); rule = SharedAutomationProtocol.rule(result.getJSONObject("rule"), project); return result
            }
            change(JSONObject().put("enabled", false)); change(JSONObject().put("deleted", true).put("enabled", false))
            assertEquals(1, SharedAutomationProtocol.list(http.call("$root?deleted=true"), project).getJSONArray("rules").length())
            change(JSONObject().put("deleted", false).put("enabled", false)); assertFalse(rule.getBoolean("deleted")); assertFalse(rule.getBoolean("enabled"))
            assertEquals(5, rule.getInt("revision")); assertEquals(0, rule.getJSONObject("definition").getJSONArray("actions").getJSONObject(0).getInt("value"))
            val reused = assertThrows(AuthApiError::class.java) { http.call("$root/$id", JSONObject(enable.toString()).put("enabled", false), "PATCH") }
            assertEquals("AUTOMATION_OPERATION_REUSED", reused.code)
        } finally {
            created?.let { project -> http.call("/shared/projects/$project/archive", JSONObject()) }
        }
    }
}
