package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.time.LocalDate
import java.time.ZoneId

/** Only source/preview endpoints are reachable here. Configuring a rule cannot apply a template. */
internal class SharedAutomationTemplateConfiguration(private val gateway: SharedWorkspaceGateway,
    private val parent: SharedAutomationEditorState, private val key: String) {
    var source by mutableStateOf<JSONObject?>(null); private set
    var preview by mutableStateOf<JSONObject?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    private var active = true; private var reviewed: String? = null
    fun close() { active = false; source = null; preview = null }
    private fun position(edit: JSONObject): Int = (0 until edit.getJSONArray("actionKeys").length()).first { edit.getJSONArray("actionKeys").getString(it) == key }
    private fun action(): JSONObject = SharedAutomationEditorEdits.row(requireNotNull(parent.edit), true, position(requireNotNull(parent.edit)))
    fun request(): JSONObject {
        val edit = requireNotNull(parent.edit); val definition = SharedAutomationEditorEdits.effective(edit)
        val anchor = LocalDate.now(ZoneId.of(definition.getJSONObject("calendarContext").getString("timeZone"))).toString()
        return SharedAutomationEditorProtocol.templateOptions(edit.getString("spaceId"), parent.projectId, action().get("options")).put("anchorDate", anchor)
    }
    fun form(): SharedTemplateApplyForm {
        val request = request(); val edit = JSONObject().put("kind", "template-apply").put("request", request).put("dateInput", requireNotNull(parent.edit).getJSONObject("dateInput"))
        return SharedTemplateApplyForm(edit, source, preview, parent.editable && !busy, reviewed == PlanningLifecycle.canonical(request),
            { next, _ -> parent.mutate { edit ->
                val options = JSONObject(next.getJSONObject("request").toString()).apply { remove("anchorDate") }
                SharedAutomationEditorEdits.row(edit, true, position(edit)).put("options", SharedAutomationEditorProtocol.templateOptions(edit.getString("spaceId"), parent.projectId, options))
            } }, { calendar -> parent.mutate { it.put("dateInput", calendar.saved()) } }, { title -> parent.mutate { edit ->
                val row = SharedAutomationEditorEdits.row(edit, true, position(edit))
                row.getJSONObject("options").put("title", title.takeUnless(String::isBlank) ?: JSONObject.NULL)
            } })
    }
    suspend fun review() {
        if (busy || !active || !parent.editable) return
        val request = request(); val fingerprint = PlanningLifecycle.canonical(request); val id = action().getString("templateId")
        fun current() { if (!active || parent.edit == null || parent.lost || action().optString("templateId") != id || PlanningLifecycle.canonical(this.request()) != fingerprint) throw CancellationException() }
        busy = true; error = ""; source = null; preview = null; reviewed = null
        try {
            currentCoroutineContext().ensureActive(); current()
            val space = requireNotNull(parent.space)
            val fresh = SharedTemplateProtocol.source(space, id, gateway.sharedTemplate(space, id, parent.language, false)); currentCoroutineContext().ensureActive(); current()
            require(fresh.getString("kind") == "task") { "AUTOMATION_TASK_TEMPLATE_REQUIRED" }; source = fresh
            val result = SharedTemplateProtocol.preview(space, id, request, gateway.previewSharedTemplate(space, id, request)); currentCoroutineContext().ensureActive(); current()
            preview = result; reviewed = fingerprint
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (!active) throw CancellationException()
            source = null; preview = null; error = when (failure) { is AuthApiError -> failure.code; is AuthFailure -> sharedFailureCode(failure); else -> failure.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "TEMPLATE_INVALID" }
        } finally { if (active) busy = false }
    }
}

@Composable internal fun AutomationTemplateConfiguration(gateway: SharedWorkspaceGateway, parent: SharedAutomationEditorState,
    action: String, preferences: UiPreferences) {
    val state = remember(parent, action) { SharedAutomationTemplateConfiguration(gateway, parent, action) }
    val scope = rememberCoroutineScope(); val copy = sharedTemplateCopy()
    DisposableEffect(state) { onDispose { state.close() } }
    LaunchedEffect(state) { state.review() }
    Column(Modifier.fillMaxWidth().testTag("automation-template-configuration"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        if (state.error.isNotBlank()) Text(templateIssueMessage(state.error, copy), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.testTag("automation-template-error"))
        val form = state.form()
        SharedTemplateApplyEditor(form, preferences, listOfNotNull(parent.project), automationRun = true)
        TemplateOutlinedButton({ scope.launch { state.review() } }, Modifier.fillMaxWidth().testTag("automation-template-preview"), parent.editable && !state.busy) {
            AffairsActionIcon(AffairsAction.VIEW); Spacer(Modifier.width(8.dp)); Text("Обновить предпросмотр")
        }
    }
}
