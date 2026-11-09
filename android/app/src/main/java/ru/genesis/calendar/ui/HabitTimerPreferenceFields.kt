package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.HabitTimerPreferences

@Composable internal fun HabitTimerPreferenceFields(enabled: Boolean, onEnabled: (Boolean) -> Unit,
    preferences: HabitTimerPreferences, editable: Boolean, onChange: (HabitTimerPreferences) -> Unit, onValidity: (Boolean) -> Unit) {
    val allowed = LocalFeatureAccess.current.allows("habit-timer")
    val canEdit = editable && allowed
    val context = LocalContext.current; val language = LocalGenesisLanguage.current
    val copy = remember(context, language) { context.assets.open("originals/i18n/habit-timer-preferences-copy.json")
        .bufferedReader().use { JSONObject(it.readText()).getJSONObject(language) } }
    var work by remember(preferences.workMinutes) { mutableStateOf(preferences.workMinutes.toString()) }
    var rest by remember(preferences.breakMinutes) { mutableStateOf(preferences.breakMinutes.toString()) }
    val workValue = work.toIntOrNull(); val restValue = rest.toIntOrNull()
    val valid = !enabled || "pomodoro" !in preferences.modes || workValue in 1..180 && restValue in 0..120
    SideEffect { onValidity(valid) }
    Column(Modifier.fillMaxWidth().testTag("habit-timer-preferences"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!allowed) NativeUpgradePrompt("habit-timer")
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-timer-enabled").toggleable(enabled, enabled = canEdit, role = Role.Switch, onValueChange = onEnabled),
            verticalAlignment = Alignment.CenterVertically) {
            UntranslatedText(copy.getString("enabled"), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            Switch(enabled, null, enabled = canEdit)
        }
        if (enabled) {
            UntranslatedText(copy.getString("modes"), style = MaterialTheme.typography.labelLarge)
            listOf("stopwatch" to "Секундомер", "pomodoro" to "Pomodoro").forEach { (mode, label) ->
                val checked = mode in preferences.modes
                val canChange = canEdit && (!checked || preferences.modes.size > 1)
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-timer-allow-$mode")
                    .toggleable(checked, enabled = canChange, role = Role.Checkbox) { value ->
                        onChange(preferences.copy(modes = listOf("stopwatch", "pomodoro").filter { if (it == mode) value else it in preferences.modes }))
                    }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked, null, enabled = canChange); Text(label)
                }
            }
            if ("pomodoro" in preferences.modes) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(work, { work = it.take(3); it.toIntOrNull()?.takeIf { n -> n in 1..180 }?.let { n -> onChange(preferences.copy(workMinutes = n)) } },
                    modifier = Modifier.weight(1f).testTag("habit-timer-work"), enabled = canEdit, isError = workValue !in 1..180,
                    label = { Text("Рабочий интервал, мин") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(rest, { rest = it.take(3); it.toIntOrNull()?.takeIf { n -> n in 0..120 }?.let { n -> onChange(preferences.copy(breakMinutes = n)) } },
                    modifier = Modifier.weight(1f).testTag("habit-timer-rest"), enabled = canEdit, isError = restValue !in 0..120,
                    label = { Text("Перерыв, мин") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
            }
            listOf("duration", "time-only").forEach { progress ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-timer-progress-$progress")
                    .selectable(preferences.progress == progress, enabled = canEdit, role = Role.RadioButton) { onChange(preferences.copy(progress = progress)) },
                    verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(preferences.progress == progress, null, enabled = canEdit)
                    UntranslatedText(copy.getString(if (progress == "duration") "duration" else "timeOnly"))
                }
            }
            UntranslatedText(copy.getString("hint"), style = MaterialTheme.typography.bodySmall)
        }
    }
}
