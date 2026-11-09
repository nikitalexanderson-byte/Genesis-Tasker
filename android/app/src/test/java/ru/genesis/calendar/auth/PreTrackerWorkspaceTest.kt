package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.security.WorkspaceCipher

class PreTrackerWorkspaceTest {
    private fun legacy() = JSONObject().put("projects", JSONArray().put(JSONObject()
        .put("id", "project-original").put("title", "Старый проект").put("categoryId", "work")))
        .put("categories", JSONArray().put(JSONObject().put("id", "work").put("name", "Работа").put("color", "#448844")))
        .put("customPreservedSection", JSONObject().put("value", "keep"))

    @Test fun absentTrackerSchemaUpgradesWithoutDiscardingProjectsOrUnknownSections() {
        val original = legacy()
        val normalized = CloudWorkspaceMigration.normalize(original)
        assertEquals(16, normalized.getInt("trackerSchemaVersion"))
        assertFalse(original.has("trackerSchemaVersion"))
        assertEquals("Старый проект", normalized.getJSONArray("projects").getJSONObject(0).getString("title"))
        assertEquals("#448844", normalized.getJSONArray("categories").getJSONObject(0).getString("color"))
        assertEquals("keep", normalized.getJSONObject("customPreservedSection").getString("value"))
        assertEquals(0, normalized.getJSONArray("habits").length())
        assertEquals(normalized.toString(), CloudWorkspaceMigration.normalize(normalized).toString())
    }

    @Test fun encryptedPreTrackerAccountsPassBothPreviewAndImportForAnyIdentity() {
        val key = ByteArray(32) { it.toByte() }
        val encrypted = WorkspaceCipher.encrypt(legacy().toString().toByteArray(), key)
        for (uid in listOf("arbitrary-account-1", "arbitrary-account-2", "arbitrary-account-3")) {
            val payload = JSONObject().put("user", JSONObject().put("uid", uid).put("email", "fixture@example.invalid"))
                .put("tasks", JSONArray()).put("tasksDeferred", true)
                .put("workspace", JSONObject().put("keyMode", "account")
                    .put("key", java.util.Base64.getEncoder().encodeToString(key))
                    .put("envelope", JSONObject().put("ciphertext", encrypted.ciphertext).put("iv", encrypted.iv).put("version", 1)))
            assertEquals(1, CloudWorkspacePreview.inspect(payload).projects)
            val snapshot = CloudAccountSnapshot.fromBootstrap(payload)
            assertEquals(CloudAccountSnapshot.scopeFor(uid), snapshot.scope)
            assertEquals("project-original", snapshot.document!!.getJSONArray("projects").getJSONObject(0).getString("id"))
        }
    }

    @Test fun emptyLegacyWorkspaceIsValidButUnknownAndFutureDocumentsAreRejected() {
        assertEquals(0, CloudWorkspaceMigration.normalize(JSONObject().put("projects", JSONArray())
            .put("categories", JSONArray())).getJSONArray("habits").length())
        listOf(JSONObject(), legacy().put("trackerSchemaVersion", 17), legacy().put("trackerSchemaVersion", "bad"))
            .forEach { document -> assertThrows(IllegalArgumentException::class.java) { CloudWorkspaceMigration.normalize(document) } }
    }
}
