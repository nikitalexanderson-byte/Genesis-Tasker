package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Source prepared for the next authorized native test run; no persistence schema is added. */
class DiaryCategoriesTest {
    private fun advice() = JSONObject().put("id", "advice-source")
        .put("body", "Original advice").put("language", "en")
        .put("categories", JSONArray()).put("sources", JSONArray())

    @Test fun personalTextAndFlagsNeverCreateAdviceProvenance() {
        val note = DiaryNote.create("A saved aphorism in my own words", "Advice")
        val original = note.json().toString()
        assertEquals("personal", note.category)
        assertEquals("personal", note.changed { put("archived", true); put("pinned", true) }.category)
        assertEquals("personal", note.changed { put("reaction", "favorite") }.category)
        assertEquals(original, note.json().toString())
        assertFalse(note.json().has("category"))
    }

    @Test fun editingAndArchivingAdviceKeepsSavedButConflictCopyBecomesPersonal() {
        val note = DiaryNote.reaction(advice(), "saved-note", "favorite")
        val original = note.json().toString()
        assertEquals("saved", note.category)
        val edited = note.changed { put("body", "My edited note"); put("pinned", true); put("archived", true) }
        assertEquals("saved", edited.category)
        assertEquals("advice-source", edited.adviceId)
        assertEquals("saved", edited.restored().category)
        val copy = edited.asCopy("conflict-copy")
        assertEquals("personal", copy.category)
        assertNull(copy.adviceId)
        assertEquals("My edited note", copy.body)
        assertEquals(original, note.json().toString())
    }

    @Test fun dreamEntriesStayOutsideBothOrdinaryDiaryCategories() {
        val note = DiaryNote.parse(DiaryNote.newDraftJson().put("body", "A dream")
            .put("dream", JSONObject().put("day", "2026-11-07").put("timeZone", "UTC")))
        assertNull(note.category)
        assertNull(note.changed { put("pinned", true) }.category)
    }
}
