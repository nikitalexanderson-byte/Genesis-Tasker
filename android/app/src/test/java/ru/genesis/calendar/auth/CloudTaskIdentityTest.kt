package ru.genesis.calendar.auth

import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CloudTaskIdentityTest {
    private val account = "synthetic-google-account"
    private val prefix = "account-" + MessageDigest.getInstance("SHA-256").digest(account.toByteArray())
        .joinToString("") { "%02x".format(it) }.take(10) + "-"

    @Test fun accountNamespaced119CharacterIdIsImportedWithoutTruncationOrCollision() {
        val base = "x".repeat(99)
        val ids = listOf(prefix + base + "1", prefix + base + "2")
        assertEquals(119, ids.first().length)
        val imported = ids.map { id -> CloudAccountSnapshot.nativeTaskJson(JSONObject()
            .put("id", id).put("title", "Task").put("dueDate", "2026-09-28")).getString("id") }
        assertEquals(ids, imported)
        assertNotEquals(imported[0], imported[1])
    }

    @Test fun calendarAndGoogleTasksMutationsKeepTheSameAccountIdentityAfterServerConfirmation() {
        for (origin in listOf("google-calendar", "google-tasks")) {
            val remoteId = prefix + "x".repeat(81)
            val localId = prefix + remoteId
            assertEquals(100, remoteId.length)
            val source = JSONObject().put("id", localId).put("title", "Edited task")
                .put("createdIn", origin).put("googleAccountId", account)
                .put("googleEventId", "event-fixture").put("googleTaskId", "task-fixture")
            val mutation = CloudTaskIdentity.mutation(localId, source)
            assertEquals(remoteId, mutation.remoteId)
            assertEquals(remoteId, mutation.body.getString("id"))
            assertEquals("event-fixture", mutation.body.getString("googleEventId"))
            assertEquals(localId, source.getString("id"))
            val response = JSONObject().put("task", JSONObject(mutation.body.toString()).put("done", true))
            val saved = mutation.confirmed(response).getJSONObject("task")
            assertEquals(localId, saved.getString("id"))
            assertTrue(saved.getBoolean("done"))
            assertEquals(remoteId, response.getJSONObject("task").getString("id"))
            assertThrows(IllegalArgumentException::class.java) {
                mutation.confirmed(JSONObject().put("task", JSONObject().put("id", "another-task")))
            }
        }
    }

    @Test fun localGenesisIdsAreNotRenamedAndOtherAccountPrefixesAreNotStripped() {
        val normal = JSONObject().put("id", "local-task").put("createdIn", "genesis")
        assertEquals("local-task", CloudTaskIdentity.mutation("local-task", normal).remoteId)
        val longId = prefix + "x".repeat(100)
        val wrongAccount = JSONObject().put("id", longId).put("createdIn", "google-calendar")
            .put("googleAccountId", "another-account")
        assertThrows(IllegalArgumentException::class.java) { CloudTaskIdentity.mutation(longId, wrongAccount) }
        assertThrows(IllegalArgumentException::class.java) { CloudTaskIdentity.requireImportedId("../another-route") }
        assertThrows(IllegalArgumentException::class.java) { CloudTaskIdentity.requireImportedId("x".repeat(257)) }
    }
}
