package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

internal fun sharedDetailDate(value:String,mode:CalendarMode):String = runCatching {
    GenesisCalendar().formatDate(java.time.LocalDate.parse(value),mode)
}.getOrDefault(value)

@Composable internal fun SharedTaskRelations(gateway: SharedWorkspaceGateway, task: JSONObject, draft: JSONObject,
    members: List<JSONObject>, disabled: Boolean, readOnly: Boolean, saved: Boolean, mode: CalendarMode,
    onChange: (JSONObject) -> Unit, onOpen: (String, String) -> Unit, onCreate: suspend (String) -> Unit) {
    val id=task.getString("id");val project=task.getString("projectId");val scope=rememberCoroutineScope()
    var title by rememberSaveable(id) { mutableStateOf("") };var pending by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf(false) };val working=disabled||pending
    AffairsDisclosure("Подзадачи и родитель",Modifier.testTag("shared-task-relations")) {
        Text("Родитель завершается после подзадач и чек-листов. Подтверждения участников сохраняются.",style=MaterialTheme.typography.bodySmall)
        val children=rememberSharedTaskListReader(gateway)
        ObserveSharedTaskList(children,JSONObject().put("projectIds",JSONArray().put(project)).put("parentTaskId",id).put("includeArchived",true),"position",task.optInt("revision").toString(),true,true) {}
        Text(genesisTranslate("Выполнено: {done} из {total}").replace("{done}",task.optInt("completedChildCount").toString()).replace("{total}",task.optInt("childCount").toString()))
        val parentId=draft.opt("parentTaskId") as? String
        if(parentId!=null) key(parentId) {
            var parent by remember { mutableStateOf<JSONObject?>(null) };var failed by remember { mutableStateOf(false) };var attempt by remember { mutableIntStateOf(0) }
            LaunchedEffect(gateway,project,parentId,attempt) {
                parent=null;failed=false
                try { val result=gateway.sharedTask(project,parentId).getJSONObject("task");check(result.getString("id")==parentId&&result.getString("projectId")==project);parent=result }
                catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}
            }
            Text("Родительская задача",style=MaterialTheme.typography.titleSmall)
            OutlinedButton({onOpen(project,parentId)},enabled=!working&&saved&&parent!=null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                UntranslatedText(parent?.optString("title")?:genesisTranslate(if(failed)"Недоступно" else "Загрузка…"))
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                if(failed) AffairsIconButton("Обновить",AffairsAction.REFRESH,{attempt++},enabled=!working)
                if(!readOnly) AffairsIconButton("Отсоединить",AffairsAction.CLOSE,{onChange(JSONObject(draft.toString()).put("parentTaskId",JSONObject.NULL))},enabled=!working)
            }
        }
        if(!readOnly) AffairsDisclosure("Выбрать родительскую задачу") {
            var search by rememberSaveable(id) { mutableStateOf("") };val choices=rememberSharedTaskListReader(gateway)
            AffairsSearchField(search,{search=it.take(200)},"Поиск задач")
            ObserveSharedTaskList(choices,JSONObject().put("projectIds",JSONArray().put(project)).put("q",search).put("completion","open"),"title",id,true,true) {}
            choices.pageState.value?.getJSONArray("tasks")?.let { rows -> for(index in 0 until rows.length()) {
                val row=rows.getJSONObject(index);val target=row.getString("id")
                if(target!=id&&target!=parentId) OutlinedButton({onChange(JSONObject(draft.toString()).put("parentTaskId",target))},enabled=!working,
                    modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { UntranslatedText(row.getString("title")) }
            } }
            RelationPageControls(choices)
        }
        children.pageState.value?.getJSONArray("tasks")?.let { rows -> for(index in 0 until rows.length()) {
            val child=rows.getJSONObject(index)
            OutlinedButton({onOpen(child.getString("projectId"),child.getString("id"))},enabled=!working&&saved,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(child.getString("title"))
                    Text(if(!child.isNull("archivedAt"))"Архив задач" else if(!child.isNull("completedAt"))"Выполнено" else "В работе",style=MaterialTheme.typography.bodySmall)
                    UntranslatedText(members.firstOrNull { it.optString("userId")==child.optString("assigneeId") }?.optString("displayName")?:genesisTranslate(if(child.isNull("assigneeId"))"Не назначен" else "Бывший участник"),style=MaterialTheme.typography.bodySmall)
                    if(!child.isNull("dueDate")) UntranslatedText(sharedDetailDate(child.getString("dueDate"),mode),style=MaterialTheme.typography.bodySmall)
                }
            }
        } }
        RelationPageControls(children)
        if(!readOnly) {
            val canCreate=!working&&saved&&title.isNotBlank()&&task.isNull("completedAt")
            fun create() { if(!canCreate||pending)return;val input=title.trim();pending=true;error=false;scope.launch {
                try { onCreate(input);title="";children.refresh() }
                catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=true}finally{pending=false}
            } }
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=androidx.compose.ui.Alignment.Bottom) {
                OutlinedTextField(title,{if(it.length<=160)title=it},enabled=!working,label={Text("Новая подзадача")},singleLine=true,
                    keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={create()}),modifier=Modifier.weight(1f).testTag("shared-child-title"))
                AffairsIconButton("Добавить подзадачу",AffairsAction.ADD,{create()},enabled=canCreate)
            }
            if(!saved)Text("Сохраните изменения перед созданием подзадачи или превращением пункта в задачу.",style=MaterialTheme.typography.bodySmall)
            if(error)Text("Не удалось загрузить данные",color=MaterialTheme.colorScheme.error)
        }
    }
}

@Composable private fun RelationPageControls(reader:SharedTaskListReader) {
    val scope=rememberCoroutineScope();val page=reader.pageState.value
    if(page==null&&reader.error.isBlank())WorkspaceLoadingText()
    if(reader.error.isNotBlank()) {
        Text("Не удалось загрузить данные",color=MaterialTheme.colorScheme.error)
        AffairsIconButton("Обновить",AffairsAction.REFRESH,{scope.launch{reader.refresh()}},enabled=!reader.busy)
    }
    if(page?.optBoolean("hasMore")==true)AffairsIconButton("Показать ещё",AffairsAction.MORE,{scope.launch{reader.more()}},enabled=!reader.busy)
}
