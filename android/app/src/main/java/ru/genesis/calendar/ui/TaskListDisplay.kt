package ru.genesis.calendar.ui

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalTask
import java.time.Instant

internal val LocalGenesisUserId=staticCompositionLocalOf { "local" }
internal enum class TaskListSort(val wire:String,val ru:String,val en:String) {
    DEFAULT("position","Обычный порядок","Default order"),NEWEST("createdAt","Новые вверху","Newest first"),
    OLDEST("createdAtAsc","Старые вверху","Oldest first"),DUE("dueDate","Ближайший срок","Due date"),
    UPDATED("updatedAt","Последние изменения","Recently updated"),TITLE("title","По названию","Title")
}
internal fun orderPersonalTasks(tasks:List<LocalTask>,sort:TaskListSort):List<LocalTask> {
    if(sort==TaskListSort.DEFAULT)return tasks
    fun stamp(task:LocalTask,field:String):Long=runCatching {
        val value=JSONObject(task.sourceFieldsJson).optString(field)
        value.toLongOrNull()?:Instant.parse(value).toEpochMilli()
    }.getOrDefault(0)
    return when(sort){
        TaskListSort.NEWEST->tasks.sortedByDescending { stamp(it,"createdAt") }
        TaskListSort.OLDEST->tasks.sortedBy { stamp(it,"createdAt") }
        TaskListSort.UPDATED->tasks.sortedByDescending { stamp(it,"updatedAt") }
        TaskListSort.DUE->tasks.sortedBy { it.date.ifBlank { "9999-12-31" } }
        TaskListSort.TITLE->tasks.sortedBy { it.title.lowercase() }
        else->tasks
    }
}
@Composable internal fun rememberTaskListSort(area:String):Pair<TaskListSort,(TaskListSort)->Unit> {
    val app=LocalContext.current.applicationContext as GenesisApplication
    val prefs=remember(app) { app.getSharedPreferences("genesis.task-display.v1",0) }
    val key="${app.workspaceScope}:$area:sort"
    var value by remember(key) { mutableStateOf(TaskListSort.entries.firstOrNull { it.wire==prefs.getString(key,null) }?:TaskListSort.DEFAULT) }
    return value to { next->value=next;prefs.edit().putString(key,next.wire).apply() }
}
@Composable internal fun TaskListSortChoice(value:TaskListSort,onChange:(TaskListSort)->Unit,
    modifier:Modifier,compact:Boolean,iconOnly:Boolean=false) {
    var open by remember { mutableStateOf(false) };val en=LocalGenesisLanguage.current=="en"
    val label=(if(en) "Sort tasks: " else "Сортировка задач: ")+(if(en)value.en else value.ru)
    val description=genesisTranslate(label)
    Box(modifier) {
        if (iconOnly) {
            AffairsIconButton(label, AffairsAction.SORT, { open = true },
                Modifier.testTag("task-sort-control"))
        } else {
            OutlinedButton(onClick={open=true},modifier=Modifier.heightIn(min=48.dp)
            .then(if(compact)Modifier.fillMaxWidth() else Modifier).testTag("task-sort-control")
            .semantics { contentDescription=description }) {
                Text(if(compact)(if(en)value.en else value.ru) else label)
            }
        }
        DropdownMenu(expanded=open,onDismissRequest={open=false}) {
            TaskListSort.entries.forEach { order->DropdownMenuItem(text={Text(if(en)order.en else order.ru)},
                onClick={onChange(order);open=false},modifier=Modifier.testTag("task-sort-${order.wire}").selectedControlDecoration(value == order)
                    .semantics { selected = value == order }) }
        }
    }
}
@Composable internal fun TaskListSortChoice(value:TaskListSort,onChange:(TaskListSort)->Unit) {
    TaskListSortChoice(value,onChange,Modifier,false)
}
internal fun personalTaskComments(task:LocalTask):List<JSONObject> = runCatching {
    val rows=JSONObject(task.sourceFieldsJson).optJSONArray("comments")
    (0 until (rows?.length()?:0)).mapNotNull { rows?.optJSONObject(it) }
}.getOrDefault(emptyList())
@Composable internal fun personalUnreadComments(task:LocalTask):Int {
    val app=LocalContext.current.applicationContext as GenesisApplication
    val prefs=remember(app) { app.getSharedPreferences("genesis.task-display.v1",0) }
    val key="${app.workspaceScope}:comments:${task.id}";val uid=LocalGenesisUserId.current
    var revision by remember(key) { mutableIntStateOf(0) }
    DisposableEffect(prefs,key){
        val listener=SharedPreferences.OnSharedPreferenceChangeListener { _,changed->if(changed==key)revision++ }
        prefs.registerOnSharedPreferenceChangeListener(listener);onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return remember(task.sourceFieldsJson,key,uid,revision){
        val read=prefs.getStringSet(key,emptySet()).orEmpty()
        personalTaskComments(task).count { it.optString("authorId")!=uid&&it.optString("id") !in read }
    }
}
@Composable internal fun UnreadCommentBadge(count:Int) {
    if(count<=0)return
    Surface(color=MaterialTheme.colorScheme.secondaryContainer,shape=MaterialTheme.shapes.small) {
        Text((if(LocalGenesisLanguage.current=="en")"Unread comments: " else "Новые комментарии: ")+count,
            Modifier.padding(horizontal=8.dp,vertical=4.dp).testTag("unread-comment-count"),style=MaterialTheme.typography.labelMedium)
    }
}
@Composable internal fun PersonalTaskDiscussion(task:LocalTask) {
    val comments=remember(task.sourceFieldsJson){personalTaskComments(task)};if(comments.isEmpty())return
    val app=LocalContext.current.applicationContext as GenesisApplication
    var expanded by remember(task.id) { mutableStateOf(false) };val count=personalUnreadComments(task)
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        TextButton(onClick={
            expanded=!expanded
            if(expanded){
                val prefs=app.getSharedPreferences("genesis.task-display.v1",0);val key="${app.workspaceScope}:comments:${task.id}"
                prefs.edit().putStringSet(key,comments.map { it.optString("id") }.toSet()).apply()
            }
        },modifier=Modifier.heightIn(min=48.dp).testTag("personal-task-comments")) {
            Text((if(LocalGenesisLanguage.current=="en")"Comments" else "Комментарии")+" · ${comments.size}"+(if(count>0)" · +$count" else ""))
        }
        if(expanded)comments.forEach { comment->Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(comment.optString("authorName"),style=MaterialTheme.typography.labelLarge)
            Text(comment.optString("body"),style=MaterialTheme.typography.bodyMedium)
        } }
    }
}
