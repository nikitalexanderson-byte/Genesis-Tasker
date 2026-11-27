package ru.genesis.calendar.auth

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.ui.LocalGenesisLanguage

class AccountWebsiteLanguageTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun settingsLinksCarryTheSelectedLocaleAndKeepTheAccountAction() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = compose.activity.application as GenesisApplication
        val destination = AtomicReference<Uri?>()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_VIEW || intent.data?.scheme != "https") return null
                destination.set(intent.data)
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        val account = LinkedGoogleAccount("qa", "test@example.invalid", "Календарь", true, true, true)
        val settings = AccountSettings(listOf(account), SyncRouting("fixed", listOf(account.id), emptyMap()), false,
            "standart", 1, "profane", "profane", "24h", false, "en")
        val state = AuthPanelState(accountSettings = settings)
        val language = mutableStateOf("en")
        val panel = mutableStateOf("privacy")
        val tags = mapOf("privacy" to "auth-privacy-policy", "link" to "linked-account-open-site", "web" to "account-link-web")
        instrumentation.addMonitor(monitor)
        try {
            compose.setContent {
                MaterialTheme {
                    CompositionLocalProvider(LocalGenesisLanguage provides language.value) {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            when (panel.value) {
                                "privacy" -> AuthPanel(app, language.value)
                                "link" -> MultiAccountPanel(state, AuthController.get(app))
                                "web" -> GenesisLinksPanel()
                            }
                        }
                    }
                }
            }
            for (locale in listOf("he", "ar", "ko", "nl", "en", "ru")) {
                for ((screen, tag) in tags) {
                    compose.runOnIdle { language.value = locale; panel.value = screen }
                    if (screen == "link") compose.onNodeWithText(account.displayName).assertExists()
                    destination.set(null)
                    compose.onNodeWithTag(tag).performScrollTo().performClick()
                    compose.waitUntil(5000) { destination.get() != null }
                    val url = requireNotNull(destination.get())
                    assertEquals(Uri.parse(AUTH_ORIGIN).authority, url.authority)
                    assertEquals(locale, url.getQueryParameter("lang"))
                    assertEquals(if (screen == "privacy") "/privacy" else "/", url.path)
                    assertEquals(if (screen == "link") "1" else null, url.getQueryParameter("account_link"))
                    assertEquals(if (screen == "link") "settings" else null, url.fragment)
                }
            }
        } finally {
            instrumentation.removeMonitor(monitor)
        }
    }
}
