package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*

/** The same settings drive real effects and this non-destructive test. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun HabitFeedbackSoundSettings(app: GenesisApplication, settings: HabitFeedbackSettings,
    enabled: Boolean, onChange: (HabitFeedbackSettings) -> Unit) {
    val copy = feedbackCopy()
    val language = LocalGenesisLanguage.current
    val player = remember(app) { HabitFeedbackPlayer(app) }
    DisposableEffect(player) { onDispose { player.close() } }
    var kind by remember { mutableStateOf("completion") }
    var notificationStatus by remember { mutableStateOf<String?>(null) }
    Text(copy.getString("schemes"), style = MaterialTheme.typography.titleSmall)
    habitSoundSchemes.forEach { scheme ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).heightIn(min = 64.dp)
                .selectable(settings.soundScheme == scheme, enabled = enabled, role = Role.RadioButton,
                    onClick = { onChange(settings.copy(soundScheme = scheme)) }).testTag("feedback-scheme-$scheme"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RadioButton(settings.soundScheme == scheme, onClick = null, enabled = enabled)
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    Text(copy.getString(scheme), style = MaterialTheme.typography.titleSmall)
                    Text(copy.getString(scheme + "Hint"), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton({ player.play(scheme, kind) }, enabled = enabled,
                modifier = Modifier.size(48.dp).testTag("feedback-listen-$scheme")
                    .genesisDescription(copy.getString("listen") + " · " + copy.getString(scheme))) {
                GenesisLucideIcon("play")
            }
        }
    }
    Text(copy.getString("soundHint"), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    HorizontalDivider()
    Text(copy.getString("events"), style = MaterialTheme.typography.titleSmall)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        habitFeedbackKinds.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { value ->
                    FilterChip(kind == value, { kind = value }, enabled = enabled,
                        label = { Text(copy.getString(value), style = MaterialTheme.typography.labelMedium) },
                        modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("feedback-event-$value"))
                }
            }
        }
    }
    Button({ app.offerHabitFeedback(HabitFeedbackEvent(app.workspaceScope, kind, copy.getString("test"), settings)) },
        enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("feedback-test")) {
        Text(copy.getString("test"))
    }
    Text(copy.getString("testHint"), style = MaterialTheme.typography.bodySmall)
    OutlinedButton({
        val sent = app.scheduler.showFeedbackPreviewNotification(language, copy.getString("test"), copy.getString("testHint"))
        notificationStatus = if (sent) "notificationSent" else "notificationBlocked"
    }, enabled = enabled && settings.achievementPopups,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("feedback-notification-test")) {
        Text(copy.getString("testNotification"))
    }
    notificationStatus?.let { Text(copy.getString(it), Modifier.testTag("feedback-notification-status"),
        color = if (it == "notificationBlocked") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) }
}

@Composable internal fun HabitFeedbackControls(app: GenesisApplication, settings: HabitFeedbackSettings,
    enabled: Boolean, onChange: (HabitFeedbackSettings) -> Unit) {
    FeedbackSwitch("Короткие анимации", "Плавный отклик галочки, карточки и прогресса.", settings.animations, enabled,
        "habit-feedback-animations") { onChange(settings.copy(animations = it)) }
    FeedbackSwitch("Звук выполнения", "Короткий локальный сигнал; не загружается с сервера.", settings.sound, enabled,
        "habit-feedback-sound") { onChange(settings.copy(sound = it)) }
    FeedbackSwitch("Тактильный отклик", "Лёгкая вибрация на поддерживаемых устройствах.", settings.haptics, enabled,
        "habit-feedback-haptics") { onChange(settings.copy(haptics = it)) }
    FeedbackSwitch("Уведомления о достижениях", "Показывать новое достижение в уведомлении о выполнении.", settings.achievementPopups, enabled,
        "habit-feedback-achievements") { onChange(settings.copy(achievementPopups = it)) }
    FeedbackSwitch("Испытания", "Создавать и показывать ежедневные, недельные и эпические испытания.", settings.questsEnabled, enabled,
        "habit-feedback-quests") { onChange(settings.copy(questsEnabled = it)) }
    FeedbackSwitch("Игровые блоки", "Показывать ранги, Лавры, награды серии и достижения.", settings.gamificationWidgets, enabled,
        "habit-feedback-gamification") { onChange(settings.copy(gamificationWidgets = it)) }
    HabitFeedbackSoundSettings(app, settings, enabled, onChange)
}
