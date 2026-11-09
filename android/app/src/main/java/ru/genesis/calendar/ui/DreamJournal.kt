package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.data.DiaryNote
import ru.genesis.calendar.data.DiaryRecord
import ru.genesis.calendar.data.DiaryRepository
import ru.genesis.calendar.data.DreamJournalModel
import ru.genesis.calendar.data.TrackersRepository
import ru.genesis.calendar.data.LocalTrackersWorkspace
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.CalendarMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun dreamCopy(): JSONObject {
    val context=LocalContext.current; val language=LocalGenesisLanguage.current
    return remember(context,language) { context.assets.open("originals/i18n/dream-journal-copy.json").bufferedReader()
        .use { JSONObject(it.readText()).getJSONObject(language) } }
}
@Composable private fun dreamDiaryCopy(): JSONObject {
    val context=LocalContext.current; val language=LocalGenesisLanguage.current
    return remember(context,language) { context.assets.open("originals/i18n/diary-copy.json").bufferedReader()
        .use { JSONObject(it.readText()).getJSONObject(language) } }
}

@Composable private fun dreamDictationCopy(): JSONObject {
    val context=LocalContext.current;val language=LocalGenesisLanguage.current
    return remember(context,language){context.assets.open("originals/i18n/dictation-copy.json").bufferedReader(Charsets.UTF_8)
        .use{JSONObject(it.readText()).getJSONObject(language)}}
}

internal val LocalDreamJournalEnabled=staticCompositionLocalOf { true }
internal val LocalDreamRepository=staticCompositionLocalOf<DiaryRepository?> { null }

@Composable internal fun TodayDreamJournal(app: GenesisApplication, repository: DiaryRepository, mode: CalendarMode) {
    val state by repository.state.collectAsStateWithLifecycle()
    val trackers = remember(app, app.workspaceScope) { TrackersRepository(app) }
    var data by remember(trackers) { mutableStateOf<LocalTrackersWorkspace?>(null) }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(trackers) {
        try { trackers.workspace.collect { data = it } } catch(cancel:CancellationException){throw cancel}catch(_:Exception){data=null}
    }
    LaunchedEffect(repository) {
        try { repository.loadCached(); repository.refresh() } catch(cancel: CancellationException) { throw cancel } catch(_: Exception) { }
    }
    LaunchedEffect(Unit) { while(true) { delay(30_000); now=Instant.now() } }
    val window = DreamJournalModel.morning(data?.sleepPlans.orEmpty(), data?.sleepEntries.orEmpty(), now)
    if(LocalDreamJournalEnabled.current && (state.dreamSettings.todayMode == "all-day" || state.dreamSettings.todayMode == "morning" && window.visible))
        DreamJournal(repository, LocalDate.now(), mode, compact=true, wakeSource=if(state.dreamSettings.todayMode=="morning")window.source else null)
}

