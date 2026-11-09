package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal fun automationTriggerLabel(type: String) = when (type) {
    "created" -> "Создание задачи"; "status" -> "Смена статуса"; "assignee" -> "Смена исполнителя"; "completed" -> "Завершение задачи"
    "dueSoon" -> "Приближение срока"; "due" -> "Наступление срока"; "schedule" -> "По расписанию"; else -> "Триггер"
}
internal fun automationActionLabel(type: String) = when (type) {
    "status" -> "Изменить статус"; "assignee" -> "Назначить исполнителя"; "priority" -> "Изменить приоритет"
    "addLabels" -> "Добавить метки"; "removeLabels" -> "Убрать метки"; "due" -> "Изменить срок"; "custom" -> "Изменить пользовательское поле"
    "createTemplate" -> "Создать задачу из шаблона"; "notify" -> "Отправить уведомление"; else -> "Действие"
}
internal fun automationFieldLabel(field: String) = when (field) {
    "project" -> "Проект"; "status" -> "Статус"; "label" -> "Метки"; "assignee" -> "Исполнитель"; "priority" -> "Приоритет"; else -> "Пользовательское поле"
}
internal fun automationOperatorLabel(value: String) = when (value) {
    "eq" -> "Равно"; "ne" -> "Не равно"; "missing" -> "Не задано"; "present" -> "Задано"; "contains" -> "Содержит"; "notContains" -> "Не содержит"
    "gt" -> "Больше"; "gte" -> "Не меньше"; "lt" -> "Меньше"; "lte" -> "Не больше"; else -> "Условие"
}
internal fun automationErrorText(code: String) = when {
    code == "AUTOMATION_CONFLICT" -> "Правило изменилось. Обновите его и повторите действие."
    code == "AUTOMATION_STALE" -> "Запуск отменён: задача, правило или права изменились."
    code == "AUTOMATION_CONDITIONS_NOT_MET" -> "Условия правила не выполнены."
    code == "AUTOMATION_LOOP_GUARD" -> "Цикл остановлен: правило уже выполнялось в этой цепочке."
    code == "AUTOMATION_CHAIN_LIMIT" -> "Достигнут лимит действий в цепочке."
    code == "AUTOMATION_RATE_LIMIT" -> "Достигнут лимит: 100 запусков правила в час."
    code == "AUTOMATION_TEMPLATE_BLOCKED" -> "Шаблон требует сопоставления данных. Проверьте настройки применения."
    code == "AUTOMATION_RETRY_UNAVAILABLE" -> "Этот запуск нельзя повторить. Проверьте версию и состояние правила."
    code == "AUTOMATION_DUE_REQUIRED" -> "Для сдвига сначала нужен срок задачи."
    code == "AUTOMATION_SERIES_DUPLICATE" -> "Создание следующей задачи уже выполняет серия. Повторное создание остановлено."
    code == "BACKGROUND_RETRY" -> "Временная ошибка. Фоновый обработчик повторит запуск."
    code == "BACKGROUND_LEASE_EXPIRED" -> "Обработчик не подтвердил запуск."
    code in setOf("SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED", "UNAUTHORIZED") -> "Недостаточно прав или задача недоступна."
    code in setOf("NETWORK", "SERVER", "AUTOMATION_ONLINE_REQUIRED") -> "Нет связи. Подключитесь к интернету и обновите экран."
    code in setOf("PLANNING_DRAFT_CHANGED", "PLANNING_DRAFT_PENDING") -> "Результат отправки пока не подтверждён. Повторите ту же команду."
    code.startsWith("CUSTOM_FIELD_") -> customFieldMessage(code) ?: "Не удалось выполнить правило. Проверьте права, поля и утверждения, затем повторите."
    code.startsWith("WORKFLOW_") -> "Переход недоступен по правилам процесса. Откройте задачу и проверьте условия."
    else -> "Не удалось выполнить правило. Проверьте права, поля и утверждения, затем повторите."
}
internal data class AutomationValue(val text: String, val available: Boolean = true)
internal fun automationCivilDate(value: String, language: String): String = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
    .withLocale(Locale.forLanguageTag(language)).format(LocalDate.parse(value))
