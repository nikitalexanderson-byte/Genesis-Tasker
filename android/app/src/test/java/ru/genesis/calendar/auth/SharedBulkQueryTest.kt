package ru.genesis.calendar.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.ui.SharedBulkState

class SharedBulkQueryTest {
    private fun origin(title: String = "Own query") = JSONObject().put("filter", JSONObject().put("q", title)).put("sort", "priority").put("title", title)
    private fun task(project: String, index: Int) = JSONObject().put("id", "task-$index").put("projectId", project).put("projectTitle", "Live $project").put("revision", 1).put("title", "Live task $index")
    private fun selection() = JSONObject().put("mode", "page").put("items", JSONArray().put(SharedBulkProtocol.reference(task("a", 1))).put(SharedBulkProtocol.reference(task("b", 2))))
    private fun edit(action: JSONObject = bulkActionFixture()) = JSONObject().put("scope", "query").put("origin", origin()).put("selection", selection()).put("action", action)
    private fun row(project: String) = JSONObject().put("id", project).put("spaceId", "space").put("title", "Live $project").put("taskCount", 1)
        .put("statuses", JSONArray().put(JSONObject().put("id", "$project-open").put("title", "Live status").put("isDone", false)))
    private fun page(ids: List<String>, total: Int = ids.size, next: String? = null) = JSONObject().put("projects", JSONArray(ids.map(::row)))
        .put("total", total).put("hasMore", next != null).put("nextCursor", next ?: JSONObject.NULL)
    private fun calendar() = JSONObject().put("mode", "lunar").put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march")

