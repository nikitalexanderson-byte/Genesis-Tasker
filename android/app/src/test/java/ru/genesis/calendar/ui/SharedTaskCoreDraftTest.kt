package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedTaskCoreDraftTest {
    private fun task() = JSONObject().put("id", "task").put("priority", 2).put("title", "Initial")
        .put("description", "Description").put("dueDate", JSONObject.NULL).put("categoryId", JSONObject.NULL)
        .put("parentTaskId", JSONObject.NULL).put("checklists", JSONArray("""[{"id":"list","title":"List","items":[{"id":"item","title":"Before","done":false}]}]"""))
    private fun fields() = sharedTaskEditorFields("Initial", "Description", "", "")

    @Test fun refreshKeepsZeroChecklistParentAndTitleWhileAcceptingAnUnchangedField() {
        val original = task(); val draft = sharedTaskDetailDraft(original)
        draft.put("priority", 0).put("parentTaskId", "parent")
        draft.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).put("title", "Typed")
        val remote = JSONObject(original.toString()).put("description", "Other window")
        val result = rebaseSharedTaskEditor(remote, draft, fields().put("title", "My title"))
        assertEquals(0, result.details.getInt("priority")); assertEquals("parent", result.details.getString("parentTaskId"))
        assertEquals("Typed", result.details.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("title"))
        assertEquals("My title", result.fields.getString("title"))
        assertEquals("Other window", result.fields.getString("description")); assertTrue(sharedTaskCoreResolved(result.details))
        val wire = sharedTaskDetailChanges(remote, result.details, false)
        assertFalse(wire.has(SHARED_TASK_CORE_BASE)); assertFalse(wire.has(SHARED_TASK_CORE_CONFLICTS))
    }

    @Test fun conflictingFieldsRequireAChoiceAndWebsiteChoiceKeepsIndependentLocalEdits() {
        val original = task(); val draft = sharedTaskDetailDraft(original).put("priority", 0)
        val remote = JSONObject(original.toString()).put("priority", 3).put("title", "Website")
        val result = rebaseSharedTaskEditor(remote, draft, fields().put("title", "Mine").put("description", "My description"))
        assertFalse(sharedTaskCoreResolved(result.details))
        assertEquals(2, result.details.getJSONArray(SHARED_TASK_CORE_CONFLICTS).length())
        val refreshedAgain = rebaseSharedTaskEditor(remote, result.details, result.fields)
        assertFalse(sharedTaskCoreResolved(refreshedAgain.details))
        val resolved = resolveSharedTaskEditor(refreshedAgain.details, refreshedAgain.fields, false, remote)
        assertEquals(3, resolved.details.getInt("priority")); assertEquals("Website", resolved.fields.getString("title"))
        assertEquals("My description", resolved.fields.getString("description")); assertTrue(sharedTaskCoreResolved(resolved.details))
        val local = resolveSharedTaskEditor(result.details, result.fields, true, remote)
        assertEquals(0, local.details.getInt("priority")); assertEquals("Mine", local.fields.getString("title"))
        assertTrue(sharedTaskCoreResolved(local.details))
    }

    @Test fun aLegacyDraftWithoutBaselineIsPreservedUntilExplicitResolution() {
        val original = task(); val draft = sharedTaskDetailDraft(original).put("priority", 0)
        draft.remove(SHARED_TASK_CORE_BASE)
        val result = rebaseSharedTaskEditor(original, draft, fields())
        assertEquals(0, result.details.getInt("priority")); assertFalse(sharedTaskCoreResolved(result.details))
    }

    @Test fun fullSizeChecklistsAreNotDuplicatedInSavedActivityStateAndStaleChoicesAreBlocked() {
        val original = task()
        val items = original.getJSONArray("checklists").getJSONObject(0).getJSONArray("items")
        for (index in 1..299) items.put(JSONObject().put("id", "item-" + index).put("title", "Ж".repeat(500)).put("done", false))
        val draft = sharedTaskDetailDraft(original).put("priority", 0)
        val remote = JSONObject(original.toString()).put("priority", 3)
        val result = rebaseSharedTaskEditor(remote, draft, fields())
        assertTrue(result.details.toString().length < original.toString().length + 2500)
        assertEquals(64, result.details.getJSONObject(SHARED_TASK_CORE_BASE).getString("checklists").length)
        assertTrue(runCatching { resolveSharedTaskEditor(result.details, result.fields, false,
            JSONObject(remote.toString()).put("title", "Another revision")) }.isFailure)
    }
}
