package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.json.JSONObject

class AdviceTextTest {
    @Test fun userEditsAreNeverNormalizedAsOriginalAdvice() {
        val snapshot = JSONObject().put("body", "Первая строка.\n\nВторая строка.")
        assertSame(snapshot, originalAdvicePreview(snapshot.getString("body"), snapshot))
        assertNull(originalAdvicePreview(snapshot.getString("body") + "\n\nМоя заметка.", snapshot))
        assertNull(originalAdvicePreview("Моя заметка.\n\nВторая строка.", null))
        assertEquals("Первая строка.\n\nВторая строка.", snapshot.getString("body"))
    }
    @Test fun importedBlankRowsAreRemovedWithoutJoiningMeaningfulLines() {
        assertEquals("Против врага: спешка и страх.\nКак союзник: просчитанная решимость.",
            compactAdviceBody("\nПротив врага: спешка и страх.\n\n \t\n\nКак союзник: просчитанная решимость.\n"))
        assertEquals("Первая строка.\nВторая строка.\nТретья строка.",
            compactAdviceBody("Первая строка.\r\n\r\nВторая строка.\rТретья строка."))
        assertEquals("Краткая мысль.", compactAdviceBody("Краткая мысль."))
    }
}
