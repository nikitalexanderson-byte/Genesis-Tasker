package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test

class DictationTextTest {
    @Test fun phrasesFormOneParagraphAndKeepTheRecognizersPunctuationAndWords() {
        assertEquals("Я видел море. Оно было тёплым.", appendDictationText("Я видел море.", "Оно было тёплым."))
        assertEquals("Я видел море и высокий берег", appendDictationText("Я видел море", "и высокий берег"))
        assertEquals("Подожди, я вернусь.", appendDictationText("Подожди ", ", я вернусь."))
        assertEquals("«Тихое море»", appendDictationText("«", "Тихое море»"))
        assertEquals("梦见大海。海面很平静。", appendDictationText("梦见大海。", "海面很平静。"))
        assertEquals("夢で海を見た", appendDictationText("夢で", "海を見た"))
        assertEquals("Старый абзац.\n\nНовый абзац.", appendDictationText("Старый абзац.\n\n", "Новый абзац."))
        assertEquals("Имя Nike", appendDictationText("Имя", "Nike"))
        assertEquals("Вручную  ", appendDictationText("Вручную  ", "  "))
    }

    @Test fun asynchronousCorrectionsShiftLaterTicketsWithoutLosingTheNewerText() {
        val patches = DictationPatches()
        var body = "Мой сон: малако"
        val first = requireNotNull(patches.track(body, "малако"))
        body = appendDictationText(body, "и карова.")
        val second = requireNotNull(patches.track(body, "и карова."))
        body = requireNotNull(patches.apply(body, first, "молоко"))
        body = requireNotNull(patches.apply(body, second, "и корова."))
        assertEquals("Мой сон: молоко и корова.", body)

        body = "Привет малако"
        val shorter = requireNotNull(patches.track(body, "малако"))
        body = appendDictationText(body, "карова")
        val later = requireNotNull(patches.track(body, "карова"))
        body = requireNotNull(patches.apply(body, shorter, "чай"))
        assertEquals("Привет чай корова", patches.apply(body, later, "корова"))

        body = "малоко"
        val older = requireNotNull(patches.track(body, "малоко"))
        body = appendDictationText(body, "карова")
        val newer = requireNotNull(patches.track(body, "карова"))
        body = requireNotNull(patches.apply(body, newer, "корова"))
        assertEquals("молоко корова", patches.apply(body, older, "молоко"))
    }

    @Test fun editedClosedOrOversizedDraftsNeverReceiveAStalePatch() {
        val patches = DictationPatches()
        val changed = requireNotNull(patches.track("Сон малако", "малако"))
        assertNull(patches.apply("Сон редактор", changed, "молоко"))
        val closed = requireNotNull(patches.track("Сон малако", "малако"))
        patches.clear()
        assertNull(patches.apply("Сон малако", closed, "молоко"))
        val full = "я".repeat(29_999) + "а"
        val limit = requireNotNull(patches.track(full, "а"))
        assertNull(patches.apply(full, limit, "автор"))
        assertFalse(patches.contains(limit))
    }
}
