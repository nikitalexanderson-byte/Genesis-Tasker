package ru.genesis.calendar.auth

import ru.genesis.calendar.ui.AlertDialog

import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.FilterChip

/** Server-owned routing; account-scoped task edits are synchronized via the native outbox. */
@Composable
internal fun MultiAccountPanel(state: AuthPanelState, controller: AuthController, showHeading: Boolean = true) {
    val settings = state.accountSettings ?: return
    val context = LocalContext.current
    val local = settings.authProvider != "google"
    var draft by remember { mutableStateOf(settings.routing) }
    var removeCandidate by remember { mutableStateOf<LinkedGoogleAccount?>(null) }
    LaunchedEffect(settings) { draft = settings.routing }

    if (showHeading) {
        HorizontalDivider()
        Text(if (local) "Связанные аккаунты" else "Несколько Google-аккаунтов", style = MaterialTheme.typography.titleMedium)
        Text("Связанные аккаунты и правила отправки задач в GENESIS.", style = MaterialTheme.typography.bodySmall)
    }
    settings.accounts.forEach { account ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(account.displayName.ifBlank { account.email }, style = MaterialTheme.typography.titleSmall)
                Text(account.email, style = MaterialTheme.typography.bodySmall)
                Text(buildString {
                    append(if (account.isPrimary) "Основной" else "Дополнительный")
                    append(" · ")
                    append(if (local) account.provider.uppercase() else "Google")
                    append(" · Calendar: ")
                    append(if (account.calendarConnected) "подключён" else "не подключён")
                }, style = MaterialTheme.typography.labelSmall)
                if (!local && !account.isPrimary) TextButton(onClick = { removeCandidate = account }, enabled = !state.busy,
                    modifier = Modifier.testTag("linked-account-remove")) { Text("Отключить") }
            }
        }
    }
    Text(if (local) "Дополнительные аккаунты подключаются в кабинете сайта. Если у них уже есть данные GENESIS, сайт попросит подтвердить объединение. Google остаётся отдельным."
        else "Дополнительные Google-аккаунты подключаются через защищённый веб-поток. В браузере войдите в тот же кабинет GENESIS, затем вернитесь в приложение.",
        style = MaterialTheme.typography.bodySmall)
    OutlinedButton(onClick = {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${AUTH_ORIGIN}/?account_link=1#settings")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }, modifier = Modifier.fillMaxWidth().testTag("linked-account-open-site")) { Text("Открыть подключение на сайте") }
    OutlinedButton(onClick = controller::checkSession, enabled = !state.busy,
        modifier = Modifier.fillMaxWidth().testTag("linked-account-refresh")) { Text("Обновить аккаунты") }

    if (settings.multiAccountEnabled && settings.accounts.size > 1) {
        HorizontalDivider()
        Text("Куда отправлять новые задачи", style = MaterialTheme.typography.titleSmall)
        listOf(
            "fixed" to "Заранее выбранные",
            "choose" to "По выбору при создании",
            "category" to "По категории проекта",
        ).forEach { (mode, label) ->
            FilterChip(selected = draft.mode == mode, onClick = { draft = draft.copy(mode = mode) },
                label = { Text(label) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("routing-mode-$mode"))
        }
        if (draft.mode == "choose") Text(if (local) "При создании задачи выберите один или несколько связанных аккаунтов. Пока правило не сохранено, используется прежняя маршрутизация."
            else "При создании задачи выберите один или несколько Google-аккаунтов. Пока правило не сохранено, используется прежняя маршрутизация.",
            style = MaterialTheme.typography.bodySmall)
        Text(if (draft.mode == "fixed") "Аккаунты для новых задач" else "Аккаунты по умолчанию",
            style = MaterialTheme.typography.titleSmall)
        settings.accounts.forEach { account ->
            AccountCheckRow(account.email, draft.defaultAccountIds.contains(account.id), !state.busy,
                "routing-default-${account.id}") { checked ->
                draft = draft.copy(defaultAccountIds = draft.defaultAccountIds.toggle(account.id, checked))
            }
        }
        if (draft.mode == "category") {
            Text("Категории и аккаунты", style = MaterialTheme.typography.titleSmall)
            val categories = state.preview?.categoryItems.orEmpty()
            if (state.preview == null) {
                Text("Категории появятся автоматически после загрузки зашифрованного пространства.",
                    style = MaterialTheme.typography.bodySmall)
            } else if (categories.isEmpty()) {
                Text("В облачном пространстве пока нет категорий. Будут использованы аккаунты по умолчанию.",
                    style = MaterialTheme.typography.bodySmall)
            }
            categories.forEach { category ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val color = runCatching { Color(AndroidColor.parseColor(category.color)) }
                                .getOrDefault(MaterialTheme.colorScheme.primary)
                            Box(Modifier.size(12.dp).background(color, CircleShape))
                            Text(category.name, style = MaterialTheme.typography.titleSmall)
                        }
                        settings.accounts.forEach { account ->
                            AccountCheckRow(account.email,
                                draft.categoryAccountIds[category.id].orEmpty().contains(account.id), !state.busy,
                                "routing-category-${category.id}-${account.id}") { checked ->
                                val selected = draft.categoryAccountIds[category.id].orEmpty().toggle(account.id, checked)
                                draft = draft.copy(categoryAccountIds = draft.categoryAccountIds + (category.id to selected))
                            }
                        }
                    }
                }
            }
        }
        Button(onClick = { controller.saveRouting(draft) },
            enabled = !state.busy && draft != settings.routing && draft.validFor(settings.accounts),
            modifier = Modifier.fillMaxWidth().testTag("routing-save")) { Text("Сохранить маршрутизацию") }
        Text(if (local) "Правила сохраняются в GENESIS. Напоминания устройства остаются локальными; выбранный Яндекс.Календарь доставляет свои календарные уведомления. Аккаунты без календаря хранят задачи в GENESIS."
            else "Правила сохраняются в аккаунте сайта. Изменения задач Android отправляются в Google через GENESIS; если сеть недоступна, они остаются в защищённой очереди на устройстве.",
            style = MaterialTheme.typography.bodySmall)
    }

    removeCandidate?.let { account ->
        AlertDialog(onDismissRequest = { removeCandidate = null },
            title = { Text("Отключить аккаунт?") },
            text = { Text("${account.email} больше не будет связан с GENESIS. Уже созданные события и задачи останутся в Google.") },
            confirmButton = { TextButton(onClick = { removeCandidate = null; controller.removeLinkedAccount(account.id) }) {
                Text("Отключить")
            } },
            dismissButton = { TextButton(onClick = { removeCandidate = null }) { Text("Отмена") } })
    }
}

@Composable
private fun AccountCheckRow(label: String, checked: Boolean, enabled: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().testTag(tag), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onChange, enabled = enabled)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun List<String>.toggle(id: String, selected: Boolean): List<String> =
    if (selected) (this + id).distinct() else filterNot { it == id }
