package ru.genesis.calendar

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.activity.compose.setContent
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.ServerIdentity
import ru.genesis.calendar.auth.SyncRouting
import ru.genesis.calendar.auth.YandexCalendarFirstRunDialog
import ru.genesis.calendar.ui.standart

class YandexCalendarFirstRunDialogTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun offersCalendarOnlyOncePerUser() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val userId = "yandex-onboarding-${System.nanoTime()}"
        val settings = AccountSettings(
            accounts = emptyList(), routing = SyncRouting("fixed", emptyList(), emptyMap()),
            multiAccountEnabled = false, theme = "standart", themeRevision = 0,
            calendarMode = "profane", taskCalendarMode = "profane", timeFormat = "24h",
            divinationDisabled = false, language = "ru", authProvider = "yandex",
            calendarConnected = false,
        )
        var state by mutableStateOf(AuthPanelState(ready = true,
            user = ServerIdentity(userId, "Тест", "test@yandex.ru"), accountSettings = settings))
        compose.runOnUiThread {
            compose.activity.setContent {
                MaterialTheme(colorScheme = standart) {
                    YandexCalendarFirstRunDialog(state, AuthController.get(app))
                }
            }
        }
        compose.onNodeWithTag("yandex-calendar-first-run").assertExists()
        compose.onNodeWithTag("yandex-first-run-login").assertExists()
        compose.onNodeWithTag("yandex-first-run-password").assertExists()
        compose.onNodeWithTag("yandex-first-run-connect").assertExists()
        compose.onNodeWithText("Открыть создание пароля Календаря в Яндекс ID").assertExists()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(context.getExternalFilesDir(null), "yandex-calendar-connect-251.png")))
        compose.onNodeWithTag("yandex-first-run-later").performClick()
        compose.onNodeWithTag("yandex-calendar-first-run").assertDoesNotExist()
        compose.runOnUiThread { state = state.copy(accountSettings = settings.copy(calendarConnected = true)) }
        compose.waitForIdle()
        compose.runOnUiThread { state = state.copy(accountSettings = settings) }
        compose.waitForIdle()
        compose.onNodeWithTag("yandex-calendar-first-run").assertDoesNotExist()
    }
}
