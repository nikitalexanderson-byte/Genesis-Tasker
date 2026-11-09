package ru.genesis.calendar.ui

import org.json.JSONObject
import ru.genesis.calendar.auth.PlanningLifecycle
import ru.genesis.calendar.auth.SharedAutomationEditorProtocol
import ru.genesis.calendar.auth.SharedTemplateProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.time.Instant
import java.time.ZoneId

/** A current, read-only interpretation of stored options; it has no save/apply capability. */
internal class SharedAutomationTemplateInspection private constructor(
    private val signature: String, private val request: JSONObject, private val source: JSONObject,
    private val preview: JSONObject
) {
    val canApply get() = preview.getBoolean("canApply")
    val language get() = request.getString("language")
    val anchorDate get() = request.getString("anchorDate")
    fun matches(action: JSONObject) = signature == key(action)
    fun form(calendar: SharedCustomCalendar) = SharedTemplateApplyForm(
        JSONObject().put("kind", "template-apply").put("request", SharedTemplateProtocol.copy(request)).put("dateInput", calendar.saved()),
        SharedTemplateProtocol.copy(source), SharedTemplateProtocol.copy(preview), false, true, { _, _ -> false }, {}, {})

    companion object {
        fun key(action: JSONObject): String = PlanningLifecycle.canonical(action)
        suspend fun read(gateway: SharedWorkspaceGateway, space: String, project: String, definition: JSONObject,
            action: JSONObject, current: () -> Unit, now: Instant = Instant.now()): SharedAutomationTemplateInspection {
            val signature = key(action)
            val request = SharedAutomationEditorProtocol.templateOptions(space, project, action.get("options"))
                .put("anchorDate", now.atZone(ZoneId.of(definition.getJSONObject("calendarContext").getString("timeZone"))).toLocalDate().toString())
            val id = action.getString("templateId")
            current()
            val source = SharedTemplateProtocol.source(space, id, gateway.sharedTemplate(space, id, request.getString("language"), false))
            current()
            require(source.getString("kind") == "task") { "AUTOMATION_TASK_TEMPLATE_REQUIRED" }
            val preview = SharedTemplateProtocol.preview(space, id, request, gateway.previewSharedTemplate(space, id, request))
            current()
            require(preview.getInt("revision") == source.getInt("revision")) { "TEMPLATE_PREVIEW_CHANGED" }
            return SharedAutomationTemplateInspection(signature, request, source, preview)
        }
    }
}
