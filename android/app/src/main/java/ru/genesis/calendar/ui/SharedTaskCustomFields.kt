package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.CustomFieldDraft
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.CalendarMode
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** One task form and one save button. User-authored names and values never pass through translation. */
@Composable internal fun SharedTaskCustomFields(task: JSONObject, details: JSONObject, binding: SharedTaskCustomBinding,
    prefs: UiPreferences, canEdit: Boolean, disabled: Boolean, onChange: (JSONObject) -> Unit, onRefresh: () -> Unit) {
    val draft = binding.draft
    val changed = draft?.changedIds(binding.fields).orEmpty()
    val visible = binding.fields.filter { field ->
        val id = field.getString("id")
        (field.getBoolean("showCard") || canEdit && (field.getBoolean("required") || id in changed || id in binding.errors)) &&
            (!field.getBoolean("archived") || !CustomFieldProtocol.absent(draft?.value(id)) || id in changed)
    }
    val unknownChanges = changed.filter { id -> binding.fields.none { it.getString("id") == id } }
    if (visible.isEmpty() && unknownChanges.isEmpty() && binding.error == null && binding.errors.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("shared-custom-fields"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val boundary = binding.error ?: binding.errors["@snapshot"]
        if (boundary != null) {
            Text(customFieldMessage(boundary) ?: "Проверьте тип и значение пользовательского поля.",
                color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("shared-custom-error"), style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onRefresh, enabled = !disabled, modifier = Modifier.heightIn(min = 48.dp).testTag("shared-custom-refresh")) {
                AffairsActionIcon(AffairsAction.REFRESH); Spacer(Modifier.width(8.dp)); Text("Обновить")
            }
            // Only an explicit local reset may replace a malformed saved custom draft.
            if (canEdit && runCatching { CustomFieldDraft.fromTask(task) }.isSuccess &&
                runCatching { sharedTaskCustomDraft(task, details); sharedCustomCalendar(details, prefs) }.isFailure) {
                TextButton({ onChange(initialSharedTaskCustom(task, details, prefs)) }, enabled = !disabled,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("shared-custom-reset")) { Text("Сбросить") }
            }
        }
        if (draft != null && binding.calendar != null) {
            val required = if (canEdit) visible.filter { it.getBoolean("required") && !it.getBoolean("archived") } else emptyList()
            val optional = visible.filterNot { it in required }
            @Composable fun Fields(rows: List<JSONObject>) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val columns = if (maxWidth >= 600.dp) 2 else 1
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        rows.chunked(columns).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            row.forEach { field -> key(field.getString("id")) {
                                SharedCustomField(field, draft, binding.errors[field.getString("id")], field.getString("id") in changed,
                                    binding.calendar, canEdit, disabled || boundary != null, Modifier.weight(1f),
                                    onValue = { id, value -> onChange(sharedTaskWithCustomFields(task, details, draft.change(id, value))) },
                                    onReset = { id -> onChange(sharedTaskWithCustomFields(task, details, draft.reset(id))) },
                                    onCalendar = { next -> onChange(JSONObject(details.toString()).put(SHARED_CUSTOM_CALENDAR_KEY, next.saved())) })
                            } }
                            if (row.size < columns) Spacer(Modifier.weight(1f))
                        } }
                    }
                }
            }
            if (required.isNotEmpty()) {
                Text("Обязательные поля", style = MaterialTheme.typography.titleSmall)
                Fields(required)
            }
            if (optional.isNotEmpty()) AffairsDisclosure("Пользовательские поля", Modifier.testTag("shared-custom-optional")) {
                var limit by rememberSaveable(task.optString("id")) { mutableIntStateOf(5) }
                Fields(optional.take(limit))
                if (optional.size > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("shared-custom-more")) { Text("Показать ещё") }
            }
            unknownChanges.forEach { id -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                UntranslatedText(id, style = MaterialTheme.typography.labelMedium)
                Text("Поле больше недоступно. Обновите данные; черновик сохранён.", color = MaterialTheme.colorScheme.error)
                TextButton({ onChange(sharedTaskWithCustomFields(task, details, draft.reset(id))) }, enabled = canEdit && !disabled,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("shared-custom-$id-reset")) { Text("Сбросить") }
            } }
        }
    }
}

