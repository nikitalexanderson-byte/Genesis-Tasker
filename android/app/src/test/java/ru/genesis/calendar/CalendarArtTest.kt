package ru.genesis.calendar

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.genesis.calendar.domain.SacredCatalog
import ru.genesis.calendar.ui.sacredMonthArtPath

class CalendarArtTest {
    @Test fun everySacredMonthAndApeironKeepTheirOriginalIllustration() {
        assertEquals(13, SacredCatalog.months.size)
        SacredCatalog.months.forEachIndexed { index, month ->
            assertEquals(index, month.index)
            assertTrue(month.name.isNotBlank())
            assertTrue(File("../../public/${sacredMonthArtPath(index)}").isFile)
        }
        assertEquals("month-art-v4/month-13.webp", sacredMonthArtPath(12))
    }

    @Test fun artLookupNeverSilentlyWrapsOutsideSacredMonths() {
        assertThrows(IllegalArgumentException::class.java) { sacredMonthArtPath(-1) }
        assertThrows(IllegalArgumentException::class.java) { sacredMonthArtPath(13) }
    }
}
