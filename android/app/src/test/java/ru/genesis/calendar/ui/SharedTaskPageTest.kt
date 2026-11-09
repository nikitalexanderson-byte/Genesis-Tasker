package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedTaskPageTest {
    @Test fun incompleteAndOversizedChecklistInputCannotBeSubmittedAsAValidTask() {
        fun draft(count:Int,title:String="Пункт")=JSONObject().put("checklists",JSONArray().put(JSONObject().put("id","list").put("title","Чек-лист")
            .put("items",JSONArray((0 until count).map { JSONObject().put("id","item-$it").put("title",title).put("done",false) }))))
        assertTrue(sharedTaskChecklistsValid(draft(300)))
        assertFalse(sharedTaskChecklistsValid(draft(301)))
        assertFalse(sharedTaskChecklistsValid(draft(1,"  ")))
        assertFalse(sharedTaskChecklistsValid(draft(1,"x".repeat(501))))
        val duplicate=draft(2);duplicate.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(1).put("id","item-0")
        assertFalse(sharedTaskChecklistsValid(duplicate))
        val before=duplicate.toString();sharedTaskChecklistsValid(duplicate);assertEquals(before,duplicate.toString())
    }
    private fun page(version: String, ids: List<String>, cursor: String? = null) = JSONObject()
        .put("queryVersion", version).put("total", 130).put("hasMore", cursor != null)
        .put("nextCursor", cursor ?: JSONObject.NULL)
        .put("tasks", JSONArray(ids.map { JSONObject().put("id", it) }))

    @Test fun paginationPreservesLoadedRowsAndRejectsChangedAccessGeneration() {
        val first = page("allowed", listOf("a", "b"), "next")
        val loaded = mergeSharedTaskPage(first, page("allowed", listOf("b", "c")), true)
        assertEquals(listOf("a", "b", "c"), (0 until loaded.getJSONArray("tasks").length()).map {
            loaded.getJSONArray("tasks").getJSONObject(it).getString("id")
        })
        val refreshed = mergeSharedTaskPage(loaded, first, false)
        assertEquals(3, refreshed.getJSONArray("tasks").length())
        assertFalse(refreshed.getBoolean("hasMore"))
        assertThrows(IllegalStateException::class.java) {
            mergeSharedTaskPage(loaded, page("revoked", emptyList()), true)
        }
        assertEquals(0, mergeSharedTaskPage(loaded, page("revoked", emptyList()), false).getJSONArray("tasks").length())
    }

    @Test fun draftKeepsLegacyDefaultsAndDoesNotMutateOriginalChecklist() {
        val legacy = sharedTaskDetailDraft(JSONObject())
        assertEquals(0, legacy.getInt("priority"))
        assertTrue(legacy.isNull("parentTaskId"))
        val task = JSONObject("""{"priority":3,"checklists":[{"id":"list","items":[{"id":"item","done":false}]}]}""")
        val draft = sharedTaskDetailDraft(task)
        draft.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).put("done", true)
        assertFalse(task.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getBoolean("done"))
    }
}