    @Test fun queryExtensionCannotLoosenTheExistingProjectContractOrLeakLocalOrigin() {
        val query = SharedBulkProtocol.edit(edit()); assertEquals(SharedBulkProtocol.QUERY_SCOPE, SharedBulkProtocol.context(query))
        val command = SharedBulkJournalContract.command(query, bulkOperationFixture).getJSONObject("body")
        assertEquals(setOf("requestId", "selection", "action"), command.keys().asSequence().toSet())
        assertFalse(command.toString().contains("Own query")); assertFalse(command.toString().contains("scope"))
        assertThrows(Exception::class.java) { SharedBulkProtocol.edit(JSONObject().put("projectId", "a").put("selection", selection()).put("action", bulkActionFixture())) }
        assertThrows(Exception::class.java) { SharedBulkProtocol.edit(edit().put("projectId", "a")) }
        val all = JSONObject().put("mode", "all").put("filter", JSONObject().put("q", "different")).put("sort", "priority").put("queryVersion", "version")
        assertThrows(Exception::class.java) { SharedBulkProtocol.edit(edit().put("selection", all)) }
    }
    @Test fun scopePagesMustHaveStableTotalsUniqueProjectsAndACompleteTaskSum() {
        val pages = SharedBulkScopePages(); assertFalse(pages.add(page((0..99).map { "p$it" }, 101, "next")))
        assertEquals("next", pages.cursor); assertTrue(pages.add(page(listOf("p100"), 101))); assertEquals(101, pages.result().getJSONArray("projects").length())
        for (second in listOf(page(listOf("a"), 2), page(listOf("b"), 3), page(listOf("b"), 2, "next"))) {
            val bad = SharedBulkScopePages(); bad.add(page(listOf("a"), 2, "next")); assertThrows(Exception::class.java) { bad.add(second) }
        }
        assertThrows(Exception::class.java) { SharedBulkScopePages().add(page(listOf("a"), 2)) }
        assertThrows(Exception::class.java) { SharedBulkScopePages().add(page(emptyList(), 1, "next")) }
        val bounded = SharedBulkScopePages()
        repeat(9) { index -> bounded.add(page((0..99).map { "p${index * 100 + it}" }, 1001, "cursor-$index")) }
        assertThrows(Exception::class.java) { bounded.add(page((900..999).map { "p$it" }, 1001, "cursor-10")) }
    }
    @Test fun statusMappingNeedsEverySelectedProjectAndItsOwnCurrentStatus() {
        val scope = page(listOf("a", "b"))
        val statuses = JSONObject().put("a", "a-open").put("b", "b-open")
        SharedBulkJournalContract.verify(edit(JSONObject().put("kind", "status").put("statusIds", statuses)), scope, SharedBulkProtocol.QUERY_SCOPE, false)
        for (map in listOf(JSONObject().put("a", "a-open"), JSONObject(statuses.toString()).put("b", "a-open"), JSONObject(statuses.toString()).put("c", "c-open"))) {
            assertThrows(Exception::class.java) { SharedBulkJournalContract.verify(edit(JSONObject().put("kind", "status").put("statusIds", map)), scope, SharedBulkProtocol.QUERY_SCOPE, false) }
        }
    }
    private inner class Gateway : SharedWorkspaceGateway {
        val storage = MemoryPlanningStorage(); val inputs = PlanningJournal(storage, contract = SharedBulkInputContract)
        var queue = false; var lose = false; var failInput = false; var damagedInput = false; var reads = 0; var projectReads = 0
        var account = "actor"; var generation = 0L
        var beforeInputWrite: (suspend () -> Unit)? = null
        var afterInputCommit: (suspend () -> Unit)? = null
        val sent = mutableListOf<String>(); var response = bulkReportFixture()
        private val access = object : SharedBulkAccess {
            override fun check() { }
            override fun hasTaskQueue() = queue
            override fun scope(selection: JSONObject) = page(listOf("a", "b"))
            override fun preview(body: JSONObject): JSONObject {
                sent += body.toString(); response = bulkReportFixture().put("action", body.getJSONObject("action")).put("mode", body.getJSONObject("selection").getString("mode"))
                response.getJSONObject("counts").put("selected", 2).put("affected", 2).put("pending", 2)
                if (body.getJSONObject("action").getString("kind") == "status") {
                    val map = body.getJSONObject("action").getJSONObject("statusIds")
                    response.getJSONObject("actionInfo").put("statuses", JSONArray(map.keys().asSequence().toList().map { project -> JSONObject()
                        .put("id", map.getString(project)).put("projectId", project).put("projectTitle", "Live $project").put("statusTitle", "Live status") }))
                }
                if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return response
            }
        }
        private fun service(account: String = this.account) = SharedBulkDraftService(PlanningJournal(storage, contract = SharedBulkJournalContract), account, access, inputs)
        override val supportsSharedBulkInput = true
        override fun captureSharedBulkInputWriter(): SharedBulkInputWriter {
            val expectedAccount = account; val expectedGeneration = generation
            return SharedBulkInputWriter { context, stamp, input -> saveInput(expectedAccount, expectedGeneration, context, stamp, input) }
        }
        override suspend fun sharedBulkInput(context: String): JSONObject? { if (damagedInput) error("PLANNING_DRAFT_INVALID"); return service().loadInput(context) }
        override suspend fun saveSharedBulkInput(context: String, stamp: String?, input: JSONObject) = saveInput(account, generation, context, stamp, input)
        private suspend fun saveInput(expectedAccount: String, expectedGeneration: Long, context: String, stamp: String?, input: JSONObject): JSONObject {
            beforeInputWrite?.invoke()
            fun current() { if (account != expectedAccount || generation != expectedGeneration) throw CancellationException() }
            current()
            if (failInput) error("PLANNING_DRAFT_STORAGE")
            return service(expectedAccount).saveInput(context, stamp, input).also { afterInputCommit?.invoke(); current() }
        }
        override suspend fun sharedBulkDraft(projectId: String) = service().load(projectId)
        override suspend fun saveSharedBulkDraft(projectId: String, stamp: String?, edit: JSONObject) = service().save(projectId, stamp, edit)
        override suspend fun prepareSharedBulkDraft(projectId: String, stamp: String) = service().prepare(projectId, stamp)
        override suspend fun sendSharedBulkDraft(projectId: String, stamp: String) = service().send(projectId, stamp)
        override suspend fun removeSharedBulkDraft(projectId: String, stamp: String) = service().remove(projectId, stamp)
        override suspend fun sharedBulkScope(selection: JSONObject, cursor: String?) = page(listOf("a", "b"))
        override suspend fun sharedProject(projectId: String): JSONObject { projectReads++; error("Fictitious project must never be read") }
        override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String): JSONObject {
            reads++; return JSONObject().put("tasks", JSONArray().put(task("a", 1)).put(task("b", 2))).put("total", 2)
                .put("hasMore", false).put("nextCursor", JSONObject.NULL).put("queryVersion", "version")
        }
        override suspend fun sharedBulkReport(id: String, after: Long) = response
    }
    private fun state(gateway: Gateway, title: String = "Own query") = SharedBulkState(gateway, SharedBulkProtocol.QUERY_SCOPE, origin(title).getJSONObject("filter"), "priority",
        SharedBulkFormData.initial().saved(), "", {}, {}, {}, {}, origin(title), calendar())
    @Test fun incompleteInputAndIndependentCalendarSurviveACompletelyNewEditor() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); first.load()
        first.change(first.form.change("kind", "due").change("dueMode", "shift").change("days", "-")); assertTrue(first.saveInput())
        val restored = state(gateway, "Another view"); restored.load()
        assertEquals("Own query", restored.title); assertEquals("-", restored.form.text("days")); assertEquals("lunar", JSONObject(restored.calendarJson!!).getString("mode"))
        assertFalse(restored.ready); assertEquals(0, gateway.sent.size); assertFalse(gateway.inputs.load("actor", SharedBulkProtocol.QUERY_SCOPE).toString().contains("Live task"))
    }
    @Test fun inputStorageFailureAndStaleSecondWindowNeverSendOrReplaceTheOtherInput() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); val stale = state(gateway); first.load(); stale.load()
        first.change(first.form.toggle(first.tasks!!.getJSONArray("tasks").getJSONObject(0))); assertTrue(first.saveInput())
        stale.change(stale.form.change("days", "-5")); assertFalse(stale.saveInput()); assertEquals("PLANNING_DRAFT_CHANGED", stale.error)
        gateway.failInput = true; first.change(first.form.toggle(first.tasks!!.getJSONArray("tasks").getJSONObject(1))); first.preview()
        assertEquals("PLANNING_DRAFT_STORAGE", first.error); assertEquals(0, gateway.sent.size)
    }
    @Test fun cancellingAutosaveAfterItsCommitKeepsTheStampAndNewerInputForConfigure() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); first.load(); first.selectAll()
        val committed = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        gateway.afterInputCommit = {
            committed.complete(Unit)
            // Like a blocking IO commit, the write finishes before cancellation is delivered to its caller.
            withContext(NonCancellable) { release.await() }
            currentCoroutineContext().ensureActive()
        }
        val saving = launch { first.saveInput() }; committed.await()
        first.change(first.form.change("priority", 3)); saving.cancel(); release.complete(Unit); saving.join()
        gateway.afterInputCommit = null
        assertTrue(first.dirty); assertEquals(3, first.form.int("priority")); assertEquals(0, gateway.sent.size)
        first.configureQuery()
        assertEquals("Configure must use the stamp of the already committed autosave", "configure", first.pane)
        assertEquals("", first.error); assertTrue(first.inputSaved)
        val saved = gateway.inputs.load("actor", SharedBulkProtocol.QUERY_SCOPE)!!.getJSONObject("edit")
        assertEquals(3, saved.getJSONObject("form").getInt("priority"))
        assertTrue(saved.getJSONObject("form").getBoolean("all"))
        assertEquals("lunar", saved.getJSONObject("calendar").getString("mode"))
        assertEquals(0, gateway.sent.size)
        first.preview()
        assertEquals(1, gateway.sent.size)
        assertEquals(3, JSONObject(gateway.sent.single()).getJSONObject("action").getInt("priority"))
    }
    @Test fun replacementInputUsesTheSameWriterAndCannotRaceAnInFlightAutosave() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); first.load(); first.selectAll()
        val committed = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        gateway.afterInputCommit = { committed.complete(Unit); withContext(NonCancellable) { release.await() } }
        val saving = launch { first.saveInput() }; committed.await()
        val replacing = launch { first.newOperation() }; yield()
        val replacementWaitedForTheWriter = !replacing.isCompleted
        release.complete(Unit); saving.join(); replacing.join(); gateway.afterInputCommit = null
        assertTrue("Replacement input must be serialized behind the committed autosave", replacementWaitedForTheWriter)
        assertEquals("", first.error); assertFalse(first.form.all); assertEquals(0, first.form.selectionCount); assertFalse(first.dirty)
        val saved = gateway.inputs.load("actor", SharedBulkProtocol.QUERY_SCOPE)!!.getJSONObject("edit")
        assertFalse(saved.getJSONObject("form").getBoolean("all")); assertEquals(0, saved.getJSONObject("form").getJSONArray("items").length())
        assertEquals("lunar", saved.getJSONObject("calendar").getString("mode")); assertEquals("Own query", first.title)
        assertEquals(0, gateway.sent.size)
    }
    @Test fun queuedAutosaveAndDisposalCannotRebindOldInputToANewAccountOrSession() = runBlocking {
        for (switchAccount in listOf(true, false)) {
            val gateway = Gateway(); val first = state(gateway); first.load(); first.selectAll()
            val waiting = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            gateway.beforeInputWrite = { waiting.complete(Unit); release.await() }
            val saving = launch { first.saveInput() }; waiting.await()
            // Disposal also flushes under NonCancellable, so cancellation of its old screen is insufficient.
            val queued = launch(NonCancellable) { first.saveInput() }; yield()
            assertFalse("The second writer must still be waiting for the input mutex", queued.isCompleted)
            gateway.generation++
            if (switchAccount) gateway.account = "another-actor"
            release.complete(Unit); saving.join(); queued.join(); gateway.beforeInputWrite = null
            assertTrue(saving.isCancelled); assertTrue(queued.isCancelled)
            assertTrue(first.dirty)
            assertNull(gateway.inputs.load("actor", SharedBulkProtocol.QUERY_SCOPE))
            assertNull(gateway.inputs.load("another-actor", SharedBulkProtocol.QUERY_SCOPE))
            val disposal = runCatching { withContext(NonCancellable) { first.saveInput() } }.exceptionOrNull()
            assertTrue("A disposal flush started after invalidation must keep its original session", disposal is CancellationException)
            assertNull(gateway.inputs.load(gateway.account, SharedBulkProtocol.QUERY_SCOPE))
            assertEquals(0, gateway.sent.size)
        }
    }
    @Test fun lostQueryPreviewRestoresItsOriginAndExactBodyWithoutAnyProjectOrViewRead() = runBlocking {
        val gateway = Gateway(); gateway.lose = true; val first = state(gateway); first.load(); first.selectAll(); first.configureQuery(); first.preview()
        assertEquals("pending", first.phase); assertEquals(1, gateway.sent.size)
        gateway.queue = true; gateway.damagedInput = true
        val restored = state(gateway, "Deleted replacement view"); val reads = gateway.reads; restored.load(); assertEquals("Own query", restored.title)
        assertEquals(reads, gateway.reads); assertEquals(0, gateway.projectReads); restored.retry()
        assertEquals("received", restored.phase); assertEquals(gateway.sent[0], gateway.sent[1]); assertEquals(2, gateway.sent.size)
        assertFalse(gateway.sent[0].contains("calendar")); assertFalse(gateway.sent[0].contains("Live task"))
    }
    @Test fun queryStatusEditorUsesOneExplicitMappingPerProjectAndNoAllTasksDownload() = runBlocking {
        val gateway = Gateway(); val first = state(gateway); first.load(); first.selectAll(); first.configureQuery()
        assertEquals(1, gateway.reads); assertEquals(2, first.scopeProjects.size)
        first.change(first.form.change("kind", "status").status("a", "a-open")); assertFalse(first.ready)
        first.change(first.form.status("b", "b-open")); assertTrue(first.ready); first.preview()
        assertEquals("received", first.phase); val statuses = JSONObject(gateway.sent.single()).getJSONObject("action").getJSONObject("statusIds")
        assertEquals(setOf("a", "b"), statuses.keys().asSequence().toSet())
    }
}
