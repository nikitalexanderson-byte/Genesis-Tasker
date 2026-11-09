package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.ui.mergePlanningPage
import ru.genesis.calendar.ui.planningTaskFilter
import ru.genesis.calendar.ui.validatePlanning
import java.io.ByteArrayInputStream
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.time.LocalDate
import java.util.Base64
import java.util.UUID
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

/** Opt-in real native HTTPS transport into an isolated loopback PHP fixture, never a user's session. */
class NativePlanningHttpsIntegrationTest {
    private lateinit var app: Context
    private lateinit var client: AuthSessionClient
    private var generation = 0L
    private var previousTls: SSLSocketFactory? = null
    private var fixtureCookie = ""
    private var fixtureCsrf = ""
    private var project: String? = null
    private lateinit var space: String
    private lateinit var actor: String
    private fun id() = UUID.randomUUID().toString()
    private fun rows(value: JSONArray) = PlanningLifecycle.rows(value)
    private fun copy(value: JSONObject) = JSONObject(value.toString())

    @Before fun isolatedSession() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("HTTPS fixture is opt-in", args.getString("genesisPlanningHttps") == "true")
        app = InstrumentationRegistry.getInstrumentation().targetContext
        check(app.packageName == "ru.genesis.calendar.ghttps.debug" && BuildConfig.DEBUG)
        check(AUTH_ORIGIN == "https://localhost:4443")
        space = requireNotNull(args.getString("genesisPlanningSpace")).also { require(UUID.fromString(it).toString() == it) }
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(
            Base64.getDecoder().decode(requireNotNull(args.getString("genesisFixtureCa")))))
        val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("loopback-fixture", certificate) }
        val managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
        previousTls = HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) }.socketFactory)
        // Hostname verification is unchanged. The generated certificate names only localhost/127.0.0.1.
        assertTrue(raw("GET", "/health").getBoolean("fixture"))
        val signIn = URL("$AUTH_ORIGIN/__fixture/sign-in?actor=editor").openConnection() as HttpsURLConnection
        try {
            signIn.instanceFollowRedirects = false
            assertEquals(302, signIn.responseCode)
            val cookie = requireNotNull(signIn.getHeaderField("Set-Cookie")).substringBefore(';')
            check(cookie.startsWith("$SESSION_COOKIE="))
            fixtureCookie = cookie.substringAfter('='); check(fixtureCookie.matches(Regex("[A-Za-z0-9,-]{16,256}")))
        } finally { signIn.disconnect() }
        val session = raw("GET", "/api/session")
        check(session.getJSONObject("user").getString("email") == "improvements-editor@example.invalid")
        actor = session.getJSONObject("user").getString("uid")
        fixtureCsrf = AuthProtocol.csrf(session.getString("csrf"))
        installFixtureSession()
        client = AuthSessionClient(app); generation = client.begin()
        check(client.session(generation).getJSONObject("user").getString("email") == "improvements-editor@example.invalid")
        project = client.createSharedProject(generation, space, JSONObject().put("title", "G HTTPS ${id()}").put("layout", "board"))
            .getJSONObject("project").getString("id")
    }

    private fun installFixtureSession() {
        val secret = JSONObject().put("cookie", fixtureCookie).put("csrf", fixtureCsrf).put("expiresAt", System.currentTimeMillis() + 3_600_000)
        check(app.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE).edit()
            .putString("session", LocalCipher().encrypt(secret.toString(), "genesis.native.auth.v2")).commit())
    }

    private fun readOnlyFixtureClient(): Pair<AuthSessionClient, Long> {
        val editorCookie = fixtureCookie; val editorCsrf = fixtureCsrf
        try {
            val signIn = URL("$AUTH_ORIGIN/__fixture/sign-in?actor=viewer").openConnection() as HttpsURLConnection
            try {
                signIn.instanceFollowRedirects = false
                assertEquals(302, signIn.responseCode)
                val cookie = requireNotNull(signIn.getHeaderField("Set-Cookie")).substringBefore(';')
                check(cookie.startsWith("$SESSION_COOKIE="))
                fixtureCookie = cookie.substringAfter('='); check(fixtureCookie.matches(Regex("[A-Za-z0-9,-]{16,256}")))
            } finally { signIn.disconnect() }
            val session = raw("GET", "/api/session")
            check(session.getJSONObject("user").getString("email") == "improvements-viewer@example.invalid")
            fixtureCsrf = AuthProtocol.csrf(session.getString("csrf")); installFixtureSession()
            val viewer = AuthSessionClient(app); val viewerGeneration = viewer.begin()
            check(viewer.session(viewerGeneration).getJSONObject("user").getString("uid") == session.getJSONObject("user").getString("uid"))
            return viewer to viewerGeneration
        } finally {
            fixtureCookie = editorCookie; fixtureCsrf = editorCsrf; installFixtureSession()
        }
    }

    @After fun cleanup() {
        try {
            if (::client.isInitialized) {
                project?.let { client.setSharedProjectArchived(generation, it, true) }
            }
        } finally {
            try { if (::client.isInitialized) client.clear(client.currentGeneration()) }
            finally { previousTls?.let(HttpsURLConnection::setDefaultSSLSocketFactory) }
            fixtureCookie = ""; fixtureCsrf = ""
        }
    }

    private fun raw(method: String, path: String, body: JSONObject? = null): JSONObject {
        check(path.startsWith('/') && !path.contains(".."))
        val connection = URL("$AUTH_ORIGIN$path").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 15_000; connection.readTimeout = 60_000
            connection.requestMethod = method
            if (fixtureCookie.isNotEmpty()) connection.setRequestProperty("Cookie", "$SESSION_COOKIE=$fixtureCookie")
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                if (fixtureCsrf.isNotEmpty()) connection.setRequestProperty("X-CSRF-Token", fixtureCsrf)
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            check(connection.responseCode in 200..299) { "Isolated fixture HTTP ${connection.responseCode}" }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun planning() = client.sharedPlanning(generation, requireNotNull(project))
    private fun settings(unit: String = "points"): JSONObject = JSONObject().put("kind", "settings")
        .put("expectedRevision", planning().getJSONObject("config").getInt("revision")).put("enabled", true).put("estimateUnit", unit)
    private fun send(edit: JSONObject) = client.sharedPlanningCommand(generation, requireNotNull(project), PlanningLifecycle.command(edit, id()))
    private fun sprint(title: String, mode: String = "profane", yearStart: String = "january"): JSONObject {
        val today = LocalDate.now()
        return send(JSONObject().put("kind", "sprint").put("sprintId", JSONObject.NULL).put("expectedRevision", 0).put("draft",
            JSONObject().put("title", title).put("goal", "Native HTTPS acceptance").put("startDate", today.minusDays(1).toString()).put("endDate", today.plusDays(7).toString())
                .put("calendarMode", mode).put("calendarContext", JSONObject().put("version", 2).put("timeZone", "UTC").put("gregorianYearStart", yearStart))))
            .getJSONObject("sprint")
    }
    private fun task(title: String, status: String, sprint: String, points: Number? = null, hours: Number? = null, assignee: String? = null): JSONObject =
        client.createSharedTask(generation, requireNotNull(project), JSONObject().put("requestId", id()).put("title", title).put("statusId", status)
            .put("sprintId", sprint).put("storyPoints", points ?: JSONObject.NULL).put("estimateHours", hours ?: JSONObject.NULL)
            .apply { if (assignee != null) put("assigneeId", assignee) }).getJSONObject("task")
    private fun patch(task: JSONObject, body: JSONObject): JSONObject = client.updateSharedTask(generation, requireNotNull(project), task.getString("id"), copy(body)
        .put("expectedRevision", task.getInt("revision")).put("requestId", id())).getJSONObject("task")
    private fun transition(sprint: JSONObject, action: String, remaining: List<JSONObject> = emptyList(), choices: JSONObject = JSONObject()): JSONObject =
        send(JSONObject().put("kind", "transition").put("sprintId", sprint.getString("id")).put("expectedRevision", sprint.getInt("revision"))
            .put("fingerprint", planning().getString("fingerprint")).put("action", action).put("tasks", JSONArray(remaining.map { PlanningLifecycle.referenceForTask(it, requireNotNull(project)) })).put("choices", choices))
            .getJSONObject("sprint")

    @Test fun nativeHttpsLifecycleEstimatesWorkflowAndReportShareExistingTasksAndHistory() {
        val p = requireNotNull(project)
        val statuses = rows(client.sharedProject(generation, p).getJSONArray("statuses"))
        val todo = statuses.first().getString("id"); val doing = statuses[1].getString("id"); val done = statuses.last().getString("id")
        assertFalse(planning().getJSONObject("config").getBoolean("enabled")); send(settings())
        val a = sprint("Native sprint A"); val b = sprint("Native sprint B")
        var zero = task("Known zero", todo, a.getString("id"), 0, 2.5, actor)
        var estimated = task("Estimated", todo, a.getString("id"), 3.5, 0)
        var unknown = task("Unestimated", todo, a.getString("id"))
        val totals = planning().getJSONObject("totals").getJSONObject(a.getString("id"))
        assertEquals(3, totals.getInt("count")); assertEquals(3.5, totals.getJSONObject("points").getDouble("value"), 0.0)
        assertEquals(1, totals.getJSONObject("points").getInt("unestimated")); assertEquals(2.5, totals.getJSONObject("hours").getDouble("value"), 0.0)
        val assigneeTotals = planning().getJSONObject("byAssignee").getJSONObject(a.getString("id")).getJSONObject(actor)
        assertEquals(0.0, assigneeTotals.getJSONObject("points").getDouble("value"), 0.0)
        assertEquals(0, assigneeTotals.getJSONObject("points").getInt("unestimated"))
        assertTrue(unknown.isNull("storyPoints")); assertEquals(0.0, zero.getDouble("storyPoints"), 0.0)
        val active = transition(a, "start")
        val observed = SprintReportProtocol.snapshot(p, a.getString("id"), "tasks", client.sharedSprintReport(generation, p, a.getString("id"), "tasks"))
        zero = patch(zero, JSONObject().put("title", "Legacy-shaped title edit"))
        assertEquals(0.0, zero.getDouble("storyPoints"), 0.0); assertEquals(2.5, zero.getDouble("estimateHours"), 0.0)
        val workflow = WorkflowLifecycle.newEdit(WorkflowLifecycle.snapshot(p, client.sharedWorkflow(generation, p)))
        rows(workflow.getJSONObject("draft").getJSONArray("statuses")).first { it.getString("statusId") == doing }.put("wipLimit", 1)
        client.saveSharedWorkflow(generation, p, WorkflowLifecycle.command(workflow, id()).getJSONObject("body"))
        zero = patch(zero, JSONObject().put("statusId", doing))
        val changed = assertThrows(AuthApiError::class.java) { client.checkSharedSprintReport(generation, p, a.getString("id"), observed.getString("token")) }
        assertEquals("REPORT_CHANGED", changed.code)
        val failure = assertThrows(WorkflowFailure::class.java) { patch(estimated, JSONObject().put("statusId", doing)) }
        assertEquals("WORKFLOW_WIP_LIMIT", failure.code)
        assertEquals(todo, client.sharedTask(generation, p, estimated.getString("id")).getJSONObject("task").getString("statusId"))
        zero = patch(zero, JSONObject().put("statusId", todo).put("storyPoints", 5.5))
        estimated = patch(estimated, JSONObject().put("statusId", doing))
        unknown = patch(unknown, JSONObject().put("statusId", done))
        assertEquals(done, unknown.getString("statusId"))
        val currentWorkflow = WorkflowLifecycle.snapshot(p, client.sharedWorkflow(generation, p))
        val history = WorkflowLifecycle.history(null, client.sharedWorkflowHistory(generation, p, null), null, currentWorkflow.getJSONObject("config").getLong("revision"))
        assertTrue(history.getJSONArray("versions").length() > 0)
        val completed = transition(active, "complete", listOf(zero, estimated), JSONObject().put(zero.getString("id"), "backlog").put(estimated.getString("id"), b.getString("id")))
        assertEquals("completed", completed.getString("state"))
        assertTrue(client.sharedTask(generation, p, zero.getString("id")).getJSONObject("task").isNull("sprintId"))
        assertEquals(b.getString("id"), client.sharedTask(generation, p, estimated.getString("id")).getJSONObject("task").getString("sprintId"))
        for (unit in SprintReportProtocol.units) {
            val report = SprintReportProtocol.snapshot(p, a.getString("id"), unit, client.sharedSprintReport(generation, p, a.getString("id"), unit))
            assertEquals(3, report.getJSONObject("flow").getJSONObject("summary").getJSONObject("plan").getInt("tasks"))
            assertTrue(client.checkSharedSprintReport(generation, p, a.getString("id"), report.getString("token")).getBoolean("unchanged"))
            val query = SprintReportProtocol.query("tasks", "plan")
            val sources = SprintReportProtocol.sources(report, query, client.sharedSprintReportSources(generation, p, a.getString("id"), report.getString("token"), query, null))
            assertEquals(3, sources.getInt("total")); assertEquals(3, sources.getJSONArray("items").length())
        }
        send(settings("hours"))
        assertEquals(5.5, client.sharedTask(generation, p, zero.getString("id")).getJSONObject("task").getDouble("storyPoints"), 0.0)
        assertEquals(2.5, client.sharedTask(generation, p, zero.getString("id")).getJSONObject("task").getDouble("estimateHours"), 0.0)
    }

    @Test fun committedLostHttpsReplyReplaysTheSameCommandAndRejectsAStaleRevision() {
        val p = requireNotNull(project); send(settings())
        val edit = settings("hours"); val sent = mutableListOf<String>()
        val access = object : PlanningDraftAccess {
            override fun check() { check(client.isCurrent(generation)) }
            override fun planning(projectId: String) = client.sharedPlanning(generation, projectId)
            override fun tasks(filter: JSONObject, cursor: String?) = client.querySharedTasks(generation, filter, cursor)
            override fun hasTaskQueue(projectId: String) = false // This isolated package only uses AuthSessionClient, never the task outbox.
            override fun send(projectId: String, command: JSONObject): JSONObject {
                sent.add(command.toString()); return client.sharedPlanningCommand(generation, projectId, command)
            }
        }
        fun service() = PlanningDraftService(PlanningJournal(PlanningDraftStore(app)), actor, access)
        val service = service()
        val editing = service.save(p, null, edit)
        val queued = service.prepare(p, editing.getString("stamp"))
        val frozen = queued.getString("command")
        raw("POST", "/__fixture/drop-next", JSONObject().put("method", "PUT").put("path", "/api/shared/projects/$p/planning"))
        val failure = assertThrows(AuthFailure::class.java) { service.send(p, queued.getString("stamp")) }
        assertEquals(AuthFailure.Kind.NETWORK, failure.kind)
        client = AuthSessionClient(app); generation = client.begin()
        val reopened = service(); val pending = requireNotNull(reopened.load(p))
        assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts")); assertEquals(frozen, pending.getString("command"))
        val receipt = reopened.send(p, pending.getString("stamp"))
        assertEquals("received", receipt.getString("phase")); assertEquals(listOf(frozen, frozen), sent)
        assertEquals(PlanningLifecycle.canonical(receipt), PlanningLifecycle.canonical(reopened.send(p, receipt.getString("stamp"))))
        assertEquals(2, sent.size)
        assertEquals(2, planning().getJSONObject("config").getInt("revision")); assertEquals("hours", planning().getJSONObject("config").getString("estimateUnit"))
        val conflict = assertThrows(AuthApiError::class.java) { client.sharedPlanningCommand(generation, p, PlanningLifecycle.command(edit, id())) }
        assertEquals("PLANNING_CONFLICT", conflict.code)
        reopened.remove(p, receipt.getString("stamp")); assertNull(reopened.load(p))
    }

    @Test fun nativePagesAndThreeReportUnitsKeepAll131TasksAndIndependentCalendarContexts() {
        val p = requireNotNull(project); send(settings())
        val a = sprint("Paginated sprint", "profane", "march")
        val lunar = sprint("Lunar input", "lunar"); val solar = sprint("Solar input", "sacred")
        val status = client.sharedProject(generation, p).getJSONArray("statuses").getJSONObject(0).getString("id")
        repeat(131) { index -> task("Page task $index", status, a.getString("id"), if (index % 2 == 0) 0 else null, if (index % 2 == 0) 2.5 else null) }
        val filter = planningTaskFilter(p, a.getString("id"))
        val first = mergePlanningPage(p, null, client.querySharedTasks(generation, filter, null), false)
        assertEquals(100, first.getJSONArray("tasks").length()); assertEquals(131, first.getInt("total"))
        val all = mergePlanningPage(p, first, client.querySharedTasks(generation, filter, first.getString("nextCursor")), true)
        assertEquals(131, all.getJSONArray("tasks").length()); assertTrue(all.isNull("nextCursor"))
        val current = validatePlanning(p, planning())
        for (sprint in listOf(a, lunar, solar)) {
            val saved = rows(current.getJSONArray("sprints")).single { it.getString("id") == sprint.getString("id") }
            assertEquals(sprint.getString("calendarMode"), saved.getString("calendarMode"))
            assertEquals(sprint.getString("startDate"), saved.getString("startDate")); assertEquals(sprint.getString("endDate"), saved.getString("endDate"))
            assertEquals(sprint.getJSONObject("calendarContext").getString("gregorianYearStart"), saved.getJSONObject("calendarContext").getString("gregorianYearStart"))
        }
        transition(a, "start")
        for (unit in SprintReportProtocol.units) {
            val report = SprintReportProtocol.snapshot(p, a.getString("id"), unit, client.sharedSprintReport(generation, p, a.getString("id"), unit))
            val metric = report.getJSONObject("flow").getJSONObject("summary").getJSONObject("plan")
            assertEquals(131, metric.getInt("tasks")); assertEquals(if (unit == "tasks") 0 else 65, metric.getInt("unestimated"))
            assertEquals(0, metric.getInt("unknownTasks"))
            assertEquals(when (unit) { "tasks" -> 131.0; "points" -> 0.0; else -> 165.0 }, metric.getDouble("knownValue"), 0.0)
            val query = SprintReportProtocol.query("tasks", "plan")
            val page = SprintReportProtocol.sources(report, query, client.sharedSprintReportSources(generation, p, a.getString("id"), report.getString("token"), query, null))
            assertEquals(100, page.getJSONArray("items").length())
            val full = SprintReportProtocol.sources(report, query, client.sharedSprintReportSources(generation, p, a.getString("id"), report.getString("token"), query, page.getString("nextCursor")), page)
            assertEquals(131, full.getJSONArray("items").length()); assertTrue(full.isNull("nextCursor"))
        }
    }

    @Test fun nativeHttpsReadOnlyRightsAndRevocationProtectPlanningWorkflowAndReportSources() {
        val p = requireNotNull(project); send(settings())
        val a = sprint("Read-only and revoked report")
        val status = client.sharedProject(generation, p).getJSONArray("statuses").getJSONObject(0).getString("id")
        val item = task("Only currently authorized readers", status, a.getString("id"), 3, 2.5)
        transition(a, "start")
        val (viewer, vg) = readOnlyFixtureClient()
        val viewerId = viewer.session(vg).getJSONObject("user").getString("uid")
        val permissions = viewer.sharedPlanning(vg, p).getJSONObject("context").getJSONObject("permissions")
        for (key in listOf("editTasks", "organizeTasks", "manageProjects")) assertFalse(permissions.getBoolean(key))
        val workflow = WorkflowLifecycle.snapshot(p, viewer.sharedWorkflow(vg, p))
        assertFalse(workflow.getJSONObject("context").getJSONObject("project").getJSONObject("permissions").getBoolean("manageProjects"))
        val report = SprintReportProtocol.snapshot(p, a.getString("id"), "points", viewer.sharedSprintReport(vg, p, a.getString("id"), "points"))
        val query = SprintReportProtocol.query("tasks", "plan")
        val sources = SprintReportProtocol.sources(report, query, viewer.sharedSprintReportSources(vg, p, a.getString("id"), report.getString("token"), query, null))
        assertEquals(1, sources.getInt("total"))
        fun forbidden(block: () -> Unit) {
            val failure = assertThrows(AuthFailure::class.java, block)
            assertEquals(AuthFailure.Kind.UNAUTHORIZED, failure.kind); assertEquals(403, failure.httpStatus)
        }
        forbidden { viewer.sharedPlanningCommand(vg, p, PlanningLifecycle.command(settings("hours"), id())) }
        forbidden { viewer.saveSharedWorkflow(vg, p, WorkflowLifecycle.command(WorkflowLifecycle.newEdit(workflow), id()).getJSONObject("body")) }
        forbidden { viewer.updateSharedTask(vg, p, item.getString("id"), JSONObject().put("requestId", id()).put("expectedRevision", item.getInt("revision")).put("storyPoints", 8)) }
        client.removeSharedMember(generation, p, viewerId)
        for (read in listOf<() -> Unit>(
            { viewer.sharedPlanning(vg, p) }, { viewer.sharedWorkflow(vg, p) },
            { viewer.sharedSprintReport(vg, p, a.getString("id"), "points") },
            { viewer.checkSharedSprintReport(vg, p, a.getString("id"), report.getString("token")) },
            { viewer.sharedSprintReportSources(vg, p, a.getString("id"), report.getString("token"), query, null) },
            { viewer.sharedSprintSourceTask(vg, p, item.getString("id"), false) }
        )) {
            val failure = assertThrows(AuthFailure::class.java, read)
            assertEquals(404, failure.httpStatus)
        }
        assertEquals(3.0, client.sharedTask(generation, p, item.getString("id")).getJSONObject("task").getDouble("storyPoints"), 0.0)
    }
}
