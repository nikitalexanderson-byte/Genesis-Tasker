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

/** Existing guarded loopback actor; no remote origin or session file is accepted. */
class CustomFieldHttpIntegrationTest {
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
            val builder = HttpRequest.newBuilder(URI("$origin/api$path")).timeout(Duration.ofSeconds(60)).header("Cookie", cookie).header("Accept", "application/json")
            if (body != null) builder.header("X-CSRF-Token", csrf).header("Content-Type", "application/json; charset=utf-8")
            val response = client.send(builder.method(method, body?.let { HttpRequest.BodyPublishers.ofString(it.toString()) } ?: HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString())
            val value = JSONObject(response.body())
            if (response.statusCode() !in 200..299) throw AuthApiError(value.optString("error", "HTTP_${response.statusCode()}"))
            return value
        }
    }
    @Test fun realPhpCreationRequiresTypedValuesAndLostResponseReplayCreatesOnlyOneTask() {
        val origin = System.getenv("GENESIS_CUSTOM_FIELDS_HTTP_TEST")
        assumeTrue("Local custom field integration fixture is opt-in", origin != null); require(origin == "http://127.0.0.1:4338")
        val file = File(requireNotNull(System.getenv("GENESIS_CUSTOM_FIELDS_HTTP_TARGET"))).canonicalFile
        require(file.name == "native-custom-fields-http-target.json" && file.parentFile?.name == "output")
        val target = JSONObject(file.readText()); val space = target.getString("spaceId"); val project = target.getString("projectId")
        CustomFieldProtocol.id(space); CustomFieldProtocol.id(project)
        val http = Http(origin); val route = "/shared/projects/$project/tasks"
        val snapshot = http.call("/shared/projects/$project")
        require(snapshot.getJSONObject("project").getString("title") == "Карточка с полями")
        val fields = CustomFieldProtocol.definitions(space, project, snapshot.getJSONArray("customFieldDefinitions"))
        val status = snapshot.getJSONArray("statuses").getJSONObject(0).getString("id")
        val keys = target.getJSONObject("fields"); fun key(type: String) = keys.getString(type)
        val state = ru.genesis.calendar.ui.SharedTaskCustomCreation.initial(project,
            ru.genesis.calendar.data.UiPreferences(input = ru.genesis.calendar.domain.CalendarMode.LUNAR))
        var draft = CustomFieldDraft.fromTask(state.source).change(key("number"), "0,0").change(key("checkbox"), false)
            .change(key("date"), "2026-10-21").change(key("select"), "first").change(key("multi"), JSONArray().put("second").put("first"))
            .change(key("text"), "Авторский текст 🌿").change(key("url"), "https://example.invalid/task")
        state.change(ru.genesis.calendar.ui.sharedTaskWithCustomFields(state.source, state.details, draft))
        val binding = ru.genesis.calendar.ui.bindSharedTaskCustom(state.source, state.details, snapshot)
        assertTrue(binding.valid)
        val title = "C3 native create ${UUID.randomUUID()}"
        fun command() = state.fields(binding).put("title", title).put("statusId", status).put("requestId", UUID.randomUUID().toString())
        assertEquals("CUSTOM_FIELD_REQUIRED", assertThrows(AuthApiError::class.java) {
            http.call(route, JSONObject().put("title", title).put("statusId", status).put("requestId", UUID.randomUUID().toString()))
        }.code)
        val wrongNumber = command().apply { getJSONObject("customFields").put(key("number"), "0") }
        assertEquals("CUSTOM_FIELD_VALUE_INVALID", assertThrows(AuthApiError::class.java) { http.call(route, wrongNumber) }.code)
        val retired = command().apply { getJSONObject("customFields").put(key("select"), "retired") }
        assertEquals("CUSTOM_FIELD_OPTION_UNAVAILABLE", assertThrows(AuthApiError::class.java) { http.call(route, retired) }.code)
        var createdId: String? = null
        try {
            val body = command(); val frozen = body.toString()
            val first = http.call(route, body).getJSONObject("task"); createdId = first.getString("id")
            // Deliberately lose the first success before acknowledging a frozen create request.
            val replay = http.call(route, JSONObject(frozen))
            confirmedSharedReceipt("create", project, null, JSONObject(frozen), replay)
            assertEquals(createdId, replay.getJSONObject("task").getString("id")); assertEquals(first.getInt("revision"), replay.getJSONObject("task").getInt("revision"))
            val stored = CustomFieldProtocol.fromTask(replay.getJSONObject("task"))
            assertEquals(0.0, stored.getDouble(key("number")), 0.0); assertEquals(false, stored.get(key("checkbox")))
            assertEquals("2026-10-21", stored.getString(key("date"))); assertEquals("Авторский текст 🌿", stored.getString(key("text")))
            assertFalse(stored.has(key("archived"))); assertEquals(frozen, body.toString())
            val tasks = PlanningLifecycle.rows(http.call("/shared/projects/$project").getJSONArray("tasks"))
            assertEquals(1, tasks.count { it.getString("title") == title })
        } finally {
            createdId?.let { id ->
                val current = http.call("$route/$id").getJSONObject("task")
                assertTrue(http.call("$route/$id", JSONObject().put("expectedRevision", current.getInt("revision"))
                    .put("requestId", UUID.randomUUID().toString()).put("retentionDays", 1), "DELETE").getBoolean("ok"))
            }
        }
    }
    @Test fun realPhpTaskPatchReplayExplicitClearAndRebasePreserveZeroFalseAndUnchangedHistory() {
        val origin = System.getenv("GENESIS_CUSTOM_FIELDS_HTTP_TEST")
        assumeTrue("Local custom field integration fixture is opt-in", origin != null); require(origin == "http://127.0.0.1:4338")
        val file = File(requireNotNull(System.getenv("GENESIS_CUSTOM_FIELDS_HTTP_TARGET"))).canonicalFile
        require(file.name == "native-custom-fields-http-target.json" && file.parentFile?.name == "output")
        val target = JSONObject(file.readText()); val space = target.getString("spaceId"); val project = target.getString("projectId"); val id = target.getString("taskId")
        listOf(space, project, id).forEach(CustomFieldProtocol::id)
        val http = Http(origin); val route = "/shared/projects/$project/tasks/$id"
        val snapshot = http.call("/shared/projects/$project"); require(snapshot.getJSONObject("project").getString("title") == "Карточка с полями")
        val fields = CustomFieldProtocol.definitions(space, project, snapshot.getJSONArray("customFieldDefinitions"))
        val initial = http.call(route).getJSONObject("task"); val original = CustomFieldProtocol.fromTask(initial)
        require(initial.getString("title") == "Задача с семью типами полей")
        val keys = target.getJSONObject("fields")
        fun key(type: String) = keys.getString(type)
        fun body(task: JSONObject, patch: JSONObject) = JSONObject().put("requestId", UUID.randomUUID().toString()).put("expectedRevision", task.getInt("revision")).put("customFields", patch)
        try {
            val selected = CustomFieldDraft.fromTask(initial).change(key("number"), "0").change(key("checkbox"), true)
                .change(key("multi"), JSONArray().put("first").put("second").put("retired"))
            val command = body(initial, selected.patch(fields)); val frozen = command.toString()
            // The HTTP success is deliberately not acknowledged on the first attempt.
            val committed = http.call(route, command).getJSONObject("task")
            val replay = http.call(route, JSONObject(frozen)); confirmedSharedReceipt("update", project, id, JSONObject(frozen), replay)
            assertEquals(committed.getInt("revision"), replay.getJSONObject("task").getInt("revision")); assertEquals(frozen, command.toString())
            val cleared = CustomFieldDraft.fromTask(replay.getJSONObject("task")).change(key("checkbox"), false).change(key("text"), null)
            val clearBody = body(replay.getJSONObject("task"), cleared.patch(fields)); val changed = http.call(route, clearBody)
            confirmedSharedReceipt("update", project, id, clearBody, changed)
            val values = changed.getJSONObject("task").getJSONObject("customFields")
            assertEquals(0.0, values.getDouble(key("number")), 0.0); assertEquals(false, values.get(key("checkbox"))); assertFalse(values.has(key("text")))
            assertEquals(original.get(key("archived")), values.get(key("archived"))); assertEquals("retired", values.getString(key("select")))
            val own = CustomFieldDraft.fromTask(changed.getJSONObject("task")).change(key("text"), "Собственная правка")
            val pending = body(changed.getJSONObject("task"), own.patch(fields)); val kept = own.snapshot().toString()
            http.call(route, JSONObject().put("requestId", UUID.randomUUID().toString()).put("expectedRevision", changed.getJSONObject("task").getInt("revision")).put("priority", 2))
            assertEquals("SHARED_TASK_CONFLICT", assertThrows(AuthApiError::class.java) { http.call(route, pending) }.code); assertEquals(kept, own.snapshot().toString())
            val current = http.call(route).getJSONObject("task"); val rebased = own.rebase(current, fields); val rebasedBody = body(current, rebased.patch(fields))
            val accepted = http.call(route, rebasedBody); confirmedSharedReceipt("update", project, id, rebasedBody, accepted)
            assertEquals(2, accepted.getJSONObject("task").getInt("priority")); assertEquals("Собственная правка", accepted.getJSONObject("task").getJSONObject("customFields").getString(key("text")))
        } finally {
            val current = http.call(route).getJSONObject("task"); val restore = body(current, original).put("priority", initial.getInt("priority"))
            confirmedSharedReceipt("update", project, id, restore, http.call(route, restore))
        }
    }
}
