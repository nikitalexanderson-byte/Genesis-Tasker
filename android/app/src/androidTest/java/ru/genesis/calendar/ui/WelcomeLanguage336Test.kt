package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
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

    @Test fun allFourteenLanguagesAreAvailableBeforeSignIn() {
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
        assertEquals(14, publicLanguages.size)
        publicLanguages.forEach { compose.onNodeWithTag("language-$it").assertExists() }
        compose.onNodeWithTag("language-en").assertIsSelected()
        compose.onNodeWithTag("language-de").performClick().assertIsSelected()
        compose.runOnIdle { ip.complete(WelcomeIpRegion.RUSSIA) }
        compose.onNodeWithTag("language-de").assertIsSelected()
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
}
