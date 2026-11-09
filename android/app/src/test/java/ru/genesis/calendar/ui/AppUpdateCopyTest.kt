package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test

class AppUpdateCopyTest {
    @Test fun updatePromptsUseUpdateAndLaterWithoutAmbiguousGenericTranslations() {
        assertEquals("Update",appUpdateCopy("en").action)
        assertEquals("Later",appUpdateCopy("en").later)
        for(language in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")) {
            val copy=appUpdateCopy(language)
            assertTrue(copy.title.isNotBlank());assertTrue(copy.action.isNotBlank());assertTrue(copy.later.isNotBlank())
        }
        assertEquals(appUpdateCopy("ru"),appUpdateCopy("unknown"))
    }
    @Test fun templateValuesStayLiteralAndAreNeverInterpretedAsAnotherPlaceholder() {
        assertEquals("Duration: 7 hr 30 min",formatGenesisTemplate("Duration: {hours} hr {minutes} min","hours" to 7,"minutes" to 30))
        assertEquals("{minutes} remains literal",formatGenesisTemplate("{note} remains literal","note" to "{minutes}","minutes" to 30))
    }
}
