package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.referralAccessError

class Referrals335UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val copy by lazy { InstrumentationRegistry.getInstrumentation().targetContext.assets
        .open("originals/i18n/referral-copy.json").bufferedReader().use { JSONObject(it.readText()) } }
    @Composable private fun Frame(language: String, dark: Boolean, content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) { content() }
            }
        }
    }
    @Test fun linkedLoginExplainsPrimaryAccountInAllLanguagesWithoutRetry() {
        var language by mutableStateOf("ru"); var dark by mutableStateOf(false)
        compose.setContent { key(language, dark) { Frame(language, dark) {
            NativeReferrals("synthetic-owner", language) { _, _, _ ->
                throw requireNotNull(referralAccessError(403, "REFERRAL_PRIMARY_GOOGLE_REQUIRED"))
            }
        } } }
        for (lang in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) for (night in listOf(false, true)) {
            compose.runOnIdle { language = lang; dark = night }
            val c = copy.getJSONObject(lang)
            compose.onNodeWithText(c.getString("title")).performClick()
            compose.onNodeWithText(c.getString("primaryRequired")).performScrollTo().assertIsDisplayed()
            compose.onNodeWithText(c.getString("retry")).assertDoesNotExist()
            compose.onNodeWithText(c.getString("create")).assertDoesNotExist()
        }
    }
    @Test fun networkRetryRecoversButAccessRejectionClearsStaleActions() {
        var calls = 0
        compose.setContent { Frame("en", false) {
            NativeReferrals("synthetic-owner", "en") { method, _, _ ->
                calls++
                if (calls == 1) throw AuthFailure(AuthFailure.Kind.NETWORK)
                if (method == "POST") throw requireNotNull(referralAccessError(403, "REFERRAL_PRIMARY_GOOGLE_REQUIRED"))
                JSONObject("""{"registeredThisMonth":0,"month":"2026-11","nextMonth":"2026-12","current":{"percent":0},"next":{"percent":0},"code":null,"used":false,"canRedeemFreeMonth":false}""")
            }
        } }
        val c = copy.getJSONObject("en")
        compose.onNodeWithText(c.getString("title")).performClick()
        compose.onNodeWithText(c.getString("retry")).performScrollTo().performClick()
        compose.onNodeWithText(c.getString("create")).performScrollTo().performClick()
        compose.onNodeWithText(c.getString("primaryRequired")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(c.getString("create")).assertDoesNotExist()
        compose.onNodeWithText(c.getString("retry")).assertDoesNotExist()
        assertEquals(3, calls)
    }
}
