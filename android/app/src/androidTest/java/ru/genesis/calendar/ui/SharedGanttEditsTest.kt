package ru.genesis.calendar.ui

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedGanttEditsTest {
    private fun task() = JSONObject().put("id","one").put("projectId","project").put("revision",4).put("dueDate","2026-10-29")
    @Test fun localPositionLeadsTheServerAndRepeatedGesturesUseAcknowledgedRevisions() = runBlocking {
        val gate=CompletableDeferred<Unit>()
        val state=SharedGanttEdits(this)
        val revisions=mutableListOf<Int>()
        val save: suspend (JSONObject,JSONObject)->JSONObject = { row,patch ->
            revisions+=row.getInt("revision")
            if(revisions.size==1) gate.await()
            JSONObject(row.toString()).put("dueDate",patch.getString("dueDate")).put("revision",row.getInt("revision")+1)
        }
        state.submit(task(),JSONObject().put("dueDate","2026-10-30"),save,{})
        yield()
        assertEquals("2026-10-30",state.rows.getValue("one").getString("dueDate"))
        state.submit(state.rows.getValue("one"),JSONObject().put("dueDate","2026-11-01"),save,{})
        assertEquals("2026-11-01",state.rows.getValue("one").getString("dueDate"))
        assertEquals(listOf(4),revisions)
        gate.complete(Unit); yield()
        assertEquals(listOf(4,5),revisions)
        assertEquals(6,state.rows.getValue("one").getInt("revision"))
        assertFalse(state.saving)
        state.reconcile(listOf(task()))
        assertTrue("Stale refresh cannot undo a confirmed gesture",state.rows.containsKey("one"))
        state.reconcile(listOf(JSONObject(state.rows.getValue("one").toString())))
        assertTrue(state.rows.isEmpty())
    }
    @Test fun rejectedMutationRollsBackAndDoesNotSendDependentQueuedChanges() = runBlocking {
        val gate=CompletableDeferred<Unit>()
        val state=SharedGanttEdits(this)
        var requests=0
        val save: suspend (JSONObject,JSONObject)->JSONObject = { _,_ -> requests++;gate.await();error("REVISION_CONFLICT") }
        state.submit(task(),JSONObject().put("dueDate","2026-10-30"),save,{})
        yield()
        state.submit(state.rows.getValue("one"),JSONObject().put("dueDate","2026-11-01"),save,{})
        gate.complete(Unit);yield()
        assertTrue(state.rows.isEmpty());assertFalse(state.saving);assertTrue(state.error.isNotBlank());assertEquals(1,requests)
    }
    @Test fun successfulRefreshDropsAnAcknowledgedTaskThatIsNoLongerReadable() = runBlocking {
        val state=SharedGanttEdits(this)
        state.submit(task(),JSONObject().put("dueDate","2026-10-30"),{ row,patch -> JSONObject(row.toString()).put("revision",5).put("dueDate",patch.getString("dueDate")) },{})
        yield()
        state.reconcile(emptyList(),dropMissing=true)
        assertTrue(state.rows.isEmpty())
    }
}
