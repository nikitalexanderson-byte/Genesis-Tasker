package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedMutationReceiptTest {
    @Test fun typedCustomFieldRejectionsKeepTheOriginalTaskOutboxRules() {
        for (code in listOf("CUSTOM_FIELD_REQUIRED", "CUSTOM_FIELD_OPTION_UNAVAILABLE", "CUSTOM_FIELD_VALUE_INVALID")) {
            val failure = requireNotNull(customFieldFailure(409, JSONObject().put("error", code)))
            assertTrue(definiteSharedRejection(failure)); assertEquals(code, sharedFailureCode(failure))
        }
        assertNull(customFieldFailure(200, JSONObject().put("error", "CUSTOM_FIELD_REQUIRED")))
        assertNull(customFieldFailure(403, JSONObject().put("error", "CUSTOM_FIELD_REQUIRED")))
        assertNull(customFieldFailure(409, JSONObject().put("error", "UNTRUSTED_CODE")))
    }
    @Test fun malformedCustomSuccessIsAnUnknownResultAndCannotReleaseTheTaskCommand() {
        val body = JSONObject().put("requestId", "frozen").put("expectedRevision", 0)
            .put("customFields", JSONObject().put("effort", 0).put("approved", false).put("note", JSONObject.NULL))
        val good = reply().apply { getJSONObject("task").put("customFields", JSONObject().put("effort", 0).put("approved", false)) }
        confirmedSharedReceipt("update", "project-a", "task-a", body, good)
        for (bad in listOf(reply(), reply().apply { getJSONObject("task").put("customFields", JSONObject().put("effort", "0").put("approved", false)) },
            reply().apply { getJSONObject("task").put("customFields", JSONObject().put("effort", 0).put("approved", false).put("note", "Old note")) })) {
            val failure = assertThrows(AuthFailure::class.java) { confirmedSharedReceipt("update", "project-a", "task-a", body, bad) }
            assertEquals(AuthFailure.Kind.PROTOCOL, failure.kind); assertFalse(definiteSharedRejection(failure))
        }
        assertEquals("frozen", body.getString("requestId")); assertEquals(false, body.getJSONObject("customFields").get("approved"))
    }
    @Test fun anEmptyLegacyCustomMapHasNoNewValueToAcknowledge() {
        for (empty in listOf(JSONObject(), org.json.JSONArray())) {
            val response = reply(); confirmedSharedReceipt("update", "project-a", "task-a", JSONObject().put("customFields", empty), response)
        }
    }
    private fun reply(id: String = "task-a", project: String = "project-a", revision: Any = 1) =
        JSONObject().put("task", JSONObject().put("id", id).put("projectId", project).put("revision", revision))

    @Test fun aDefiniteFirstFourHundredRejectionDiffersFromAnUnknownServerResult() {
        assertTrue(definiteSharedRejection(AuthFailure(AuthFailure.Kind.SERVER, 400)))
        assertTrue(definiteSharedRejection(AuthFailure(AuthFailure.Kind.UNAUTHORIZED, 403)))
        assertTrue(definiteSharedRejection(AuthFailure(AuthFailure.Kind.SERVER, 422)))
        assertFalse(definiteSharedRejection(AuthFailure(AuthFailure.Kind.SERVER, 500)))
        assertFalse(definiteSharedRejection(AuthFailure(AuthFailure.Kind.NETWORK)))
        assertFalse(definiteSharedRejection(AuthFailure(AuthFailure.Kind.PROTOCOL)))
        assertFalse(definiteSharedRejection(AuthFailure(AuthFailure.Kind.STORAGE)))
    }

    @Test fun updateIdentityAndRevisionMustMatchBeforeReleasingTheCommand() {
        val body = JSONObject().put("expectedRevision", 0).put("requestId", "stable").put("storyPoints", 0)
        val response = reply()
        assertSame(response, confirmedSharedReceipt("update", "project-a", "task-a", body, response))
        for (bad in listOf(reply(id = "other"), reply(project = "other"), reply(revision = -1), reply(revision = 0.5), JSONObject())) {
            assertEquals(AuthFailure.Kind.PROTOCOL, assertThrows(AuthFailure::class.java) {
                confirmedSharedReceipt("update", "project-a", "task-a", body, bad)
            }.kind)
        }
        assertEquals("stable", body.getString("requestId"))
        assertEquals(0, body.getInt("storyPoints"))
    }

    @Test fun aMoveCanAcknowledgeItsRequestedDestinationButNotAnotherProject() {
        val body = JSONObject().put("expectedRevision", 0).put("destinationProjectId", "project-b")
        val response = reply(project = "project-b")
        assertSame(response, confirmedSharedReceipt("move", "project-a", "task-a", body, response))
        assertThrows(AuthFailure::class.java) { confirmedSharedReceipt("move", "project-a", "task-a", body, reply()) }
        val within = JSONObject().put("expectedRevision", 0).put("statusId", "done")
        confirmedSharedReceipt("move", "project-a", "task-a", within, reply())
    }

    @Test fun queuedPlaceholdersCannotMasqueradeAsConfirmedServerTasks() {
        val pending = reply().apply { getJSONObject("task").put("pending", true) }
        assertThrows(AuthFailure::class.java) { confirmedSharedReceipt("create", "project-a", null, JSONObject(), pending) }
        assertThrows(AuthFailure::class.java) { confirmedSharedReceipt("create", "project-a", null, JSONObject(), reply(id = "pending:stable")) }
        val created = reply(id = "new-server-id", revision = 0)
        assertSame(created, confirmedSharedReceipt("create", "project-a", null, JSONObject(), created))
    }
}
