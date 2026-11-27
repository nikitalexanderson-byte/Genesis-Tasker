package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
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
import ru.genesis.calendar.data.publicLanguages
import ru.genesis.calendar.ui.LanguageChips
import ru.genesis.calendar.ui.translateGenesisText
import ru.genesis.calendar.ui.balancedLanguageColumns
import ru.genesis.calendar.ui.evening

class LanguageGridTest {
    @Test fun savedQueuedAndConfirmedHaveDistinctLocalizedLabels() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val expected = mapOf(
            "he" to listOf("נשמר במכשיר הזה", "נשמר במכשיר · בהמתנה לסנכרון", "הסנכרון הושלם."),
            "ar" to listOf("تم الحفظ على هذا الجهاز", "تم الحفظ على الجهاز · بانتظار المزامنة", "اكتملت المزامنة."),
            "ko" to listOf("이 기기에 저장됨", "기기에 저장됨 · 동기화 대기 중", "동기화가 완료되었습니다."),
            "nl" to listOf("Opgeslagen op dit apparaat", "Opgeslagen op het apparaat · wacht op synchronisatie", "Gesynchroniseerd."),
        )
        val source = listOf("Сохранено на этом устройстве", "Сохранено на устройстве · ожидает синхронизации", "Синхронизировано.")
        expected.forEach { (language, labels) ->
            assertEquals(language, labels, source.map { translateGenesisText(app, it, language) })
        }
    }

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
        val codes = publicLanguages
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

    @Test fun flagsAndNativeNamesRemainSelectableAtLargeFontScale() {
        val choices = mapOf("he" to "עברית", "ar" to "العربية", "ko" to "한국어", "nl" to "Nederlands")
        var language by mutableStateOf("en")
        compose.setContent {
            val density = LocalDensity.current.density
            val direction = if (language in setOf("he", "ar")) LayoutDirection.Rtl else LayoutDirection.Ltr
            CompositionLocalProvider(LocalDensity provides Density(density, 1.3f), LocalLayoutDirection provides direction) {
                MaterialTheme {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                        LanguageChips(language, flagsOnly = false) { language = it }
                    }
                }
            }
        }
        for ((code, name) in choices) {
            val chip = compose.onNodeWithTag("language-$code")
            chip.performScrollTo().assertContentDescriptionEquals(name).performClick().assertIsSelected()
            compose.onNodeWithText(name, useUnmergedTree = true).assertExists()
            val expected = if (code == "he" || code == "ar") LayoutDirection.Rtl else LayoutDirection.Ltr
            assertEquals(expected, chip.fetchSemanticsNode().layoutInfo.layoutDirection)
        }
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
