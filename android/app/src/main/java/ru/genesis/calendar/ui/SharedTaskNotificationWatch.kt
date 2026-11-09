package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.auth.SharedWorkspaceGateway

@Composable internal fun SharedTaskNotificationWatch(gateway:SharedWorkspaceGateway,project:String,task:String,use24:Boolean) {
    val scope=rememberCoroutineScope();var watching by remember(project,task){mutableStateOf<Boolean?>(null)}
    var busy by remember(project,task){mutableStateOf(false)};var failure by remember(project,task){mutableStateOf(false)}
    var attempt by remember(project,task){mutableIntStateOf(0)};var settings by remember(project,task){mutableStateOf(false)}
    LaunchedEffect(gateway,project,task,attempt) {
        watching=null;failure=false
        try { watching=gateway.sharedTaskWatch(project,task).getBoolean("watching") }
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){failure=true}
    }
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        AffairsIconButton("Наблюдение за задачей",AffairsAction.VIEW,{
            if(watching!=null&&!busy){busy=true;failure=false;scope.launch {
                try { watching=gateway.sharedTaskWatch(project,task,!watching!!).getBoolean("watching") }
                catch(cancel:CancellationException){throw cancel}catch(_:Exception){failure=true}finally{busy=false}
            }}
        },Modifier.semantics{selected=watching==true},enabled=watching!=null&&!busy,selected=watching==true)
        AffairsIconButton("Настройки уведомлений",AffairsAction.SETTINGS,{settings=true})
        if(failure)AffairsIconButton("Обновить",AffairsAction.REFRESH,{attempt++},enabled=!busy)
    }
    if(failure)Text("Не удалось загрузить данные",color=MaterialTheme.colorScheme.error)
    if(settings)Dialog(onDismissRequest={settings=false}) {
        Surface(shape=AffairsLayout.shape,color=MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().heightIn(max=620.dp).padding(16.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("Настройки уведомлений",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);AffairsIconButton("Закрыть",AffairsAction.CLOSE,{settings=false})}
                EmailNotificationSettings(gateway,use24)
            }
        }
    }
}
