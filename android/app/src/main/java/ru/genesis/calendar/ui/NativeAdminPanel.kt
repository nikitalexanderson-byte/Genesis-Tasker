package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AdminGateway
import ru.genesis.calendar.auth.AdminProtocol

@Composable
internal fun NativeAdminPanel(onClose: () -> Unit, load: suspend () -> JSONObject,
    deleteUser: suspend (String, Boolean) -> JSONObject, gateway: AdminGateway? = null, use24: Boolean = true) {
    val scope = rememberCoroutineScope()
    val uid = LocalGenesisUserId.current
    var payload by remember(uid) { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<JSONObject?>(null) }
    var blacklist by remember { mutableStateOf(false) }
    var emailConfirmation by rememberSaveable { mutableStateOf("") }
    var activityUserId by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable(uid) { mutableStateOf("analytics") }
    var adsExitSignal by remember { mutableIntStateOf(0) }
    val forecastCopy = modelingServiceCopy()
    suspend fun refresh() {
        gateway?.check(); val next = load(); gateway?.check(); payload = next
    }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""; message = ""
        scope.launch { try { gateway?.check(); action(); gateway?.check() } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = "Не удалось обновить данные администратора. Проверьте доступ и повторите." }
            finally { busy = false } }
    }
    LaunchedEffect(uid) { run { refresh() } }
    Dialog(onDismissRequest = { if (section == "ads") adsExitSignal++ else if (!busy && pendingDelete == null) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().testTag("native-admin-panel"), shape = AffairsLayout.shape,
            color = MaterialTheme.colorScheme.surface) {
            if (section == "ads" && gateway != null) {
                AdminAdsScreen(gateway, adsExitSignal, use24) { section = "analytics" }
            } else Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                EditorDialogHeader("Админ-панель", "admin-close-icon", onClose = { if (!busy) onClose() })
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(section == "analytics", onClick = { section = "analytics" }, label = { Text("Пользователи") }, modifier = Modifier.heightIn(min = 48.dp))
                    FilterChip(section == "actions", onClick = { section = "actions" }, label = { Text("Использование функций") }, modifier = Modifier.heightIn(min = 48.dp).testTag("admin-feature-tab"))
                    FilterChip(false, onClick = { adsExitSignal = 0; section = "ads" }, enabled = gateway != null && !busy,
                        label = { Text("Реклама") }, modifier = Modifier.heightIn(min = 48.dp).testTag("admin-manage-ads"))
                }
                if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary)
                val users = payload?.optJSONArray("users")?.let { array -> (0 until array.length()).map { array.getJSONObject(it) } }.orEmpty()
                if (section == "actions") {
                    val usage = payload?.optJSONObject("featureUsage")
                    val features = usage?.optJSONArray("features")?.let { array -> (0 until array.length()).map { array.getJSONObject(it) } }.orEmpty()
                    LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth().testTag("admin-feature-usage"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        item {
                            Text("Действия и их количество", style = MaterialTheme.typography.titleLarge)
                            Text("Счётчики начинаются с первого зафиксированного открытия. «Без открытия» включает старые аккаунты, действия которых прежде не измерялись. «Выключено» отражает текущие настройки меню и календарей.", style = MaterialTheme.typography.bodySmall)
                            Text(genesisTranslate("Первое событие") + ": " + adminDate(usage?.optString("startedAt").orEmpty()), style = MaterialTheme.typography.bodySmall)
                        }
                        items(features, key = { it.getString("id") }) { feature ->
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(adminFeatureName(feature.getString("id")), style = MaterialTheme.typography.titleSmall)
                                Text(adminCount("Пользователей", feature.optInt("usedUsers")) + " · " + adminCount("Открытий", feature.optInt("opens")))
                                Text(adminCount("Сайт", feature.optInt("webOpens")) + " · Android: " + feature.optInt("androidOpens") + " · " + adminCount("Выключено", feature.optInt("disabledUsers")), style = MaterialTheme.typography.bodySmall)
                                Text(adminCount("Без зафиксированного открытия", ((usage?.optInt("accountCount") ?: 0) - feature.optInt("usedUsers")).coerceAtLeast(0)), style = MaterialTheme.typography.bodySmall)
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                    }
                } else LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth().testTag("admin-users"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    payload?.optJSONObject("totals")?.let { totals -> item {
                        Text("Активность GENESIS", style = MaterialTheme.typography.titleLarge)
                        Text("Названия, заметки и история привычек остаются зашифрованными. Панель получает только агрегированные количества.", style = MaterialTheme.typography.bodySmall)
                        Text(adminCount("Пользователей", totals.optInt("users")) + " · " + adminCount("Привычек", totals.optInt("habits")))
                        Text(adminCount("Задач", totals.optInt("tasks")) + " · " + adminCount("Выполнено", totals.optInt("completedTasks")) + " · " + adminCount("Проектов", totals.optInt("projects")))
                        Text(adminCount("В чёрном списке", totals.optInt("blockedIdentities")), style = MaterialTheme.typography.bodySmall)
                        Text(adminCount("Загрузок Android", totals.optInt("androidDownloadRequests")) + " · " + adminCount("Пользователей с отчётом", totals.optInt("androidReportingUsers")), style = MaterialTheme.typography.bodySmall)
                    } }
                    if (payload != null && users.isEmpty()) item { Text("Пользователей пока нет.") }
                    items(users, key = { it.getString("id") }) { user ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            UntranslatedText(user.optString("displayName").ifBlank { user.getString("email") }, style = MaterialTheme.typography.titleMedium)
                            UntranslatedText(user.getString("email"), style = MaterialTheme.typography.bodySmall)
                            if (user.optBoolean("forecastElitePlus")) UntranslatedText("Elite+", color = MaterialTheme.colorScheme.primary)
                            Text(adminCount("Задач", user.optInt("taskCount")) + " · " + adminCount("Привычек", user.optInt("habitCount")) + " · " + adminCount("Проектов", user.optInt("projectCount")), style = MaterialTheme.typography.bodySmall)
                            Text(genesisTranslate("Последняя активность") + ": " + adminDate(user.optString("lastSeenAt")), style = MaterialTheme.typography.bodySmall)
                            AdminSubscriptionControl(gateway, user, busy, onSaved = { plan ->
                                payload = payload?.let { original -> JSONObject(original.toString()).apply { val rows = getJSONArray("users")
                                    (0 until rows.length()).map(rows::getJSONObject).first { it.getString("id") == user.getString("id") }.put("subscriptionPlan", plan)
                                } }
                            }, onRefresh = ::refresh)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { activityUserId = user.getString("id") }, enabled = !busy) { Text("Подробнее") }
                                if (!user.optBoolean("isAdmin")) TextButton(onClick = {
                                    pendingDelete = user; blacklist = false; emailConfirmation = ""
                                }, enabled = !busy) { Text("Удалить пользователя") }
                                else Text("Администратор · защищён", style = MaterialTheme.typography.bodySmall)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { run { refresh() } }, enabled = !busy) { Text("Обновить") }
                    Button(onClick = onClose, enabled = !busy, modifier = Modifier.testTag("admin-close-text")) { Text("Закрыть") }
                }
                users.firstOrNull { it.getString("id") == activityUserId }?.let { user -> AdminUserDetails(user) { activityUserId = "" } }
            }
        }
    }
    pendingDelete?.let { user ->
        AlertDialog(onDismissRequest = { if (!busy) pendingDelete = null }, title = { Text("Удалить пользователя?") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(user.getString("email"))
                Text("Аккаунт, зашифрованное пространство, привычки, задачи и связанные серверные данные будут удалены без возможности восстановления.")
                AdminChoice("Заблокировать повторный вход", blacklist, !busy) { blacklist = it }
                Text("Для блокировки остаются только необратимые криптографические отпечатки Google ID и email.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(emailConfirmation, { emailConfirmation = it }, enabled = !busy, label = { Text("Введите email пользователя для подтверждения") }, modifier = Modifier.fillMaxWidth().testTag("admin-delete-email"))
            } }, confirmButton = { TextButton(enabled = !busy && AdminProtocol.canDelete(user, emailConfirmation), onClick = { run {
                require(AdminProtocol.canDelete(user, emailConfirmation)); val id = AdminProtocol.userId(user.getString("id"))
                deleteUser(id, blacklist); pendingDelete = null; emailConfirmation = ""; refresh()
                message = if (blacklist) "Пользователь удалён и добавлен в чёрный список." else "Пользователь удалён."
            } }, modifier = Modifier.testTag("admin-delete-confirm")) { Text(if (blacklist) "Удалить и заблокировать" else "Удалить") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { pendingDelete = null; emailConfirmation = "" }) { Text("Отмена") } })
    }
}

