package ru.genesis.calendar.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import java.io.InputStream
import java.util.UUID

class DataImportStateTest {
    private class Gateway : SharedWorkspaceGateway {
        var record: JSONObject? = null; var saveStarted: CompletableDeferred<Unit>? = null; var saveReply: CompletableDeferred<Unit>? = null
        var delayedSend: CompletableDeferred<Unit>? = null; var lost = false; var writes = 0; var chosen = 0
        var pending = emptyList<JSONObject>(); var outcomes = emptyList<JSONObject>(); var loseUndo = false
        private fun nextStamp() = UUID.randomUUID().toString()
        private fun current(expected: String?) { require(record?.getString("stamp") == expected) { "PLANNING_DRAFT_CHANGED" } }
        override suspend fun sharedDataImportDraft(spaceId: String, projectId: String) = record?.let { JSONObject(it.toString()) }
        override suspend fun chooseSharedDataImportSource(spaceId: String, projectId: String, stamp: String?, name: String, selection: JSONObject, open: () -> InputStream): JSONObject {
            current(stamp); chosen++; open().close()
            val edit = JSONObject().put("kind", "data-import").put("selection", JSONObject(selection.toString())).put("review", JSONObject.NULL)
                .put("source", JSONObject().put("id", UUID.randomUUID().toString()).put("name", name).put("bytes", 1).put("sha256", "a".repeat(64)))
            return JSONObject().put("stamp", nextStamp()).put("phase", "editing").put("edit", edit).put("attempts", 0).put("receipt", JSONObject.NULL).also { record = it }
        }
        override suspend fun saveSharedDataImportDraft(spaceId: String, projectId: String, stamp: String?, edit: JSONObject): JSONObject {
            current(stamp); val frozen = JSONObject(edit.toString()); saveStarted?.complete(Unit); saveReply?.await()
            current(stamp); return JSONObject(record!!.toString()).put("stamp", nextStamp()).put("edit", frozen).also { record = it }
        }
        override suspend fun inspectSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject {
            current(stamp); val preview = importPreview(); val next = JSONObject(record!!.toString()).put("stamp", nextStamp())
            next.getJSONObject("edit").put("review", DataImportProtocol.review(preview)); record = next
            return JSONObject().put("record", next).put("preview", preview)
        }
        override suspend fun prepareSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject {
            current(stamp); return JSONObject(record!!.toString()).put("stamp", nextStamp()).put("phase", "pending").put("command", "frozen-command").also { record = it }
        }
        override suspend fun sendSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject {
            current(stamp); writes++; record = JSONObject(record!!.toString()).put("stamp", nextStamp()).put("attempts", record!!.getInt("attempts") + 1)
            delayedSend?.await()
            if (lost) { lost = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return JSONObject(record!!.toString()).put("stamp", nextStamp()).put("phase", "received").put("receipt", importReceipt(UUID.randomUUID().toString())).also { record = it }
        }
        override suspend fun pendingSharedDataUndos(spaceId: String) = pending
        override suspend fun sharedDataUndoOutcomes(spaceId: String) = outcomes
        override suspend fun undoSharedDataImport(spaceId: String, receipt: JSONObject): JSONObject {
            pending = listOf(receipt)
            if (loseUndo) { loseUndo = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            pending = emptyList(); outcomes = listOf(JSONObject(receipt.toString()).put("state", "undone").put("canUndo", false))
            return JSONObject().put("importId", receipt.getString("importId")).put("state", "undone")
        }
    }
    private fun state(gateway: Gateway, account: String = "account") = DataImportState(gateway, account, IMPORT_SPACE, IMPORT_PROJECT, importSelection())
    private suspend fun source(state: DataImportState) {
        state.load(); state.choose(state.pickerParameters()!!, "source.json") { "x".byteInputStream() }
    }
    @Test fun quietSaveKeepsNewerTypingAndUsesTheCommittedStampForTheNextSave() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); source(state)
        importEdit(state) { it.getJSONObject("parse").put("title", "First") }
        gateway.saveStarted = CompletableDeferred(); gateway.saveReply = CompletableDeferred()
        val saving = launch { state.save() }; gateway.saveStarted!!.await()
        assertTrue(state.editable); assertFalse(state.busy)
        importEdit(state) { it.getJSONObject("parse").put("title", "Second") }
        gateway.saveReply!!.complete(Unit); saving.join()
        assertEquals("Second", state.selection.getJSONObject("parse").getString("title")); assertTrue(state.dirty)
        gateway.saveStarted = null; gateway.saveReply = null; state.save()
        assertFalse(state.dirty); assertEquals("Second", gateway.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("parse").getString("title"))
    }
    @Test fun aLostApplyReplyLoadsTheAdvancedDurableStampAndOffersTheSameCommandAgain() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); source(state); state.inspect(); gateway.lost = true; state.apply()
        assertEquals("pending", state.phase); assertEquals(1, state.record!!.getInt("attempts")); assertEquals("NETWORK", state.error)
        state.retry(); assertEquals("received", state.phase); assertEquals(2, gateway.writes); assertEquals("frozen-command", state.record!!.getString("command"))
    }
    @Test fun closingDuringTheResponseCannotShowSuccessInTheOldUi() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); source(state); state.inspect(); gateway.delayedSend = CompletableDeferred()
        val applying = launch { assertThrowsSuspend { state.apply() } }
        withTimeout(5000) { while (gateway.writes == 0) yield() }; assertEquals(1, gateway.writes); state.close(); gateway.delayedSend!!.complete(Unit); applying.join()
        assertNull(state.receipt); assertEquals("pending", state.phase)
    }
    @Test fun aPickerRestoredIntoAnotherAccountCannotReadOrStoreItsUri() = runBlocking {
        val gateway = Gateway(); val old = state(gateway); old.load(); val parameters = old.pickerParameters()!!; old.close()
        val replacement = state(gateway, "another-account"); replacement.load(); var opened = false
        replacement.choose(parameters, "source.json") { opened = true; "x".byteInputStream() }
        assertFalse(opened); assertEquals(0, gateway.chosen); assertEquals("UNAUTHORIZED", replacement.error)
    }
    @Test fun theRestoredPickerUsesTheNewGatewayAndItsFrozenFirstSelection() = runBlocking {
        val originalGateway = Gateway(); val original = state(originalGateway); original.load()
        importEdit(original) { it.put("format", "csv") }; val parameters = original.pickerParameters()!!; original.close()
        val freshGateway = Gateway(); val restored = state(freshGateway); restored.load(); restored.choose(parameters, "source.csv") { "title\nTask".byteInputStream() }
        assertEquals(0, originalGateway.chosen); assertEquals(1, freshGateway.chosen); assertEquals("csv", restored.selection.getString("format"))
    }
    @Test fun pendingUndoAppearsAfterFailureAndTheCompletedOutcomeSurvivesUiRecreation() = runBlocking {
        val gateway = Gateway(); val state = state(gateway); source(state); state.inspect(); state.apply(); val receipt = state.receipt!!
        gateway.loseUndo = true; state.undo(receipt); assertEquals(1, state.pendingUndos.size)
        state.undo(state.pendingUndos.single()); assertTrue(state.pendingUndos.isEmpty()); assertEquals("undone", state.receipt!!.getString("state"))
        val restored = state(gateway); restored.load(); assertEquals("undone", restored.receipt!!.getString("state"))
    }
    private suspend fun assertThrowsSuspend(action: suspend () -> Unit) {
        try { action(); fail("Expected cancellation") } catch (_: CancellationException) { }
    }
}
