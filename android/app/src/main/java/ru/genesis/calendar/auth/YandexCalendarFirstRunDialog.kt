package ru.genesis.calendar.auth

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import ru.genesis.calendar.ui.AlertDialog
import ru.genesis.calendar.ui.Button
import androidx.compose.material3.MaterialTheme
import ru.genesis.calendar.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.yandex.authsdk.YandexAuthLoginOptions
import com.yandex.authsdk.YandexAuthOptions
import com.yandex.authsdk.YandexAuthResult
import com.yandex.authsdk.YandexAuthSdk
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.ui.Text

/** Offer calendar consent to the signed-in Yandex account. */
@Composable
fun YandexCalendarFirstRunDialog(state: AuthPanelState, controller: AuthController) {
    val userId = state.user?.uid
    val context = LocalContext.current
    val offers = remember(context) { context.getSharedPreferences("genesis.yandex.calendar-offer", Context.MODE_PRIVATE) }
    var show by remember(userId) { mutableStateOf(false) }
    val sdk = remember(context) {
        if (BuildConfig.YANDEX_CLIENT_ID.isNotBlank()) YandexAuthSdk.create(YandexAuthOptions(context)) else null
    }
    val launcher = if (sdk != null) rememberLauncherForActivityResult(sdk.contract) { result ->
        when (result) {
            is YandexAuthResult.Success -> controller.connectYandexCalendar(result.token.value, result.token.expiresIn)
            is YandexAuthResult.Failure, YandexAuthResult.Cancelled -> Unit
        }
    } else null
    val connected = state.accountSettings?.calendarConnected == true

    LaunchedEffect(state.ready, state.requiresSignIn, state.accountSettings?.authProvider, connected, userId) {
        if (connected || state.accountSettings?.authProvider != "yandex") {
            show = false
        } else if (state.ready && !state.requiresSignIn && userId != null && !offers.getBoolean(userId, false)) {
            offers.edit().putBoolean(userId, true).apply()
            show = true
        }
    }
    if (!show || userId == null || state.accountSettings?.authProvider != "yandex") return

    val dismiss = {
        if (!state.busy) {
            show = false
        }
    }
    AlertDialog(
        modifier = Modifier.testTag("yandex-calendar-first-run"),
        onDismissRequest = dismiss,
        title = { Text("Подключить Яндекс.Календарь") },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Подтвердите доступ к Календарю через Яндекс ID. Отдельный пароль не требуется.",
                    style = MaterialTheme.typography.bodyMedium)
                Text(state.message, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(onClick = { launcher?.launch(YandexAuthLoginOptions()) },
                enabled = !state.busy && launcher != null,
                modifier = Modifier.testTag("yandex-first-run-connect")) { Text("Подключить календарь") }
        },
        dismissButton = { TextButton(onClick = dismiss, enabled = !state.busy,
            modifier = Modifier.testTag("yandex-first-run-later")) { Text("Позже") } },
    )
}
