package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import ru.genesis.calendar.ui.LanguageChips
import ru.genesis.calendar.ui.balancedLanguageColumns
import ru.genesis.calendar.ui.evening

class LanguageGridTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun flagsFormCompleteEqualRowsAndRemainSelectable() {
        var language by mutableStateOf("ru")
        compose.setContent {
            MaterialTheme(colorScheme = evening) {
                Box(Modifier.fillMaxWidth().padding(20.dp)) {
                    LanguageChips(language, dark = true, flagsOnly = true) { language = it }
                }
            }
        }
        val codes = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        compose.waitForIdle()
        val bounds = codes.map { compose.onNodeWithTag("language-$it").fetchSemanticsNode().boundsInRoot }
        val rows = bounds.groupBy { it.top.toInt() }.values
        assertEquals(1, rows.map { it.size }.distinct().size)
        assertTrue(bounds.maxOf { it.width } - bounds.minOf { it.width } < 2f)
        assertTrue(bounds.maxOf { it.height } - bounds.minOf { it.height } < 2f)
        compose.onNodeWithTag("language-ja").performClick().assertIsSelected()
        assertEquals("ja", language)
        compose.onNodeWithTag("language-ja").assertContentDescriptionEquals("日本語")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(
            File(instrumentation.targetContext.getExternalFilesDir(null), "language-grid.png")))
    }

    @Test fun additionalLanguagesKeepCompleteRows() {
        for (count in 1..40) for (available in 1..14) {
            val columns = balancedLanguageColumns(count, available)
            assertTrue(columns in 1..minOf(count, available, 7))
            assertEquals(0, count % columns)
        }
        assertEquals(7, balancedLanguageColumns(14, 7))
        assertEquals(4, balancedLanguageColumns(16, 7))
        assertEquals(6, balancedLanguageColumns(18, 7))
    }
}
