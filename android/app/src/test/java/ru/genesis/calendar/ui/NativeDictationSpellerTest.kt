package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeDictationSpellerTest {
    private fun correction(pos: Int, word: String, value: String, code: Int = 1) = JSONObject()
        .put("pos", pos).put("len", word.length).put("word", word).put("s", JSONArray().put(value)).put("code", code)

    @Test fun onlyExactSpellingAndCapitalizationSpansChange() {
        val original = "🙂 малоко и карова."
        val corrections = JSONArray().put(correction(3, "малоко", "молоко"))
            .put(correction(12, "карова", "корова"))
        assertEquals("🙂 молоко и корова.", applyDictationSpelling(original, corrections))
        assertEquals("Nike очень очень", applyDictationSpelling("Nike очень очень",
            JSONArray().put(correction(5, "очень", "", code = 2))))
        assertEquals(original, applyDictationSpelling(original, JSONArray()))
    }

    @Test fun malformedOrOverlappingResponsesCannotRewriteAnotherTextRange() {
        assertTrue(runCatching { applyDictationSpelling("малако", JSONArray().put(correction(1, "малако", "молоко"))) }.isFailure)
        assertTrue(runCatching { applyDictationSpelling("малако", JSONArray().put(correction(0, "другой", "молоко"))) }.isFailure)
        assertTrue(runCatching { applyDictationSpelling("малако", JSONArray().put(correction(0, "малако", "молоко"))
            .put(correction(0, "малако", "чай"))) }.isFailure)
        assertEquals("малако", applyDictationSpelling("малако", JSONArray().put(correction(0, "малако", "текст\nвнешний"))))
        assertTrue(runCatching { applyDictationSpelling("малако", JSONArray().put(correction(0, "малако", "молоко", code = 4))) }.isFailure)
        assertTrue(runCatching { applyDictationSpelling("малако", JSONArray().put(correction(0, "мал", "мол"))) }.isFailure)
    }

    @Test fun ambiguousMultiwordAndLargeChangesAreLeftToTheAuthor() {
        val ambiguous = correction(0, "helo", "hello").put("s", JSONArray().put("hello").put("help"))
        assertEquals("helo", applyDictationSpelling("helo", JSONArray().put(ambiguous), "en"))
        assertEquals("abc123", applyDictationSpelling("abc123", JSONArray().put(correction(0, "abc123", "abc124")), "en"))
        assertEquals("насамом", applyDictationSpelling("насамом", JSONArray().put(correction(0, "насамом", "на самом"))))
        assertEquals("сон", applyDictationSpelling("сон", JSONArray().put(correction(0, "сон", "солнцестояние"))))
        assertEquals("helo@example.com", applyDictationSpelling("helo@example.com", JSONArray().put(correction(0, "helo", "hello")), "en"))
        assertEquals("theHelo", applyDictationSpelling("theHelo", JSONArray().put(correction(0, "theHelo", "theHello")), "en"))
    }
}
