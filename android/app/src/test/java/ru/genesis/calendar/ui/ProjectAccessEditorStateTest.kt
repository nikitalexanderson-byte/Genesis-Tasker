package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*

class ProjectAccessEditorStateTest {
    private class Gateway : SharedWorkspaceGateway {
        val storage = MemoryPlanningStorage(); val snapshot = accessFixture("state")
        val space = snapshot.getString("spaceId"); val user = snapshot.getString("userId")
        var failure: Exception? = null; var gate: CompletableDeferred<JSONObject>? = null; var lose = false
        var sends = 0; val bodies = mutableListOf<String>(); val receipts = mutableMapOf<String, JSONObject>()
        private val access = object : ProjectAccessDraftAccess {
            override fun check() = Unit
            override fun state(space: String, user: String) = JSONObject(snapshot.toString()).also { failure?.let { throw it } }
            override fun preview(space: String, user: String, draft: JSONObject) = accessFixture("preview").put("desired", draft)
                .put("fingerprint", snapshot.getString("fingerprint")).put("revision", snapshot.getLong("revision")).also { failure?.let { throw it } }
            override fun hasTaskQueue() = false
            override fun send(space: String, user: String, body: JSONObject): JSONObject {
                failure?.let { throw it }; sends++; bodies += body.toString()
                val result = receipts.getOrPut(body.getString("operationId")) {
                    snapshot.put("revision", snapshot.getLong("revision") + 1).put("fingerprint", "c".repeat(64))
                        .put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants"))
                    JSONObject().put("operationId", body.getString("operationId")).put("revision", snapshot.getLong("revision")).put("changed", 3)
                        .put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants"))
                }
                if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return JSONObject(result.toString())
            }
        }
        private fun service() = ProjectAccessDraftService(PlanningJournal(storage, contract = ProjectAccessJournalContract), "ui-state-actor", access)
        override suspend fun sharedProjectAccess(spaceId: String, userId: String): JSONObject = gate?.await() ?: access.state(spaceId, userId)
        override suspend fun sharedProjectAccessDraft(spaceId: String, userId: String) = service().load(spaceId, userId)
        override suspend fun sharedProjectAccessCopies(spaceId: String, userId: String) = service().copies(spaceId, userId)
        override suspend fun saveSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String?, edit: JSONObject) = service().save(spaceId, userId, stamp, edit)
        override suspend fun previewSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().preview(spaceId, userId, stamp)
        override suspend fun prepareSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().prepare(spaceId, userId, stamp)
        override suspend fun sendSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().send(spaceId, userId, stamp)
        override suspend fun rebaseSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().rebase(spaceId, userId, stamp)
        override suspend fun removeSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().remove(spaceId, userId, stamp)
        override suspend fun saveSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String?, edit: JSONObject) = service().saveCopy(spaceId, userId, id, stamp, edit)
        override suspend fun useSharedProjectAccessCopy(spaceId: String, userId: String, id: String, copyStamp: String, stamp: String?) = service().useCopy(spaceId, userId, id, copyStamp, stamp)
        override suspend fun removeSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String) = service().removeCopy(spaceId, userId, id, stamp)
    }
    private fun selected(state: ProjectAccessEditorState) = JSONObject(state.edit!!.toString()).put("draft", accessFixture("preview").getJSONObject("desired"))
    @Test fun reviewIsVisibleBeforeApplyAndSuccessfulSaveRestoresTheFreshPolicy() = runBlocking {
        val gateway = Gateway(); var notices = 0; val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, { notices++ })
        state.load(); state.change(selected(state)); state.persist(); state.apply(); assertEquals(0, gateway.sends)
        state.review(); assertNotNull(state.preview); state.apply()
        assertEquals(1, gateway.sends); assertEquals(1, notices); assertTrue(state.notice); assertNull(state.preview)
        assertFalse(state.edit!!.getJSONObject("draft").getBoolean("allProjects")); assertTrue(state.editable)
    }
    @Test fun reopeningRestoresOnlyRulesAndRequiresANewPreviewBeforeAnyWrite() = runBlocking {
        val gateway = Gateway(); val first = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {})
        first.load(); first.change(selected(first)); first.persist(); first.review(); first.close()
        val next = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); next.load()
        assertEquals(3, next.edit!!.getJSONObject("draft").getJSONArray("grants").length()); assertNull(next.preview)
        next.apply(); assertEquals(0, gateway.sends)
    }
    @Test fun offlineDiscardsThePreviewAndIgnoresAnEarlierLoadingReply() = runBlocking {
        val gateway = Gateway(); val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {})
        state.load(); state.change(selected(state)); state.persist(); state.review(); val before = state.record!!.toString()
        gateway.gate = CompletableDeferred(); val read = launch { state.refresh() }; yield(); state.offline()
        gateway.gate!!.complete(JSONObject(gateway.snapshot.toString())); read.join()
        assertNull(state.preview); assertNull(state.data); assertEquals(before, state.record!!.toString()); assertEquals("NETWORK", state.error)
        state.apply(); assertEquals(0, gateway.sends)
    }
    @Test fun lostResponseKeepsThePendingCommandAndManualRetryDoesNotDuplicateChanges() = runBlocking {
        val gateway = Gateway(); var notices = 0; val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, { notices++ })
        state.load(); state.change(selected(state)); state.persist(); state.review(); gateway.lose = true; state.apply()
        assertEquals("pending", state.phase); assertEquals(1, state.record!!.getInt("attempts")); assertNull(state.preview)
        state.retry(); assertEquals(2, gateway.sends); assertEquals(gateway.bodies[0], gateway.bodies[1]); assertEquals(1, gateway.receipts.size); assertEquals(1, notices)
    }
    @Test fun revokedOwnerAccessClearsPrivateNamesAndDoesNotNotifyASuccess() = runBlocking {
        val gateway = Gateway(); var lost = 0; var notices = 0; val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, { lost++ }, { notices++ })
        state.load(); state.change(selected(state)); state.persist(); state.review()
        gateway.failure = AuthFailure(AuthFailure.Kind.UNAUTHORIZED); state.apply()
        assertNull(state.data); assertNull(state.edit); assertNull(state.preview); assertNull(state.record); assertEquals(1, lost); assertEquals(0, notices); assertEquals(0, gateway.sends)
        assertNotNull(gateway.sharedProjectAccessDraft(gateway.space, gateway.user))
    }
    @Test fun competingEditorsPreserveBothChoicesInTheVersionPicker() = runBlocking {
        val gateway = Gateway(); val a = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); val b = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {})
        a.load(); b.load(); a.change(selected(a)); a.persist()
        val bEdit = selected(b); bEdit.getJSONObject("draft").getJSONArray("grants").getJSONObject(0).put("includeDescendants", true)
        b.change(bEdit); assertTrue(b.persist()); assertTrue(b.conflicted); assertTrue(b.saved)
        b.review(); assertNull(b.preview); assertEquals(0, gateway.sends)
        b.versions(); assertFalse(b.active); assertEquals(1, b.copies.size); b.useCopy(b.copies.single())
        assertTrue(b.active); assertFalse(b.conflicted); assertEquals(2, b.copies.size)
        assertTrue(b.edit!!.getJSONObject("draft").getJSONArray("grants").getJSONObject(0).getBoolean("includeDescendants"))
    }
    @Test fun coldReopenWithCompetingCopiesOffersAnExplicitChoiceInsteadOfHidingTheSavedVersion() = runBlocking {
        val gateway = Gateway(); val first = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); first.load()
        val other = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); other.load()
        first.change(selected(first)); first.persist()
        val own = selected(other); own.getJSONObject("draft").put("allProjects", true); other.change(own); other.persist(); other.close()
        val reopened = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); reopened.load()
        assertFalse(reopened.active); assertEquals(1, reopened.copies.size)
        reopened.useCopy(reopened.copies.single()); assertTrue(reopened.active); assertTrue(reopened.edit!!.getJSONObject("draft").getBoolean("allProjects")); assertEquals(2, reopened.copies.size)
    }
    @Test fun aFullCopyQuotaCanBeFreedWithoutLosingTheUnsavedCompetingInput() = runBlocking {
        val gateway = Gateway(); val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); state.load()
        val old = state.record!!
        gateway.saveSharedProjectAccessDraft(gateway.space, gateway.user, old.getString("stamp"), selected(state))
        repeat(PlanningJournal.MAX_COPIES) { gateway.saveSharedProjectAccessCopy(gateway.space, gateway.user, java.util.UUID.randomUUID().toString(), null, selected(state)) }
        val own = selected(state); own.getJSONObject("draft").put("allProjects", true); state.change(own)
        assertFalse(state.persist()); assertTrue(state.conflicted); assertFalse(state.saved); assertEquals(8, state.copies.size)
        state.removeCopy(state.copies.first()); assertTrue(state.saved)
        state.versions(); assertFalse(state.active); assertEquals(8, state.copies.size)
        assertTrue(state.copies.any { it.getJSONObject("edit").getJSONObject("draft").getBoolean("allProjects") })
    }
    @Test fun cancellationHidesTheCatalogAndManagerTargetsNeverBecomeEditable() = runBlocking {
        val gateway = Gateway(); val state = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {})
        state.load(); gateway.failure = CancellationException("Synthetic scope changed")
        assertTrue(runCatching { state.refresh() }.exceptionOrNull() is CancellationException); assertNull(state.data); assertNull(state.preview)
        gateway.failure = null; gateway.snapshot.put("memberRole", "admin")
        val manager = ProjectAccessEditorState(gateway, gateway.space, gateway.user, {}, {}); manager.load(); assertFalse(manager.editable)
        manager.review(); manager.apply(); assertEquals(0, gateway.sends)
    }
}
