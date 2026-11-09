package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedTaskMoveProjectionTest {
    @Test fun sparseMoveReceiptKeepsTheReaderCardUntilRefresh() {
        val task = JSONObject().put("id", "task").put("projectId", "from").put("statusId", "old")
            .put("title", "Move me").put("description", "Keep the description").put("revision", 3)
        val receipt = JSONObject().put("id", "task").put("revision", 4).put("position", 2)
        val moved = sharedMovedTaskProjection(task, receipt, "to", "new")
        assertEquals("Move me", moved.getString("title"))
        assertEquals("Keep the description", moved.getString("description"))
        assertEquals("to", moved.getString("projectId")); assertEquals("new", moved.getString("statusId"))
        assertEquals(4, moved.getInt("revision")); assertFalse(moved.getBoolean("pending"))
        assertEquals("from", task.getString("projectId")); assertFalse(receipt.has("title"))
    }
    @Test(expected = IllegalArgumentException::class) fun receiptForAnotherTaskCannotReplaceTheCard() {
        sharedMovedTaskProjection(JSONObject().put("id", "a"), JSONObject().put("id", "b"), "project", "status")
    }
}
