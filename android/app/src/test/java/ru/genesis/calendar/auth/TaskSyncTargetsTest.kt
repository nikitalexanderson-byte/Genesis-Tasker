package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.LocalTask

class TaskSyncTargetsTest {
    @Test fun nativeTaskKeepsExplicitGoogleTargets() {
        val source = JSONObject().put("syncAccountIds", JSONArray(listOf("account-one", "account-two")))
        val saved = JSONObject(LocalTask(title = "Task", sourceFieldsJson = source.toString()).json())
        assertEquals(listOf("account-one", "account-two"),
            (0 until saved.getJSONArray("syncAccountIds").length()).map {
                saved.getJSONArray("syncAccountIds").getString(it)
            })
    }

    @Test fun completionTimestampChangesOnlyWhenCompleting() {
        val previous = JSONObject().put("done", false)
        val completed = JSONObject(LocalTask(title = "Task", done = true,
            sourceFieldsJson = previous.toString()).json())
        assertTrue(completed.getString("completedAt").isNotBlank())
        val reopened = JSONObject(LocalTask(title = "Task", done = false,
            sourceFieldsJson = completed.toString()).json())
        assertTrue(reopened.isNull("completedAt"))
    }
}
