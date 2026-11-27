package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.WelcomeIpRegion
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.publicLanguages
import ru.genesis.calendar.data.welcomeLanguage

class WelcomeLanguage336Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun allSupportedLanguagesAreAvailableBeforeSignIn() {
        var selected by mutableStateOf<String?>(null)
        val ip = CompletableDeferred<WelcomeIpRegion>()
        compose.setContent {
            val region = rememberWelcomeIpRegion(true) { ip.await() }
            val language = welcomeLanguage(selected, "en", "America/New_York", "US",
                suggestRussianByIp = region == WelcomeIpRegion.RUSSIA)
            CompositionLocalProvider(LocalGenesisLanguage provides language) {
                MaterialTheme {
                    WelcomeContent(AuthPanelState(checkedAt = 1L), language, { selected = it }, {},
                        onRetry = {}, onWeb = {}, onLegal = {})
                }
            }
        }
        assertEquals(18, publicLanguages.size)
        publicLanguages.forEach { compose.onNodeWithTag("language-$it").assertExists() }
        compose.onNodeWithTag("language-en").assertIsSelected()
        compose.onNodeWithTag("language-de").performClick().assertIsSelected()
        compose.runOnIdle { ip.complete(WelcomeIpRegion.RUSSIA) }
        compose.onNodeWithTag("language-de").assertIsSelected()
        for (code in listOf("he", "ar", "ko", "nl")) {
            compose.onNodeWithTag("language-$code").performClick().assertIsSelected()
            assertEquals(code, selected)
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome337-$code.png"))
        }
        compose.onNodeWithTag("language-ru").performClick().assertIsSelected()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome336-russian.png"))
        assertEquals("ru", selected)
    }

    @Test fun savedRussianChoiceReopensWithAnEnglishDeviceLocale() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = "welcome336-${UUID.randomUUID()}"
        LocalPreferences(context, scope).set("language", "ru")
        val reopened = LocalPreferences(context, scope)
        val saved = reopened.selectedLanguage.first().selected
        assertEquals("ru", welcomeLanguage(saved, "en", "Etc/UTC", "US"))
    }

    @Test fun koreanMultilineTextKeepsWordsAndTheOriginalSelectableTextAtBothFontScales() {
        val original = "개인 작업 공간은 웹사이트와 사용 중인 기기 간에 동기화됩니다."
        val styled = buildAnnotatedString {
            append("GENESIS\n")
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(original) }
        }
        var scale by mutableStateOf(1f)
        var width by mutableStateOf(185.dp)
        lateinit var plainLayout: TextLayoutResult
        lateinit var styledLayout: TextLayoutResult
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, scale)) {
                Row(Modifier.height(IntrinsicSize.Min)) {
                    SelectionContainer {
                        Column(Modifier.width(width)) {
                            UntranslatedText(original, Modifier.testTag("ko-plain"), fontSize = 16.sp,
                                onTextLayout = { plainLayout = it })
                            UntranslatedText(styled, Modifier.testTag("ko-styled"), fontSize = 16.sp,
                                onTextLayout = { styledLayout = it })
                        }
                    }
                }
            }
        }
        for ((fontScale, columnWidth) in listOf(1f to 185.dp, 1.3f to 152.dp, 1f to 240.dp)) {
            compose.runOnIdle { scale = fontScale; width = columnWidth }
            compose.onNodeWithTag("ko-plain").assertTextEquals(original)
            compose.onNodeWithTag("ko-styled").assertTextEquals(styled.text)
            compose.runOnIdle {
                for ((source, layout) in listOf(original to plainLayout, styled.text to styledLayout)) {
                    assertEquals(source, layout.layoutInput.text.text)
                    assertEquals(16f, layout.layoutInput.style.fontSize.value, .01f)
                    assertTrue(layout.lineCount > 1)
                    assertFalse(layout.splitsWord())
                }
                val displayed = styledLayout.layoutInput.text
                val lastWord = displayed.text.lastIndexOf("동기화됩니다")
                assertTrue(displayed.spanStyles.any { it.start <= lastWord && it.end > lastWord && it.item.fontWeight == FontWeight.Bold })
            }
        }
    }
}
