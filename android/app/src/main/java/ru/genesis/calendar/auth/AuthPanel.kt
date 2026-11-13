package ru.genesis.calendar.auth

import ru.genesis.calendar.ui.AlertDialog

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.Button
import ru.genesis.calendar.ui.OutlinedButton
import ru.genesis.calendar.ui.FilterChip
import ru.genesis.calendar.ui.TextButton
import ru.genesis.calendar.ui.genesisTranslate
import ru.genesis.calendar.ui.eveningSurface
import ru.genesis.calendar.ui.release319Copy
import ru.genesis.calendar.ui.WorkspaceStatusNotice
import ru.genesis.calendar.ui.WorkspaceLoadingLine
import ru.genesis.calendar.ui.rememberDonationAction
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import com.yandex.authsdk.YandexAuthLoginOptions
import com.yandex.authsdk.YandexAuthOptions
import com.yandex.authsdk.YandexAuthResult
import com.yandex.authsdk.YandexAuthSdk

/** Native account and sync settings, grouped by user intent instead of one long card. */
@Composable
fun AuthPanel(app: GenesisApplication, localLanguage: String) {
    val controller = remember(app) { AuthController.get(app) }
    val state by controller.state.collectAsStateWithLifecycle()
    val taskSync by controller.taskSync.collectAsStateWithLifecycle()
    val activity = LocalContext.current.activity()
    val yandexSignInError = genesisTranslate("Вход через Яндекс не завершён")
    val privacyOpenError = genesisTranslate("Не удалось открыть политику конфиденциальности")
    val yandexSdk = remember(app, state.accountSettings?.authProvider) {
        if (state.accountSettings?.authProvider == "yandex" && BuildConfig.YANDEX_CLIENT_ID.isNotBlank())
            YandexAuthSdk.create(YandexAuthOptions(app)) else null
    }
    val yandexLauncher = if (yandexSdk != null) rememberLauncherForActivityResult(yandexSdk.contract) { result ->
        when (result) {
            is YandexAuthResult.Success -> controller.signInWithYandex(result.token.value, localLanguage)
            is YandexAuthResult.Failure -> Toast.makeText(app, yandexSignInError, Toast.LENGTH_SHORT).show()
            YandexAuthResult.Cancelled -> Unit
        }
    } else null
    var conflictReview by remember(state.user?.uid) { mutableStateOf<Pair<String, WorkspaceConflictPreview>?>(null) }
    var confirmDiscardSharedDrafts by remember { mutableIntStateOf(0) }
    val yandexAccounts = state.accountSettings?.accounts.orEmpty().filter { it.provider == "yandex" }
    var selectedYandexId by remember(state.user?.uid) { mutableStateOf(yandexAccounts.firstOrNull()?.id.orEmpty()) }
    val yandexCalendarLauncher = if (yandexSdk != null) rememberLauncherForActivityResult(yandexSdk.contract) { result ->
        when (result) {
            is YandexAuthResult.Success -> controller.connectYandexCalendar(result.token.value,
                result.token.expiresIn, selectedYandexId)
            is YandexAuthResult.Failure -> Toast.makeText(app, yandexSignInError, Toast.LENGTH_SHORT).show()
            YandexAuthResult.Cancelled -> Unit
        }
    } else null
    LaunchedEffect(yandexAccounts) {
        if (yandexAccounts.none { it.id == selectedYandexId }) selectedYandexId = yandexAccounts.firstOrNull()?.id.orEmpty()
    }
    val selectedYandex = yandexAccounts.firstOrNull { it.id == selectedYandexId }

    Column(Modifier.fillMaxWidth().testTag("auth-panel"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        AccountSubsection("auth-sign-in-block", "◎", "Вход в GENESIS",
            "Защищённая учётная запись и состояние сессии") {
            Text("После входа данные сайта открываются в отдельной защищённой копии. Локальные черновики не перезаписываются.",
                style = MaterialTheme.typography.bodySmall)
            if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            state.user?.let { identity ->
                Text(identity.displayName, style = MaterialTheme.typography.titleSmall)
                Text(identity.email, style = MaterialTheme.typography.bodySmall)
            }
            Text(state.message, modifier = Modifier.testTag("auth-status"), style = MaterialTheme.typography.bodySmall)
            state.checkedAt?.let { time ->
                Text("Проверено: " + DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")
                    .format(Instant.ofEpochMilli(time).atZone(ZoneId.systemDefault())),
                    style = MaterialTheme.typography.labelSmall)
            }
            if (state.requiresSignIn && state.accountSettings?.authProvider == "google") {
                Button(onClick = { activity?.let { controller.signIn(it, localLanguage) } },
                    enabled = !state.busy && activity != null,
                    modifier = Modifier.fillMaxWidth().testTag("auth-google-sign-in")) {
                    Text("Продолжить вход через Google")
                }
            }
            if (state.requiresSignIn && state.accountSettings?.authProvider == "yandex") {
                if (yandexLauncher != null) {
                    OutlinedButton(onClick = { yandexLauncher.launch(YandexAuthLoginOptions()) },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("auth-yandex-sign-in")) {
                        Text("Войти через Яндекс")
                    }
                }
            }
            if (state.user != null) {
                val identity=requireNotNull(state.user)
                BillingPanel(controller,identity.uid,identity.email,state.accountSettings?.featureAccess ?: FeatureAccess(),localLanguage)
                OutlinedButton(onClick = {
                    val pending = controller.pendingSharedMutationsCount()
                    if (pending > 0) confirmDiscardSharedDrafts = pending else controller.logout()
                },
                    modifier = Modifier.fillMaxWidth().testTag("auth-logout")) { Text("Выйти") }
            }
            TextButton(onClick = {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${AUTH_ORIGIN}/privacy"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { app.startActivity(intent) }.onFailure {
                    Toast.makeText(app, privacyOpenError, Toast.LENGTH_SHORT).show()
                }
            }, modifier = Modifier.testTag("auth-privacy-policy")) {
                Text("Политика конфиденциальности")
            }
        }

        AccountSubsection("auth-cloud-block", "☁", "Облако",
            if (state.accountSettings?.authProvider != "google") "Защищённое пространство GENESIS"
            else "Что хранится в GENESIS, а что синхронизируется с Google") {
            val cloud = state.preview
            CloudDestination("Сайт GENESIS",
                if (cloud == null) "Ожидает загрузки защищённого пространства" else "Версия облака: ${cloud.version}",
                if (cloud == null) "Проекты, категории, привычки, отметки, сон, настроение, награды и испытания."
                else "${cloud.projects} проектов · ${cloud.categories} категорий · ${cloud.habits} привычек · ${cloud.completions} отметок\n" +
                    "Сон: ${cloud.sleepEntries} · настроение: ${cloud.moodEntries} · награды: ${cloud.rewards} · испытания: ${cloud.quests}")
            if (state.accountSettings?.authProvider == "google") {
                val access = GoogleServiceAccess.primary(state.accountSettings)
                CloudDestination("Google-аккаунт",
                    if (access.complete) "Calendar и Tasks подключены" else "Calendar и Tasks требуют подключения",
                    if (cloud?.tasks == null) "События календаря и задачи Google появятся после подключения сервисов."
                    else "Задачи Google: ${cloud.tasks} · списки: ${cloud.taskLists ?: 0}")
            }
            if (taskSync.scope == app.workspaceScope) {
                // The shared drawer footer owns task synchronization notices.
                taskSync.received?.let { count ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Получено с сервера:", style = MaterialTheme.typography.bodySmall)
                        Text(count.toString(), style = MaterialTheme.typography.bodySmall)
                    }
                }
                taskSync.available?.let { count ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Задач на устройстве:", style = MaterialTheme.typography.bodySmall)
                        Text(count.toString(), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (cloud?.hasGoogleSyncWarning == true) {
                Text("Google Tasks сообщил о неполной загрузке. Объединение пока недоступно.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            Text(if (state.accountSettings?.authProvider == "yandex")
                "Проекты, привычки и списки задач хранятся в зашифрованном пространстве GENESIS. Задачи синхронизируются с Яндекс.Календарем после подключения."
                else "Изменения проектов и привычек синхронизируются с зашифрованным пространством, задачи — с Google. При конфликте локальная копия сохраняется.",
                style = MaterialTheme.typography.bodySmall)
            if (state.user != null) OutlinedButton(onClick = controller::refresh,
                enabled = !state.busy && !taskSync.loading,
                modifier = Modifier.fillMaxWidth().testTag("auth-sync-retry")) { Text("Повторить синхронизацию") }
            if (state.workspaceConflictPath != null) {
                Text("Одно и то же поле изменено на сайте и на телефоне. Обычная синхронизация остановлена; обе копии сохранены.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                WorkspaceConflictSummary(state.workspaceConflictPreview, state.busy) {
                    state.user?.uid?.let { uid -> state.workspaceConflictPreview?.let { conflictReview = uid to it } }
                }
            }
        }

        if (state.user != null && selectedYandex != null) {
            AccountSubsection("auth-yandex-calendar-block", "▦", "Яндекс.Календарь",
                "Подключение для выбранного Яндекс-аккаунта") {
                if (yandexAccounts.size > 1) yandexAccounts.forEach { account ->
                    FilterChip(selected = selectedYandexId == account.id, onClick = {
                        selectedYandexId = account.id
                    }, label = { Text(account.email) }, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("yandex-calendar-account-${account.id}"))
                }
                if (selectedYandex.calendarConnected) {
                    Text("Подключён. Задачи GENESIS отображаются в Яндекс.Календаре как события.",
                        style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = { controller.disconnectYandexCalendar(selectedYandexId) }, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("disconnect-yandex-calendar")) {
                        Text("Отключить календарь")
                    }
                } else {
                    Text("Подтвердите доступ к Календарю через Яндекс ID. Отдельный пароль не требуется.",
                        style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { yandexCalendarLauncher?.launch(YandexAuthLoginOptions()) },
                        enabled = !state.busy && yandexCalendarLauncher != null,
                        modifier = Modifier.fillMaxWidth().testTag("connect-yandex-calendar")) {
                        Text("Подключить календарь")
                    }
                }
            }
        }

        if (state.user != null && state.accountSettings?.authProvider != "google") {
            AccountSubsection("auth-local-multi-account-block", "◉", "Несколько аккаунтов",
                "Связанные способы входа и правила отправки задач") {
                MultiAccountPanel(state, controller, showHeading = false)
            }
        }

        if (state.user != null && state.accountSettings?.authProvider == "google") {
            AccountSubsection("auth-google-services-block", "↻", "Google Calendar и Tasks",
                "Разрешения и фоновая синхронизация") {
                GoogleServicesConnectPanel(state, controller, showWhenComplete = true, embedded = true)
            }
            AccountSubsection("auth-multi-account-block", "◉", "Несколько Google-аккаунтов",
                "Связанные аккаунты и правила отправки задач") {
                MultiAccountPanel(state, controller, showHeading = false)
            }
        }
    }

    if (confirmDiscardSharedDrafts > 0) AlertDialog(
        onDismissRequest = { confirmDiscardSharedDrafts = 0 },
        title = { Text(if (localLanguage == "en") "Unsent team changes" else "Неотправленные изменения команды") },
        text = { Text(if (localLanguage == "en")
            "$confirmDiscardSharedDrafts team changes are saved on this device. Signing out will delete them."
            else "$confirmDiscardSharedDrafts изменений команды хранятся на устройстве. При выходе они будут удалены.") },
        confirmButton = { TextButton(onClick = { confirmDiscardSharedDrafts = 0; controller.logout() }) {
            Text(if (localLanguage == "en") "Sign out and delete" else "Выйти и удалить") } },
        dismissButton = { TextButton(onClick = { confirmDiscardSharedDrafts = 0 }) {
            Text(if (localLanguage == "en") "Cancel" else "Отмена") } })
    conflictReview?.let { (uid, preview) -> WorkspaceConflictDialog(preview, state.busy,
        onKeepLocal = { conflictReview = null; controller.keepLocalWorkspaceChanges(uid, preview.fingerprint) },
        onKeepRemote = { conflictReview = null; controller.keepRemoteWorkspaceChanges(uid, preview.fingerprint) },
        onDismiss = { conflictReview = null }) }
}

@Composable
fun AccountTaskSyncNotice(state: AccountTaskSyncState, modifier: Modifier = Modifier) {
    val notice = state.notice ?: return
    WorkspaceStatusNotice(notice, modifier.testTag("account-task-sync-status"), isError = state.issue != null) {
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}

/** Permanent project links are intentionally outside the account and sync section. */
@Composable
fun GenesisLinksPanel() {
    val context = LocalContext.current
    val copy = release319Copy()
    val controller = remember(context) { AuthController.get(context) }
    val donation = rememberDonationAction(controller)
    val openLinkError = genesisTranslate("Не удалось открыть ссылку в браузере.")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = donation.open, enabled = !donation.preparing,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("account-link-donate"),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary)) {
            Text(copy.getString("donation"), textAlign = androidx.compose.ui.text.style.TextAlign.Center, translate = false)
        }
        listOf(
            Triple("GENESIS · Telegram", "https://t.me/genesiscalendar", "account-link-telegram"),
            Triple("Веб-версия GENESIS", "${AUTH_ORIGIN}/", "account-link-web"),
        ).forEach { (label, url, tag) ->
            val open: () -> Unit = {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(intent) }.onFailure {
                    Toast.makeText(context, openLinkError, Toast.LENGTH_SHORT).show()
                }
            }
            OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth().testTag(tag)) { Text(label) }
        }
    }
}

@Composable
private fun AccountSubsection(tag: String, symbol: String, title: String, subtitle: String,
    content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth().testTag(tag), shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(Modifier.size(34.dp).testTag("$tag-icon"), shape = RoundedCornerShape(10.dp),
                    color = eveningSurface(Color(0xff123b36))) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(symbol, color = Color(0xffffe4a6), style = MaterialTheme.typography.titleSmall)
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                    Text(subtitle, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            content()
        }
    }
}

@Composable
private fun CloudDestination(title: String, status: String, details: String) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(details, style = MaterialTheme.typography.bodySmall)
        }
    }
}

internal tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.activity()
    else -> null
}
