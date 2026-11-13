package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
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
import ru.genesis.calendar.domain.habits.HabitAutoDeletePolicy

@Composable internal fun HabitAutoDeleteFields(value: HabitAutoDeletePolicy?, enabled: Boolean,
    onChange: (HabitAutoDeletePolicy?) -> Unit, onValidity: (Boolean) -> Unit) {
    val context=LocalContext.current
    val language=LocalGenesisLanguage.current
    val copy=remember(context,language) { context.assets.open("originals/i18n/habit-auto-delete-copy.json").bufferedReader(Charsets.UTF_8)
        .use { JSONObject(it.readText()).getJSONObject(language) } }
    var draft by remember { mutableStateOf(value ?: HabitAutoDeletePolicy()) }
    var count by remember { mutableStateOf(draft.count.toString()) }
    val valid=count.toIntOrNull()?.let { it in 1..365 } == true && count.all(Char::isDigit)
    LaunchedEffect(value != null,valid) { onValidity(value == null || valid) }
    Column(Modifier.fillMaxWidth().testTag("habit-auto-delete-settings"), verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("habit-auto-delete-enabled")
            .toggleable(value != null,enabled=enabled,role=Role.Switch) { checked -> onChange(if(checked) draft else null) },
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            UntranslatedText(copy.getString("enabled"),Modifier.weight(1f))
            Switch(value != null,null,enabled=enabled)
        }
        if(value != null) {
            OutlinedTextField(count,{ text ->
                count=text
                text.toIntOrNull()?.takeIf { it in 1..365 && text.all(Char::isDigit) }?.let {
                    draft=draft.copy(count=it);onChange(draft)
                }
            },label={UntranslatedText(copy.getString("count"))},enabled=enabled,isError=!valid,
                supportingText=if(!valid) { { UntranslatedText(copy.getString("range")) } } else null,
                singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.fillMaxWidth().testTag("habit-auto-delete-count"))
            UntranslatedText(copy.getString("unit"),style=MaterialTheme.typography.labelLarge)
            listOf("days","weeks","months").forEach { unit ->
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("habit-auto-delete-$unit")
                    .toggleable(draft.unit==unit,enabled=enabled,role=Role.RadioButton) { draft=draft.copy(unit=unit);onChange(draft) },verticalAlignment=Alignment.CenterVertically) {
                    RadioButton(draft.unit==unit,null,enabled=enabled)
                    UntranslatedText(copy.getString(unit),Modifier.weight(1f))
                }
            }
            UntranslatedText(copy.getString("points"),style=MaterialTheme.typography.labelLarge)
            listOf("keep","remove").forEach { points ->
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("habit-auto-delete-$points")
                    .toggleable(draft.points==points,enabled=enabled,role=Role.RadioButton) { draft=draft.copy(points=points);onChange(draft) },verticalAlignment=Alignment.CenterVertically) {
                    RadioButton(draft.points==points,null,enabled=enabled)
                    UntranslatedText(copy.getString(points),Modifier.weight(1f))
                }
            }
            UntranslatedText(copy.getString("hint"),style=MaterialTheme.typography.bodySmall)
        }
    }
}
