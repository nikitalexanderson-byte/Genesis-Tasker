package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AdminGateway
import ru.genesis.calendar.auth.AdminProtocol
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal fun adminDate(value: String): String = value.takeIf { it.isNotBlank() && it != "null" }?.let {
    runCatching { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(it)) }.getOrDefault(it)
}.orEmpty().ifBlank { "—" }

private fun adminSyncStatus(status: String, lastSync: String): String {
    val stale = runCatching { Instant.parse(lastSync) < Instant.now().minusSeconds(7 * 86400) }.getOrDefault(false)
    return when (status) { "ok" -> if (stale) "Давно не проверено" else "Работает"; "warning" -> "Требует внимания"; "disconnected" -> "Отключено"; else -> "Не проверено" }
}

@Composable
internal fun AdminSubscriptionControl(gateway: AdminGateway?, user: JSONObject, disabled: Boolean,
    onSaved: (String) -> Unit, onRefresh: suspend () -> Unit) {
    val id = user.getString("id"); val current = user.optString("subscriptionPlan", "free")
    var draft by rememberSaveable(id, current) { mutableStateOf<String?>(null) }
    val selected = draft ?: current
    var open by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var resetAccess by remember{mutableStateOf(false)}
    var resetEmail by remember{mutableStateOf("")}
    val scope = rememberCoroutineScope()
    fun run(action: suspend () -> Unit) {
        if (busy || gateway == null) return
        busy = true; error = ""; message = ""
        scope.launch { try { gateway.check(); action(); gateway.check() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = adminError(failure.message) } finally { busy = false } }
    }
    Column(Modifier.fillMaxWidth().testTag("admin-subscription-$id"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(genesisTranslate("Текущий тариф") + ": " + if (current == "elite_plus") "Elite+" else if (current == "premium4life") "Elite" else current, style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) {
                OutlinedButton(onClick = { open = true }, enabled = gateway != null && !disabled && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(if (selected == "elite_plus") "Elite+" else if (selected == "premium4life") "Elite" else selected, Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
                }
                DropdownMenu(open, { open = false }) { AdminProtocol.plans.forEach { plan ->
                    DropdownMenuItem(text = { Text(if (plan == "elite_plus") "Elite+" else if (plan == "premium4life") "Elite" else plan) }, onClick = { draft = plan; open = false; message = ""; error = "" })
                } }
            }
            Button(enabled = gateway != null && !disabled && !busy && selected != current, modifier = Modifier.heightIn(min = 48.dp), onClick = { if(selected=="free"){resetEmail="";resetAccess=true}else run {
                val command = AdminProtocol.subscription(user, selected)
                val result = requireNotNull(gateway).subscription(id, command.getString("subscriptionPlan"), command.getString("expectedPlan"))
                require(result.getString("userId") == id && result.getString("subscriptionPlan") == selected)
                onSaved(selected); draft = null; message = "Тариф сохранён."
            } }) { Text("Сохранить") }
        }
        TextButton(enabled=gateway!=null&&!disabled&&!busy,onClick={resetEmail="";resetAccess=true},modifier=Modifier.heightIn(min=48.dp)){Text("Сбросить доступ до Free")}
        if(resetAccess) AlertDialog(onDismissRequest={if(!busy)resetAccess=false},title={Text("Отозвать доступ?")},text={
            Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("Аккаунт перейдёт на Free. Данные сохранятся. Повторный вход и переустановка не вернут прежнюю льготу.")
                OutlinedTextField(resetEmail,{resetEmail=it},label={Text("Введите e-mail пользователя")},singleLine=true)
            }
        },confirmButton={TextButton(enabled=!busy&&resetEmail.trim().equals(user.getString("email"),ignoreCase=true),onClick={run {
            val result=requireNotNull(gateway).resetAccess(id,current,user.optInt("subscriptionRevision",0))
            require(result.getString("userId")==id&&result.getString("subscriptionPlan")=="free")
            onSaved("free");draft=null;resetAccess=false;message="Доступ сброшен до Free.";onRefresh()
        }}){Text("Отозвать и установить Free")}},dismissButton={TextButton(enabled=!busy,onClick={resetAccess=false}){Text("Отмена")}})
        if (error.isNotBlank()) {
            Text(error, color = MaterialTheme.colorScheme.error)
            TextButton(enabled = !busy && !disabled, onClick = { run { onRefresh(); error = ""; draft = null } }) { Text("Обновить пользователя") }
        }
        if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
internal fun AdminUserDetails(user: JSONObject, onClose: () -> Unit) {
    AlertDialog(onDismissRequest = onClose, title = { Text(user.optString("displayName").ifBlank { user.getString("email") }) },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(user.getString("email"))
            Text("Активность", style = MaterialTheme.typography.titleMedium)
            Text("Активность включает работу и синхронизацию в фоне. Новая авторизация означает повторный вход в аккаунт.", style = MaterialTheme.typography.bodySmall)
            AdminDetail("Последняя операция / синхронизация", adminDate(user.optString("lastSeenAt")))
            AdminDetail("Новая авторизация", adminDate(user.optString("lastLoginAt")))
            AdminDetail("Регистрация", adminDate(user.optString("createdAt")))
            AdminDetail("Входов", user.optInt("loginCount").toString())
            user.optJSONArray("clientActivity")?.let { clients -> (0 until clients.length()).forEach { index -> val client = clients.getJSONObject(index)
                Text(when (client.optString("kind")) { "android_app" -> "Android-приложение"; "mobile_browser" -> "Браузер на смартфоне / планшете"; "desktop_browser" -> "Браузер на компьютере"; else -> "Устройство" }, style = MaterialTheme.typography.titleSmall)
                AdminDetail("Связь с сервером", adminDate(client.optString("lastSeenAt")))
                AdminDetail("Новая авторизация", adminDate(client.optString("lastLoginAt")))
            } }
            Text("Разбивка по устройствам собирается после обновления. Устройства прежних входов не определены.", style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()
            Text("Содержимое пространства", style = MaterialTheme.typography.titleMedium)
            AdminDetail("Привычек", user.optInt("habitCount").toString()); AdminDetail("Проектов", user.optInt("projectCount").toString())
            AdminDetail("Задач", user.optInt("taskCount").toString()); AdminDetail("Открытых задач", user.optInt("openTaskCount").toString())
            AdminDetail("Выполненных задач", user.optInt("completedTaskCount").toString())
            AdminDetail("Обновление агрегатов", adminDate(user.optString("metricsUpdatedAt")))
            Text("Названия, заметки и история привычек остаются зашифрованными. Доступны только количества.", style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()
            Text("Google", style = MaterialTheme.typography.titleMedium)
            AdminDetail("Авторизация", if (user.optBoolean("googleAuthConnected")) genesisTranslate("Подключено") else genesisTranslate("Отключено"))
            AdminDetail("Calendar", if (user.optBoolean("calendarConnected")) genesisTranslate("Подключено") else genesisTranslate("Отключено"))
            AdminDetail("Событий Google", user.optInt("googleSyncedCount").toString())
            AdminDetail("Проверка Google Calendar", adminDate(user.optString("lastGoogleCalendarSyncAt")))
            HorizontalDivider()
            Text("Android", style = MaterialTheme.typography.titleMedium)
            AdminDetail("Запросов скачивания", user.optInt("androidDownloadCount").toString())
            AdminDetail("Первый запрос", adminDate(user.optString("androidFirstDownloadAt")))
            AdminDetail("Последний запрос", adminDate(user.optString("androidLastDownloadAt")))
            AdminDetail("Запрошенная версия", user.optString("androidLastDownloadVersion").takeUnless { it == "null" }.orEmpty().ifBlank { "—" })
            AdminDetail("Версия из приложения", user.optString("androidReportedVersion").takeUnless { it == "null" }.orEmpty().ifBlank { "—" })
            AdminDetail("Установок с отчётом", user.optInt("androidDeviceCount").toString())
            AdminDetail("Последний контакт приложения", adminDate(user.optString("androidLastSeenAt")))
            AdminDetail("Синхронизация сервера", genesisTranslate(adminSyncStatus(user.optString("androidServerSyncStatus"), user.optString("androidLastServerSyncAt"))))
            AdminDetail("Синхронизация Google", genesisTranslate(adminSyncStatus(user.optString("androidGoogleSyncStatus"), user.optString("androidLastServerSyncAt"))))
            AdminDetail("Последняя синхронизация", adminDate(user.optString("androidLastServerSyncAt")))
            Text("Версия появляется после контакта приложения с сервером и не доказывает, что приложение всё ещё установлено. Анонимные скачивания не связаны с аккаунтом.", style = MaterialTheme.typography.bodySmall)
        } }, confirmButton = {})
}

@Composable private fun AdminDetail(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        UntranslatedText(value, style = MaterialTheme.typography.bodyMedium)
    }
}
