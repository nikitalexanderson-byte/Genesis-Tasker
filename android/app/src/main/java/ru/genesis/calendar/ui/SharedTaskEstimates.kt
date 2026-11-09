package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale
import org.json.JSONObject

@Composable
internal fun sharedPlanningCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val all = remember(context) {
        context.assets.open("originals/i18n/planning-translations.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
    }
    return remember(all, language) { all.optJSONObject(language) ?: all.getJSONObject("ru") }
}

/** The task card owns one save action; these fields contribute only changed estimate keys. */
@Composable
internal fun SharedTaskEstimates(task: JSONObject, details: JSONObject, planningEnabled: Boolean,
    canEdit: Boolean, disabled: Boolean, onChange: (JSONObject) -> Unit) {
    val draft = sharedTaskEstimates(task, details)
    if (!planningEnabled && !draft.dirty && task.isNull("storyPoints") && task.isNull("estimateHours")) return
    val copy = sharedPlanningCopy()
    val language = LocalGenesisLanguage.current
    val focus = LocalFocusManager.current
    val number = remember(language) { NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 2 } }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("shared-task-estimates"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        UntranslatedText(copy.getString("estimates"), style = MaterialTheme.typography.titleSmall)
        val editing = planningEnabled && canEdit || draft.dirty
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val wide = maxWidth >= 600.dp
            @Composable fun Field(key: String, raw: String, last: Boolean, change: (String) -> Unit, modifier: Modifier) {
                if (editing) {
                    val invalid = runCatching { parseSharedEstimate(raw) }.isFailure
                    OutlinedTextField(raw, change, modifier.testTag("shared-estimate-$key"), singleLine = true,
                        enabled = !disabled && canEdit, label = { UntranslatedText(copy.getString(key)) },
                        placeholder = { UntranslatedText(copy.getString("unestimated")) },
                        isError = invalid,
                        supportingText = if (invalid) ({ UntranslatedText(copy.getString("numbersInvalid")) }) else null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = if (last) ImeAction.Done else ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Next) }, onDone = { focus.clearFocus() }))
                } else Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(copy.getString(key), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val field = if (key == "points") "storyPoints" else "estimateHours"
                    UntranslatedText(if (task.isNull(field)) copy.getString("unestimated") else number.format(task.getDouble(field)),
                        modifier = Modifier.testTag("shared-estimate-$key-value"), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (wide) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Field("points", draft.storyPoints, false, { onChange(sharedTaskWithEstimates(details, draft.points(it))) }, Modifier.weight(1f))
                Field("hours", draft.estimateHours, true, { onChange(sharedTaskWithEstimates(details, draft.hours(it))) }, Modifier.weight(1f))
            } else Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Field("points", draft.storyPoints, false, { onChange(sharedTaskWithEstimates(details, draft.points(it))) }, Modifier.fillMaxWidth())
                Field("hours", draft.estimateHours, true, { onChange(sharedTaskWithEstimates(details, draft.hours(it))) }, Modifier.fillMaxWidth())
            }
        }
        UntranslatedText(copy.getString("independent"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (draft.dirty && !planningEnabled) UntranslatedText(copy.getString("disabled"), style = MaterialTheme.typography.bodySmall)
        if (draft.dirty && !canEdit) Text("Нет доступа", style = MaterialTheme.typography.bodySmall)
        if (draft.dirty) TextButton(onClick = { onChange(sharedTaskWithEstimates(details, SharedTaskEstimateDraft.fromTask(task))) },
            enabled = !disabled, modifier = Modifier.heightIn(min = 48.dp).testTag("shared-estimate-reset")) {
            UntranslatedText(copy.getString("resetEstimates"))
        }
    }
}
