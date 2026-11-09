package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.reminders.MoonReminderScheduler

@Composable
internal fun MoonReminderSettings(app: GenesisApplication, prefs: UiPreferences,
    onSetLocal: (String, String) -> Unit) {
    LaunchedEffect(app.workspaceScope, prefs.fullMoonLeadDays, prefs.newMoonLeadDays) {
        MoonReminderScheduler.restore(app)
    }
    SettingsSection("☾", "Лунные напоминания", "Отдельное напоминание о каждой фазе",
        Color(0xffe7e9f3), modifier = Modifier.testTag("moon-reminder-settings")) {
        Text("Полнолуние", style = MaterialTheme.typography.titleSmall)
        MoonLeadChoices("full", prefs.fullMoonLeadDays) { onSetLocal("fullMoonLeadDays", it.sorted().joinToString(",")) }
        Text("Новолуние", style = MaterialTheme.typography.titleSmall)
        MoonLeadChoices("new", prefs.newMoonLeadDays) { onSetLocal("newMoonLeadDays", it.sorted().joinToString(",")) }
        Text("Выберите один или несколько сроков. Каждое уведомление приходит в 09:00 по времени устройства.",
            style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun MoonLeadChoices(kind: String, selected: Set<Int>, onSelect: (Set<Int>) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        (0..3).forEach { days ->
            val active = if(days==0) selected.isEmpty() else days in selected
            Surface(onClick = { onSelect(if(days==0) emptySet() else if(active) selected-days else selected+days) },
                modifier = Modifier.weight(1f).height(48.dp).testTag("moon-$kind-lead-$days")
                    .semantics { this.selected = active },
                shape = AffairsLayout.shape,
                color = selectedControlContainer(active), contentColor = MaterialTheme.colorScheme.onSurface,
                border = selectedControlBorder(active, fallback = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant))) {
                Box(Modifier.fillMaxSize().padding(horizontal = 2.dp), contentAlignment = Alignment.Center) {
                    CompactChoiceLabel(when (days) {
                        0 -> "Выключено"
                        1 -> "За 1 сутки"
                        2 -> "За 2 суток"
                        else -> "За 3 суток"
                    })
                }
            }
        }
    }
}