@Composable internal fun DreamJournal(repository: DiaryRepository, date: LocalDate, mode: CalendarMode, compact:Boolean=false, wakeSource:String?=null, onDateChange:(LocalDate)->Unit={}) {
    if(!LocalDreamJournalEnabled.current)return
    val state by repository.state.collectAsStateWithLifecycle()
    val scope=rememberCoroutineScope();val text=dreamCopy();val common=dreamDiaryCopy()
    val access=LocalFeatureAccess.current;val upgrade=LocalNativeUpgrade.current
    var open by remember { mutableStateOf(false) };var record by remember { mutableStateOf<DiaryRecord?>(null) }
    var history by rememberSaveable { mutableStateOf(false) };var failed by remember { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("all") };var query by rememberSaveable { mutableStateOf("") }
    var historyDay by rememberSaveable { mutableStateOf(date.toString()) }
    var showStats by rememberSaveable { mutableStateOf(false) };var showDrafts by rememberSaveable { mutableStateOf(false) }
    val dreams=DreamJournalModel.uniqueDreams(state.records)
    val otherDrafts=state.records.filter { row -> row.note.dreamDay!=null&&row.draft&&dreams.none { it.draftKey==row.draftKey } }
    LaunchedEffect(repository) { try { repository.loadCached();repository.refresh();failed=false }
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true} }
    Surface(Modifier.fillMaxWidth().testTag("dream-journal"),shape=AffairsLayout.shape,color=MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(text.getString("title"),style=MaterialTheme.typography.titleLarge)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Button({if(access.allows("dream-journal")){record=null;open=true}else upgrade?.invoke("dream-journal")},
                    Modifier.weight(1f).heightIn(min=48.dp).testTag("dream-record"),enabled=state.ready&&!state.protected) { Text(text.getString("record"),maxLines=1) }
                OutlinedButton({history=true},Modifier.weight(1f).heightIn(min=48.dp).testTag("dream-history")) { Text(text.getString("history"),maxLines=1) }
            }
            if(compact)wakeSource?.let{Text(text.getString(if(it=="actual")"actualWake" else "plannedWake"),style=MaterialTheme.typography.bodySmall)}
        }
    }
    if(history) Dialog(onDismissRequest={history=false},properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxWidth().fillMaxHeight(.9f).testTag("dream-history-dialog"),shape=AffairsLayout.shape) {
            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                GenesisDialogHeader(onClose={history=false}){Text(text.getString("history"),style=MaterialTheme.typography.titleLarge)}
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        listOf(Triple("all","all","history"),Triple("day","dayOnly","calendar-days"),Triple("favorites","favorites","star"),Triple("lucid","lucid","moon")).forEach{(value,label,icon)->
                            IconToggleButton(filter==value,{filter=value},Modifier.weight(1f).heightIn(min=48.dp).testTag("dream-filter-"+value)
                                .semantics{contentDescription=text.getString(label)}) { GenesisLucideIcon(icon,Modifier.size(22.dp)) }
                        }
                    }
                    if(filter=="day")AuthorDatePicker(historyDay,mode){historyDay=it}
                    OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth().testTag("dream-search"),singleLine=true,label={Text(text.getString("search"))})
                    TextButton({showStats=!showStats},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("statistics"))}
                    if(showStats)listOf("total" to dreams.size,"days" to dreams.map{it.note.dreamDay}.distinct().size,"favorites" to dreams.count{it.note.reaction=="favorite"},"lucid" to dreams.count{it.note.lucid}).forEach{(label,count)->
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(text.getString(label));Text(count.toString())}
                    }
                    if(!state.syncEnabled){Text(text.getString("cloud"));OutlinedButton({scope.launch{try{repository.setSyncEnabled(true);failed=false}catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}}}){Text(common.getString("retry"))}}
                    if(failed){Text(common.getString("error"),color=MaterialTheme.colorScheme.error);OutlinedButton({scope.launch{try{repository.refresh();failed=false}catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}}}){Text(common.getString("retry"))}}
                    if(state.offline)Text(common.getString("offline"),style=MaterialTheme.typography.bodySmall)
                    val notes=dreams.filter{(filter!="day"||it.note.dreamDay==historyDay)&&(filter!="favorites"||it.note.reaction=="favorite")&&(filter!="lucid"||it.note.lucid)&&DreamJournalModel.matches(it.note,query)}.sortedWith(compareByDescending<DiaryRecord>{it.note.dreamDay}.thenByDescending{it.note.updatedAt})
                    if(state.ready&&notes.isEmpty())Text(text.getString(if(query.isNotBlank()||filter!="all")"noMatches" else "empty"))
                    notes.forEach{row->Surface(onClick={record=row;open=true},modifier=Modifier.fillMaxWidth().testTag("dream-entry-"+row.note.id),shape=AffairsLayout.shape,color=MaterialTheme.colorScheme.surfaceContainerLow){
                        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                            UntranslatedText(row.note.title.ifBlank{text.getString("title")},style=MaterialTheme.typography.titleMedium)
                            Text(listOfNotNull(row.note.dreamDay,if(row.note.reaction=="favorite")text.getString("favorites")else null,if(row.note.lucid)text.getString("lucid")else null).joinToString(" · "),style=MaterialTheme.typography.bodySmall)
                            UntranslatedText(row.note.body.take(180));if(row.draft||row.localOnly)Text(common.getString("draft"))
                        }
                    }}
                    if(otherDrafts.isNotEmpty()){
                        TextButton({showDrafts=!showDrafts},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(common.getString("drafts")+" · "+otherDrafts.size)}
                        if(showDrafts){Text(common.getString("draftHint"));otherDrafts.forEach{row->OutlinedButton({record=row;open=true},Modifier.fillMaxWidth().testTag("dream-recover-"+row.draftKey)){UntranslatedText(row.note.title.ifBlank{text.getString("title")})}}}
                    }
                }
            }
        }
    }
    if(open)DreamEditor(repository,record,LocalDate.now(),mode,onSaved={day->onDateChange(LocalDate.parse(day));open=false;record=null}){open=false;record=null}
}

