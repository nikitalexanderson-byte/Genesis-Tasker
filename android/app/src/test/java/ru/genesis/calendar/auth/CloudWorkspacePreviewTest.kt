package ru.genesis.calendar.auth

import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.security.WorkspaceCipher

class CloudWorkspacePreviewTest {
    private val key = ByteArray(32) { it.toByte() }

    private fun response(mode: String, keyValue: String?, document: String?): JSONObject {
        val workspace = JSONObject().put("keyMode", mode).put("key", keyValue ?: JSONObject.NULL)
        workspace.put("envelope", if (document == null) JSONObject.NULL else {
            val encrypted = WorkspaceCipher.encrypt(document.toByteArray(), key)
            JSONObject().put("ciphertext", encrypted.ciphertext).put("iv", encrypted.iv)
                .put("version", 7).put("updatedAt", "2026-09-25T00:00:00Z")
        })
        return JSONObject().put("workspace", workspace)
    }

    @Test fun readsAuthenticatedWebDocumentWithoutChangingIt() {
        val document = """{"trackerSchemaVersion":16,"projects":[{"id":"p"}],"categories":[],"habits":[{}],"habitCompletions":[{},{}],"sleepEntries":[],"moodEntries":[{}],"rewardTransactions":[{}],"quests":[],"unknownWebField":{"mustRemain":true}}"""
        val summary = CloudWorkspacePreview.inspect(response("account", Base64.getEncoder().encodeToString(key), document))
        assertEquals(7, summary.version)
        assertEquals(1, summary.projects)
        assertEquals(2, summary.completions)
        assertEquals(1, summary.moodEntries)
        assertFalse(summary.isEmpty)
        assertNull(summary.tasks)
    }

    @Test fun refusesWrongKeyTamperingAndRecoveryMode() {
        val document = """{"trackerSchemaVersion":16,"projects":[],"categories":[],"habits":[],"habitCompletions":[],"sleepEntries":[],"moodEntries":[],"rewardTransactions":[],"quests":[]}"""
        val wrongKey = ByteArray(32) { (it + 1).toByte() }
        assertThrows(CloudWorkspacePreview.Unreadable::class.java) {
            CloudWorkspacePreview.inspect(response("account", Base64.getEncoder().encodeToString(wrongKey), document))
        }
        assertThrows(CloudWorkspacePreview.RecoveryRequired::class.java) {
            CloudWorkspacePreview.inspect(response("client", null, document))
        }
        val tampered = response("account", Base64.getEncoder().encodeToString(key), document)
        tampered.getJSONObject("workspace").getJSONObject("envelope").put("version", 0)
        assertThrows(CloudWorkspacePreview.Unreadable::class.java) { CloudWorkspacePreview.inspect(tampered) }
    }

    @Test fun emptyRemoteIsOnlyAReadOnlySummary() {
        val payload = response("new", null, null)
            .put("tasks", org.json.JSONArray().put(JSONObject().put("id", "web-task")))
            .put("taskLists", org.json.JSONArray())
            .put("syncWarning", "temporary fixture warning")
        val summary = CloudWorkspacePreview.inspect(payload)
        assertTrue(summary.isEmpty)
        assertEquals(0, summary.version)
        assertEquals(1, summary.tasks)
        assertEquals(0, summary.taskLists)
        assertTrue(summary.hasGoogleSyncWarning)
    }
}
