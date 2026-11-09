package ru.genesis.calendar.ui

import android.Manifest
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
internal fun HabitSettingsPanel(app: GenesisApplication, use24: Boolean,
    dreamJournalEnabled: Boolean = true, dreamJournalToggleEnabled: Boolean = false,
    onDreamJournalEnabled: (Boolean) -> Unit = {}) {
    val repository = remember(app, app.workspaceScope) { HabitsRepository(app) }
    val trackers = remember(app, app.workspaceScope) { TrackersRepository(app) }
    val workspace by repository.workspace.collectAsStateWithLifecycle(LocalHabitWorkspace())
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var resetConfirmation by remember { mutableStateOf(false) }
    fun save(settings: HabitSettings, afterSave: () -> Unit = {}) {
        scope.launch {
            busy = true
            runCatching { repository.updateSettings(settings) }
                .onFailure { error = "Не удалось сохранить настройки привычек." }
                .onSuccess { error = null; afterSave() }
            busy = false
        }
    }
    val language = LocalGenesisLanguage.current
    val english = language == "en"
    val requestAccess = rememberRequestNotificationAccess(app) { granted ->
        if(granted) save(workspace.settings.copy(notifications = workspace.settings.notifications.copy(enabled = true)))
    }
    val settings = workspace.settings

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        HabitPreferenceCard("ЕЖЕДНЕВНАЯ ПРАКТИКА", "Трекинг привычек", "habit-tracking-settings") {
            PreferenceSwitchRow("Включить трекер привычек",
                "Показывает страницу «Привычки», настроение и прогресс. При отключении зашифрованные записи сохраняются.",
                settings.enabled, !busy, "habit-tracking-enabled") {
                save(settings.copy(enabled = it))
            }
            Text(if (settings.enabled) "Трекинг привычек включён" else "Трекинг привычек скрыт",
                style = MaterialTheme.typography.labelMedium,
                color = if (settings.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider()
            PreferenceActionRow("Стартовые привычки",
                if (workspace.hiddenDefaultTemplates.isEmpty()) "Все стандартные предложения доступны"
                else "Скрыто предложений: ${workspace.hiddenDefaultTemplates.size}",
                "Восстановить стандартные", workspace.hiddenDefaultTemplates.isNotEmpty() && !busy,
                "habit-templates-restore") { scope.launch { repository.restoreDefaultTemplates() } }
            HorizontalDivider()
            PreferenceActionRow("Обнуление трекера",
                "Безвозвратно удалит привычки, сон, настроение, статистику, XP и лавры. Настройки аккаунта и календаря сохранятся.",
                "Обнулить все привычки", !busy, "habit-tracking-reset", destructive = true) {
                resetConfirmation = true
            }
        }

        LocalDreamRepository.current?.let { diary ->
            val dreamText=dreamCopy()
            HabitPreferenceCard("Сон", dreamText.getString("title"), "sleep-settings") {
                PreferenceSwitchRow(dreamText.getString("enabledLabel"),dreamText.getString("enabledHint"),
                    dreamJournalEnabled,dreamJournalToggleEnabled,"dream-journal-enabled",onDreamJournalEnabled)
                DreamJournalSettings(diary,dreamJournalEnabled)
            }
        }

        HabitPreferenceCard("МОТИВАЦИЯ НА УСТРОЙСТВЕ", "Уведомления привычек", "habit-notification-settings") {
            Text("Каждая привычка напоминает о себе в выбранное время. Дневная цель настраивается отдельно; тихие часы можно переопределить для отдельной привычки.",
                style = MaterialTheme.typography.bodySmall)
            val notificationsAllowed = rememberNotificationsAllowed(app)
            val personalEnabled = workspace.habits.any { it.reminder.enabled }
            HabitNotificationAccessNotice(app,personalEnabled)
            PreferenceSwitchRow("Общие напоминания о дневной цели",
                "Личные напоминания включаются внутри каждой привычки и работают независимо от этого переключателя.",
                settings.notifications.enabled && notificationsAllowed, !busy, "habit-notifications-enabled") { enabled ->
                if (!enabled) save(settings.copy(notifications = settings.notifications.copy(enabled = false)))
                else if (!notificationsAllowed) {
                    save(settings.copy(notifications = settings.notifications.copy(enabled = true)))
                    requestAccess()
                }
                else save(settings.copy(notifications = settings.notifications.copy(enabled = true)))
            }
            Text(when {
                !notificationsAllowed -> "Разрешение Android выключено"
                settings.notifications.enabled -> "Общие напоминания включены"
                personalEnabled -> "Личные напоминания включены · общие выключены"
                else -> "Напоминания не включены"
            }, style = MaterialTheme.typography.labelMedium,
                color = if (settings.notifications.enabled && notificationsAllowed) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Поведение уведомлений", style = MaterialTheme.typography.titleSmall)
            var frequency by remember(app.workspaceScope) { mutableStateOf(
                ru.genesis.calendar.reminders.habitReminderFrequency(app, app.workspaceScope)) }
            fun changeFrequency(value: ru.genesis.calendar.reminders.HabitReminderFrequency) {
                scope.launch {
                    busy = true
                    try {
                        ru.genesis.calendar.reminders.saveHabitReminderFrequency(app, app.workspaceScope, value)
                        frequency = value; app.scheduler.restoreHabitNotifications(); error = null
                    } catch (_: Exception) { error = "Не удалось сохранить настройки привычек." }
                    finally { busy = false }
                }
            }
            Text("Лимит напоминаний в день на этом устройстве", style = MaterialTheme.typography.bodyMedium)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(4, 12, 24, 64, 128).forEach { limit ->
                    FilterChip(frequency.maxPerDay == limit, { changeFrequency(frequency.copy(maxPerDay = limit)) },
                        border=choiceBorder(frequency.maxPerDay==limit,!busy),
                        enabled = !busy, label = { Text(limit.toString()) })
                }
            }
            Text("Отложить напоминание, минут", style = MaterialTheme.typography.bodyMedium)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(5, 10, 15, 30, 60).forEach { minutes ->
                    FilterChip(frequency.snoozeMinutes == minutes, { changeFrequency(frequency.copy(snoozeMinutes = minutes)) },
                        border=choiceBorder(frequency.snoozeMinutes==minutes,!busy),
                        enabled = !busy, label = { Text(minutes.toString()) })
                }
            }
            Row(Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("calm" to "Спокойный", "heroic" to "Героический", "ironic" to "С иронией").forEach { (value, label) ->
                    FilterChip(selected = settings.notifications.tone == value,
                        border=choiceBorder(settings.notifications.tone==value,!busy),
                        onClick = {
                            save(settings.copy(notifications = settings.notifications.copy(tone = value))) {
                                if (notificationsAllowed && !app.scheduler.showHabitTonePreview(value, language))
                                    error = "Android не разрешил показать пример уведомления."
                            }
                        },
                        enabled = !busy,
                        label = { CompactChoiceLabel(label) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                            .testTag("habit-notification-tone-$value"))
                }
            }
            if (notificationsAllowed) Text("При выборе стиля сразу появится тестовое уведомление с примером формулировки.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            TimePreference("Напоминание о дневной цели", settings.notifications.dailyGoalTime,
                use24, !busy) {
                save(settings.copy(notifications = settings.notifications.copy(dailyGoalTime = it)))
            }
            TimePreference("Начало тихих часов", settings.notifications.quietHoursStart,
                use24, !busy) {
                save(settings.copy(notifications = settings.notifications.copy(quietHoursStart = it)))
            }
            TimePreference("Конец тихих часов", settings.notifications.quietHoursEnd,
                use24, !busy) {
                save(settings.copy(notifications = settings.notifications.copy(quietHoursEnd = it)))
            }
            PreferenceSwitchRow("Напоминания о цели и серии",
                "Показываются только пока цель достижима; не стыдят и не отнимают прогресс.",
                settings.notifications.motivational, !busy,
                "habit-notifications-motivational") {
                save(settings.copy(notifications = settings.notifications.copy(motivational = it)))
            }
            Text("Аналитика уведомлений не содержит названий привычек и остаётся только на этом устройстве. Настройки хранятся внутри зашифрованного пространства.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if(Build.MANUFACTURER.equals("samsung", ignoreCase=true)) {
                Text("На Samsung добавьте GENESIS в «Никогда не спящие приложения», если включено автоматическое ограничение фоновой работы.",
                    style=MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={
                    val intent=Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
                        .putExtra("activity_type", 2).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { context.startActivity(intent) }.onFailure {
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            android.net.Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                },modifier=Modifier.fillMaxWidth().testTag("habit-samsung-background-settings")) { Text("Фоновая работа Samsung") }
            }
        }

        HabitPreferenceCard("ОТКЛИК И ДОСТУПНОСТЬ", "Отклик на выполнение", "habit-feedback-settings") {
            Text("Выберите, как GENESIS подтверждает выполнение привычки. Системное ограничение движения всегда имеет приоритет.",
                style = MaterialTheme.typography.bodyMedium)
            val enabled = settings.enabled && !busy
            HabitFeedbackControls(app, settings.feedback, enabled) { save(settings.copy(feedback = it)) }
            if (!settings.enabled) Text("Включите трекинг привычек, чтобы изменить эти настройки.",
                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }

    if (resetConfirmation) AlertDialog(onDismissRequest = { if (!busy) resetConfirmation = false },
        title = { Text("Обнулить трекер?") },
        text = { Text("Будут безвозвратно удалены привычки, отметки, сон, настроение, XP, награды и Лавры. Это действие нельзя отменить.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
            busy = true
            runCatching { repository.resetTracking(); trackers.resetTracking() }
                .onSuccess { resetConfirmation = false; error = null }
                .onFailure { error = "Не удалось обнулить трекер." }
            busy = false
        } }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
            Text("Обнулить")
        } },
        dismissButton = { TextButton(enabled = !busy, onClick = { resetConfirmation = false }) { Text("Отмена") } })
}

@Composable
private fun HabitPreferenceCard(eyebrow: String, title: String, tag: String,
    content: @Composable ColumnScope.() -> Unit) {
    SettingsPreferenceCard(title, Modifier.testTag(tag), eyebrow = eyebrow, content = content)
}

@Composable
private fun PreferenceSwitchRow(title: String, description: String, checked: Boolean, enabled: Boolean,
    tag: String, onChecked: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(description, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChecked, enabled = enabled,
            modifier = Modifier.testTag(tag))
    }
}

@Composable
internal fun FeedbackSwitch(title: String, description: String, checked: Boolean, enabled: Boolean,
    tag: String, onChecked: (Boolean) -> Unit) {
    PreferenceSwitchRow(title, description, checked, enabled, tag, onChecked)
    HorizontalDivider(color = Color(0x33b28a4a))
}

@Composable
private fun PreferenceActionRow(title: String, description: String, action: String, enabled: Boolean,
    tag: String, destructive: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(description, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag),
            colors = if (destructive) ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
            else ButtonDefaults.outlinedButtonColors()) { Text(action) }
    }
}

@Composable
private fun TimePreference(label: String, value: String, use24: Boolean, enabled: Boolean,
    onValue: (String) -> Unit) {
    val context = LocalContext.current
    val dialogTheme = if(LocalEveningTheme.current) android.R.style.Theme_DeviceDefault_Dialog else
        android.R.style.Theme_DeviceDefault_Light_Dialog
    val dialogFrame = genesisNativeDialogFrame()
    val time = runCatching { LocalTime.parse(value) }.getOrDefault(LocalTime.NOON)
    val display = time.format(DateTimeFormatter.ofPattern(if (use24) "HH:mm" else "hh:mm a", Locale.ENGLISH))
    OutlinedButton(onClick = {
        TimePickerDialog(context, dialogTheme, { _, hour, minute -> onValue("%02d:%02d".format(hour, minute)) },
            time.hour, time.minute, use24).also { it.show(); dialogFrame(it) }
    }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodySmall)
            Text(display, style = MaterialTheme.typography.titleSmall)
        }
    }
}