@Composable internal fun DreamJournalSettings(repository:DiaryRepository,enabled:Boolean=true){
    val state by repository.state.collectAsStateWithLifecycle();val scope=rememberCoroutineScope();val text=dreamCopy();val common=dreamDiaryCopy()
    var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxWidth().testTag("dream-today-settings"),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(text.getString("showToday"),style=MaterialTheme.typography.titleSmall)
        listOf("off" to "hidden","morning" to "morning","all-day" to "allDay").forEach{(value,label)->
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                RadioButton(state.dreamSettings.todayMode==value,{if(!busy){busy=true;scope.launch{try{repository.setDreamTodayMode(value);error=false}catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=true}finally{busy=false}}}},enabled=enabled&&state.ready&&state.syncEnabled&&!busy)
                Text(text.getString(label))
            }
        }
        Text(text.getString("morningHint"),style=MaterialTheme.typography.bodySmall)
        if(error)Text(common.getString("error"),color=MaterialTheme.colorScheme.error)
    }
}

@Composable private fun DreamEditor(repository:DiaryRepository,record:DiaryRecord?,date:LocalDate,mode:CalendarMode,onSaved:(String)->Unit,onClose:()->Unit) {
    val text=dreamCopy();val common=dreamDiaryCopy();val scope=rememberCoroutineScope()
    val dictationCopy=dreamDictationCopy();val language=LocalGenesisLanguage.current;val context=LocalContext.current
    val app=context.applicationContext as GenesisApplication
    val state by repository.state.collectAsStateWithLifecycle()
    val access=LocalFeatureAccess.current
    val key=record?.draftKey?:record?.note?.id?:"new-dream"
    val editorAccountScope=remember(repository,key){app.workspaceScope}
    val spellingPatches=remember(repository,key){DictationPatches()}
    var spellingEnabled by remember(repository,key,language){mutableStateOf(false)}
    val currentSpellingEnabled by rememberUpdatedState(spellingEnabled)
    val currentLanguage by rememberUpdatedState(language)
    val currentEditorKey by rememberUpdatedState(key)
    DisposableEffect(spellingPatches){onDispose{spellingPatches.clear()}}
    val saver=remember(repository){Saver<String,String>(save={repository.sealEditorState(it)},restore={repository.openEditorState(it)})}
    var formJson by rememberSaveable(key,stateSaver=saver){mutableStateOf((record?.note?.json()?:DiaryNote.newDraftJson()
        .put("dream",JSONObject().put("day",date.toString()).put("timeZone",ZoneId.systemDefault().id))).toString())}
    var draftKey by rememberSaveable(key){mutableStateOf(record?.draftKey)}
    val form=JSONObject(formJson);val dream=form.getJSONObject("dream")
    var today by remember { mutableStateOf<String?>(null) };var checking by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) };var saving by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf(false) };var recording by remember { mutableStateOf(false) }
    var voicePending by remember { mutableStateOf(false) };var deleteConfirm by remember { mutableStateOf(false) }
    var voicePartial by remember(key) { mutableStateOf("") }
    val voiceGeneration=remember { intArrayOf(0) }
    val voiceCommit=remember(key){arrayOfNulls<Pair<String,String>>(1)}
    var changed by rememberSaveable(key) { mutableStateOf(false) }
    fun update(field:String,value:String){formJson=JSONObject(formJson).put(field,value).toString();changed=true;error=null}
    fun checkFinalPhrase(heard:String,generation:Int){
        val candidate=voiceCommit[0];voiceCommit[0]=null
        if(candidate==null||candidate.first!=heard.trim()||candidate.second!=JSONObject(formJson).getString("body"))return
        if(!spellingEnabled||language !in dictationSpellerLanguages||generation!=voiceGeneration[0])return
        if(heard.length>4_000){error=dictationCopy.getString("unavailable");return}
        val ticket=spellingPatches.track(JSONObject(formJson).getString("body"),heard)?:return
        fun ownsPatch()=currentSpellingEnabled&&currentLanguage==language&&currentEditorKey==key&&
            generation==voiceGeneration[0]&&app.workspaceScope==editorAccountScope&&!saving&&!deleteConfirm&&spellingPatches.contains(ticket)
        scope.launch{
            try{
                val corrected=correctDictatedPhrase(heard.trim(),language)
                if(ownsPatch())spellingPatches.apply(JSONObject(formJson).getString("body"),ticket,corrected)?.let{update("body",it)}
            }catch(timeout:TimeoutCancellationException){if(ownsPatch())error=dictationCopy.getString("unavailable")}
            catch(cancel:CancellationException){throw cancel}
            catch(_:Exception){if(ownsPatch())error=dictationCopy.getString("unavailable")}
            finally{spellingPatches.discard(ticket)}
        }
    }
    fun stopVoice(){
        if(recording&&voicePartial.isNotBlank())update("body",appendDictationText(JSONObject(formJson).getString("body"),voicePartial).take(30_000))
        voicePartial="";voiceCommit[0]=null;voiceGeneration[0]++;recording=false;spellingPatches.clear()
    }
    fun note()=DiaryNote.parse(JSONObject(formJson).put("updatedAt",Instant.now().toString()))
    suspend fun keep():Boolean = try {
        if(changed&&JSONObject(formJson).getString("body").isNotBlank()) draftKey=repository.keepDraft(note(),record?.revision?:0,draftKey).draftKey
        true
    }catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=common.getString("draftError");false}
    fun close(){if(!saving&&!deleteConfirm){stopVoice();scope.launch{if(keep())onClose()}}}
    LaunchedEffect(access.allows("dream-voice")){if(!access.allows("dream-voice")&&recording)stopVoice()}
    LaunchedEffect(repository,key){
        try{val serverDay=repository.dreamToday(dream.getString("timeZone"));today=serverDay
            if(record==null)formJson=JSONObject(formJson).apply{getJSONObject("dream").put("day",serverDay)}.toString()
        }catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=common.getString("error")}
        finally{checking=false}
    }
    LaunchedEffect(formJson,saving,deleteConfirm){if(changed&&!saving&&!deleteConfirm){delay(650);keep()}}
    val valid=today!=null&&dream.getString("day")<=today!!&&form.getString("body").isNotBlank()
    Dialog(onDismissRequest=::close,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxWidth().testTag("dream-editor"),shape=AffairsLayout.shape) {
            Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                GenesisDialogHeader(onClose=::close,enabled=!saving&&!deleteConfirm,actions={
                    AuthorDatePicker(dream.getString("day"),mode,maxDate=today?.let(LocalDate::parse),enabled=!saving&&!checking,compact=true){chosen->
                        formJson=JSONObject(formJson).apply{getJSONObject("dream").put("day",chosen)}.toString();changed=true;error=null}
                }){Text(text.getString("record"),style=MaterialTheme.typography.titleMedium,maxLines=1,softWrap=false)}
                Column(Modifier.weight(1f,fill=false).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    if(checking)Text(text.getString("check"))
                    if(today!=null&&dream.getString("day")>today!!)Text(text.getString("future"),color=MaterialTheme.colorScheme.error)
                    OutlinedTextField(form.getString("title"),{update("title",it.take(200))},Modifier.fillMaxWidth().testTag("dream-title"),
                        label={Text(common.getString("heading"))},enabled=!saving)
                    OutlinedTextField((if(recording)appendDictationText(form.getString("body"),voicePartial) else form.getString("body")).take(30_000),
                        {spellingPatches.clear();update("body",it.take(30_000))},Modifier.fillMaxWidth().heightIn(min=180.dp).testTag("dream-body"),
                        label={Text(common.getString("body"))},minLines=5,maxLines=10,enabled=!saving,readOnly=recording)
                    Row(Modifier.fillMaxWidth().testTag("dream-flags"),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                        Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically){
                            Checkbox(form.optString("reaction")=="favorite",{checked->formJson=JSONObject(formJson).put("reaction",if(checked)"favorite" else JSONObject.NULL).toString();changed=true},enabled=!saving&&!deleteConfirm,modifier=Modifier.testTag("dream-favorite"))
                            Text(text.getString("favorites"),fontSize=12.sp,maxLines=1,softWrap=false)
                        }
                        Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically){
                            Checkbox(dream.optBoolean("lucid"),{checked->formJson=JSONObject(formJson).apply{getJSONObject("dream").put("lucid",checked)}.toString();changed=true},enabled=!saving&&!deleteConfirm,modifier=Modifier.testTag("dream-lucid"))
                            Text(text.getString("lucid"),fontSize=12.sp,maxLines=1,softWrap=false)
                        }
                    }
                    if(access.allows("dream-voice")) {
                        if(recording) {
                            val generation=voiceGeneration[0]
                            VoiceSpeechInput(onTranscript = { heard ->
                                if(generation==voiceGeneration[0]){
                                    voicePartial=""
                                    val before=JSONObject(formJson).getString("body")
                                    val appended=appendDictationText(before,heard)
                                    voiceCommit[0]=if(appended.length<=30_000&&appended.length>before.length)heard.trim() to appended else null
                                    update("body",appended.take(30_000))
                                }
                            }, onFinished = { if(generation==voiceGeneration[0]){voicePartial="";recording=false} },
                                onFailure = { message -> if(generation==voiceGeneration[0]){voicePartial="";recording=false;error=message} },
                                onPartialTranscript = { heard -> if(generation==voiceGeneration[0])voicePartial=heard },
                                onFinalTranscript = { heard -> checkFinalPhrase(heard,generation) })
                        } else {
                            OutlinedButton({if(!saving&&!recording&&!voicePending&&!deleteConfirm){voicePending=true;val generation=++voiceGeneration[0];scope.launch{
                                try{repository.authorizeDreamVoice();if(generation==voiceGeneration[0]){error=null;voicePartial="";recording=true}}
                                catch(cancel:CancellationException){throw cancel}catch(_:Exception){recording=false;error=text.getString("unavailable")}
                                finally{voicePending=false}
                            }}},Modifier.fillMaxWidth().testTag("dream-voice"),enabled=!saving&&!recording&&!voicePending&&!deleteConfirm){Text(text.getString("voice"))}
                        }
                        Text(text.getString("voicePrivacy"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        if(language in dictationSpellerLanguages){
                            Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("dream-dictation-spellcheck")
                                .toggleable(spellingEnabled,enabled=!saving&&!deleteConfirm,role=Role.Checkbox){enabled->
                                    spellingPatches.clear();spellingEnabled=enabled},
                                verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                                Checkbox(spellingEnabled,onCheckedChange=null,enabled=!saving&&!deleteConfirm)
                                UntranslatedText(dictationCopy.getString("spellcheck"),Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                            }
                            UntranslatedText(dictationCopy.getString("privacy"),style=MaterialTheme.typography.bodySmall,
                                color=MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick={runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(dictationSpellerCreditUrl)))}
                                .onFailure{error=dictationCopy.getString("unavailable")}},modifier=Modifier.heightIn(min=48.dp)){
                                UntranslatedText(dictationCopy.getString("credit"))
                            }
                        }
                    } else Text(text.getString("premium"),style=MaterialTheme.typography.bodySmall)
                    Text(common.getString("private"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if(!state.syncEnabled)Text(text.getString("cloud"),color=MaterialTheme.colorScheme.error)
                    error?.let{Text(it,color=MaterialTheme.colorScheme.error,modifier=Modifier.testTag("dream-error"))}
                    OutlinedButton({stopVoice();deleteConfirm=true},Modifier.fillMaxWidth().testTag("dream-delete"),enabled=!saving,
                        colors=ButtonDefaults.outlinedButtonColors(contentColor=MaterialTheme.colorScheme.error)) { Text(text.getString(if(record!=null&&!record.draft)"deleteDream" else "discard")) }
                }
                Button({saving=true;scope.launch{
                    try{repository.save(note(),record?.revision?:0,draftKey);onSaved(dream.getString("day"))}
                    catch(cancel:CancellationException){throw cancel}catch(_:ru.genesis.calendar.data.DiaryConflict){conflict=true;error=common.getString("conflict")}
                    catch(_:Exception){error=common.getString("error")}
                    finally{saving=false}
                }},Modifier.fillMaxWidth().testTag("dream-save"),enabled=valid&&!checking&&!saving&&!recording&&!voicePending&&!deleteConfirm&&state.syncEnabled&&access.allows("dream-journal")){Text(common.getString("save"))}
                if(conflict)OutlinedButton({saving=true;scope.launch{try{repository.saveCopy(note(),draftKey);onSaved(dream.getString("day"))}
                    catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=common.getString("error")}
                    finally{saving=false}}},Modifier.fillMaxWidth(),enabled=!saving&&valid&&state.syncEnabled){Text(common.getString("copy"))}
            }
        }
    }
    if(deleteConfirm) AlertDialog(onDismissRequest={if(!saving)deleteConfirm=false},
        title={Text(text.getString(if(record!=null&&!record.draft)"deleteDream" else "discard"))},
        text={Text(text.getString(if(record!=null&&!record.draft)"deleteConfirm" else "discardConfirm"))},
        confirmButton={TextButton({if(!saving){saving=true;stopVoice();scope.launch {
            try { if(record!=null&&!record.draft)repository.remove(record) else repository.discardEditorDraft(form.getString("id"),draftKey);changed=false;onClose() }
            catch(cancel:CancellationException){throw cancel}catch(_:Exception){deleteConfirm=false;error=common.getString("error")}
            finally{saving=false}
        }}},enabled=!saving,modifier=Modifier.testTag("dream-delete-confirm")){Text(text.getString("deleteAction"))}},
        dismissButton={TextButton({deleteConfirm=false},enabled=!saving){Text(text.getString("cancel"))}})
}