internal fun customDisplay(field: JSONObject, value: Any?, language: String, calendar: SharedCustomCalendar, unavailable: String): String? {
    if (CustomFieldProtocol.absent(value)) return null
    return when (value) {
        is Number -> NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 12 }.format(value)
        is Boolean -> null // Rendered using translated system labels by the caller.
        else -> when (field.getString("type")) {
            "select", "multi" -> {
                val ids = if (value is JSONArray) (0 until value.length()).map { value.getString(it) } else listOf(value.toString())
                val options = importRows(field.getJSONArray("options")).associateBy { it.getString("id") }
                ids.joinToString(", ") { options[it]?.getString("title") ?: unavailable }
            }
            "date" -> runCatching { GenesisCalendar(ZoneId.of(calendar.context.timeZone), calendar.context.version,
                calendar.context.gregorianYearStart).formatDate(LocalDate.parse(value.toString()), calendar.mode) }.getOrDefault(value.toString())
            else -> value.toString()
        }
    }
}

@Composable internal fun SharedCustomField(field: JSONObject, draft: CustomFieldDraft, error: String?, changed: Boolean, calendar: SharedCustomCalendar,
    canEdit: Boolean, disabled: Boolean, modifier: Modifier, onValue: (String, Any?) -> Unit, onReset: (String) -> Unit,
    onCalendar: (SharedCustomCalendar) -> Unit) {
    val id = field.getString("id"); val title = field.getString("title"); val type = field.getString("type")
    val value = draft.value(id); val archived = field.getBoolean("archived"); val editable = canEdit && !archived
    val enabled = editable && !disabled; val tag = "shared-custom-$id"
    val language = LocalGenesisLanguage.current
    val unavailable = genesisTranslate("Недоступный вариант")
    val sacredFeatures = LocalSacredFeaturesEnabled.current
    val dateCalendar = if (sacredFeatures) calendar else calendar.copy(mode = CalendarMode.PROFANE)
    val uri = LocalUriHandler.current
    val focus = LocalFocusManager.current
    var linkError by remember { mutableStateOf(false) }
    Column(modifier.testTag("$tag-field"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            UntranslatedText(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            if (enabled && !CustomFieldProtocol.absent(value)) AffairsIconButton("Очистить", AffairsAction.CLOSE,
                { onValue(id, null) }, Modifier.testTag("$tag-clear"))
        }
        if (archived) Text("Архив", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!editable) {
            val label = when { CustomFieldProtocol.absent(value) -> genesisTranslate("Не задано")
                value is Boolean -> genesisTranslate(if (value) "Да" else "Нет")
                type == "date" -> genesisTranslate(customDisplay(field, value, language, dateCalendar, unavailable).orEmpty())
                else -> customDisplay(field, value, language, calendar, unavailable).orEmpty() }
            UntranslatedText(label, Modifier.testTag("$tag-value"), style = MaterialTheme.typography.bodyMedium)
        } else when (type) {
            "text", "number", "url" -> OutlinedTextField(if (CustomFieldProtocol.absent(value)) "" else value.toString(),
                { onValue(id, it.take(5000)) }, enabled = enabled, isError = error != null, singleLine = type != "text",
                minLines = if (type == "text") 2 else 1, maxLines = if (type == "text") 5 else 1,
                keyboardOptions = KeyboardOptions(keyboardType = when (type) { "number" -> KeyboardType.Decimal; "url" -> KeyboardType.Uri; else -> KeyboardType.Text },
                    imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
                textStyle = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.fillMaxWidth().testTag(tag).semantics { contentDescription = title })
            "checkbox" -> {
                val unspecified = genesisTranslate("Не задано"); val yes = genesisTranslate("Да"); val no = genesisTranslate("Нет")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(null to unspecified, true to yes, false to no).forEach { (option, label) ->
                        FilterChip(selected = if (option == null) CustomFieldProtocol.absent(value) else value == option,
                            onClick = { onValue(id, option) }, enabled = enabled,
                            label = { UntranslatedText(label) }, modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-${option ?: "unset"}"))
                    }
                }
            }
            "select" -> {
                val options = importRows(field.getJSONArray("options"))
                val previous = draft.previous(id)
                ImportChoice(title, value as? String ?: "@unset", listOf("@unset" to genesisTranslate("Не задано")) +
                    options.filter { !it.getBoolean("archived") || it.getString("id") == previous }.map { option ->
                        option.getString("id") to (option.getString("title") + if (option.getBoolean("archived")) " · " + genesisTranslate("Архив") else "")
                    } + if (value is String && options.none { it.getString("id") == value }) listOf(value to unavailable) else emptyList(), enabled, tag, userLabel = true, showLabel = false) { onValue(id, it.takeUnless { it == "@unset" }) }
            }
            "multi" -> {
                val selected = (value as? JSONArray)?.let { rows -> (0 until rows.length()).map(rows::getString) }.orEmpty()
                val previous = (draft.previous(id) as? JSONArray)?.let { rows -> (0 until rows.length()).map(rows::getString) }.orEmpty()
                val options = importRows(field.getJSONArray("options")).filter { !it.getBoolean("archived") || it.getString("id") in previous }
                val summary = customDisplay(field, value, language, calendar, unavailable) ?: genesisTranslate("Не задано")
                UntranslatedText(summary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("$tag-value"))
                AffairsDisclosure("Варианты", Modifier.testTag(tag)) {
                    var limit by rememberSaveable(id) { mutableIntStateOf(5) }
                    options.take(limit).forEach { option ->
                        val key = option.getString("id")
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(key in selected, { checked -> onValue(id, JSONArray((selected.filterNot { it == key } + if (checked) listOf(key) else emptyList()).distinct())) },
                                enabled = enabled, modifier = Modifier.testTag("$tag-$key").semantics { contentDescription = title + ": " + option.getString("title") })
                            Column(Modifier.weight(1f)) {
                                UntranslatedText(option.getString("title"), style = MaterialTheme.typography.bodyMedium)
                                if (option.getBoolean("archived")) Text("Архив", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    if (options.size > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .testTag("$tag-more")) { Text("Показать ещё") }
                }
            }
            "date" -> {
                val date = (value as? String)?.takeIf { runCatching { LocalDate.parse(it) }.isSuccess }.orEmpty()
                AuthorDatePicker(date, dateCalendar.mode, calculationContext = dateCalendar.context, enabled = enabled,
                    placeholder = "Выберите дату", modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag), onChange = { onValue(id, it) })
                if (sacredFeatures) AffairsDisclosure("Календарь ввода", Modifier.testTag("$tag-calendar")) {
                    EditorCalendarModePicker(calendar.mode, { onCalendar(calendar.copy(mode = it)) }, enabled,
                        preferredMode = calendar.mode, tag = "$tag-mode")
                }
            }
        }
        if (type == "url" && !CustomFieldProtocol.absent(value) && runCatching { CustomFieldProtocol.normalize(field, value, draft.previous(id)) }.isSuccess) {
            OutlinedButton({ linkError = runCatching { uri.openUri(value.toString()) }.isFailure }, enabled = !disabled,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-open")) {
                AffairsActionIcon(AffairsAction.VIEW); Spacer(Modifier.width(8.dp)); Text("Открыть")
            }
        }
        if (error != null) Text(customFieldMessage(error) ?: "Проверьте тип и значение пользовательского поля.",
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("$tag-error"))
        if (linkError) Text("Не удалось открыть ссылку в браузере.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        if (changed) TextButton({ onReset(id) }, enabled = canEdit && !disabled, modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-reset")) {
            AffairsActionIcon(AffairsAction.UNDO); Spacer(Modifier.width(6.dp)); Text("Сбросить")
        }
    }
}
