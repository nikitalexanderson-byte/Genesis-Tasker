package ru.genesis.calendar.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.RecurrenceConfig
import java.io.File
import java.time.LocalDate
import java.util.UUID

/** Real checkbox → ViewModel → encrypted Room persistence, in the separate QA app only. */
class TaskCompletion313Test {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val today = LocalDate.now()
    private val prefix = "QA313 ${UUID.randomUUID().toString().take(8)}"
    private val ownedIds = linkedSetOf<String>()
    private lateinit var original: UiPreferences
    private var inboxHidden: Boolean? = null
    private var inboxBottom: Boolean? = null
    private var safe = false

    @Before fun requireIsolatedWorkspace() {
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        safe = true
        val layout = app.getSharedPreferences("genesis.personal-layout.v1", 0)
        val key = "${app.workspaceScope}:inbox:"
        inboxHidden = if (layout.contains(key + "hidden")) layout.getBoolean(key + "hidden", false) else null
        inboxBottom = if (layout.contains(key + "bottom")) layout.getBoolean(key + "bottom", false) else null
        layout.edit().putBoolean(key + "hidden", false).putBoolean(key + "bottom", false).commit()
        runBlocking {
            val prefs = LocalPreferences(app, app.workspaceScope)
            original = prefs.values.first()
            prefs.set("language", "ru")
            prefs.set("display", "profane")
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty() }
    }

    @After fun removeOnlyOwnedSyntheticRows() {
        if (!safe || app.workspaceScope != "internal-validation-v1") return
        runBlocking {
            val dao = app.database.dao()
            val scope = app.workspaceScope
            ownedIds.forEach { id ->
                app.repository.delete(id)
                dao.deleteTaskReminders(scope, id)
                dao.outbox(scope).filter { it.entityId == id }.forEach {
                    dao.acknowledgeOutbox(scope, it.entityId, it.revision, it.operationId)
                }
                dao.deleteCachedTask(scope, id)
            }
            if (::original.isInitialized) LocalPreferences(app, scope).apply {
                set("language", original.language)
                set("display", original.display.wireValue)
            }
        }
        val key = "${app.workspaceScope}:inbox:"
        app.getSharedPreferences("genesis.personal-layout.v1", 0).edit().apply {
            inboxHidden?.let { putBoolean(key + "hidden", it) } ?: remove(key + "hidden")
            inboxBottom?.let { putBoolean(key + "bottom", it) } ?: remove(key + "bottom")
        }.commit()
    }

    private fun model(): GenesisViewModel {
        lateinit var model: GenesisViewModel
        compose.runOnUiThread {
            model = ViewModelProvider(compose.activity).get("genesis-${app.workspaceScope}", GenesisViewModel::class.java)
        }
        return model
    }

    private fun seed(recurring: Boolean = false): LocalTask = runBlocking {
        val id = "completion313-${UUID.randomUUID()}"
        ownedIds += id
        app.repository.save(LocalTask(id = id, title = "$prefix ${if (recurring) "серия" else "задача"}",
            date = today.toString(), recurrence = RecurrenceConfig(enabled = recurring, mode = "classic",
                pattern = "daily", rangeStart = today.toString(), rangeEnd = today.plusDays(2).toString())))
    }

    private fun stored(id: String) = runBlocking { requireNotNull(app.repository.get(id)) }

    private fun complete(request: () -> Job) {
        lateinit var job: Job
        compose.runOnUiThread { job = request() }
        runBlocking { withTimeout(10_000) { job.join() } }
        assertFalse("Completion failed by cancelling its coroutine", job.isCancelled)
        compose.waitForIdle()
    }

