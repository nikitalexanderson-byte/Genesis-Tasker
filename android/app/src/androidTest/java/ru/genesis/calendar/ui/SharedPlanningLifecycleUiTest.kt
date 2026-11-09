package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.util.UUID
import java.io.File

/** Deterministically hold the asynchronous journal read without blocking the main thread. */
private class PlanningDraftReadGate {
    val entered = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    suspend fun awaitRelease() { entered.complete(Unit); release.await() }
}

private class LifecycleFixture(active: Boolean = false) : SharedWorkspaceGateway, PlanningDraftAccess {
    val context = InstrumentationRegistry.getInstrumentation().targetContext.also {
        check(BuildConfig.DEBUG && it.packageName in setOf("ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug", "ru.genesis.calendar.qa1103.debug"))
    }
    val account = "qa-lifecycle-${UUID.randomUUID()}"
    val store = PlanningDraftStore(context)
    @Volatile var diskFailure = false
    private val storage = object : PlanningJournalStorage {
        override fun <T> locked(block: () -> T) = store.locked(block)
        override fun read(key: String) = store.read(key)
        override fun write(key: String, value: String) { check(!diskFailure) { "PLANNING_DRAFT_STORAGE" }; store.write(key, value) }
        override fun remove(key: String) { check(!diskFailure) { "PLANNING_DRAFT_STORAGE" }; store.remove(key) }
    }
    val journal = PlanningJournal(storage)
    val service = PlanningDraftService(journal, account, this)
    @Volatile var deny = false
    @Volatile var organize = true
    @Volatile var manage = true
    @Volatile var loseReply = false
    @Volatile var cached = false
    @Volatile var draftReadGate: PlanningDraftReadGate? = null
    var version = 1
    var configRevision = 1
    var enabled = true
    var unit = "points"
    val commands = mutableListOf<String>()
    val receipts = mutableMapOf<String, JSONObject>()
    val sprints = mutableListOf(sprint("source", if (active) "active" else "planning", "Текущий этап"), sprint("next", "planning", "Следующий этап"))
    val records = (0 until 131).map { JSONObject().put("id", "task-$it").put("projectId", "project").put("revision", 1)
        .put("title", "Подготовить обзор · $it").put("sprintId", if (active) "source" else JSONObject.NULL)
        .put("storyPoints", if (it == 0) 0 else JSONObject.NULL).put("estimateHours", if (it == 0) 2.5 else JSONObject.NULL) }.toMutableList()
    private fun sprint(id: String, state: String, title: String) = JSONObject().put("id", id).put("projectId", "project").put("state", state)
        .put("title", title).put("goal", "Согласовать этап").put("revision", 1).put("startDate", "2026-10-19").put("endDate", "2026-10-25")
        .put("calendarMode", "profane").put("calendarContext", JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march"))
    private fun total(rows: List<JSONObject>) = JSONObject().put("count", rows.size).put("completed", 0).apply {
        for ((field, name) in listOf("storyPoints" to "points", "estimateHours" to "hours")) put(name, JSONObject().put("value", rows.filter { !it.isNull(field) }.sumOf { it.getDouble(field) }).put("unestimated", rows.count { it.isNull(field) }))
    }
    override fun check() = Unit
    @Synchronized override fun planning(projectId: String): JSONObject {
        if (deny) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        return JSONObject().put("config", JSONObject().put("enabled", enabled).put("estimateUnit", unit).put("revision", configRevision))
            .put("context", JSONObject().put("permissions", JSONObject().put("manageProjects", manage).put("organizeTasks", organize).put("editTasks", organize)))
            .put("sprints", JSONArray(sprints.map { JSONObject(it.toString()) })).put("fingerprint", version.toString(16).padStart(64, '0'))
            .put("totals", JSONObject().put("backlog", total(records.filter { it.isNull("sprintId") })).apply {
                sprints.forEach { sprint -> put(sprint.getString("id"), total(records.filter { it.optString("sprintId") == sprint.getString("id") })) }
            }).put("byAssignee", JSONObject()).put("offlineCache", cached)
    }
    @Synchronized override fun tasks(filter: JSONObject, cursor: String?): JSONObject {
        val id = filter.optString("sprintId", "backlog")
        val rows = records.filter { if (id == "backlog") it.isNull("sprintId") else it.optString("sprintId") == id }
        val from = cursor?.toInt() ?: 0; val end = minOf(from + 100, rows.size)
        return JSONObject().put("tasks", JSONArray(rows.subList(from, end).map { JSONObject(it.toString()) })).put("total", rows.size)
            .put("queryVersion", "v$version-$id").put("nextCursor", if (end < rows.size) end.toString() else JSONObject.NULL).put("offlineCache", cached)
    }
    override fun hasTaskQueue(projectId: String) = false
    @Synchronized override fun send(projectId: String, command: JSONObject): JSONObject {
        commands.add(command.toString())
        val body = command.getJSONObject("body"); val requestId = body.getString("requestId")
        val result = receipts.getOrPut(requestId) {
            version++
            when (command.getString("kind")) {
                "settings" -> {
                    check(body.getInt("expectedRevision") == configRevision)
                    enabled = body.getBoolean("enabled"); unit = body.getString("estimateUnit"); configRevision++
                    JSONObject().put("config", JSONObject().put("enabled", enabled).put("estimateUnit", unit).put("revision", configRevision))
                }
                "sprint" -> {
                    val old = if (command.isNull("sprintId")) sprint(UUID.randomUUID().toString(), "planning", "").also { it.put("revision", 0); sprints.add(it) }
                        else sprints.first { it.getString("id") == command.getString("sprintId") }
                    check(old.getInt("revision") == body.getInt("expectedRevision"))
                    for (key in listOf("title", "goal", "startDate", "endDate", "calendarMode", "calendarContext")) old.put(key, body.get(key))
                    old.put("revision", old.getInt("revision") + 1); JSONObject().put("sprint", JSONObject(old.toString()))
                }
                else -> {
                    val old = sprints.first { it.getString("id") == command.getString("sprintId") }
                    check(old.getInt("revision") == body.getInt("expectedRevision"))
                    if (body.getString("action") == "complete") {
                        val rows = (0 until body.getJSONArray("outcomes").length()).map { body.getJSONArray("outcomes").getJSONObject(it) }
                        check(rows.size == records.count { it.optString("sprintId") == old.getString("id") })
                        rows.forEach { outcome -> records.first { it.getString("id") == outcome.getString("taskId") }.apply {
                            check(getInt("revision") == outcome.getInt("expectedRevision")); put("sprintId", outcome.get("destinationSprintId")); put("revision", getInt("revision") + 1)
                        } }
                    }
                    old.put("state", if (body.getString("action") == "start") "active" else "completed").put("revision", old.getInt("revision") + 1)
                    JSONObject().put("sprint", JSONObject(old.toString()))
                }
            }
        }
        if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        return JSONObject(result.toString())
    }
    @Synchronized fun remoteEdit() { version++; sprints.first { it.getString("id") == "source" }.apply { put("revision", getInt("revision") + 1); put("goal", "Изменено другим участником") } }
    override suspend fun sharedPlanning(projectId: String) = withContext(Dispatchers.IO) { planning(projectId) }
    override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = withContext(Dispatchers.IO) { tasks(filter, cursor) }
    override suspend fun queuedSharedTasks(projectId: String) = emptyList<JSONObject>()
    override suspend fun sharedPlanningDraft(projectId: String): JSONObject? {
        draftReadGate?.awaitRelease()
        return withContext(Dispatchers.IO) { service.load(projectId) }
    }
    override suspend fun sharedPlanningCopies(projectId: String) = withContext(Dispatchers.IO) { service.copies(projectId) }
    override suspend fun saveSharedPlanningCopy(projectId: String, id: String, stamp: String?, edit: JSONObject) = withContext(Dispatchers.IO) { service.saveCopy(projectId, id, stamp, edit) }
    override suspend fun useSharedPlanningCopy(projectId: String, id: String, copyStamp: String, stamp: String?) = withContext(Dispatchers.IO) { service.useCopy(projectId, id, copyStamp, stamp) }
    override suspend fun removeSharedPlanningCopy(projectId: String, id: String, stamp: String) = withContext(Dispatchers.IO) { service.removeCopy(projectId, id, stamp) }
    override suspend fun saveSharedPlanningDraft(projectId: String, stamp: String?, edit: JSONObject) = withContext(Dispatchers.IO) { service.save(projectId, stamp, edit) }
    override suspend fun prepareSharedPlanningDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.prepare(projectId, stamp) }
    override suspend fun sendSharedPlanningDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.send(projectId, stamp) }
    override suspend fun rebaseSharedPlanningDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.rebase(projectId, stamp) }
    override suspend fun prepareSharedSprintCompletion(projectId: String, sprintId: String, stamp: String?) = withContext(Dispatchers.IO) { service.completion(projectId, sprintId, stamp) }
    override suspend fun removeSharedPlanningDraft(projectId: String, stamp: String) = withContext(Dispatchers.IO) { service.remove(projectId, stamp) }
    fun clean() = store.locked {
        val key = "planning-v1:${account.length}:$account:7:project"
        context.getSharedPreferences("genesis.shared.planning.v1", 0).edit().remove(key).remove("copies:$key").commit()
    }
}

class SharedPlanningLifecycleUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixtures = mutableListOf<LifecycleFixture>()
    private var currentFixture by mutableStateOf<LifecycleFixture?>(null)
    private var generation by mutableIntStateOf(0)
    private var language by mutableStateOf("ru")
    private var dark by mutableStateOf(false)
    private var sacredEnabled by mutableStateOf(true)
    private var currentClose: () -> Unit = {}
    private var installed = false
    private fun withLifecycleProof(fixture: LifecycleFixture, phase: String, action: () -> Unit) {
        try { action() }
        catch (failure: Throwable) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val directory = instrumentation.targetContext.getExternalFilesDir(null) ?: instrumentation.targetContext.cacheDir
            val name = "planning313-lifecycle-$phase-${System.currentTimeMillis()}"
            runCatching {
                val proof = JSONObject().put("ownedAccount", fixture.account).put("ownedProjectId", "project")
                    .put("ownedSprintId", "source").put("phase", phase).put("failure", failure.toString())
                    .put("planning", fixture.planning("project"))
                    .put("draft", fixture.service.load("project") ?: JSONObject.NULL)
                    .put("commands", JSONArray(fixture.commands.toList())).put("receiptCount", fixture.receipts.size)
                File(directory, "$name.json").writeText(proof.toString(2))
            }
            runCatching {
                android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("screencap -p"))
                    .use { input -> File(directory, "$name.png").outputStream().use { input.copyTo(it) } }
            }
            throw failure
        }
    }
    private fun show(fixture: LifecycleFixture, onClose: () -> Unit = {}) {
        if (fixture !in fixtures) fixtures.add(fixture)
        if (!installed) {
            compose.setContent { currentFixture?.let { active -> key(generation) { CompositionLocalProvider(LocalGenesisLanguage provides language,
                LocalEveningTheme provides dark, LocalSacredFeaturesEnabled provides sacredEnabled) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                    SharedPlanningScreen(active, JSONObject().put("id", "project").put("title", "План команды"), emptyList(), { currentClose() }, {}, {})
                } }
            } } } }
            installed = true
        }
        compose.runOnIdle { currentFixture = fixture; currentClose = onClose; generation++ }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-lifecycle").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }
    private fun click(tag: String) {
        // The lifecycle container precedes IO draft restoration and preference loading.
        // Wait for the requested action itself, including completion of any in-flight write.
        compose.waitUntil(10_000) {
            runCatching { compose.onNodeWithTag(tag, useUnmergedTree = true).assertExists().assertIsEnabled() }.isSuccess
        }
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.assertIsDisplayed().assertIsEnabled().performClick()
    }
    private fun waitSaved() { compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-device-saved").fetchSemanticsNodes().isNotEmpty() } }
    private fun enterSprintTitle(text: String) {
        val field = compose.onNodeWithTag("planning-sprint-title", useUnmergedTree = true).performScrollTo()
        field.assertIsDisplayed()
        field.performClick()
        field.performTextReplacement(text)
        field.assertTextContains(text)
        hideKeyboard()
        compose.onNodeWithTag("planning-sprint-title", useUnmergedTree = true).assertTextContains(text)
    }
    private fun restoredSprintTitle(expected: String) {
        // Copy selection reads the encrypted journal on IO; a clipped field is absent
        // from the merged tablet tree while its preceding page is still visible.
        compose.waitUntil(10_000) {
            runCatching { compose.onNodeWithTag("planning-sprint-title", useUnmergedTree = true).assertTextContains(expected) }.isSuccess
        }
        compose.onNodeWithTag("planning-sprint-title", useUnmergedTree = true).performScrollTo().assertTextContains(expected)
    }
    private fun bucket(id: String) { click("planning-bucket"); compose.onNodeWithTag("planning-select-$id").performClick() }
    private fun hideKeyboard() {
        compose.runOnUiThread {
            androidx.core.view.WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView)
                .hide(androidx.core.view.WindowInsetsCompat.Type.ime())
        }
        compose.waitForIdle()
    }
    @After fun cleanup() { if (installed) { compose.runOnIdle { currentFixture = null }; compose.waitForIdle() }; fixtures.forEach { it.clean() } }
    @Test fun settingsKeepPointsAndHoursIndependentAndPersistTheSelectedUnit() {
        val fixture = LifecycleFixture(); show(fixture); click("planning-settings")
        compose.onNodeWithTag("planning-unit-hours").performScrollTo().performClick(); waitSaved()
        click("planning-save-lifecycle")
        compose.waitUntil(10_000) { fixture.unit == "hours" && compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(0, fixture.records[0].getInt("storyPoints")); assertEquals(2.5, fixture.records[0].getDouble("estimateHours"), 0.0)
        assertEquals(1, fixture.commands.size)
    }
    @Test fun lostCreateReplyRestoresAndRetriesTheSameCommandWithoutAnotherSprint() {
        val fixture = LifecycleFixture(); fixture.loseReply = true
        withLifecycleProof(fixture, "lost-create-reply") {
            show(fixture); click("planning-new-sprint")
            compose.onNodeWithTag("planning-sprint-title").performTextReplacement("Проверить восстановление")
            compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Сохранить цель и даты")
            hideKeyboard(); waitSaved(); click("planning-save-lifecycle")
            // A pending node appears as soon as prepare commits, before send/recovery settles.
            // Reopen only after the server accepted exactly one command and its reply was lost.
            compose.waitUntil(10_000) {
                val pending = fixture.service.load("project")
                pending?.optString("phase") == "pending" && pending.optInt("attempts") == 1 && pending.optString("error") == "NETWORK" &&
                    synchronized(fixture) { fixture.commands.size == 1 && fixture.receipts.size == 1 } &&
                    compose.onAllNodesWithTag("planning-pending-command", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithTag("planning-lifecycle-error", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithTag("planning-lifecycle-busy", useUnmergedTree = true).fetchSemanticsNodes().isEmpty()
            }
            val lost = fixture.service.load("project")!!
            val command = synchronized(fixture) { fixture.commands.single() }
            assertEquals(command, lost.getString("command"))
            assertEquals("Проверить восстановление", lost.getJSONObject("edit").getJSONObject("draft").getString("title"))
            assertEquals("Сохранить цель и даты", lost.getJSONObject("edit").getJSONObject("draft").getString("goal"))
            assertEquals(3, fixture.sprints.size); assertEquals(1, fixture.receipts.size)

            val gate = PlanningDraftReadGate()
            fixture.draftReadGate = gate
            try {
                show(fixture)
                compose.waitUntil(10_000) { gate.entered.isCompleted }
                // The screen exists while the encrypted journal is still being read.
                compose.onNodeWithTag("planning-lifecycle").assertExists()
                compose.onNodeWithTag("planning-restore-draft", useUnmergedTree = true).assertDoesNotExist()
                assertEquals(lost.getString("stamp"), fixture.service.load("project")!!.getString("stamp"))
                assertEquals(1, fixture.commands.size); assertEquals(1, fixture.receipts.size)
            } finally {
                fixture.draftReadGate = null
                gate.release.complete(Unit)
            }
            click("planning-restore-draft")
            val concurrent = fixture.service.load("project")!!
            assertEquals("pending", concurrent.getString("phase")); assertEquals(1, concurrent.getInt("attempts"))
            assertEquals(command, concurrent.getString("command"))
            fixture.journal.beginAttempt(fixture.account, "project", concurrent.getString("stamp"))
            click("planning-retry-command")
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("planning-lifecycle-error", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithTag("planning-lifecycle-busy", useUnmergedTree = true).fetchSemanticsNodes().isEmpty()
            }
            assertEquals(1, fixture.commands.size)
            val conflict = fixture.service.load("project")!!
            assertEquals("pending", conflict.getString("phase")); assertEquals(2, conflict.getInt("attempts"))
            assertEquals(command, conflict.getString("command"))
            click("planning-retry-command")
            compose.waitUntil(10_000) { fixture.commands.size == 2 && compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(fixture.commands[0], fixture.commands[1]); assertEquals(3, fixture.sprints.size); assertEquals(1, fixture.receipts.size)
            val requestId = JSONObject(command).getJSONObject("body").getString("requestId")
            assertEquals(fixture.sprints.last().getString("id"), fixture.receipts.getValue(requestId).getJSONObject("sprint").getString("id"))
            assertNull(fixture.service.load("project"))
        }
    }
    @Test fun concurrentEditRequiresExplicitRefreshAndPreservesTheEnteredGoal() {
        val fixture = LifecycleFixture(); show(fixture); bucket("source"); click("planning-edit-sprint")
        compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Мой план остаётся")
        compose.onNodeWithTag("planning-sprint-goal").assertTextContains("Мой план остаётся")
        hideKeyboard(); waitSaved(); compose.onNodeWithTag("planning-sprint-goal").assertTextContains("Мой план остаётся")
        fixture.remoteEdit(); click("planning-save-lifecycle")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-lifecycle-error").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(fixture.commands.isEmpty()); click("planning-rebase-draft")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-lifecycle-busy").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("planning-sprint-goal").assertTextContains("Мой план остаётся")
        click("planning-save-lifecycle")
        compose.waitUntil(10_000) { fixture.commands.isNotEmpty() }
        assertEquals(2, JSONObject(fixture.commands[0]).getJSONObject("body").getInt("expectedRevision"))
    }
    @Test fun completing131TasksSendsEveryExplicitOutcomeIncludingTheLastTask() {
        val fixture = LifecycleFixture(active = true); show(fixture); bucket("source"); click("planning-complete-sprint")
        click("planning-all-destinations"); compose.onNodeWithTag("planning-outcome-backlog").performClick(); waitSaved()
        compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-outcome-task-task-0"))
        click("planning-outcome-choice-task-0"); compose.onNodeWithTag("planning-outcome-next").performClick()
        compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-finish-completion")); click("planning-finish-completion")
        compose.waitUntil(10_000) { fixture.commands.isNotEmpty() && compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty() }
        val outcomes = JSONObject(fixture.commands.single()).getJSONObject("body").getJSONArray("outcomes")
        assertEquals(131, outcomes.length()); assertEquals("next", outcomes.getJSONObject(0).getString("destinationSprintId"))
        assertEquals("task-130", outcomes.getJSONObject(130).getString("taskId")); assertTrue(outcomes.getJSONObject(130).isNull("destinationSprintId"))
    }
    @Test fun diskFailureBlocksSendingAndBackUntilTheLatestInputIsSaved() {
        val fixture = LifecycleFixture()
        withLifecycleProof(fixture, "disk-failure") {
            val latestTitle = "Не терять этот ввод"
            var closed = 0
            var durableTitleOnClose: String? = null
            show(fixture) {
                durableTitleOnClose = fixture.service.load("project")?.optJSONObject("edit")
                    ?.optJSONObject("draft")?.optString("title")
                closed++
            }
            click("planning-new-sprint")
            fixture.diskFailure = true; enterSprintTitle(latestTitle)
            hideKeyboard(); click("planning-save-lifecycle")
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("planning-lifecycle-error").fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithTag("planning-lifecycle-busy").fetchSemanticsNodes().isEmpty()
            }
            assertTrue(fixture.commands.isEmpty())
            compose.onNodeWithContentDescription("Назад").assertIsEnabled().performClick()
            compose.waitForIdle(); assertEquals(0, closed)

            // Resolving a conditional error node after restoring writes races a pending
            // autosave/Back commit. Keep failure active until this captured UI action.
            val retry = compose.onNode(hasText("Повторить") and hasClickAction())
            if (!retry.isDisplayed()) retry.performScrollTo()
            retry.assertIsDisplayed().assertIsEnabled().performSemanticsAction(SemanticsActions.OnClick) { action ->
                fixture.diskFailure = false
                action()
            }
            waitSaved()
            assertTrue("Local recovery must not send a lifecycle command", fixture.commands.isEmpty())
            assertEquals(latestTitle, fixture.service.load("project")!!.getJSONObject("edit").getJSONObject("draft").getString("title"))

            // An already requested Back may finish after storage recovers. Its close
            // is valid only if the latest input was durable at the time it happened.
            if (closed == 0) compose.onNodeWithContentDescription("Назад").assertIsEnabled().performClick()
            assertEquals(1, closed)
            assertEquals("Back must not close before the latest input is durable", latestTitle, durableTitleOnClose)
            show(fixture); click("planning-restore-draft"); restoredSprintTitle(latestTitle)
        }
    }
    @Test fun revokedProjectAccessHidesTheProjectAndDraftTitlesWithoutDeletingTheDraft() {
        val fixture = LifecycleFixture(); show(fixture); click("planning-new-sprint")
        compose.onNodeWithTag("planning-sprint-title").performTextReplacement("Личный незаконченный ввод")
        hideKeyboard(); waitSaved(); fixture.deny = true; click("planning-refresh")
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Нет доступа").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("План команды").assertDoesNotExist(); compose.onNodeWithText("Личный незаконченный ввод").assertDoesNotExist()
        assertNotNull(fixture.journal.load(fixture.account, "project"))
    }
    @Test fun twoEditorsKeepBothInputsAndTheUserExplicitlySelectsTheVersionToContinue() {
        val fixture = LifecycleFixture(); var closed = false; show(fixture) { closed = true }; click("planning-new-sprint")
        enterSprintTitle("Мой ввод")
        hideKeyboard(); waitSaved()
        val main = fixture.service.load("project")!!
        val other = JSONObject(main.getJSONObject("edit").toString()).apply { getJSONObject("draft").put("title", "Другое окно").put("goal", "Другой план") }
        fixture.service.save("project", main.getString("stamp"), other)
        compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Моя цель")
        hideKeyboard()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-conflict-copy-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("Другое окно", fixture.service.load("project")!!.getJSONObject("edit").getJSONObject("draft").getString("title"))
        assertTrue(fixture.commands.isEmpty())
        val savedCopy = fixture.service.copies("project").single()
        compose.onNodeWithContentDescription("Назад").performClick(); assertTrue(closed)
        show(fixture); click("planning-use-version-${savedCopy.getString("id")}")
        restoredSprintTitle("Мой ввод")
        compose.onNodeWithTag("planning-sprint-goal").assertTextContains("Моя цель")
        assertEquals(setOf("Мой ввод", "Другое окно"), fixture.service.copies("project").map { it.getJSONObject("edit").getJSONObject("draft").getString("title") }.toSet())
    }
    @Test fun startingASprintUsesTheLifecycleCommandAndDisablesAnotherStart() {
        val fixture = LifecycleFixture(); show(fixture); bucket("source"); click("planning-start-sprint")
        compose.waitUntil(10_000) { fixture.sprints.first().getString("state") == "active" && compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("start", JSONObject(fixture.commands.single()).getJSONObject("body").getString("action"))
        bucket("next"); compose.onNodeWithTag("planning-start-sprint").assertIsNotEnabled()
    }
    @Test fun emptySprintCanBeCompletedWithoutInventingTaskDecisions() {
        val fixture = LifecycleFixture(active = true); fixture.records.clear()
        withLifecycleProof(fixture, "empty-completion") {
            show(fixture); bucket("source")
            compose.waitUntil(10_000) { runCatching { compose.onNodeWithTag("planning-complete-sprint").assertIsEnabled() }.isSuccess }
            click("planning-complete-sprint")
            // Preparation commits the encrypted journal on IO before the editor is ready.
            compose.waitUntil(10_000) {
                val prepared = fixture.service.load("project")
                val edit = prepared?.optJSONObject("edit")
                prepared?.optString("phase") == "editing" && edit != null && edit.optString("kind") == "transition" &&
                    edit.optString("action") == "complete" && edit.optString("sprintId") == "source" && edit.getJSONArray("tasks").length() == 0 &&
                    compose.onAllNodesWithTag("planning-lifecycle-busy").fetchSemanticsNodes().isEmpty() &&
                    compose.onAllNodesWithTag("planning-lifecycle-error").fetchSemanticsNodes().isEmpty()
            }
            compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-finish-completion"))
            compose.onNodeWithTag("planning-finish-completion").assertIsDisplayed().assertIsEnabled().performClick()
            compose.waitUntil(10_000) {
                fixture.sprints.first().getString("state") == "completed" &&
                    compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty()
            }
            val command = JSONObject(fixture.commands.single())
            assertEquals("transition", command.getString("kind")); assertEquals("source", command.getString("sprintId"))
            assertEquals("complete", command.getJSONObject("body").getString("action"))
            assertEquals(1, command.getJSONObject("body").getInt("expectedRevision"))
            assertEquals(0, command.getJSONObject("body").getJSONArray("outcomes").length())
            assertEquals(2, fixture.sprints.first().getInt("revision")); assertEquals(1, fixture.receipts.size)
            assertNull(fixture.service.load("project"))
        }
    }
    @Test fun viewerHasNoLifecycleActionsAndManagerMayChangeOnlySettings() {
        val fixture = LifecycleFixture(); fixture.organize = false; fixture.manage = false; show(fixture)
        compose.onNodeWithTag("planning-settings").assertDoesNotExist(); compose.onNodeWithTag("planning-new-sprint").assertDoesNotExist()
        fixture.manage = true; show(fixture); click("planning-settings")
        compose.onNodeWithTag("planning-new-sprint").assertDoesNotExist()
        click("planning-enabled"); click("planning-save-lifecycle")
        compose.waitUntil(10_000) { !fixture.enabled && compose.onAllNodesWithTag("planning-lifecycle-saved").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("settings", JSONObject(fixture.commands.single()).getString("kind"))
    }
    @Test fun inputCalendarsKeepCivilDatesAndSavedYearContextAcrossDstAndReopen() {
        for ((mode, year) in listOf("profane" to "january", "profane" to "march", "sacred" to "march", "lunar" to "january")) {
            val fixture = LifecycleFixture()
            fixture.sprints.first().put("calendarMode", mode).put("startDate", "2026-10-24").put("endDate", "2026-10-26")
                .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "Europe/Berlin").put("gregorianYearStart", year))
            withLifecycleProof(fixture, "date-$mode-$year") {
                show(fixture); bucket("source"); click("planning-edit-sprint"); waitSaved()
                for (nextMode in listOf("sacred", "lunar", "profane")) {
                    click("planning-input-$nextMode"); waitSaved()
                    val draft = fixture.service.load("project")!!.getJSONObject("edit").getJSONObject("draft")
                    assertEquals("2026-10-24", draft.getString("startDate")); assertEquals("2026-10-26", draft.getString("endDate"))
                    assertEquals(year, draft.getJSONObject("calendarContext").getString("gregorianYearStart"))
                    assertEquals("Europe/Berlin", draft.getJSONObject("calendarContext").getString("timeZone"))
                }
                show(fixture); click("planning-restore-draft")
                compose.onNodeWithTag("planning-start-date", useUnmergedTree = true).performScrollTo().onChildren().filter(hasClickAction()).onFirst().performClick()
                compose.onNodeWithText("Выберите дату").assertIsDisplayed()
                compose.onNodeWithTag("author-date-close").assertIsDisplayed().assertContentDescriptionEquals("Закрыть").performClick()
                compose.onNodeWithTag("author-date-close").assertDoesNotExist()
                assertEquals("2026-10-24", fixture.service.load("project")!!.getJSONObject("edit").getJSONObject("draft").getString("startDate"))
            }
        }
    }
    @Test fun disabledSacredFeaturesHideCalendarOptionsWithoutRewritingTheSavedContext() {
        val fixture = LifecycleFixture(); fixture.sprints.first().put("calendarMode", "sacred")
        compose.runOnUiThread { sacredEnabled = false }; show(fixture); bucket("source"); click("planning-edit-sprint"); waitSaved()
        compose.onNodeWithTag("planning-input-sacred").assertDoesNotExist(); compose.onNodeWithTag("planning-input-lunar").assertDoesNotExist()
        assertEquals("sacred", fixture.service.load("project")!!.getJSONObject("edit").getJSONObject("draft").getString("calendarMode"))
    }
    @Test fun preparedButNeverAttemptedCommandCanBeCancelledWhileOffline() {
        val fixture = LifecycleFixture()
        val draft = fixture.service.save("project", null, JSONObject().put("kind", "settings").put("enabled", true).put("estimateUnit", "hours").put("expectedRevision", 1))
        fixture.service.prepare("project", draft.getString("stamp")); fixture.cached = true
        show(fixture); click("planning-restore-draft")
        compose.onNodeWithTag("planning-retry-command").assertIsNotEnabled()
        click("planning-cancel-unsent")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-pending-command").fetchSemanticsNodes().isEmpty() }
        assertNull(fixture.service.load("project")); assertTrue(fixture.commands.isEmpty())
    }
    @Test fun captureLifecycleFormsAndRecoveryStates() {
        val args = InstrumentationRegistry.getArguments()
        org.junit.Assume.assumeTrue(args.getString("genesisLifecycleCapture") == "true")
        val width = args.getString("genesisLifecycleWidth") ?: "390"
        val translated = args.getString("genesisLifecycleLanguages") == "true"
        val locales = if (translated) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        fun capture(state: String) {
            compose.waitForIdle()
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val file = File(instrumentation.targetContext.cacheDir, "g1-lifecycle-$width-${if (dark) "dark" else "light"}-$language-$state.png")
            ru.genesis.calendar.captureNativeWindow(file)
        }
        if (args.getString("genesisShared314FocusedCapture") == "true") {
            for (theme in listOf(false, true)) {
                compose.runOnUiThread { language = "ru"; dark = theme }
                show(LifecycleFixture().apply { enabled = false }); capture("disabled")
                click("planning-settings"); waitSaved(); capture("settings")
                compose.onNodeWithTag("planning-enabled").assertIsDisplayed()
                compose.onNodeWithTag("planning-save-lifecycle").assertIsDisplayed()
                compose.onNodeWithTag("planning-settings").assertDoesNotExist()
            }
            return
        }
        for (theme in listOf(false, true)) for (locale in locales) {
            compose.runOnUiThread { language = locale; dark = theme }
            val fixture = LifecycleFixture(); show(fixture); bucket("source"); click("planning-edit-sprint"); waitSaved()
            compose.onNodeWithTag("planning-sprint-title").performScrollTo(); capture("sprint")
            compose.onNodeWithTag("planning-end-date", useUnmergedTree = true).performScrollTo(); capture("dates")
            if (!translated) {
                show(LifecycleFixture()); click("planning-settings"); waitSaved(); capture("settings")
                val completion = LifecycleFixture(active = true); show(completion); bucket("source"); click("planning-complete-sprint")
                compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-all-destinations").fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithTag("planning-lifecycle-busy").fetchSemanticsNodes().isEmpty() }
                capture("complete")
                click("planning-all-destinations"); compose.onNodeWithTag("planning-outcome-backlog").performClick(); waitSaved()
                compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-finish-completion")); capture("complete-end")
                val recovery = LifecycleFixture(); show(recovery); click("planning-new-sprint")
                compose.onNodeWithTag("planning-sprint-title").performTextReplacement("Согласовать следующий этап")
                compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Сохранить изменения команды")
                hideKeyboard(); waitSaved(); recovery.loseReply = true; click("planning-save-lifecycle")
                compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-pending-command").fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithTag("planning-lifecycle-busy").fetchSemanticsNodes().isEmpty() }; capture("pending")
                val conflict = LifecycleFixture(); show(conflict); click("planning-new-sprint")
                compose.onNodeWithTag("planning-sprint-title").performTextReplacement("Мой вариант спринта"); hideKeyboard(); waitSaved()
                val before = conflict.service.load("project")!!
                conflict.service.save("project", before.getString("stamp"), JSONObject(before.getJSONObject("edit").toString()).apply {
                    getJSONObject("draft").put("title", "План из другого окна").put("goal", "Сохранён параллельно")
                })
                compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Незаконченный ввод сохраняется отдельно")
                hideKeyboard()
                compose.waitUntil(10_000) { compose.onAllNodesWithTag("planning-conflict-copy-saved").fetchSemanticsNodes().isNotEmpty() }
                click("planning-list-versions"); capture("versions")
            }
        }
    }
}