internal fun automationReference(state: SharedAutomationsState, field: String, value: Any?, fieldId: String?, t: (String) -> String): AutomationValue {
    val missing = t("Недоступно")
    if (value == null || value == JSONObject.NULL) return AutomationValue(t("Не задано"))
    fun resolved(name: String?) = AutomationValue(name ?: missing, name != null)
    return when (field) {
        "project" -> resolved(state.project?.takeIf { it.optString("id") == value }?.optString("title"))
        "status" -> resolved(state.status(value.toString()))
        "assignee" -> resolved(state.member(value.toString()))
        "label" -> resolved(state.labels[value.toString()])
        "priority" -> AutomationValue(t(when ((value as? Number)?.toInt()) { 0 -> "Без приоритета"; 1 -> "Низкий приоритет"; 2 -> "Средний приоритет"; 3 -> "Высокий приоритет"; else -> return AutomationValue(missing, false) }))
        "custom" -> {
            val definition = fieldId?.let(state::field) ?: return AutomationValue(missing, false)
            val options = importRows(definition.getJSONArray("options")); val live = !definition.getBoolean("archived")
            when (definition.getString("type")) {
                "select", "multi" -> {
                    val ids = if (value is JSONArray) (0 until value.length()).map(value::getString) else listOf(value.toString())
                    val found = ids.map { id -> options.firstOrNull { it.getString("id") == id } }
                    AutomationValue(found.joinToString(", ") { it?.getString("title") ?: missing }, live && found.all { it != null && !it.getBoolean("archived") })
                }
                "checkbox" -> if (value is Boolean) AutomationValue(t(if (value) "Да" else "Нет"), live) else AutomationValue(missing, false)
                "number" -> if (value is Number) AutomationValue(NumberFormat.getNumberInstance(Locale.forLanguageTag(state.language)).format(value), live) else AutomationValue(missing, false)
                "date" -> runCatching { AutomationValue(automationCivilDate(value.toString(), state.language), live) }.getOrElse { AutomationValue(missing, false) }
                else -> AutomationValue(value.toString(), live)
            }
        }
        else -> AutomationValue(missing, false)
    }
}
internal fun automationActionValue(state: SharedAutomationsState, action: JSONObject, t: (String) -> String): AutomationValue {
    fun reference(field: String, value: Any?, id: String? = null) = automationReference(state, field, value, id, t)
    return when (action.getString("type")) {
        "status", "assignee", "priority" -> reference(action.getString("type"), action.get("value"))
        "addLabels", "removeLabels" -> {
            val ids = action.getJSONArray("value"); val values = (0 until ids.length()).map { reference("label", ids.getString(it)) }
            AutomationValue(if (values.isEmpty()) t("Не задано") else values.joinToString(", ") { it.text }, values.all { it.available })
        }
        "custom" -> {
            val id = action.getString("fieldId"); val value = reference("custom", action.get("value"), id)
            AutomationValue((state.field(id)?.getString("title") ?: t("Недоступно")) + ": " + value.text, value.available)
        }
        "due" -> AutomationValue(when (action.getString("mode")) {
            "clear" -> t("Очистить срок"); "set" -> automationCivilDate(action.getString("date"), state.language)
            else -> { val offset = action.getJSONObject("offset"); val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(state.language)).format(offset.getInt("amount"))
                number + " " + t(when (offset.getString("unit")) { "day" -> "дн."; "month" -> "мес."; else -> "г." }) }
        })
        "notify" -> {
            val ids = action.getJSONArray("recipientIds"); val recipients = (0 until ids.length()).map { reference("assignee", ids.getString(it)) }
            AutomationValue(recipients.joinToString(", ") { it.text } + action.getString("message").takeIf(String::isNotBlank)?.let { "\n$it" }.orEmpty(), recipients.all { it.available })
        }
        "createTemplate" -> {
            val name = if (action.optBoolean("unavailable")) null else state.templates[action.getString("templateId")]
            val inspection = state.templateInspection(action)
            val optionsSupported = action.optJSONObject("options")?.length() == 0 || inspection != null
            AutomationValue(if (name == null) t("Шаблон недоступен") else name +
                if (optionsSupported) "" else "\n" + t("Параметры применения шаблона доступны в редакторе правила."), name != null && optionsSupported && inspection?.canApply != false)
        }
        else -> AutomationValue(t("Недоступно"), false)
    }
}
internal fun automationCanReadParameters(state: SharedAutomationsState): Boolean {
    val rule = state.rule ?: return false; if (state.member(rule.optString("ownerId")) == null) return false
    val definition = rule.getJSONObject("definition")
    val conditions = importRows(definition.getJSONArray("conditions")).all { condition ->
        val field = condition.getString("field"); val fieldId = condition.optString("fieldId").takeIf(String::isNotEmpty)
        val availableField = field != "custom" || fieldId?.let(state::field)?.optBoolean("archived") == false
        availableField && (condition.getString("operator") in setOf("missing", "present") || automationReference(state, field, condition.get("value"), fieldId) { it }.available)
    }
    return conditions && importRows(definition.getJSONArray("actions")).all { automationActionValue(state, it) { value -> value }.available }
}