    private fun openPage(page: String) {
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-$page-root").performScrollTo().performClick()
        compose.waitUntil(5_000) { !compose.onNodeWithTag("workspace-drawer").isDisplayed() }
        if (page == "Календарь") {
            compose.onNodeWithTag("submenu-month").performClick()
            compose.onNodeWithTag("calendar-task-count-$today").performScrollTo().performClick()
        }
        if (page == "Проекты") {
            if (compose.onAllNodesWithTag("submenu-personal").fetchSemanticsNodes().isNotEmpty())
                compose.onNodeWithTag("submenu-personal").performClick()
            if (compose.onAllNodesWithTag("personal-task-search-open").fetchSemanticsNodes().isNotEmpty())
                compose.onNodeWithTag("personal-task-search-open").performClick()
            compose.onNodeWithTag("personal-task-search").performTextReplacement(prefix)
            androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        }
    }

    private fun checkbox(page: String, id: String): SemanticsNodeInteraction {
        if (page == "Календарь") {
            compose.onNode(hasScrollAction() and hasAnyAncestor(hasTestTag("calendar-task-list-dialog")))
                .performScrollToNode(hasTestTag("calendar-task-complete-$id"))
            return compose.onNodeWithTag("calendar-task-complete-$id")
        }
        // Projects uses draggable rows in the inbox and NativeTaskCard in search results.
        // Both must resolve to this task's actual checkbox, never the clickable card.
        val row = if (page == "Проекты") hasTestTag("drag-task-$id") or hasTestTag("task-$id")
            else hasTestTag("task-$id")
        if (page == "Проекты") compose.onNodeWithTag("projects-screen").performScrollToNode(row)
        else compose.scrollToTodayNode(row)
        return compose.onNode(isToggleable() and hasAnyAncestor(row), useUnmergedTree = true)
    }

    private fun awaitCheckbox(page: String, id: String, checked: Boolean, phase: String): SemanticsNodeInteraction {
        val node = checkbox(page, id)
        val started = android.os.SystemClock.elapsedRealtime()
        try {
            // Room commit, invalidation Flow and lifecycle-aware Compose collection
            // are separate asynchronous steps. Wait for this actual task checkbox.
            compose.waitUntil(10_000) {
                runCatching { if (checked) node.assertIsOn() else node.assertIsOff(); true }.getOrDefault(false)
            }
            return if (checked) node.assertIsOn() else node.assertIsOff()
        } catch (failure: Throwable) {
            val key = when (page) { "Сегодня" -> "today"; "Календарь" -> "calendar"; else -> "affairs" }
            val file = File(app.getExternalFilesDir(null), "completion313-$key-$phase-$id")
            runCatching {
                fun snapshot(task: LocalTask?): Any = task?.let { JSONObject().put("id", it.id)
                    .put("done", it.done).put("revision", it.revision).put("recurring", it.recurrence.enabled) } ?: JSONObject.NULL
                val vm = runCatching { model() }.getOrNull()
                val record = runCatching { runBlocking { withTimeout(2_000) { app.repository.get(id) } } }.getOrNull()
                val proof = JSONObject().put("page", key).put("phase", phase).put("expectedChecked", checked)
                    .put("elapsedMs", android.os.SystemClock.elapsedRealtime() - started).put("scope", app.workspaceScope)
                    .put("lifecycle", compose.activity.lifecycle.currentState.name).put("database", snapshot(record))
                    .put("modelFlow", snapshot(vm?.tasks?.value?.firstOrNull { it.id == id }))
                    .put("modelError", vm?.error?.value ?: JSONObject.NULL)
                    .put("checkbox", runCatching { node.printToString() }.getOrElse { it.javaClass.simpleName })
                File(file.path + ".json").writeText(proof.toString(2))
                println("QA313_CHECKBOX_UI_TIMEOUT=$proof")
            }.exceptionOrNull()?.let { failure.addSuppressed(it) }
            runCatching { captureNativeWindow(File(file.path + ".png")) }
                .exceptionOrNull()?.let { failure.addSuppressed(it) }
            throw failure
        }
    }

