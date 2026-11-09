package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTaskReviewGateway
import ru.genesis.calendar.auth.SharedTaskReviewProtocol

@Composable
internal fun SharedTaskReviewSettingsPanel(gateway: SharedTaskReviewGateway, projectId: String, disabled: Boolean = false) {
    var data by remember(projectId) { mutableStateOf<JSONObject?>(null) }
    var policyJson by rememberSaveable(projectId) { mutableStateOf("") }
    var baseRevision by rememberSaveable(projectId) { mutableIntStateOf(-1) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun apply(next: JSONObject) {
        SharedTaskReviewProtocol.policy(next.getJSONObject("policy"))
        data = next; policyJson = next.getJSONObject("policy").toString(); baseRevision = next.getInt("revision")
    }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""; saved = false
        scope.launch { try { action() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskReviewError(failure.message) } finally { busy = false } }
    }
    LaunchedEffect(projectId) {
        try {
            val next = gateway.sharedTaskReviewSettings(projectId)
            SharedTaskReviewProtocol.policy(next.getJSONObject("policy"))
            if (policyJson.isBlank()) apply(next) else data = next
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = sharedTaskReviewError(failure.message) }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Проверка выполненных задач", style = MaterialTheme.typography.titleMedium)
        Text("Правила основного проекта применяются и к его подпроектам.", style = MaterialTheme.typography.bodySmall)
        val current = data
        if (current == null || policyJson.isBlank()) {
            if (error.isBlank()) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            OutlinedButton(enabled = !busy, onClick = { run { apply(gateway.sharedTaskReviewSettings(projectId)) } }) { Text("Обновить данные") }
        } else {
            val policy = JSONObject(policyJson)
            val stale = current.getInt("revision") != baseRevision
            val editable = current.getBoolean("canManage") && !busy && !disabled && !stale
            UntranslatedText(current.getString("rootTitle"), style = MaterialTheme.typography.titleSmall)
            ReviewPolicyCheckbox("Включить проверку выполненных задач", policy.getBoolean("enabled"), editable) {
                policyJson = JSONObject(policyJson).put("enabled", it).toString(); saved = false
            }
            SharedTaskReviewProtocol.kinds.forEach { kind ->
                val rule = policy.getJSONObject(kind)
                val options = listOf("everyone" to "Все участники проекта", "editors" to "Участники с правом редактирования",
                    "organizers" to "Организаторы и администраторы", "selected" to "Выбранные участники")
                var open by remember(kind) { mutableStateOf(false) }
                Text(when (kind) { "checked" -> "Кто проверяет выполнение"; "confirmed" -> "Кто подтверждает выполнение"; else -> "Кто разрешает удаление" }, style = MaterialTheme.typography.titleSmall)
                Box {
                    OutlinedButton(onClick = { open = true }, enabled = editable && policy.getBoolean("enabled"), modifier = Modifier.fillMaxWidth()) {
                        Text(options.first { it.first == rule.getString("group") }.second, Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
                    }
                    DropdownMenu(open, { open = false }) { options.forEach { (id, title) -> DropdownMenuItem(text = { Text(title) }, onClick = {
                        policyJson = JSONObject(policyJson).put(kind, JSONObject(rule.toString()).put("group", id)).toString(); saved = false; open = false
                    }) } }
                }
                if (rule.getString("group") == "selected") {
                    val members = current.getJSONArray("members"); val selected = rule.getJSONArray("userIds")
                    val ids = (0 until selected.length()).map { selected.getString(it) }.toSet()
                    (0 until members.length()).forEach { index -> val member = members.getJSONObject(index); val id = member.getString("userId")
                        ReviewPolicyCheckbox(member.getString("displayName"), id in ids, editable && policy.getBoolean("enabled")) { checked ->
                            val next = if (checked) ids + id else ids - id
                            policyJson = JSONObject(policyJson).put(kind, JSONObject(rule.toString()).put("userIds", JSONArray(next.sorted()))).toString(); saved = false
                        }
                    }
                }
            }
            if (!current.getBoolean("canManage")) Text("Настройки изменяет администратор основного проекта.", style = MaterialTheme.typography.bodySmall)
            if (stale) Text("Правила изменились. Черновик сохранён. Обновите данные перед сохранением.", color = MaterialTheme.colorScheme.error)
            if (current.getBoolean("canManage")) Button(enabled = editable, onClick = { run {
                require(data?.optBoolean("canManage") == true && data?.getInt("revision") == baseRevision)
                apply(gateway.saveSharedTaskReviewSettings(current.getString("rootProjectId"), JSONObject()
                    .put("policy", SharedTaskReviewProtocol.policy(JSONObject(policyJson))).put("expectedRevision", baseRevision))); saved = true
            } }) { Text("Сохранить правила проверки") }
            OutlinedButton(enabled = !busy, onClick = { discard = true }) { Text("Обновить данные") }
        }
        if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        if (saved) Text("Правила проверки сохранены.", color = MaterialTheme.colorScheme.primary)
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Загрузить сохранённые правила?") },
        text = { Text("Изменения черновика будут отменены.") },
        confirmButton = { TextButton(onClick = { discard = false; run { apply(gateway.sharedTaskReviewSettings(projectId)) } }) { Text("Обновить") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("Продолжить редактирование") } })
}

@Composable private fun ReviewPolicyCheckbox(title: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    val label = genesisTranslate(title)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = label })
        Text(title)
    }
}
