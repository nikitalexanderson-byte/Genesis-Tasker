package ru.genesis.calendar.ui

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.CustomFieldDraft
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

internal const val SHARED_CUSTOM_DRAFT_KEY = "_genesisCustomFieldDraft"
internal const val SHARED_CUSTOM_CALENDAR_KEY = "_genesisCustomCalendar"

/** Presentation context is local editor metadata; task patches contain ISO dates only. */
internal data class SharedCustomCalendar(val mode: CalendarMode, val context: CalendarContext) {
    fun saved(): JSONObject = JSONObject().put("mode", mode.wireValue).put("version", context.version)
        .put("timeZone", context.timeZone).put("gregorianYearStart", context.gregorianYearStart)
    companion object {
        fun initial(prefs: UiPreferences, zone: ZoneId = ZoneId.systemDefault()): SharedCustomCalendar {
            // Some Android versions report the zero-offset GMT/Z alias instead of an IANA ID.
            // UTC has identical rules and satisfies the portable server calendar contract.
            val timeZone = if (zone.rules.isFixedOffset && zone.rules.getOffset(Instant.EPOCH) == ZoneOffset.UTC) "UTC" else zone.id
            return SharedCustomCalendar(prefs.input, CalendarContext(timeZone = timeZone,
                gregorianYearStart = if (prefs.gregorianYearStartsInMarch) "march" else "january"))
        }
        fun restore(raw: JSONObject): SharedCustomCalendar {
            require(raw.keys().asSequence().toSet() == setOf("mode", "version", "timeZone", "gregorianYearStart")) { "CUSTOM_FIELD_INVALID" }
            val mode = CalendarMode.entries.singleOrNull { it.wireValue == raw.getString("mode") }
                ?: throw IllegalArgumentException("CUSTOM_FIELD_INVALID")
            return SharedCustomCalendar(mode, CalendarContext(raw.getInt("version"), raw.getString("timeZone"), raw.getString("gregorianYearStart")))
        }
    }
}

internal fun sharedCustomCalendar(details: JSONObject, prefs: UiPreferences = UiPreferences()): SharedCustomCalendar =
    if (details.has(SHARED_CUSTOM_CALENDAR_KEY)) SharedCustomCalendar.restore(details.getJSONObject(SHARED_CUSTOM_CALENDAR_KEY))
    else SharedCustomCalendar.initial(prefs)

internal fun sharedTaskCustomDraft(task: JSONObject, details: JSONObject): CustomFieldDraft {
    if (!details.has(SHARED_CUSTOM_DRAFT_KEY)) return CustomFieldDraft.fromTask(task)
    val saved = details.getJSONObject(SHARED_CUSTOM_DRAFT_KEY)
    require(saved.keys().asSequence().toSet() == setOf("taskId", "projectId", "draft") &&
        saved.optString("taskId") == task.optString("id") && saved.optString("projectId") == task.optString("projectId")) { "CUSTOM_FIELD_INVALID" }
    return CustomFieldDraft.restore(saved.getJSONObject("draft"))
}

internal fun sharedTaskWithCustomFields(task: JSONObject, details: JSONObject, draft: CustomFieldDraft): JSONObject =
    JSONObject(details.toString()).put(SHARED_CUSTOM_DRAFT_KEY, JSONObject()
        .put("taskId", task.optString("id")).put("projectId", task.optString("projectId")).put("draft", draft.snapshot()))

/** Malformed server/old saved metadata becomes a recoverable boundary, never a composition crash. */
internal fun initialSharedTaskCustom(task: JSONObject, details: JSONObject, prefs: UiPreferences): JSONObject =
    runCatching { sharedTaskWithCustomFields(task, details, CustomFieldDraft.fromTask(task)) }
        .getOrElse { JSONObject(details.toString()).put(SHARED_CUSTOM_DRAFT_KEY, JSONObject().put("error", "CUSTOM_FIELD_VALUE_INVALID")) }
        .put(SHARED_CUSTOM_CALENDAR_KEY, SharedCustomCalendar.initial(prefs).saved())

