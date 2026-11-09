package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTemplateProtocol
import ru.genesis.calendar.domain.GenesisCalendar
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** Resolve proposed values through current catalogs; opaque IDs are never substitute UI labels. */
@Composable internal fun AutomationEditorEffects(state: SharedAutomationEditorState, effect: JSONObject) {
    val patch = SharedTemplateProtocol.dictionary(effect.get("patch")); val unavailable = genesisTranslate("Недоступно")
    val empty = genesisTranslate("Не задано"); val input = state.edit?.getJSONObject("dateInput")?.let(SharedCustomCalendar::restore) ?: return
    val calendar = GenesisCalendar(ZoneId.of(input.context.timeZone), input.context.version, input.context.gregorianYearStart)
    val mode = if (LocalSacredFeaturesEnabled.current) input.mode else ru.genesis.calendar.domain.CalendarMode.PROFANE
    val format = NumberFormat.getNumberInstance(Locale.forLanguageTag(state.language)).apply { maximumFractionDigits = 12 }
    val yes = genesisTranslate("Да"); val no = genesisTranslate("Нет")
    fun date(value: String) = runCatching { calendar.formatDate(LocalDate.parse(value), mode) }.getOrDefault(unavailable)
    fun reference(rows: List<JSONObject>, value: Any?, idKey: String = "id", titleKey: String = "title") = rows.firstOrNull { it.opt(idKey) == value }?.getString(titleKey) ?: unavailable
    @Composable fun Value(label: String, value: String, userLabel: Boolean = false) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (userLabel) UntranslatedText(label, style = MaterialTheme.typography.titleSmall) else Text(label, style = MaterialTheme.typography.titleSmall)
            UntranslatedText(value, style = MaterialTheme.typography.bodyMedium)
        }
    }
    Column(Modifier.fillMaxWidth().testTag("automation-editor-effects"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (patch.has("statusId")) Value("Статус", reference(state.statuses, patch.get("statusId")))
        if (patch.has("assigneeId")) Value("Исполнитель", if (patch.isNull("assigneeId")) empty else reference(state.members, patch.get("assigneeId"), "userId", "displayName"))
        if (patch.has("priority")) Value("Приоритет", genesisTranslate(listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет").getOrElse(patch.optInt("priority", -1)) { "Недоступно" }))
        if (patch.has("dueDate")) Value("Срок", if (patch.isNull("dueDate")) empty else date(patch.getString("dueDate")))
        if (patch.has("labelIds")) Value("Метки", patch.getJSONArray("labelIds").let { values -> if (values.length() == 0) empty else (0 until values.length()).joinToString(", ") { reference(state.labels, values.get(it)) } })
        if (patch.has("customFields")) {
            val values = SharedTemplateProtocol.dictionary(patch.get("customFields"))
            values.keys().forEach { id ->
                val field = state.fields.firstOrNull { it.getString("id") == id }
                if (field != null) {
                    val value = values.get(id)
                    val text = when (value) {
                        JSONObject.NULL -> empty
                        is Boolean -> if (value) yes else no
                        is Number -> format.format(value)
                        else -> when (field.getString("type")) {
                            "date" -> date(value.toString())
                            "select" -> reference(importRows(field.getJSONArray("options")), value)
                            "multi" -> (value as? JSONArray)?.let { ids -> (0 until ids.length()).joinToString(", ") { reference(importRows(field.getJSONArray("options")), ids.get(it)) } } ?: unavailable
                            else -> value.toString()
                        }
                    }
                    Value(field.getString("title"), text, true)
                } else Value("Пользовательское поле", unavailable)
            }
        }
    }
}
