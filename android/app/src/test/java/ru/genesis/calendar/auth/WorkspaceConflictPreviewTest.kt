package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspaceConflictPreviewTest {
    private fun document() = WorkspacePatch.emptyDocument().put("projects", JSONArray().put(
        JSONObject().put("id", "p1").put("title", "Original").put("description", "Original text")))
    private fun inspect(base: JSONObject, local: JSONObject, remote: JSONObject): List<WorkspaceConflictField> {
        val conflicts = mutableListOf<WorkspaceConflictField>()
        WorkspacePatch.apply(base, local, remote, setOf("workspace-structure", "habits"), 2,
            "2026-10-22T12:00:00Z", "synthetic-device", conflicts = conflicts)
        return conflicts
    }
    @Test fun inspectionCollectsAllFieldsAndFreezesValuesWithoutMutatingInputs() {
        val base = document()
        val local = JSONObject(base.toString()).apply {
            getJSONArray("projects").getJSONObject(0).put("title", "Phone <script>").put("description", "Phone text")
            getJSONObject("habitSettings").put("reportRange", "year")
        }
        val remote = JSONObject(base.toString()).apply {
            getJSONArray("projects").getJSONObject(0).put("title", "Website").put("description", "Website text")
            getJSONObject("habitSettings").put("reportRange", "week")
        }
        val before = listOf(base, local, remote).map { it.toString() }
        val fields = inspect(base, local, remote)
        assertEquals(setOf("projects/p1/title", "projects/p1/description", "habitSettings/reportRange"), fields.map { it.path }.toSet())
        assertEquals(before, listOf(base, local, remote).map { it.toString() })
        val title = fields.first { it.path == "projects/p1/title" }
        assertEquals("\"Original\"", title.baseJson)
        assertEquals("\"Phone <script>\"", title.localJson)
        local.getJSONArray("projects").getJSONObject(0).put("title", "Later edit")
        assertEquals("\"Phone <script>\"", title.localJson)
    }
    @Test fun equivalentJsonNumbersDoNotCreateConflictsButDistinctNumbersDo() {
        val base = document().put("habitSettings", JSONObject().put("goal", 10))
        val local = JSONObject(base.toString()).put("habitSettings", JSONObject().put("goal", 10.0))
        val remote = JSONObject(base.toString()).put("habitSettings", JSONObject().put("goal", 11))
        assertTrue(inspect(base, local, remote).isEmpty())
        local.getJSONObject("habitSettings").put("goal", 12.5)
        val field = inspect(base, local, remote).single()
        assertEquals("10", field.baseJson); assertEquals("12.5", field.localJson); assertEquals("11", field.remoteJson)
    }
    @Test fun fingerprintsIgnoreObjectAndConflictOrderAndDetectChangedVersions() {
        val a = WorkspaceConflictField("projects/a/title", "Own", "null", workspaceConflictJson(JSONObject("{\"b\":10.0,\"a\":1}")), "\"Web\"")
        val b = WorkspaceConflictField("projects/b/title", null, "null", "\"Phone\"", "\"Web\"")
        val same = a.copy(localJson = workspaceConflictJson(JSONObject("{\"a\":1.0,\"b\":10}")))
        val original = WorkspaceConflictPreview.create(listOf(a, b))
        assertEquals(original.fingerprint, WorkspaceConflictPreview.create(listOf(b, same)).fingerprint)
        assertNotEquals(original.fingerprint, WorkspaceConflictPreview.create(listOf(a.copy(remoteJson = "\"New web value\""), b)).fingerprint)
        assertNotEquals(original.fingerprint, WorkspaceConflictPreview.create(listOf(a)).fingerprint)
        assertEquals(64, original.fingerprint.length)
    }
}
