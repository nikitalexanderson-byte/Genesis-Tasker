package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*

@Composable
internal fun SharedTaskReviewPanel(gateway: SharedTaskReviewGateway, task: JSONObject, project: JSONObject,
    members: List<JSONObject>, userId: String, disabled: Boolean, onRefresh: suspend () -> Unit, readOnly: Boolean = false) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var configure by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val rows = task.optJSONArray("approvals") ?: JSONArray()
    val completed = task.optString("completedAt").let { it.isNotBlank() && it != "null" }
    val archived = task.optString("archivedAt").let { it.isNotBlank() && it != "null" }
    val canConfigure = !readOnly && sharedTaskCanEdit(project) && !completed && !archived &&
        (task.optString("createdBy") == userId || project.optJSONObject("permissions")?.optBoolean("manageProjects") == true)
    val enabled = !disabled && !busy && !task.optBoolean("pending") && !archived
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""
        scope.launch { try { action(); onRefresh() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskReviewError(failure.message) } finally { busy = false } }
    }
    Column(Modifier.fillMaxWidth().testTag("shared-task-review"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Согласование выполнения", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            if (canConfigure) AffairsIconButton("Настроить подтверждение", AffairsAction.SETTINGS, { configure = true }, enabled = enabled, outlined = false)
        }
        if (rows.length() == 0) Text("Подтверждение участников не требуется.", style = MaterialTheme.typography.bodySmall)
        (0 until rows.length()).forEach { index -> val row = rows.getJSONObject(index)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                AffairsActionIcon(if (row.isNull("approvedAt")) AffairsAction.PAUSE else AffairsAction.TASK)
                UntranslatedText(row.optString("displayName"), Modifier.weight(1f))
                Text(if (row.isNull("approvedAt")) "Ожидается" else "Подтверждено", style = MaterialTheme.typography.labelMedium)
            }
        }
        if (SharedTaskReviewProtocol.canApprove(task, userId)) Button(onClick = { confirm = true }, enabled = enabled,
            modifier = Modifier.testTag("shared-task-approve")) { Text("Подтвердить выполнение") }
        task.optJSONObject("review")?.takeIf { completed && it.optBoolean("enabled") }?.let { data ->
            Text("Проверка выполненной задачи", style = MaterialTheme.typography.titleSmall)
            val entries = data.optJSONArray("entries") ?: JSONArray()
            SharedTaskReviewProtocol.kinds.forEach { kind ->
                val matching = (0 until entries.length()).map { entries.getJSONObject(it) }.filter { it.optString("kind") == kind }
                if (matching.isNotEmpty()) Text(reviewKindTitle(kind) + ": " + matching.joinToString { it.optString("displayName") }, style = MaterialTheme.typography.bodySmall)
                if (data.optJSONObject("allowed")?.optBoolean(kind) == true) {
                    val checked = matching.any { it.optString("userId") == userId }
                    val label = genesisTranslate(reviewKindTitle(kind))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked, { value -> run {
                            gateway.sharedTaskReview(task.getString("projectId"), task.getString("id"), SharedTaskReviewProtocol.review(task, kind, value))
                        } }, enabled = enabled, modifier = Modifier.size(48.dp).testTag("shared-task-review-$kind").semantics { contentDescription = label })
                        Text(reviewKindTitle(kind))
                    }
                }
            }
        }
        if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    }
    if (confirm) AlertDialog(onDismissRequest = { if (!busy) confirm = false }, title = { Text("Подтвердить выполнение?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(task.getString("title"))
            Text("Когда все назначенные участники подтвердят выполнение, задача перейдёт в выполненные.")
        } }, confirmButton = { TextButton(enabled = enabled, onClick = { run {
            require(SharedTaskReviewProtocol.canApprove(task, userId)); gateway.sharedTaskApprove(task.getString("projectId"), task.getString("id")); confirm = false
        } }) { Text("Подтвердить") } }, dismissButton = { TextButton(enabled = !busy, onClick = { confirm = false }) { Text("Отмена") } })
    if (configure) SharedTaskApproverDialog(task, members, enabled, onClose = { configure = false }) { required, selected ->
        run { gateway.sharedTaskApprovers(task.getString("projectId"), task.getString("id"),
            SharedTaskReviewProtocol.approvers(task, required, selected, members, canConfigure)); configure = false }
    }
}

@Composable
private fun SharedTaskApproverDialog(task: JSONObject, members: List<JSONObject>, enabled: Boolean,
    onClose: () -> Unit, onSave: (Boolean, Set<String>) -> Unit) {
    var required by remember(task.getString("id")) { mutableStateOf(task.optBoolean("approvalRequired")) }
    var selected by remember(task.getString("id")) { mutableStateOf(task.optJSONArray("approvals")?.let { rows ->
        (0 until rows.length()).map { rows.getJSONObject(it).optString("userId") }.filter { it.isNotBlank() && it != "null" }.toSet()
    } ?: emptySet()) }
    val requiredLabel = genesisTranslate("Нужно подтверждение")
    AlertDialog(onDismissRequest = { if (enabled) onClose() }, title = { Text("Кто подтверждает выполнение") },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(required, { required = it }, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = requiredLabel }); Text("Нужно подтверждение") }
            if (required) members.forEach { member -> val id = member.getString("userId")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(id in selected, { if (it) selected = selected + id else selected = selected - id }, enabled = enabled,
                        modifier = Modifier.size(48.dp).semantics { contentDescription = member.optString("displayName") })
                    UntranslatedText(member.optString("displayName"))
                }
            }
            if (required && selected.isEmpty()) Text("Выберите хотя бы одного участника.", color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = enabled && (!required || selected.isNotEmpty()), onClick = { onSave(required, selected) }) { Text("Сохранить") } },
        dismissButton = { TextButton(onClick = onClose, enabled = enabled) { Text("Отмена") } })
}

internal fun reviewKindTitle(kind: String): String = when (kind) { "checked" -> "Проверено"; "confirmed" -> "Подтверждено"; else -> "Можно удалять" }
internal fun sharedTaskReviewError(code: String?): String = when (code) {
    "SHARED_TASK_CONFLICT", "REVIEW_CONFLICT" -> "Задача изменилась. Обновите её перед повторной проверкой."
    "INVALID_TASK_APPROVER", "APPROVAL_CONFIGURATION_FORBIDDEN" -> "Проверьте участников и права настройки подтверждения."
    "REVIEW_FORBIDDEN", "AUTH_REQUIRED", "SHARED_PROJECT_FORBIDDEN" -> "Нет доступа к этому действию. Обновите задачу."
    else -> "Подтверждение не сохранено. Обновите задачу и повторите после подключения."
}