internal data class SharedTaskCustomBinding(val fields: List<JSONObject>, val draft: CustomFieldDraft?,
    val errors: Map<String, String>, val error: String?, val calendar: SharedCustomCalendar?) {
    val valid: Boolean get() = error == null && errors.isEmpty() && draft != null && calendar != null
}

internal fun bindSharedTaskCustom(task: JSONObject, details: JSONObject, snapshot: JSONObject?,
    prefs: UiPreferences = UiPreferences()): SharedTaskCustomBinding {
    var fields = emptyList<JSONObject>()
    var draft: CustomFieldDraft? = null
    var calendar: SharedCustomCalendar? = null
    return try {
        val project = requireNotNull(snapshot).getJSONObject("project")
        require(project.optString("id") == task.optString("projectId")) { "CUSTOM_FIELD_UNAVAILABLE" }
        // Old snapshots without a catalog must not hide values supplied by a newer task response.
        if (!snapshot.has("customFieldDefinitions")) require(CustomFieldProtocol.fromTask(task).length() == 0) { "CUSTOM_FIELD_UNAVAILABLE" }
        fields = CustomFieldProtocol.definitions(project.getString("spaceId"), project.getString("id"),
            if (snapshot.has("customFieldDefinitions")) snapshot.getJSONArray("customFieldDefinitions") else JSONArray())
        draft = sharedTaskCustomDraft(task, details)
        calendar = sharedCustomCalendar(details, prefs)
        val errors = draft.errors(fields)
        if (errors.isEmpty()) draft.patch(fields) // Also validates aggregate wire bounds.
        SharedTaskCustomBinding(fields, draft, errors, null, calendar)
    } catch (failure: Exception) {
        SharedTaskCustomBinding(fields, draft, emptyMap(), failure.message?.takeIf { it in CustomFieldProtocol.errors }
            ?: "CUSTOM_FIELD_UNAVAILABLE", calendar)
    }
}

internal fun customFieldMessage(code: String): String? = when (code) {
    "CUSTOM_FIELD_REQUIRED" -> "Заполните обязательные пользовательские поля."
    "CUSTOM_FIELD_VALUE_INVALID" -> "Проверьте тип и значение пользовательского поля."
    "CUSTOM_FIELD_URL_INVALID" -> "Укажите ссылку, начинающуюся с https:// или http://."
    "CUSTOM_FIELD_OPTION_UNAVAILABLE" -> "Вариант списка недоступен. Выберите действующий вариант."
    "CUSTOM_FIELD_UNAVAILABLE" -> "Поле больше недоступно. Обновите данные; черновик сохранён."
    "CUSTOM_FIELD_INVALID" -> "Проверьте название, тип и настройки поля."
    "CUSTOM_FIELD_CONFLICT" -> "Поле или его значения изменились. Обновите предпросмотр; черновик сохранён."
    "CUSTOM_FIELD_SCOPE_HAS_VALUES" -> "Нельзя изменить область: у поля есть значения в других проектах."
    "CUSTOM_FIELD_TYPE_TRANSITION_REQUIRED" -> "Подтвердите создание нового поля с сохранением прежнего в архиве."
    "CUSTOM_FIELD_LIMIT" -> "Достигнут лимит: 200 действующих полей в пространстве."
    "CUSTOM_FIELD_OPERATION_REUSED" -> "Эта операция уже использована. Обновите предпросмотр и повторите."
    else -> null
}

/** Isolate the composable catalog loop from the workspace's near-limit bytecode method. */
@androidx.compose.runtime.Composable internal fun sharedCustomFieldFailureMessages(): Map<String, String> =
    CustomFieldProtocol.errors.associateWith { genesisTranslate(customFieldMessage(it).orEmpty()) }
