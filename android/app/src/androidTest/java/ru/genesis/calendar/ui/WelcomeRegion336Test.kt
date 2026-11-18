package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.WelcomeIpRegion
import ru.genesis.calendar.data.welcomeLanguage
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.captureNativeWindow

/** All locations are synthetic; these tests never query a geo provider. */
class WelcomeRegion336Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun RussianIsAbsentUntilPositiveIpAndManualOtherLanguageWinsLateResult() {
        val response = CompletableDeferred<WelcomeIpRegion>()
        var selected by mutableStateOf<String?>(null)
        compose.setContent {
            val region = rememberWelcomeIpRegion(true) { response.await() }
            val russian = region == WelcomeIpRegion.RUSSIA
            val language = welcomeLanguage(selected, "ru", "Europe/Moscow", "RU", russian)
            CompositionLocalProvider(LocalGenesisLanguage provides language) {
                MaterialTheme {
                    WelcomeContent(AuthPanelState(checkedAt = 1L), language, { selected = it }, {},
                        onRetry = {}, onWeb = {}, onLegal = {}, russianAvailable = russian)
                }
            }
        }
        compose.onNodeWithTag("language-ru").assertDoesNotExist()
        compose.onNodeWithTag("language-de").performClick()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome336-region-unknown.png"))
        compose.runOnIdle { response.complete(WelcomeIpRegion.RUSSIA) }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("language-ru").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("language-de").assertIsSelected()
        compose.onNodeWithTag("language-ru").performClick()
        compose.onNodeWithTag("language-ru").assertIsSelected()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome336-region-RU.png"))
        assertEquals("ru", selected)
    }

    @Test fun staleCompletionAfterLeavingCannotEnableRussianOnNextVisit() {
        val replies = listOf(CompletableDeferred<WelcomeIpRegion>(), CompletableDeferred<WelcomeIpRegion>())
        var visit by mutableStateOf(true)
        val calls = AtomicInteger()
        compose.setContent {
            val region = rememberWelcomeIpRegion(visit) { replies[calls.getAndIncrement()].await() }
            LanguageChips("en", flagsOnly = true, includeRussian = region == WelcomeIpRegion.RUSSIA, onLanguage = {})
        }
        compose.waitForIdle()
        compose.waitUntil(10_000) { calls.get() == 1 }
        compose.runOnIdle { visit = false }
        compose.waitForIdle()
        compose.runOnIdle { replies[0].complete(WelcomeIpRegion.RUSSIA); visit = true }
        compose.waitForIdle()
        compose.waitUntil(10_000) { calls.get() == 2 }
        compose.onNodeWithTag("language-ru").assertDoesNotExist()
        compose.runOnIdle { replies[1].complete(WelcomeIpRegion.OTHER) }
        compose.waitForIdle()
        compose.onNodeWithTag("language-ru").assertDoesNotExist()
    }

    @Test fun foregroundReturnRequiresFreshIpRatherThanReusingPreviousRussiaResult() {
        val fresh = CompletableDeferred<WelcomeIpRegion>()
        val calls = AtomicInteger()
        compose.setContent {
            val region = rememberWelcomeIpRegion(true) {
                if (calls.incrementAndGet() == 1) WelcomeIpRegion.RUSSIA else fresh.await()
            }
            LanguageChips("en", flagsOnly = true, includeRussian = region == WelcomeIpRegion.RUSSIA, onLanguage = {})
        }
        compose.waitForIdle()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("language-ru").fetchSemanticsNodes().isNotEmpty() }
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
        compose.waitUntil(10_000) { calls.get() >= 2 }
        compose.onNodeWithTag("language-ru").assertDoesNotExist()
        compose.runOnIdle { fresh.complete(WelcomeIpRegion.UNKNOWN) }
        compose.waitForIdle()
        compose.onNodeWithTag("language-ru").assertDoesNotExist()
    }

    @Test fun savedChoiceIsReadAgainAndRussianIsMaskedWithoutDeletingThePreference() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = "welcome336-${UUID.randomUUID()}"
        LocalPreferences(context, scope).set("language", "ru")
        val reopened = LocalPreferences(context, scope)
        val saved = reopened.selectedLanguage.first().selected
        assertEquals("ru", saved)
        assertEquals("en", welcomeLanguage(saved, "ru", "Europe/Moscow", "RU", false))
        assertEquals("ru", welcomeLanguage(saved, "en", "Etc/UTC", "US", true))
        assertEquals("ru", reopened.selectedLanguage.first().selected)
    }
}
