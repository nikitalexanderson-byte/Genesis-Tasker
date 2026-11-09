package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.util.UUID

private fun sharedTaskDetailCore(task: JSONObject): JSONObject = JSONObject()
    .put("priority", task.optInt("priority"))
    .put("parentTaskId", task.opt("parentTaskId") ?: JSONObject.NULL)
    .put("checklists", JSONArray((task.optJSONArray("checklists") ?: JSONArray()).toString()))

internal fun sharedTaskDetailDraft(task: JSONObject, prefs: UiPreferences = UiPreferences()): JSONObject = initialSharedTaskCustom(task,
    sharedTaskWithEstimates(sharedTaskDetailCore(task), SharedTaskEstimateDraft.fromTask(task)), prefs)
        .put(SHARED_TASK_CORE_BASE, sharedTaskCoreBaseline(task))

internal fun sharedTaskDetailChanges(task: JSONObject, details: JSONObject, includeEstimates: Boolean,
    customFields: List<JSONObject> = emptyList()): JSONObject =
    sharedTaskDetailCore(details).apply {
        if (includeEstimates) sharedTaskEstimates(task, details).patch().let { estimates ->
            estimates.keys().forEach { key -> put(key, estimates.get(key)) }
        }
        sharedTaskCustomDraft(task, details).patch(customFields).let { patch ->
            if (patch.length() > 0) put("customFields", patch)
        }
    }

internal fun sharedTaskDetailsChanged(task: JSONObject, details: JSONObject, customFields: List<JSONObject> = emptyList()): Boolean =
    sharedTaskDetailCore(task).toString() != sharedTaskDetailCore(details).toString() || sharedTaskEstimates(task, details).dirty ||
        runCatching { sharedTaskCustomDraft(task, details).changedIds(customFields).isNotEmpty() }.getOrDefault(true)

internal fun rebaseSharedTaskDetailDraft(task: JSONObject, details: JSONObject, customFields: List<JSONObject> = emptyList()): JSONObject {
    val result = sharedTaskWithEstimates(sharedTaskDetailCore(task), sharedTaskEstimates(task, details).rebase(task))
    // Keep malformed local input recoverable rather than replacing it during a refresh.
    if (details.has(SHARED_CUSTOM_CALENDAR_KEY)) result.put(SHARED_CUSTOM_CALENDAR_KEY, details.get(SHARED_CUSTOM_CALENDAR_KEY))
    return runCatching { sharedTaskWithCustomFields(task, result, sharedTaskCustomDraft(task, details).rebase(task, customFields)) }
        .getOrElse { if (details.has(SHARED_CUSTOM_DRAFT_KEY)) result.put(SHARED_CUSTOM_DRAFT_KEY, details.get(SHARED_CUSTOM_DRAFT_KEY)) else result }
}

/** Preserve loaded pages only while the server's membership/data generation is unchanged. */
internal fun mergeSharedTaskPage(previous: JSONObject?, next: JSONObject, append: Boolean): JSONObject {
    if (previous == null) return next
    val same = previous.optString("queryVersion").isNotBlank() && previous.optString("queryVersion") == next.optString("queryVersion")
    if (append && !same) throw IllegalStateException("SHARED_QUERY_CHANGED")
    if (!same) return next
    if (!append) return JSONObject(next.toString()).put("tasks", previous.getJSONArray("tasks"))
        .put("nextCursor", previous.opt("nextCursor") ?: JSONObject.NULL).put("hasMore", previous.optBoolean("hasMore"))
    val tasks = linkedMapOf<String, JSONObject>()
    listOf(previous, next).forEach { page ->
        val rows = page.getJSONArray("tasks")
        for (index in 0 until rows.length()) rows.getJSONObject(index).let { tasks[it.getString("id")] = it }
    }
    return JSONObject(next.toString()).put("tasks", JSONArray(tasks.values.toList()))
}

internal fun sharedTaskChecklistsValid(draft: JSONObject): Boolean = runCatching {
    val lists = draft.getJSONArray("checklists")
    require(lists.length() <= 20)
    val ids = mutableSetOf<String>(); var total = 0
    for (i in 0 until lists.length()) {
        val list = lists.getJSONObject(i)
        require(ids.add(list.getString("id")) && list.getString("title").trim().length in 1..160)
        val items = list.getJSONArray("items"); total += items.length(); require(total <= 300)
        for (j in 0 until items.length()) {
            val item = items.getJSONObject(j)
            require(ids.add(item.getString("id")) && item.getString("title").trim().length in 1..500 && item.get("done") is Boolean)
        }
    }
    true
}.getOrDefault(false)

private fun detailRows(rows: JSONArray) = (0 until rows.length()).map(rows::getJSONObject)
private fun detailMove(rows: JSONArray, index: Int, delta: Int): JSONArray = JSONArray(detailRows(rows).toMutableList().apply {
    if (index + delta in indices) { val value = this[index]; this[index] = this[index + delta]; this[index + delta] = value }
})

