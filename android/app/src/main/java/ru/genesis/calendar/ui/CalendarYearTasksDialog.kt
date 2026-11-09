package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarRange
import ru.genesis.calendar.data.TaskOccurrences
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable internal fun CalendarYearTasksDialog(range:CalendarRange,tasks:List<LocalTask>,use24:Boolean,shared:Boolean,
    sharedCounts:Map<String,Int>,loadSharedDay:suspend(LocalDate)->List<SharedCalendarEntry>,
    onComplete:(LocalTask)->Unit,onCreate:(LocalDate)->Unit,onEdit:(LocalTask,LocalDate)->Unit,
    onDelete:(LocalTask,LocalDate)->Unit,onShared:(SharedCalendarEntry)->Unit,onClose:()->Unit) {
    val locale=Locale.forLanguageTag(LocalGenesisLanguage.current)
    val personal=remember(tasks,range){TaskOccurrences.byDate(tasks,range.start,range.end)}
    var sharedTasks by remember(range){mutableStateOf<Map<LocalDate,List<SharedCalendarEntry>>?>(null)}
    var failed by remember(range){mutableStateOf(false)};var retry by remember{mutableIntStateOf(0)}
    LaunchedEffect(range,shared,sharedCounts,retry){if(shared){failed=false
        try{val loaded=linkedMapOf<LocalDate,List<SharedCalendarEntry>>()
            for(day in range.dates()) if((sharedCounts[day.toString()]?:0)>0)loaded[day]=loadSharedDay(day)
            sharedTasks=loaded
        }catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}
    }}
    Dialog(onDismissRequest=onClose){Surface(Modifier.fillMaxWidth().heightIn(max=640.dp).testTag("calendar-year-task-dialog"),shape=AffairsLayout.shape){
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            GenesisDialogHeader(onClose=onClose){Text(if(shared)"Общие задачи месяца" else "Задачи месяца",style=MaterialTheme.typography.titleLarge)}
            Text("${range.start.format(DateTimeFormatter.ofPattern("d MMM yyyy",locale))} — ${range.end.format(DateTimeFormatter.ofPattern("d MMM yyyy",locale))}",
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            when{
                shared&&failed->{Text("Не удалось загрузить задачи",color=MaterialTheme.colorScheme.error);TextButton({retry++}){Text("Повторить")}}
                shared&&sharedTasks==null->WorkspaceLoadingIndicator()
                else->{val days=range.dates().filter{if(shared)!sharedTasks?.get(it).isNullOrEmpty() else !personal[it.toString()].isNullOrEmpty()}
                    if(days.isEmpty())Text("В этом месяце задач нет.")
                    LazyColumn(Modifier.weight(1f,fill=false).fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
                        items(days,key={it.toString()}){day->
                            if(shared)Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                                Text(day.format(DateTimeFormatter.ofPattern("d MMM",locale)),style=MaterialTheme.typography.titleSmall)
                                sharedTasks?.get(day).orEmpty().forEach{entry->OutlinedButton({onShared(entry)},Modifier.fillMaxWidth()){
                                    UntranslatedText("${if(entry.completed)"✓ " else ""}${entry.title} · ${entry.projectTitle}")}}
                            }else CalendarInlineTasks(day,personal[day.toString()].orEmpty(),use24,onComplete,
                                onCreate={onCreate(day)},onEdit={onEdit(it,day)},onDelete={onDelete(it,day)})
                        }
                    }
                }
            }
        }
    }}
}
