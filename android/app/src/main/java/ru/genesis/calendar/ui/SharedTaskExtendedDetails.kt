package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

@Composable internal fun SharedTaskCardBody(content:@Composable ColumnScope.()->Unit) {
    Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)
}

/** Keep the task graph/editor composition outside the workspace method's JVM size limit. */
@Composable internal fun SharedTaskExtendedDetails(gateway:SharedWorkspaceGateway,task:JSONObject,draft:JSONObject,
    members:List<JSONObject>,statuses:List<JSONObject>,prefs:UiPreferences,mode:CalendarMode,
    disabled:Boolean,readOnly:Boolean,saved:Boolean,onChange:(JSONObject)->Unit,onOpen:(String,String)->Unit,
    run:((suspend ()->Unit)->Unit),onPending:()->Unit,onReload:suspend(JSONObject,Boolean)->Unit) {
    val project=task.getString("projectId");val id=task.getString("id")
    SharedTaskRelations(gateway,task,draft,members,disabled,readOnly,saved,mode,onChange,onOpen) { title ->
        val status=statuses.firstOrNull { it.optInt("isDone")==0 }?.getString("id") ?: error("INVALID_STATUS")
        val created=gateway.createSharedTask(project,JSONObject().put("title",title).put("statusId",status)
            .put("parentTaskId",id).put("priority",draft.optInt("priority"))).getJSONObject("task")
        if(created.optBoolean("pending"))onPending()
        else onReload(gateway.sharedTask(project,id).getJSONObject("task"),false)
    }
    SharedTaskDetailsFields(task,draft,onChange,disabled,readOnly,members,mode,saved,onOpen,
        if(readOnly)null else { item,request->run {
            gateway.convertSharedChecklist(project,id,item,task.getInt("revision"),request)
            onReload(gateway.sharedTask(project,id).getJSONObject("task"),true)
        } })
    if(task.isNull("archivedAt")&&!task.optBoolean("pending"))SharedTaskNotificationWatch(gateway,project,id,prefs.use24)
}
