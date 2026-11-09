package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedTaskEstimateDraftTest {
    private fun task(points: Any = JSONObject.NULL, hours: Any = JSONObject.NULL, id: String = "task-a") =
        JSONObject().put("id", id).put("projectId", "project-a").put("revision", 0)
            .put("storyPoints", points).put("estimateHours", hours).put("title", "PRIVATE_TASK")

    @Test fun independentValuesPreserveZeroNullAndOmittedFields() {
        val source = task(0, 2.5)
        val initial = SharedTaskEstimateDraft.fromTask(source)
        assertEquals("0", initial.storyPoints)
        assertEquals("2.5", initial.estimateHours)
        assertEquals(0, initial.patch().length())
        assertTrue(initial.points("").patch().isNull("storyPoints"))
        assertFalse(initial.points("").patch().has("estimateHours"))
        assertEquals(0.0, initial.hours("0").patch().getDouble("estimateHours"), 0.0)
        assertEquals(0, initial.points("0.00").patch().length())
        assertEquals(2.5, source.getDouble("estimateHours"), 0.0)
    }

    @Test fun explicitRebaseKeepsTouchedInputAndAdoptsAnUntouchedSibling() {
        val initial = SharedTaskEstimateDraft.fromTask(task(3, 2)).points("5")
        val next = initial.rebase(task(4, 8))
        assertEquals("5", next.storyPoints)
        assertEquals("8", next.estimateHours)
        assertEquals(5.0, next.patch().getDouble("storyPoints"), 0.0)
        assertFalse(next.patch().has("estimateHours"))
        assertEquals("2", initial.estimateHours)
        assertThrows(IllegalArgumentException::class.java) { initial.rebase(task(id = "other")) }
    }

    @Test fun invalidOrUnfinishedInputIsKeptWithoutBecomingZero() {
        for (raw in listOf("-", ".", "1e", "  ", "0x10", "Infinity", "-1", "1.111", "1000001", "1e99999")) {
            val initial = SharedTaskEstimateDraft.fromTask(task()).points(raw)
            val restored = SharedTaskEstimateDraft.restore(JSONObject(initial.saved().toString()))
            assertEquals(raw, restored.storyPoints)
            assertFalse(restored.valid)
            assertTrue(restored.dirty)
            assertThrows(IllegalArgumentException::class.java) { restored.patch() }
        }
        assertNull(parseSharedEstimate(""))
        assertEquals(0.0, parseSharedEstimate("0")!!, 0.0)
        assertEquals(1.25, parseSharedEstimate("1,25")!!, 0.0)
        assertEquals(100.0, parseSharedEstimate("1e2")!!, 0.0)
        assertEquals(1000000.0, parseSharedEstimate("1000000.00")!!, 0.0)
    }

    @Test fun restoredIntentDoesNotCacheNamesOrShareMutableJson() {
        val initial = SharedTaskEstimateDraft.fromTask(task(0)).hours("2,5")
        val saved = initial.saved()
        assertFalse(saved.toString().contains("PRIVATE"))
        assertEquals(initial, SharedTaskEstimateDraft.restore(JSONObject(saved.toString())))
        val details = JSONObject().put("priority", 3)
        val changed = sharedTaskWithEstimates(details, initial)
        assertFalse(details.has(SHARED_ESTIMATE_DRAFT_KEY))
        assertEquals(initial, sharedTaskEstimates(task(), changed))
        saved.put("title", "PRIVATE")
        assertThrows(IllegalArgumentException::class.java) { SharedTaskEstimateDraft.restore(saved) }
        assertThrows(IllegalArgumentException::class.java) { sharedTaskEstimates(task(id = "other"), changed) }
    }

    @Test fun authoritativePermissionsOverrideLegacyRolesWithoutCreatingRights() {
        assertTrue(sharedTaskCanEdit(JSONObject().put("role", "member")))
        assertFalse(sharedTaskCanEdit(JSONObject().put("role", "viewer")))
        assertFalse(sharedTaskCanEdit(JSONObject().put("role", "owner").put("permissions", JSONObject().put("editTasks", false))))
        assertTrue(sharedTaskCanEdit(JSONObject().put("role", "viewer").put("permissions", JSONObject().put("editTasks", true))))
        assertFalse(sharedTaskCanEdit(JSONObject().put("role", "member").put("permissions", JSONObject())))
        assertFalse(sharedTaskCanEdit(JSONObject().put("role", "owner").put("permissions", JSONArray())))
        assertFalse(sharedTaskCanEdit(null))
    }

    @Test fun uncertainQueueEntriesStillPreventASecondCommandForThatTask() {
        val pending = JSONObject().put("taskId", "task-a").put("requestId", "stable").put("error", "FORBIDDEN")
        assertTrue(sharedTaskHasPending("task-a", listOf(pending)))
        assertFalse(sharedTaskHasPending("task-b", listOf(pending)))
        assertEquals("stable", pending.getString("requestId"))
    }

    @Test fun queuedIdentityReplyCannotEraseTheSubmittedTaskOrOtherFields() {
        val source = task(3, 8).put("description", "PRIVATE_DETAIL").put("priority", 2)
        val reply = JSONObject().put("id", "task-a").put("projectId", "project-a").put("revision", 0).put("pending", true)
        val changes = JSONObject().put("storyPoints", 0).put("title", "New title").put("expectedRevision", 0).put("requestId", "stable")
        val next = sharedPendingTask(source, reply, changes)
        assertEquals("New title", next.getString("title"))
        assertEquals("PRIVATE_DETAIL", next.getString("description"))
        assertEquals(0.0, next.getDouble("storyPoints"), 0.0)
        assertEquals(8.0, next.getDouble("estimateHours"), 0.0)
        assertFalse(next.has("requestId"))
        assertEquals("PRIVATE_TASK", source.getString("title"))
        reply.put("projectId", "other")
        assertThrows(IllegalArgumentException::class.java) { sharedPendingTask(source, reply, changes) }
    }

    @Test fun taskPatchNeverIncludesEditorMetadataOrAnUntouchedEstimate() {
        val source = task(3, 2).put("priority", 2)
        val initial = sharedTaskDetailDraft(source)
        val changed = sharedTaskWithEstimates(initial, sharedTaskEstimates(source, initial).points("0"))
        val patch = sharedTaskDetailChanges(source, changed, true)
        assertEquals(0.0, patch.getDouble("storyPoints"), 0.0)
        assertFalse(patch.has("estimateHours"))
        assertFalse(patch.has(SHARED_ESTIMATE_DRAFT_KEY))
        assertEquals(2, patch.getInt("priority"))
        assertFalse(sharedTaskDetailChanges(source, changed, false).has("storyPoints"))
        assertTrue(sharedTaskDetailsChanged(source, changed))
        assertFalse(sharedTaskDetailsChanged(source, initial))
        val noop = sharedTaskWithEstimates(initial, sharedTaskEstimates(source, initial).points("3.00"))
        assertFalse(sharedTaskDetailsChanged(source, noop))
    }

    @Test fun refreshingTheCardReloadsCoreFieldsButKeepsTouchedEstimateIntent() {
        val source = task(3, 2).put("priority", 1)
        val initial = sharedTaskDetailDraft(source)
        val changed = sharedTaskWithEstimates(initial, sharedTaskEstimates(source, initial).points("5"))
        val fresh = task(4, 8).put("priority", 3)
        val next = rebaseSharedTaskDetailDraft(fresh, changed)
        assertEquals(3, next.getInt("priority"))
        assertEquals("5", sharedTaskEstimates(fresh, next).storyPoints)
        assertEquals("8", sharedTaskEstimates(fresh, next).estimateHours)
        assertFalse(sharedTaskDetailChanges(fresh, next, true).has("estimateHours"))
        assertEquals(1, initial.getInt("priority"))
    }
}
