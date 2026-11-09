package ru.genesis.calendar.auth

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SharedOfflineStoreTest {
    @Test fun customPatchAndOldCommandsSurviveEncryptedReloadWithTheirOriginalIdentity() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val user = UUID.randomUUID().toString(); val other = UUID.randomUUID().toString()
        val store = SharedOfflineStore(context)
        val oldRequest = UUID.randomUUID().toString(); val request = UUID.randomUUID().toString()
        val old = JSONObject().put("requestId", oldRequest).put("body", JSONObject().put("title", "Legacy task").put("requestId", oldRequest))
        val body = JSONObject().put("customFields", JSONObject().put("number", 0).put("checkbox", false)
            .put("text", JSONObject.NULL).put("select", "retired")).put("expectedRevision", 5).put("requestId", request)
        try {
            store.enqueue(user, old)
            store.enqueue(user, JSONObject().put("requestId", request).put("taskId", "custom-task").put("body", body))
            store.markError(user, request, "CUSTOM_FIELD_REQUIRED")
            val reloaded = SharedOfflineStore(context)
            assertTrue(reloaded.queued(other).isEmpty()); assertEquals(old.toString(), reloaded.queued(user).first().toString())
            val pending = reloaded.queued(user).last(); assertEquals(body.toString(), pending.getJSONObject("body").toString())
            assertEquals(request, pending.getString("requestId")); assertEquals("CUSTOM_FIELD_REQUIRED", pending.getString("error"))
            assertFalse(context.getSharedPreferences("genesis.shared.offline.v1", 0).all.values.joinToString().contains("retired"))
            val incomplete = JSONObject().put("task", JSONObject().put("id", "custom-task").put("projectId", "custom-project").put("revision", 6))
            assertThrows(AuthFailure::class.java) { confirmedSharedReceipt("update", "custom-project", "custom-task", body, incomplete) }
            assertEquals(body.toString(), reloaded.queued(user).last().getJSONObject("body").toString())
            store.remove(user, request); assertEquals(old.toString(), reloaded.queued(user).single().toString())
        } finally { store.clear(user); store.clear(other) }
    }

    @Test fun estimateCommandKeepsZeroNullOmittedAndIdentityAfterAnUncertainRetry() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val user = UUID.randomUUID().toString()
        val request = UUID.randomUUID().toString()
        val body = JSONObject().put("storyPoints", 0).put("estimateHours", JSONObject.NULL)
            .put("expectedRevision", 0).put("requestId", request)
        val store = SharedOfflineStore(context)
        try {
            store.enqueue(user, JSONObject().put("taskId", "estimate-test").put("requestId", request).put("body", body))
            store.markError(user, request, "FORBIDDEN")
            val retained = SharedOfflineStore(context).queued(user).single()
            assertEquals(request, retained.getString("requestId"))
            assertEquals(body.toString(), retained.getJSONObject("body").toString())
            assertEquals(0, retained.getJSONObject("body").getInt("storyPoints"))
            assertTrue(retained.getJSONObject("body").has("estimateHours"))
            assertTrue(retained.getJSONObject("body").isNull("estimateHours"))
            assertFalse(retained.getJSONObject("body").has("sprintId"))
            assertEquals("FORBIDDEN", retained.getString("error"))
        } finally { store.clear(user) }
    }

    @Test fun teamDraftsAreEncryptedScopedAndClearedOnLogout() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SharedOfflineStore(context)
        val first = UUID.randomUUID().toString()
        val second = UUID.randomUUID().toString()
        val path = "project:${UUID.randomUUID()}"
        val title = "Private team draft ${UUID.randomUUID()}"
        try {
            store.saveSnapshot(first, path, JSONObject().put("title", title))
            store.saveSnapshot(second, path, JSONObject().put("title", "Other team"))
            store.enqueue(first, JSONObject().put("requestId", UUID.randomUUID().toString())
                .put("projectId", path).put("title", title))
            assertEquals(title, store.snapshot(first, path)?.getString("title"))
            assertEquals("Other team", store.snapshot(second, path)?.getString("title"))
            assertEquals(1, store.queued(first).size)
            assertTrue(store.queued(second).isEmpty())
            val raw = context.getSharedPreferences("genesis.shared.offline.v1", 0).all.values.joinToString()
            assertFalse(raw.contains(title))
            store.clearSnapshots(first)
            assertNull(store.snapshot(first, path))
            assertEquals(1, store.queued(first).size)
            store.clear(first)
            assertNull(store.snapshot(first, path))
            assertTrue(store.queued(first).isEmpty())
            assertEquals("Other team", store.snapshot(second, path)?.getString("title"))
        } finally {
            store.clear(first)
            store.clear(second)
        }
    }
}
