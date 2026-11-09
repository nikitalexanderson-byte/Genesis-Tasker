package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.UUID

/** Opt-in against the guarded local PHP fixture. Never accepts a remote origin or real account. */
class DataImportHttpIntegrationTest {
    private class Memory : PlanningJournalStorage {
        private val values = mutableMapOf<String, String>()
        override fun <T> locked(block: () -> T): T = synchronized(this, block)
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
    }
    private class Sources : DataImportSources {
        private val values = mutableMapOf<String, String>()
        override fun store(account: String, space: String, project: String, name: String, open: () -> InputStream, current: () -> Unit): JSONObject {
            current(); val bytes = open().use { it.readBytes() }; val id = UUID.randomUUID().toString()
            values[id] = bytes.toString(Charsets.UTF_8)
            return JSONObject().put("id", id).put("name", name).put("bytes", bytes.size)
                .put("sha256", MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
        }
        override fun read(account: String, space: String, project: String, reference: JSONObject, current: () -> Unit): String {
            current(); return values.getValue(reference.getString("id"))
        }
    }
    private class Http(private val origin: String) {
        private var cookie = ""; private var csrf = ""
        init {
            require(origin == "http://127.0.0.1:4338")
            val connection = URI("$origin/__fixture/sign-in?actor=editor").toURL().openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false; assertEquals(302, connection.responseCode)
                cookie = connection.getHeaderField("Set-Cookie").substringBefore(';')
                require(cookie.matches(Regex("GENESISSESSID=[A-Za-z0-9,-]{16,256}")))
            } finally { connection.disconnect() }
            val session = call("/session")
            require(session.getJSONObject("user").getString("email") == "improvements-editor@example.invalid")
            csrf = AuthProtocol.csrf(session.getString("csrf"))
        }
        fun call(path: String, body: JSONObject? = null, source: String? = null): JSONObject {
            require(path.startsWith('/') && !path.contains(".."))
            val connection = URI("$origin/api$path").toURL().openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false; connection.connectTimeout = 10_000; connection.readTimeout = 120_000
                connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Cookie", cookie)
                if (body != null) {
                    connection.requestMethod = "POST"; connection.doOutput = true
                    connection.setRequestProperty("X-CSRF-Token", csrf); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    val streamed = source?.let { DataImportBody(body, it) }; val bytes = if (streamed == null) body.toString().toByteArray(Charsets.UTF_8) else null
                    connection.setFixedLengthStreamingMode(streamed?.length ?: bytes!!.size)
                    connection.outputStream.use { output -> if (streamed != null) streamed.write(output) {} else output.write(bytes!!) }
                }
                val status = connection.responseCode
                val raw = (if (status in 200..299) connection.inputStream else connection.errorStream).bufferedReader().use { it.readText() }
                val response = JSONObject(raw)
                if (status !in 200..299) throw AuthApiError(response.optString("error", "HTTP_$status"))
                return response
            } finally { connection.disconnect() }
        }
    }
    @Test fun realPhpPreviewStreamedApplyReplayHistoryExportAndUndoAgreeWithTheNativeService() {
        val origin = System.getenv("GENESIS_IMPORT_HTTP_TEST")
        assumeTrue("Local integration fixture is opt-in", origin != null)
        require(origin == "http://127.0.0.1:4338")
        val targetFile = File(requireNotNull(System.getenv("GENESIS_IMPORT_HTTP_TARGET"))).canonicalFile
        require(targetFile.name == "native-export-http-target.json" && targetFile.parentFile?.name == "output")
        val target = JSONObject(targetFile.readText()); val space = target.getString("spaceId"); val host = target.getString("projectId")
        require(PlanningLifecycle.id(space) && PlanningLifecycle.id(host) && target.getInt("expectedTasks") == 131)
        val http = Http(origin)
        val project = http.call("/shared/projects/$host").getJSONObject("project")
        require(project.getString("title") == "Проверка экспорта 🌙")
        val selection = importSelection().put("spaceId", space)
        val export = JSONObject().put("scope", "tree").put("projectId", host).put("format", "json")
            .put("from", JSONObject.NULL).put("to", JSONObject.NULL).put("undated", true).put("archived", false)
            .put("calendarMode", "lunar").put("calendarContext", selection.getJSONObject("parse").getJSONObject("calendarContext")).put("titles", JSONObject())
        val manifest = JSONObject(DataExportProtocol.snapshot("json", http.call("/shared/spaces/$space/data-export", export)).getString("content"))
        val firstTask = manifest.getJSONArray("tasks").getJSONObject(0)
        manifest.getJSONArray("history").put(JSONObject().put("key", "http-history").put("projectKey", firstTask.getString("projectKey"))
            .put("taskKey", firstTask.getString("key")).put("actorTitle", "Synthetic source").put("action", "task.updated")
            .put("createdAt", "2026-10-01T00:00:00Z").put("details", JSONObject().put("synthetic", true)))
        val source = manifest.toString()
        var loseApply = true; var loseUndo = true; val attempts = mutableListOf<String>(); var imported: JSONObject? = null
        val access = object : DataImportAccess {
            override fun check() = Unit
            override fun hasTaskQueue(project: String) = false
            override fun preview(selection: JSONObject, content: String) = http.call("/shared/data/preview?view=native-v1", selection, content)
            override fun apply(selection: JSONObject, content: String, operation: String, fingerprint: String): JSONObject {
                val command = JSONObject(selection.toString()).put("operationId", operation).put("fingerprint", fingerprint)
                attempts += command.toString() + content
                val response = http.call("/shared/data/apply?view=native-v1", command, content)
                imported = response
                if (loseApply) { loseApply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
                return response
            }
            override fun imports(space: String, cursor: String?) = http.call("/shared/spaces/$space/data-imports?view=native-v1" + (cursor?.let { "&cursor=$it" } ?: ""))
            override fun undo(import: String): JSONObject {
                val response = http.call("/shared/data-imports/$import/undo", JSONObject())
                if (loseUndo) { loseUndo = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
                return response
            }
            override fun history(project: String, cursor: String?) = http.call("/shared/projects/$project/data-history" + (cursor?.let { "?cursor=$it" } ?: ""))
        }
        val storage = Memory(); val sources = Sources()
        fun service() = DataImportDraftService(PlanningJournal(storage, contract = DataImportJournalContract), DataImportUndoJournal(storage), sources, "synthetic-editor", space, access)
        try {
            val chosen = service().choose(host, null, "http-contract.json", { source.byteInputStream() }, selection)
            val review = service().inspect(host, chosen.getString("stamp")); val preview = review.getJSONObject("preview")
            assertEquals(131, preview.getInt("taskCount")); assertEquals(100, preview.getJSONObject("data").getJSONArray("tasks").length())
            assertTrue("Unexpected import blockers: ${preview.getJSONArray("blockers")}", preview.getBoolean("canApply"))
            assertEquals("America/New_York", preview.getJSONObject("data").getJSONObject("calendarContext").getString("timeZone"))
            val pending = service().prepare(host, review.getJSONObject("record").getString("stamp"))
            assertThrows(AuthFailure::class.java) { service().send(host, pending.getString("stamp")) }
            val restored = service().load(host)!!; assertEquals("pending", restored.getString("phase"))
            val firstImport = requireNotNull(imported).getString("importId")
            val received = service().send(host, restored.getString("stamp")); val receipt = received.getJSONObject("receipt")
            assertEquals("received", received.getString("phase")); assertEquals(firstImport, receipt.getString("importId"))
            assertEquals(2, attempts.size); assertEquals(attempts[0], attempts[1]); assertEquals(131, receipt.getInt("taskCount"))
            val imports = service().imports(null).getJSONArray("imports")
            assertEquals(1, (0 until imports.length()).count { imports.getJSONObject(it).getString("importId") == receipt.getString("importId") })
            val importedProject = receipt.getString("rootProjectId")
            val roundTrip = DataExportProtocol.snapshot("json", http.call("/shared/spaces/$space/data-export", JSONObject(export.toString()).put("projectId", importedProject)))
            assertEquals(131, roundTrip.getInt("taskCount"))
            var cursor: String? = null; var pages = 0; var foundHistory = false
            do {
                val history = service().history(importedProject, cursor); val records = history.getJSONArray("records")
                for (index in 0 until records.length()) if (records.getJSONObject(index).optString("kind") == "history") foundHistory = true
                cursor = history.optString("nextCursor").takeUnless { history.isNull("nextCursor") }; pages++; require(pages <= 10)
            } while (cursor != null)
            assertTrue(foundHistory); assertTrue("Sparse history must retain its continuation cursor", pages > 1)
            assertThrows(AuthFailure::class.java) { service().undo(receipt) }
            assertEquals(1, service().pendingUndos().size); assertEquals("undone", service().undo(receipt).getString("state"))
            assertTrue(service().pendingUndos().isEmpty()); assertEquals("undone", service().undoOutcomes().single().getString("state"))
        } finally {
            imported?.let { http.call("/shared/data-imports/${it.getString("importId")}/undo", JSONObject()) }
        }
    }
}