internal fun sharedTaskDetailsFailure(code: String?): String? = when(code) {
    "TASK_RELATION_CYCLE" -> "Эта связь создаёт цикл. Выберите другую родительскую задачу."
    "TASK_PARENT_UNAVAILABLE" -> "Родительская задача недоступна. Выберите задачу из этого проекта."
    "TASK_PARENT_COMPLETED" -> "Сначала верните родительскую задачу в работу."
    "TASK_CHILDREN_INCOMPLETE" -> "Сначала завершите подзадачи. Они не закрываются автоматически."
    "TASK_CHECKLIST_INCOMPLETE" -> "Сначала завершите пункты чек-листов и связанные задачи."
    "TASK_MOVE_RELATIONS" -> "Перед переносом отсоедините родителя и подзадачи. Связанные задачи остаются в своём проекте."
    "INVALID_TASK_PRIORITY" -> "Выберите приоритет из списка."
    "INVALID_CHECKLIST" -> "Проверьте названия чек-листов и пунктов. Допустимо до 20 списков и 300 пунктов."
    else -> null
}

@Composable
internal fun SharedTaskDetailsFields(task: JSONObject, draft: JSONObject, onChange: (JSONObject) -> Unit, disabled: Boolean,
    readOnly: Boolean = disabled, members: List<JSONObject> = emptyList(), mode: CalendarMode = CalendarMode.PROFANE,
    saved: Boolean = true, onOpen: ((String, String) -> Unit)? = null, onConvert: ((String, String) -> Unit)? = null) {
    Text("Приоритет", style = MaterialTheme.typography.titleSmall)
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет").forEachIndexed { priority, label ->
            FilterChip(selected = draft.optInt("priority") == priority, enabled = !disabled && !readOnly,modifier=Modifier.heightIn(min=48.dp),shape=AffairsLayout.controlShape,
                onClick = { onChange(JSONObject(draft.toString()).put("priority", priority)) }, label = { Text(label) })
        }
    }
    val checklists = draft.optJSONArray("checklists") ?: JSONArray()
    val defaultChecklistTitle=genesisTranslate("Чек-лист")
    fun change(action: (JSONObject) -> Unit) { if (!disabled && !readOnly) onChange(JSONObject(draft.toString()).apply(action)) }
    val total = detailRows(checklists).sumOf { it.getJSONArray("items").length() }
    AffairsDisclosure("Чек-листы", initiallyExpanded = checklists.length() > 0) {
    for (listIndex in 0 until checklists.length()) key(checklists.getJSONObject(listIndex).getString("id")) {
        val checklist = checklists.getJSONObject(listIndex)
        fun changeList(action: (JSONObject) -> Unit) = change { action(it.getJSONArray("checklists").getJSONObject(listIndex)) }
        if (readOnly) UntranslatedText(checklist.optString("title"), style = MaterialTheme.typography.titleSmall)
        else OutlinedTextField(checklist.optString("title"), { value -> if (value.length <= 160) changeList { it.put("title",value) } },
            label = { Text("Название чек-листа") }, enabled = !disabled, isError = checklist.optString("title").isBlank(),
            modifier = Modifier.fillMaxWidth().testTag("shared-checklist-title-${checklist.getString("id")}"))
        if (!readOnly) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AffairsIconButton("Переместить выше", AffairsAction.EXPAND, { change { it.put("checklists",detailMove(checklists,listIndex,-1)) } }, enabled = !disabled && listIndex > 0)
            AffairsIconButton("Переместить ниже", AffairsAction.COLLAPSE, { change { it.put("checklists",detailMove(checklists,listIndex,1)) } }, enabled = !disabled && listIndex + 1 < checklists.length())
            AffairsIconButton("Удалить чек-лист", AffairsAction.DELETE, { change { it.put("checklists",JSONArray(detailRows(checklists).filterIndexed { index,_ -> index != listIndex })) } }, enabled = !disabled)
        }
        val items = checklist.optJSONArray("items") ?: JSONArray()
        Text(genesisTranslate("Выполнено: {done} из {total}").replace("{done}",detailRows(items).count { it.optBoolean("done") }.toString()).replace("{total}",items.length().toString()),style = MaterialTheme.typography.bodySmall)
        var limit by rememberSaveable { mutableIntStateOf(5) }
        for (itemIndex in 0 until minOf(items.length(),limit)) key(items.getJSONObject(itemIndex).getString("id")) {
            val item = items.getJSONObject(itemIndex)
            val linked = !item.isNull("linkedTaskId") || item.optBoolean("linkUnavailable")
            val completionLabel=genesisTranslate("Выполнено")+": "+item.optString("title")
            fun changeItem(action: (JSONObject) -> Unit) = changeList { action(it.getJSONArray("items").getJSONObject(itemIndex)) }
            Row(Modifier.fillMaxWidth(),verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = item.optBoolean("done"), enabled = !disabled && !readOnly && item.isNull("linkedTaskId") && !item.optBoolean("linkUnavailable"),
                    modifier=Modifier.semantics { contentDescription=completionLabel },
                    onCheckedChange = { done -> changeItem { it.put("done",done) } })
                Column(Modifier.weight(1f)) {
                    if (readOnly) UntranslatedText(item.optString("title"))
                    else OutlinedTextField(item.optString("title"),{ value -> if(value.length <= 500)changeItem { it.put("title",value) } },label={Text("Название пункта")},
                        enabled=!disabled,isError=item.optString("title").isBlank(),modifier=Modifier.fillMaxWidth().testTag("shared-checklist-item-${item.getString("id")}"))
                    if (item.optBoolean("linkUnavailable")) Text("Связанная задача недоступна", style = MaterialTheme.typography.bodySmall)
                }
            }
            AffairsDisclosure("Срок, исполнитель и действия") {
                if (readOnly) {
                    UntranslatedText(members.firstOrNull { it.optString("userId")==item.optString("assigneeId") }?.optString("displayName") ?: genesisTranslate(if(item.isNull("assigneeId"))"Не назначен" else "Бывший участник"))
                    if (!item.isNull("dueDate")) UntranslatedText(sharedDetailDate(item.getString("dueDate"),mode))
                } else {
                    TemplateMember("Исполнитель",item.opt("assigneeId") as? String,members,!disabled,"shared-checklist-assignee-${item.getString("id")}") { value -> changeItem { it.put("assigneeId",value ?: JSONObject.NULL) } }
                    if (item.isNull("dueDate")) AffairsIconButton("Срок пункта",AffairsAction.TIMER,{ changeItem { it.put("dueDate",java.time.LocalDate.now().toString()) } },enabled=!disabled)
                    else {
                        Text("Срок пункта")
                        if (!disabled) AuthorDatePicker(item.getString("dueDate"),mode) { value -> changeItem { it.put("dueDate",value) } }
                        else UntranslatedText(sharedDetailDate(item.getString("dueDate"),mode))
                        AffairsIconButton("Убрать дату",AffairsAction.CLOSE,{ changeItem { it.put("dueDate",JSONObject.NULL) } },enabled=!disabled)
                    }
                }
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    if (!readOnly) {
                        AffairsIconButton("Переместить выше",AffairsAction.EXPAND,{ changeList { it.put("items",detailMove(items,itemIndex,-1)) } },enabled=!disabled&&itemIndex>0)
                        AffairsIconButton("Переместить ниже",AffairsAction.COLLAPSE,{ changeList { it.put("items",detailMove(items,itemIndex,1)) } },enabled=!disabled&&itemIndex+1<items.length())
                        AffairsIconButton("Удалить пункт",AffairsAction.DELETE,{ changeList { it.put("items",JSONArray(detailRows(items).filterIndexed { index,_ -> index!=itemIndex })) } },enabled=!disabled)
                    }
                    if (!item.isNull("linkedTaskId")&&!item.isNull("linkedProjectId")&&onOpen!=null) AffairsIconButton("Открыть связанную задачу",AffairsAction.NEXT,
                        { onOpen(item.getString("linkedProjectId"),item.getString("linkedTaskId")) },enabled=!disabled&&saved)
                    else if (!readOnly&&!linked&&onConvert!=null) {
                        val request=rememberSaveable(task.getString("id"),item.getString("id")) { UUID.randomUUID().toString() }
                        AffairsIconButton("Превратить в задачу",AffairsAction.TASK,{onConvert(item.getString("id"),request)},enabled=!disabled&&saved&&task.isNull("completedAt"))
                    }
                }
            }
        }
        if(items.length()>limit) AffairsIconButton("Показать ещё",AffairsAction.MORE,{limit+=5})
        if (!readOnly) AffairsIconButton("Добавить пункт",AffairsAction.ADD,{
            changeList { it.getJSONArray("items").put(JSONObject().put("id",UUID.randomUUID().toString()).put("title","").put("done",false).put("assigneeId",JSONObject.NULL).put("dueDate",JSONObject.NULL).put("linkedTaskId",JSONObject.NULL)) };limit=items.length()+1
        },enabled=!disabled&&total<300)
        HorizontalDivider()
    }
    if (!readOnly) AffairsIconButton("Добавить чек-лист",AffairsAction.ADD,{
        change { it.getJSONArray("checklists").put(JSONObject().put("id",UUID.randomUUID().toString()).put("title",defaultChecklistTitle).put("items",JSONArray())) }
    },enabled=!disabled&&checklists.length()<20)
    }
}