    private fun exerciseCheckboxes(page: String) {
        val tasks = listOf(seed(), seed(recurring = true))
        openPage(page)
        tasks.forEach { task ->
            checkbox(page, task.id).assertIsOff().performClick()
            compose.waitUntil(10_000) { stored(task.id).done }
            awaitCheckbox(page, task.id, true, "completed")
            assertEquals(task.revision + 1, stored(task.id).revision)
        }
        if (page == "Календарь") compose.onNodeWithContentDescription("Закрыть").performClick()
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty() }
        openPage(page)
        tasks.forEach { task ->
            awaitCheckbox(page, task.id, true, "recreated").performClick()
            compose.waitUntil(10_000) { !stored(task.id).done }
            awaitCheckbox(page, task.id, false, "undone")
            assertEquals(task.revision + 2, stored(task.id).revision)
        }
        val series = stored(tasks.last().id)
        assertTrue(series.recurrence.enabled)
        assertTrue(series.recurrenceExcludedDates.isEmpty())
        assertTrue(TaskOccurrences.occursOn(series, today.plusDays(1)))
        assertNull(model().error.value)
    }

    @Test fun todayCheckboxesPersistOrdinaryAndSeriesCompletionAndUndoAcrossRecreation() = exerciseCheckboxes("Сегодня")
    @Test fun calendarCheckboxesPersistOrdinaryAndSeriesCompletionAndUndoAcrossRecreation() = exerciseCheckboxes("Календарь")
    @Test fun affairsCheckboxesPersistOrdinaryAndSeriesCompletionAndUndoAcrossRecreation() = exerciseCheckboxes("Проекты")

    @Test fun invalidOccurrenceRequestsReportErrorsWithoutMutatingTheSeriesOrBlockingRetry() {
        val task = seed(recurring = true)
        val vm = model()
        listOf("not-a-date", today.plusDays(5).toString()).forEach { date ->
            complete { vm.completeOccurrence(task, date) }
            assertNotNull(vm.error.value)
            assertEquals(task.revision, stored(task.id).revision)
            assertFalse(stored(task.id).done)
            assertTrue(stored(task.id).recurrenceExcludedDates.isEmpty())
        }
        complete { vm.complete(task) }
        assertTrue(stored(task.id).done)
        assertNull(vm.error.value)
    }

    @Test fun importedInvalidEndMetadataCompletesOneOccurrenceAndPreservesTheRest() {
        val task = seed(recurring = true)
        val json = JSONObject(task.json()).put("endDate", "invalid-imported-end")
            .put("futureImportField", JSONObject().put("keep", true))
        runBlocking { app.database.dao().putTask(TaskRecord(app.workspaceScope, task.id,
            LocalCipher().encrypt(json.toString(), "${app.workspaceScope}/${task.id}"), task.revision, false)) }
        val imported = stored(task.id)
        val day = today.plusDays(1).toString()
        val id = TaskOccurrences.standaloneDraft(imported, day).id
        ownedIds += id
        val vm = model()
        complete { vm.completeOccurrence(imported, day) }
        assertNull(vm.error.value)
        val occurrence = stored(id)
        assertTrue(occurrence.done)
        assertFalse(occurrence.recurrence.enabled)
        assertEquals(day, occurrence.date)
        assertEquals(day, JSONObject(occurrence.sourceFieldsJson).getString("endDate"))
        assertTrue(JSONObject(occurrence.sourceFieldsJson).getJSONObject("futureImportField").getBoolean("keep"))
        val remaining = stored(task.id)
        assertFalse(remaining.done)
        assertEquals(listOf(day), remaining.recurrenceExcludedDates)
        assertTrue(TaskOccurrences.occursOn(remaining, today))
        assertFalse(TaskOccurrences.occursOn(remaining, today.plusDays(1)))
        assertTrue(TaskOccurrences.occursOn(remaining, today.plusDays(2)))
        complete { vm.complete(occurrence) }
        assertFalse(stored(id).done)
    }

    @Test fun staleAndDeletedCheckboxSnapshotsNeverOverwriteOrResurrectTasks() {
        val original = seed()
        val changed = runBlocking { app.repository.save(original.copy(title = "$prefix изменённая задача")) }
        val vm = model()
        complete { vm.complete(original) }
        assertEquals(changed.title, stored(original.id).title)
        assertEquals(changed.revision, stored(original.id).revision)
        assertFalse(stored(original.id).done)
        assertNotNull(vm.error.value)
        runBlocking { app.repository.delete(changed.id, changed.revision) }
        val tombstone = runBlocking { app.database.dao().task(app.workspaceScope, changed.id) }
        complete { vm.complete(changed) }
        assertNull(runBlocking { app.repository.get(changed.id) })
        assertEquals(tombstone, runBlocking { app.database.dao().task(app.workspaceScope, changed.id) })
        assertNotNull(vm.error.value)
    }

    @Test fun rapidTapsShareOnePendingWriteWhileDifferentTasksCanComplete() {
        val first = seed()
        val second = seed()
        val vm = model()
        val release = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        runBlocking {
            val lock = async(Dispatchers.Default) { app.scheduler.withMutation { entered.complete(Unit); release.await() } }
            entered.await()
            lateinit var firstJob: Job
            lateinit var secondJob: Job
            try {
                compose.runOnUiThread {
                    firstJob = vm.complete(first)
                    repeat(20) { assertSame(firstJob, vm.complete(first)) }
                    secondJob = vm.complete(second)
                    assertNotSame(firstJob, secondJob)
                }
            } finally { release.complete(Unit) }
            withTimeout(10_000) { joinAll(lock, firstJob, secondJob) }
        }
        assertEquals(first.revision + 1, stored(first.id).revision)
        assertEquals(second.revision + 1, stored(second.id).revision)
        assertTrue(stored(first.id).done && stored(second.id).done)
        assertNull(vm.error.value)
    }

    @Test fun differentSeriesOccurrencesNeverSilentlyShareOnePendingRequest() {
        val series = seed(recurring = true)
        val vm = model()
        val release = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        runBlocking {
            val lock = async(Dispatchers.Default) { app.scheduler.withMutation { entered.complete(Unit); release.await() } }
            entered.await()
            lateinit var first: Job
            lateinit var second: Job
            try {
                compose.runOnUiThread {
                    first = vm.completeOccurrence(series, today.toString())
                    assertSame(first, vm.completeOccurrence(series, today.toString()))
                    second = vm.completeOccurrence(series, today.plusDays(1).toString())
                    assertNotSame("Different dates represent different checkbox requests", first, second)
                }
            } finally { release.complete(Unit) }
            withTimeout(10_000) { joinAll(lock, first, second) }
        }
        val excluded = stored(series.id).recurrenceExcludedDates
        assertTrue("Both dates must persist, or the stale request must report a conflict",
            excluded.containsAll(listOf(today.toString(), today.plusDays(1).toString())) || vm.error.value != null)
    }

    @Test fun cancellationDoesNotBecomeASaveErrorAndReleasesTheCompletionGuard() {
        val task = seed()
        val vm = model()
        val release = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        runBlocking {
            val lock = async(Dispatchers.Default) { app.scheduler.withMutation { entered.complete(Unit); release.await() } }
            entered.await()
            lateinit var job: Job
            try {
                compose.runOnUiThread { job = vm.complete(task) }
                job.cancelAndJoin()
                assertTrue(job.isCancelled)
            } finally { release.complete(Unit) }
            withTimeout(10_000) { lock.join() }
        }
        assertFalse(stored(task.id).done)
        assertEquals(task.revision, stored(task.id).revision)
        assertNull(vm.error.value)
        complete { vm.complete(task) }
        assertTrue(stored(task.id).done)
        assertNull(vm.error.value)
    }
}