@Composable private fun adminCount(label: String, count: Int) = genesisTranslate(label) + ": " + count

private fun adminFeatureName(id: String): String = when (id) {
    "menu.today" -> "Сегодня"; "menu.tasks" -> "Задачи"; "menu.projects" -> "Проекты"; "menu.calendar" -> "Календарь"; "menu.habits" -> "Привычки"; "menu.sacred" -> "Оракул"; "menu.settings" -> "Настройки"
    "submenu.tasks.tasks" -> "Задачи · задачи"; "submenu.tasks.lists" -> "Задачи · списки"; "submenu.projects.personal" -> "Проекты · личные"; "submenu.projects.shared" -> "Проекты · общие"
    "submenu.calendar.month" -> "Календарь · месяц"; "submenu.calendar.year" -> "Календарь · год"; "submenu.habits.habits" -> "Привычки · трекер"; "submenu.habits.sleep" -> "Привычки · сон и настроение"
    "submenu.sacred.stoicheion" -> "Оракул · Стойхейон"; "submenu.sacred.theokyklos" -> "Оракул · Теокиклос"
    "submenu.settings.appearance" -> "Настройки · оформление"; "submenu.settings.habits" -> "Настройки · привычки"; "submenu.settings.reminders" -> "Настройки · напоминания"; "submenu.settings.shared" -> "Настройки · общие проекты"
    "submenu.settings.region" -> "Настройки · регион"; "submenu.settings.account" -> "Настройки · аккаунт"; "submenu.settings.links" -> "Настройки · ссылки"
    "calendar.profane" -> "Григорианский календарь"; "calendar.sacred" -> "Сакральный календарь"; "calendar.lunar" -> "Лунный календарь"
    else -> id.removePrefix("submenu.").replace(".", " · ")
}
