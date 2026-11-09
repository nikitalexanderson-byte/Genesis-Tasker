package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import java.io.IOException

class DataExportStateTest {
    private val space = "11111111-1111-4111-8111-111111111111"
    private val project = "22222222-2222-4222-8222-222222222222"
    private fun command(format: String = "json") = JSONObject().put("scope", "tree").put("projectId", project).put("format", format)
        .put("from", JSONObject.NULL).put("to", JSONObject.NULL).put("undated", true).put("archived", true)
        .put("calendarMode", "lunar").put("calendarContext", JSONObject().put("version", 2).put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
    private fun reply(content: String = "{\"future\":true}", format: String = "json") = JSONObject().put("format", format).put("content", content)
        .put("projectCount", 3).put("taskCount", 131).put("notices", JSONArray())
    private inner class Gateway : SharedWorkspaceGateway {
        var calls = 0; var sent: JSONObject? = null
        var response: suspend () -> JSONObject = { reply() }
        override suspend fun exportSharedData(spaceId: String, command: JSONObject): JSONObject {
            assertEquals(space, spaceId); calls++; sent = JSONObject(command.toString()); return response()
        }
    }
    @Test fun openingAndCancellingThePickerMakesNoExportRequestAndShowsNoSuccess() = runBlocking {
        val gateway = Gateway(); val state = DataExportState(gateway, "account-a", space)
        assertEquals("json", state.prepare(command())); assertTrue(state.busy); assertEquals(0, gateway.calls)
        state.complete(null); assertEquals(0, gateway.calls); assertFalse(state.busy); assertNull(state.receipt)
    }
    @Test fun requestAndContextAreFrozenBeforeThePickerAndFileBytesAreNotReserialized() = runBlocking {
        val gateway = Gateway(); val state = DataExportState(gateway, "account-a", space); val draft = command()
        state.prepare(draft); draft.put("scope", "space"); draft.getJSONObject("calendarContext").put("timeZone", "UTC")
        var file = ""; state.complete(DataExportDestination { content, current -> current(); file = content })
        assertEquals("tree", gateway.sent!!.getString("scope")); assertEquals("America/New_York", gateway.sent!!.getJSONObject("calendarContext").getString("timeZone"))
        assertEquals(reply().getString("content"), file); assertEquals(131, state.receipt!!.getInt("taskCount"))
        assertFalse(state.receipt!!.has("content")); assertNull(state.saved())
    }
    @Test fun duplicatePickerCallbacksDoNotFetchOrWriteTwice() = runBlocking {
        val gateway = Gateway(); val state = DataExportState(gateway, "account-a", space); var writes = 0
        state.prepare(command()); val target = DataExportDestination { _, current -> current(); writes++ }
        state.complete(target); state.complete(target); assertEquals(1, gateway.calls); assertEquals(1, writes)
    }
    @Test fun pendingSelectionRestoresOnlyForTheSameAccountAndWorkspace() = runBlocking {
        val gateway = Gateway(); val original = DataExportState(gateway, "account-a", space); original.prepare(command())
        val saved = original.saved()!!; original.close()
        val restored = DataExportState(gateway, "account-a", space, saved); var writes = 0
        restored.complete(DataExportDestination { _, _ -> writes++ }); assertEquals(1, writes)
        val other = DataExportState(gateway, "account-b", space, saved)
        other.complete(DataExportDestination { _, _ -> writes++ }); assertEquals(1, writes); assertNull(other.prepared)
    }
    @Test fun aLateNonCancellableNetworkResponseAfterCloseCannotOpenTheFile() = runBlocking {
        val gateway = Gateway(); val waiting = CompletableDeferred<Unit>()
        gateway.response = { withContext(NonCancellable) { waiting.await() }; reply() }
        val state = DataExportState(gateway, "account-a", space); state.prepare(command()); var writes = 0
        val saving = launch { state.complete(DataExportDestination { _, _ -> writes++ }) }; yield()
        state.close(); waiting.complete(Unit); saving.join()
        assertEquals(0, writes); assertNull(state.receipt)
    }
    @Test fun losingRightsOrNetworkNeverWritesACachedSelection() = runBlocking {
        for (kind in listOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NETWORK)) {
            val gateway = Gateway().apply { response = { throw AuthFailure(kind) } }
            val state = DataExportState(gateway, "account-a", space); state.prepare(command()); var wrote = false
            state.complete(DataExportDestination { _, _ -> wrote = true })
            assertFalse(wrote); assertNull(state.receipt); assertEquals(kind.name, state.error)
        }
    }
    @Test fun providerFailureNeverReportsSuccessAndTheSelectionCanBeRetried() = runBlocking {
        val gateway = Gateway(); val state = DataExportState(gateway, "account-a", space)
        state.prepare(command()); state.complete(DataExportDestination { _, _ -> throw IOException() })
        assertEquals("STORAGE", state.error); assertNull(state.receipt); assertFalse(state.busy)
        state.prepare(command()); state.complete(DataExportDestination { _, current -> current() })
        assertNotNull(state.receipt); assertEquals(2, gateway.calls); assertEquals("", state.error)
    }
    @Test fun aClosedScreenStopsWritingAndDoesNotProduceASuccessReceipt() = runBlocking {
        val gateway = Gateway(); val state = DataExportState(gateway, "account-a", space); state.prepare(command()); var reachedEnd = false
        val entered = CompletableDeferred<Unit>(); val continueWrite = CompletableDeferred<Unit>()
        val writing = launch {
            state.complete(DataExportDestination { _, current -> withContext(Dispatchers.Default) {
                current(); entered.complete(Unit); continueWrite.await(); current(); reachedEnd = true
            } })
        }
        entered.await(); state.close(); continueWrite.complete(Unit); writing.join()
        assertFalse(reachedEnd); assertNull(state.receipt)
    }
    @Test fun invalidReplyIsRejectedBeforeTheDestinationIsWritten() = runBlocking {
        val gateway = Gateway().apply { response = { reply(format = "csv") } }; val state = DataExportState(gateway, "account-a", space)
        state.prepare(command()); var writes = 0; state.complete(DataExportDestination { _, _ -> writes++ })
        assertEquals(0, writes); assertEquals("PROTOCOL", state.error); assertNull(state.receipt)
    }
    @Test fun csvBomUnicodeQuotesAndLineEndingsPassToTheDestinationExactly() = runBlocking {
        val csv = "\uFEFFНазвание,Описание\r\n\"Луна 🌙\",\"первая\nвторая\"\r\n"
        val gateway = Gateway().apply { response = { reply(csv, "csv") } }; val state = DataExportState(gateway, "account-a", space)
        state.prepare(command("csv")); var actual = ""; state.complete(DataExportDestination { content, _ -> actual = content })
        assertArrayEquals(csv.toByteArray(Charsets.UTF_8), actual.toByteArray(Charsets.UTF_8))
    }
}
