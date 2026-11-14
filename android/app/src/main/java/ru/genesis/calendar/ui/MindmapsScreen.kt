package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.zIndex
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID
import ru.genesis.calendar.data.*
import kotlin.math.roundToInt

/** Native views read the same encrypted documents and reference ordinary task/project rows. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MindmapsScreen(repo:MindmapRepository,tasks:List<LocalTask>,projects:List<GenesisProject>,projectId:String?,onBack:()->Unit,
    onTask:(LocalTask,String?)->Unit,onCreate:(LocalTask)->Unit,onComplete:(LocalTask,String?)->Unit,onProject:(String)->Unit,
    readOnly:Boolean=false, taskCanEdit:(LocalTask)->Boolean={true}, workspaceTitle:String="Личные дела",
    onConvertIdea:((MindmapDocument,MindmapNode,String)->Unit)?=null,
    onTaskSearch:(String)->Unit={},taskPickerFooter:@Composable ()->Unit={}, onResolveTaskIds:(Set<String>)->Unit={},
    mapVisible:(MindmapDocument)->Boolean={true}, newMapProjectId:String?=projectId, backLabel:String="К личным делам") {
    val storedRecords by repo.records.collectAsState();val records=storedRecords.filter {mapVisible(it.document)};val scope=rememberCoroutineScope()
    val mapContext=LocalContext.current;val mapLanguage=LocalGenesisLanguage.current
    val canExchange = LocalFeatureAccess.current.allows("data-export")
    fun defaultLabel(source:String)=translateGenesisText(mapContext,source,mapLanguage)
    var mapId by rememberSaveable { mutableStateOf<String?>(null) };var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) };var busy by remember { mutableStateOf(false) };var query by rememberSaveable { mutableStateOf("") }
    var archived by rememberSaveable { mutableStateOf(false) };var create by rememberSaveable { mutableStateOf(false) };var title by rememberSaveable { mutableStateOf("") };var description by rememberSaveable {mutableStateOf("")}
    var editing by rememberSaveable { mutableStateOf<String?>(null) };var text by rememberSaveable { mutableStateOf("") };var note by rememberSaveable { mutableStateOf("") }
    var occurrenceTask by remember {mutableStateOf<LocalTask?>(null)};var occurrenceDate by rememberSaveable {mutableStateOf("")}
    var remove by remember { mutableStateOf(false) };var picker by remember { mutableStateOf(false) };var files by remember { mutableStateOf(false) }
    var exportMenu by remember { mutableStateOf(false) }
    var addMenu by remember { mutableStateOf(false) }
    var resetCanvas by remember { mutableIntStateOf(0) }
    var discardNodeDraft by remember { mutableStateOf(false) }
    var pickerQuery by rememberSaveable { mutableStateOf("") }
    var template by rememberSaveable {mutableStateOf("empty")}
    var serverPreview by remember {mutableStateOf(false)}
    var history by remember { mutableStateOf<List<NativeMapRecord>?>(null) };var import by remember { mutableStateOf(false) };var export by remember { mutableStateOf(false) }
    var view by remember { mutableStateOf(JSONObject().put("mode","map").put("zoom",1.0)) };var undo by remember { mutableStateOf<List<MindmapDocument>>(emptyList()) }
    val record=records.firstOrNull { it.document.id==mapId };val map=record?.document;val node=map?.nodes?.firstOrNull { it.id==selected } ?: map?.nodes?.firstOrNull()
    if (map != null && !readOnly) NativeGuidanceBlockingSurface()
    fun run(action:suspend ()->Unit) { if(busy)return;busy=true;error=null;scope.launch {try { action() }catch(e:Exception){error=e.message ?: "Не удалось сохранить. Черновик остаётся на устройстве."}finally{busy=false} } }
    fun save(next:MindmapDocument,remember:Boolean=true) { if(busy)return;if(readOnly){error="Нет доступа к изменению карты.";return};if(remember&&map!=null)undo=(undo+map).takeLast(20);run { repo.save(next) } }
    fun open(id:String) {mapId=id;selected=null;editing=null;undo=emptyList();query="";exportMenu=false;files=false}
    fun changeView(next:JSONObject) {view=next;mapId?.let { id->scope.launch { repo.saveView(id,next) } } }
    fun add(sibling:Boolean=false,point:Offset?=null) {if(map==null||node==null||busy||readOnly)return;val next=MindmapNode(UUID.randomUUID().toString(),if(sibling)node.parentId ?: node.id else node.id,text=defaultLabel("Новая мысль"))
        val previousNodes=map.nodes.map {if(editing!=null&&it.id==node.id)it.copy(text=if(it.kind=="idea")text else "",note=note) else it}
        selected=next.id;text=next.text;note="";editing=next.id;save(map.copy(nodes=previousNodes+next));if(point!=null) {val v=JSONObject(view.toString());val positions=v.optJSONObject("positions") ?: JSONObject();positions.put(next.id,JSONObject().put("x",point.x).put("y",point.y));changeView(v.put("positions",positions))} }
    fun linkedTask(n:MindmapNode):LocalTask? {
        if(n.kind!="task")return null
        val exception=n.occurrenceDate?.let {date->tasks.firstOrNull {val source=JSONObject(it.sourceFieldsJson);source.optString("recurrenceSeriesId")==n.refId&&source.optString("recurrenceOriginalDate",it.date)==date}}
        if(exception!=null)return exception
        val original=tasks.firstOrNull {it.id==n.refId} ?: return null
        if(original.recurrence.enabled&&(n.occurrenceDate==null||!TaskOccurrences.occursOn(original,java.time.LocalDate.parse(n.occurrenceDate))))return null
        return original
    }
    fun label(n:MindmapNode)=when(n.kind) {"task"->linkedTask(n)?.title ?: "Задача недоступна";"project"->projects.firstOrNull { it.id==n.refId }?.title ?: "Проект недоступен";else->n.text }
    val context=LocalContext.current
    val outlineTitle=genesisTranslate("Структура карты")
    var pdfSnapshot by remember {mutableStateOf<Triple<MindmapDocument,Map<String,String>,JSONObject>?>(null)}
    val pdfLauncher=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) {uri->
        val snapshot=pdfSnapshot;pdfSnapshot=null
        if(uri!=null&&snapshot!=null)run {withContext(Dispatchers.IO){repo.requireDataExchange();context.contentResolver.openOutputStream(uri)?.use {writeMindmapPdf(it,snapshot.first,snapshot.second,snapshot.third,outlineTitle)} ?: error("Не удалось открыть файл PDF.")}}
    }
    LaunchedEffect(repo) { runCatching { repo.loadCached() };runCatching { repo.refresh() }.onFailure { error=it.message ?: "Открыта защищённая копия устройства." } }
    LaunchedEffect(repo,mapId) { mapId?.let { view=(repo.view(it) ?: JSONObject().put("zoom",1.0)).put("mode","map") } }
    LaunchedEffect(picker,pickerQuery) { if(picker&&!readOnly)onTaskSearch(pickerQuery) }
    LaunchedEffect(map?.id,map?.nodes?.filter {it.kind=="task"}?.map {it.refId}?.joinToString()) {
        onResolveTaskIds(map?.nodes?.filter {it.kind=="task"}?.mapNotNull {it.refId}?.toSet().orEmpty())
    }
    fun closeNodeEditor() {
        if(node!=null&&((node.kind=="idea"&&text!=node.text)||note!=node.note)) discardNodeDraft=true
        else editing=null
    }
    fun goBack() { when { mapId!=null -> { mapId=null;query="";exportMenu=false }; archived -> archived=false; else -> onBack() } }
    BackHandler {if(editing!=null)closeNodeEditor() else goBack()}
    val headerTitle = map?.title ?: "Майндмепы"
    val exportLabel = genesisTranslate("Экспорт")
    val resetLabel = genesisTranslate("К началу")
    val headerSubtitle = if(map==null) {
        (if(backLabel=="К общим делам") "Общие дела" else "Личные дела") +
            (if(archived) " · Архив" else projects.firstOrNull {it.id==projectId}?.title?.let {" · $it"} ?: "")
    } else "${map.nodes.size} узлов · "+if(record.unsynced)"Сохранено на устройстве" else "Синхронизировано"
    val headerActions: @Composable (Modifier) -> Unit = { actionsModifier ->
            Box(actionsModifier) {
                if (map == null) WorkspaceHeaderButton("Действия с картой", "mindmaps-actions", onClick={files=true}) { AffairsActionIcon(AffairsAction.MORE) }
                else OutlinedIconButton(onClick={exportMenu=true}, enabled=!busy && canExchange,
                    modifier=Modifier.size(48.dp).testTag("mindmap-export-menu")
                        .semantics { contentDescription=exportLabel }, shape=AffairsLayout.controlShape) {
                    GenesisLucideIcon("download")
                }
                DropdownMenu(files,{files=false}) {
                    if(map==null) {
                        DropdownMenuItem(text={Text(if(archived) "Активные карты" else "Архив")},
                            leadingIcon={AffairsActionIcon(if(archived) AffairsAction.RESTORE else AffairsAction.ARCHIVE)},
                            modifier=Modifier.testTag("mindmaps-archive"), onClick={files=false;archived=!archived})
                        DropdownMenuItem(text={Text("Импорт JSON")},enabled=!readOnly && canExchange,leadingIcon={AffairsActionIcon(AffairsAction.IMPORT)},onClick={files=false;text="";import=true})
                        DropdownMenuItem(text={Text("Обновить")},leadingIcon={AffairsActionIcon(AffairsAction.REFRESH)},onClick={files=false;run {repo.refresh()}})
                    }
                }
                DropdownMenu(exportMenu && map!=null,{exportMenu=false}) {
                    if(map!=null) {
                        DropdownMenuItem(text={Text("Экспорт JSON")},leadingIcon={GenesisLucideIcon("file-json")},enabled=canExchange,
                            modifier=Modifier.testTag("mindmap-export-json"),onClick={exportMenu=false;run {text=repo.exportJson(map);export=true}})
                        DropdownMenuItem(text={Text("Экспорт PDF")},leadingIcon={GenesisLucideIcon("file-text")},enabled=!busy && canExchange,
                            modifier=Modifier.testTag("mindmap-export-pdf"),onClick={exportMenu=false;run {repo.requireDataExchange();pdfSnapshot=Triple(map,map.nodes.associate {it.id to label(it)},JSONObject(view.toString()));pdfLauncher.launch("GENESIS-map.pdf")}})
                    }
                }
            }
    }
    val headerInShell = WorkspaceScreenHeader(headerTitle, headerSubtitle, showThemeToggle = false,
        navigation={ WorkspaceHeaderButton(if(mapId==null) backLabel else "Все майндмепы", "mindmaps-back", onClick=::goBack) {
            AffairsActionIcon(AffairsAction.BACK)
        } }, singleLine=true, titleIsUserContent=map!=null, actions={ if (map == null) headerActions(Modifier) })
    Box(Modifier.fillMaxSize().imePadding().testTag("mindmaps-screen")) {
    Column(Modifier.fillMaxSize().padding(horizontal=16.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        if(!headerInShell) AffairsPageHeader(headerTitle, headerSubtitle, icon=GenesisPageIcon.MINDMAPS,
            onBack=::goBack, backLabel=if(mapId==null)backLabel else "Все майндмепы", titleIsUserContent=map!=null,
            contextMaxLines=1) { if (map == null) headerActions(Modifier) }
        error?.let { NativeAccessMessage(it,"mindmaps");if(map!=null)FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            TextButton(enabled=!busy&&!readOnly,onClick={run { repo.retry(map.id) }}){Text("Повторить сохранение")}
            TextButton(enabled=!busy&&!readOnly,onClick={run {open(repo.fork(map).id)}}){Text("Сохранить отдельную карту")}
            TextButton(enabled=!busy,onClick={run { serverPreview=true;history=listOf(repo.serverVersion(map.id)) }}){Text("Серверная версия")}
        } }
        if(map==null) {
                Button(enabled=!busy&&!readOnly,shape=AffairsLayout.controlShape,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("mindmaps-create"),onClick={title="";description="";template="empty";create=true}) {
                    AffairsActionIcon(AffairsAction.ADD);Spacer(Modifier.width(8.dp));Text("Создать карту")
                }
            val visibleMaps=records.filter {it.document.archived==archived&&(projectId==null||it.document.projectId==projectId)&&it.document.title.contains(query,true)}.sortedByDescending { it.document.pinned }
            LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(bottom=112.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                if(visibleMaps.isEmpty()) item {
                    Text(if(query.isNotBlank())"Карты не найдены. Измените запрос." else if(archived)"В архиве пока нет карт." else "Создайте карту, чтобы собрать мысли, задачи и проекты в одном месте.",
                        Modifier.padding(vertical=16.dp),color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(visibleMaps,key={it.document.id}) { r->
                    var mapActionsOpen by remember(r.document.id) {mutableStateOf(false)}
                    Surface(onClick={open(r.document.id)},shape=AffairsLayout.shape,color=MaterialTheme.colorScheme.surface,modifier=Modifier.testTag("mindmap-open-${r.document.id}")) {
                        Row(Modifier.fillMaxWidth().padding(start=12.dp,end=4.dp,top=8.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            GenesisVectorIcon(GenesisPageIcon.MINDMAPS,Modifier.size(24.dp),MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                Text(r.document.title,style=MaterialTheme.typography.titleMedium)
                                Text("${r.document.nodes.size} узлов · "+(projects.firstOrNull {it.id==r.document.projectId}?.title ?: "Без проекта"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                if(r.unsynced||r.document.pinned) Text(if(r.unsynced)"Черновик на устройстве" else "Закреплена",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.secondary)
                            }
                            Box {
                                AffairsIconButton("Действия с картой",AffairsAction.MORE,{mapActionsOpen=true},outlined=false)
                                DropdownMenu(mapActionsOpen,{mapActionsOpen=false}) {
                                    DropdownMenuItem(text={Text(if(r.document.pinned)"Открепить" else "Закрепить")},enabled=!busy&&!readOnly,onClick={mapActionsOpen=false;save(r.document.copy(pinned=!r.document.pinned))})
                                    DropdownMenuItem(text={Text(if(archived)"Восстановить" else "Архивировать")},enabled=!busy&&!readOnly,onClick={mapActionsOpen=false;save(r.document.copy(archived=!r.document.archived))})
                                }
                            }
                        }
                    }
                }
            }
        } else {
            BoxWithConstraints(Modifier.fillMaxWidth().testTag("mindmap-toolbar-viewport")) {
            Row(Modifier.horizontalScroll(rememberScrollState()).widthIn(min = maxWidth).height(IntrinsicSize.Min)
                .testTag("mindmap-toolbar"),horizontalArrangement=Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment=Alignment.CenterVertically) {
                val structure = view.optString("mode") == "structure"
                Box { AffairsIconButton(if (structure) "Показать карту" else "Показать структуру",
                    if (structure) AffairsAction.MINDMAP else AffairsAction.SUBTASK, {
                        query = ""; changeView(JSONObject(view.toString()).put("mode", if (structure) "map" else "structure"))
                    }, Modifier.testTag("mindmap-mode-toggle")) }
                Box {
                    AffairsIconButton("Добавить",AffairsAction.ADD,{addMenu=true},enabled=!busy&&!readOnly,
                        modifier=Modifier.testTag("mindmap-add-node"))
                    DropdownMenu(addMenu,{addMenu=false}) {
                        DropdownMenuItem(text={Text("Добавить мысль")},leadingIcon={AffairsActionIcon(AffairsAction.ADD)},
                            modifier=Modifier.testTag("mindmap-add-thought"),onClick={addMenu=false;add()})
                        DropdownMenuItem(text={Text("Добавить из дел")},leadingIcon={AffairsActionIcon(AffairsAction.TASK)},
                            modifier=Modifier.testTag("mindmap-add-from-affairs"),onClick={addMenu=false;picker=true})
                    }
                }
                AffairsIconButton("Отменить изменение", AffairsAction.UNDO, {
                    val old=undo.last();undo=undo.dropLast(1);save(old,false)
                }, Modifier.testTag("mindmap-undo"), enabled=undo.isNotEmpty()&&!busy&&!readOnly)
                AffairsIconButton("Название и описание", AffairsAction.EDIT, {
                    title=map.title;description=map.description;create=true
                }, Modifier.testTag("mindmap-title-description"), enabled=!busy&&!readOnly)
                AffairsIconButton("История", AffairsAction.HISTORY, {
                    run {serverPreview=false;history=repo.history(map.id)}
                }, Modifier.testTag("mindmap-history"), enabled=!busy)
                headerActions(Modifier)
            }
            }
            if(view.optString("focus").isNotBlank()&&view.optString("focus")!="null")TextButton(onClick={changeView(JSONObject(view.toString()).removeFocus())}){Text("Вся карта")}
            val collapsed=view.optJSONArray("collapsed")?.let { a->(0 until a.length()).map {a.optString(it)}.toSet() } ?: emptySet()
            val rows=map.rows(collapsed,view.optString("focus").takeIf {it.isNotBlank()&&it!="null"})
            if(view.optString("mode")=="map"&&query.isBlank()) NativeMindmapCanvas(map,rows,view,::label,{id->selected=id;text=map.nodes.first {it.id==id}.text;note=map.nodes.first {it.id==id}.note;editing=id},::changeView,{add(point=it)},{from,to->if(!map.links.any {it.from==from&&it.to==to||it.from==to&&it.to==from})save(map.copy(links=map.links+MindmapLink(UUID.randomUUID().toString(),from,to,"Связано с")))},Modifier.weight(1f),readOnly,resetCanvas,
                onAffair={picker=true},onHome={resetCanvas++;changeView(JSONObject(view.toString()).removeFocus().put("zoom",1.0))})
            else LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(bottom=88.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                items(rows.filter {label(it.first).contains(query,true)||it.first.note.contains(query,true)},key={it.first.id}) { (n,depth)->
                    val fill=mapColor(n.style?.optString("fill"),MaterialTheme.colorScheme.surface)
                    val ink=if(n.style?.has("fill")==true) if(fill.luminance()>.179f)Color.Black else Color.White else MaterialTheme.colorScheme.onSurface
                    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                        Row(Modifier.fillMaxWidth().padding(start=(depth.coerceAtMost(3)*12).dp).background(fill,MaterialTheme.shapes.small)
                            .border(1.dp,mapColor(n.style?.optString("border"),MaterialTheme.colorScheme.outlineVariant),MaterialTheme.shapes.small),verticalAlignment=Alignment.CenterVertically) {
                            if(map.nodes.any {it.parentId==n.id}) AffairsIconButton(if(n.id in collapsed)"Развернуть ветку" else "Свернуть ветку",if(n.id in collapsed)AffairsAction.EXPAND else AffairsAction.COLLAPSE,
                                {val next=collapsed.toMutableSet();if(!next.add(n.id))next.remove(n.id);changeView(JSONObject(view.toString()).put("collapsed",org.json.JSONArray(next.toList())))},contentColor=ink,outlined=false)
                            TextButton(onClick={selected=n.id;text=n.text;note=n.note;editing=n.id},modifier=Modifier.weight(1f).testTag("mindmap-node-${n.id}"),
                                colors=ButtonDefaults.textButtonColors(contentColor=ink)) {
                                n.mindmapIcon()?.let { MindmapGlyph(it, Modifier.padding(end = 8.dp).size(24.dp), ink) }
                                Column(Modifier.weight(1f)) {
                                    UntranslatedText(label(n),color=ink)
                                    Text(when(n.kind){"task"->if(linkedTask(n)?.done==true)"Выполнено" else "Задача GENESIS";"project"->"Проект GENESIS";else->"Мысль"},color=ink,style=MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    key(mapId) { WorkspaceSearchDock(query,{query=it},if(map==null) "Поиск карт" else "Найти узел",
        if(map==null) "mindmaps-search" else "mindmap-node-search",Modifier.align(Alignment.BottomCenter).padding(horizontal=8.dp),
        leading=if(map!=null) ({
            FilledTonalIconButton(onClick={
                query="";resetCanvas++;changeView(JSONObject(view.toString()).removeFocus().put("mode","map").put("zoom",1.0))
            }, modifier=Modifier.size(56.dp).testTag("mindmap-reset").semantics { contentDescription=resetLabel },
                shape=AffairsLayout.controlShape) { AffairsActionIcon(AffairsAction.CENTER) }
        }) else null) }
    }
    if(create) AlertDialog(onDismissRequest={create=false},title={Text(if(map==null)"Новая карта" else "Настройка карты")},text={Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)) {OutlinedTextField(title,{title=it},label={Text("Название карты")},modifier=Modifier.fillMaxWidth());OutlinedTextField(description,{description=it.take(12000)},label={Text("Описание")},modifier=Modifier.fillMaxWidth());if(map==null) MindmapTemplatePicker(template) { template=it }}},confirmButton={TextButton(enabled=title.isNotBlank()&&!busy&&!readOnly,onClick={if(map==null){val next=MindmapDocument.new(title,newMapProjectId,template,::defaultLabel).copy(description=description);save(next);open(next.id)}else save(map.copy(title=title.trim(),description=description));create=false}){Text("Сохранить")}},dismissButton={TextButton(onClick={create=false}){Text("Отмена")}})
    if(editing!=null&&map!=null&&node!=null&&readOnly) AlertDialog(onDismissRequest={editing=null},title={Text(label(node))},
        text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("Карта доступна для просмотра.")
            if(node.note.isNotBlank()) UntranslatedText(node.note)
            linkedTask(node)?.let { task->TextButton(onClick={onTask(task,node.occurrenceDate)}){Text("Открыть карточку задачи")} }
            if(node.kind=="project"&&projects.any {it.id==node.refId})TextButton(onClick={onProject(node.refId!!)}){Text("Открыть проект")}
        }},confirmButton={})
    if(editing!=null&&map!=null&&node!=null&&!readOnly) AlertDialog(onDismissRequest={closeNodeEditor()},showCloseButton=false,title={Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Text(label(node),Modifier.weight(1f))
        AffairsIconButton("Закрыть",AffairsAction.CLOSE,{closeNodeEditor()},Modifier.testTag("mindmap-node-close"),enabled=!busy)
    }},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        var colorsExpanded by remember(node.id) {mutableStateOf(false)}
        var linksExpanded by remember(node.id) {mutableStateOf(false)}
        var movementExpanded by remember(node.id) {mutableStateOf(false)}
        val editorDocument=map.copy(nodes=map.nodes.map {if(it.id==node.id)it.copy(text=if(it.kind=="idea")text else "",note=note) else it})
        if(node.kind=="idea")OutlinedTextField(text,{text=it},label={Text("Название мысли")},modifier=Modifier.fillMaxWidth().testTag("mindmap-node-text"))
        OutlinedTextField(note,{note=it},label={Text("Пояснение · только в карте")},modifier=Modifier.fillMaxWidth())
        if(node.kind=="idea"&&onConvertIdea!=null) OutlinedButton(modifier=Modifier.fillMaxWidth(),enabled=!busy,onClick={run {
            repo.save(editorDocument);editing=null;onConvertIdea(editorDocument,node,text.trim().ifBlank {node.text})
        }}){Text("Создать задачу из мысли")}
        else if(node.kind=="idea")OutlinedButton(modifier=Modifier.fillMaxWidth(),enabled=!busy,onClick={val taskId=map.taskId(node.id);val task=tasks.firstOrNull {it.id==taskId};editing=null;if(task!=null){save(map.copy(nodes=map.nodes.map {if(it.id==node.id)it.copy(kind="task",refId=task.id,text="",note=note) else it}));onTask(task,null)}else {val draft=LocalTask(id=taskId,title=text.trim().ifBlank {node.text}.take(500),date="",projectId=map.projectId,sourceFieldsJson=JSONObject().put("mindmapCreateOnly",true).toString());run {repo.save(map.copy(nodes=map.nodes.map {if(it.id==node.id)it.copy(text=text,note=note) else it}));onCreate(draft)}} }){Text("Создать задачу из мысли")}
        linkedTask(node)?.let { task->TextButton(onClick={onTask(task,node.occurrenceDate)}){Text("Открыть карточку задачи")};TextButton(enabled=!busy&&taskCanEdit(task),onClick={onComplete(task,node.occurrenceDate)}){Text(if(task.done)"Вернуть задачу" else "Выполнить задачу")} }
        if(node.kind=="project"&&projects.any {it.id==node.refId})TextButton(onClick={onProject(node.refId!!)}){Text("Открыть проект")}
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            MapIconButton("Добавить дочернюю мысль",2,{add()},!busy)
            MapIconButton("Добавить соседнюю мысль",3,{add(true)},!busy)
            MapIconButton("Добавить из дел",4,{picker=true},!busy)
            MapIconButton("Фокус на ветке",5,{save(editorDocument);changeView(JSONObject(view.toString()).put("focus",node.id));editing=null},!busy)
            MapIconButton("Свернуть ветку",6,{save(editorDocument);val a=view.optJSONArray("collapsed");val set=(0 until (a?.length() ?: 0)).map {a!!.getString(it)}.toMutableSet();if(!set.add(node.id))set.remove(node.id);changeView(JSONObject(view.toString()).put("collapsed",org.json.JSONArray(set.toList())));editing=null},!busy)
        }
        TextButton(onClick={colorsExpanded=!colorsExpanded},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
            Text("Оформление",Modifier.weight(1f));AffairsActionIcon(if(colorsExpanded)AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        MindmapIconPicker(node.mindmapIcon(), enabled = !busy) { icon ->
            save(editorDocument.copy(nodes = editorDocument.nodes.map { if (it.id == node.id) it.withMindmapIcon(icon) else it }))
        }
        if(colorsExpanded) {
        fun setColor(key:String,value:String?) {val style=JSONObject(node.style?.toString() ?: "{}");if(value==null)style.remove(key) else style.put(key,value);save(map.copy(nodes=map.nodes.map {if(it.id==node.id)it.copy(style=style.takeIf {it.length()>0}) else it}))}
        MapColorField("Заливка карточки",node.style?.optString("fill"),{setColor("fill",it)})
        MapColorField("Обводка карточки",node.style?.optString("border"),{setColor("border",it)})
        MapColorField("Цвет линий карты",map.appearance?.optString("lineColor"),{value->save(map.copy(appearance=value?.let {JSONObject().put("lineColor",it)}))})
        TextButton(modifier=Modifier.fillMaxWidth(),onClick={save(map.copy(appearance=null,nodes=map.nodes.map {if(it.id==node.id)it.copy(style=null) else it}))}){Text("Вернуть цвета темы")}
        }
        val nodeLinks=map.links.filter {it.from==node.id||it.to==node.id}
        if(nodeLinks.isNotEmpty()) TextButton(onClick={linksExpanded=!linksExpanded},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
            Text("Связи · ${nodeLinks.size}",Modifier.weight(1f));AffairsActionIcon(if(linksExpanded)AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        if(linksExpanded) {
        map.links.filter {it.from==node.id||it.to==node.id}.forEach {link->Column {
            Text(map.nodes.firstOrNull {it.id==(if(link.from==node.id)link.to else link.from)}?.let(::label).orEmpty())
            MapColorField("Цвет связи",link.color,{value->save(map.copy(links=map.links.map {if(it.id==link.id)it.copy(color=value) else it}))})
            TextButton(modifier=Modifier.fillMaxWidth(),onClick={save(map.copy(links=map.links.filterNot {it.id==link.id}))}){Text("Убрать связь")}
        } }
        }
        if(node.parentId!=null) {
            TextButton(onClick={movementExpanded=!movementExpanded},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                Text("Переместить и упорядочить",Modifier.weight(1f));AffairsActionIcon(if(movementExpanded)AffairsAction.COLLAPSE else AffairsAction.EXPAND)
            }
            if(movementExpanded) {
            var targetParent by rememberSaveable(map.id,node.id) {mutableStateOf(node.parentId.orEmpty())}
            val branchChoices=mindmapBranchChoices(editorDocument,node.id,::label)
            ImportChoice("Переместить в ветку",targetParent,branchChoices,!busy,"mindmap-node-parent") {targetParent=it}
            Button(modifier=Modifier.fillMaxWidth(),enabled=!busy&&targetParent!=node.parentId&&branchChoices.any {it.first==targetParent},
                onClick={save(editorDocument.move(node.id,targetParent));editing=null}){Text("Переместить узел")}
            Row {listOf(-1,1).forEach {direction->MapIconButton(if(direction<0)"Выше" else "Ниже",if(direction<0)7 else 8,{val siblings=map.nodes.filter {it.parentId==node.parentId};val index=siblings.indexOfFirst {it.id==node.id};if(index+direction in siblings.indices){save(editorDocument.move(node.id,node.parentId,siblings.getOrNull(if(direction<0)index-1 else index+2)?.id))}},!busy)} }
            }
        }
    }},confirmButton={Row(Modifier.fillMaxWidth().testTag("mindmap-node-save-row"),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) {
        if(node.parentId!=null) AffairsIconButton("Убрать ветку с карты",AffairsAction.DELETE,{remove=true},Modifier.testTag("mindmap-node-delete"),enabled=!busy)
        Button(enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("mindmap-node-save"),onClick={save(map.copy(nodes=map.nodes.map {if(it.id==node.id)it.copy(text=if(it.kind=="idea")text else "",note=note) else it}));editing=null}){Text("Сохранить мысль")}
    }})
    if(discardNodeDraft) AlertDialog(onDismissRequest={discardNodeDraft=false},title={Text("Закрыть без сохранения?")},
        text={Text("Название и пояснение изменены. Продолжите редактирование, чтобы сохранить их.")},
        confirmButton={TextButton(onClick={discardNodeDraft=false;editing=null}){Text("Не сохранять")}},
        dismissButton={TextButton(onClick={discardNodeDraft=false}){Text("Продолжить редактирование")}})
    if(remove&&map!=null&&node!=null)AlertDialog(onDismissRequest={remove=false},title={Text("Убрать ветку?")},text={Text("Связанные задачи и проекты останутся в GENESIS.")},confirmButton={TextButton(onClick={save(map.remove(node.id));remove=false;editing=null;selected=null}){Text("Убрать только с карты")}},dismissButton={TextButton(onClick={remove=false}){Text("Отмена")}})
    if(picker&&map!=null&&node!=null&&!readOnly)AlertDialog(onDismissRequest={picker=false},title={Text("Добавить из дел")},text={Column {
        AffairsSearchField(pickerQuery,{pickerQuery=it.take(200)},"Поиск задач",Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f,fill=false)) {items(tasks.filter {it.title.contains(pickerQuery,true)},key={it.id}) {t->TextButton(onClick={if(t.recurrence.enabled){occurrenceTask=t;occurrenceDate=t.date}else {save(map.copy(nodes=map.nodes+MindmapNode(UUID.randomUUID().toString(),node.id,"task",refId=t.id)));picker=false}}){Text(t.title)} };items(projects.filter {it.title.contains(pickerQuery,true)},key={it.id}) {p->TextButton(onClick={save(map.copy(nodes=map.nodes+MindmapNode(UUID.randomUUID().toString(),node.id,"project",refId=p.id)));picker=false}){Text("Проект · ${p.title}")} }
            item {taskPickerFooter()}
        }
    }},confirmButton={})
    if(occurrenceTask!=null&&map!=null&&node!=null)AlertDialog(onDismissRequest={occurrenceTask=null},title={Text("День повторения")},text={Column {AuthorDatePicker(occurrenceDate,ru.genesis.calendar.domain.CalendarMode.PROFANE){occurrenceDate=it};Text("На карте будет только выбранный экземпляр.")}},confirmButton={TextButton(enabled=runCatching {TaskOccurrences.occursOn(occurrenceTask!!,java.time.LocalDate.parse(occurrenceDate))}.getOrDefault(false),onClick={save(map.copy(nodes=map.nodes+MindmapNode(UUID.randomUUID().toString(),node.id,"task",refId=occurrenceTask!!.id,occurrenceDate=occurrenceDate)));occurrenceTask=null;picker=false}){Text("Привязать этот день")}},dismissButton={TextButton(onClick={occurrenceTask=null}){Text("Отмена")}})
    if(import||export)AlertDialog(onDismissRequest={import=false;export=false},title={Text(if(import)"Импорт JSON" else "Экспорт JSON")},text={OutlinedTextField(text,{if(import)text=it},readOnly=export,label={Text("Документ GENESIS")},modifier=Modifier.fillMaxWidth().heightIn(max=360.dp))},confirmButton={TextButton(enabled=export||(!readOnly && canExchange),onClick={if(import)run {open(repo.importJson(text).id)};import=false;export=false}){Text(if(import)"Импортировать копию" else "Закрыть")}})
    history?.let { versions->AlertDialog(onDismissRequest={history=null},title={Text("История карты")},text={LazyColumn {items(versions,key={it.revision}) {r->TextButton(enabled=!readOnly,onClick={if(map!=null){if(serverPreview)run {repo.adoptServer(map.id);open(map.id)}else save(r.document.copy(id=map.id))};history=null}){Text("Версия ${r.revision} · ${r.document.title}")} } }},confirmButton={}) }
    // Recovery also binds a previously committed conversion after process death.
    LaunchedEffect(map?.id,tasks,records,busy) {if(onConvertIdea==null&&!readOnly&&map!=null&&!busy&&!record.unsynced) {val recovered=map.nodes.map { n->if(n.kind=="idea")tasks.firstOrNull {it.id==map.taskId(n.id)}?.let {n.copy(kind="task",text="",refId=it.id)} ?: n else n };if(recovered!=map.nodes)run {repo.save(map.copy(nodes=recovered))} } }
}

@Composable
internal fun NativeMindmapCanvas(map:MindmapDocument,rows:List<Pair<MindmapNode,Int>>,view:JSONObject,label:(MindmapNode)->String,onSelect:(String)->Unit,onView:(JSONObject)->Unit,onAdd:(Offset)->Unit,onLink:(String,String)->Unit,modifier:Modifier,readOnly:Boolean=false,resetKey:Int=0,
    onAffair:()->Unit={},onHome:()->Unit={}) {
    var connecting by remember(map.id) {mutableStateOf<String?>(null)}
    BackHandler(connecting!=null) {connecting=null}
    LaunchedEffect(readOnly,resetKey) {connecting=null}
    val horizontal=rememberScrollState();val vertical=rememberScrollState()
    val density=LocalDensity.current.density
    val positions=view.optJSONObject("positions") ?: JSONObject();var drag by remember {mutableStateOf<Pair<String,Offset>?>(null)};var menu by remember {mutableStateOf<Offset?>(null)};var menuAnchor by remember {mutableStateOf(Offset.Zero)}
    LaunchedEffect(readOnly) { if (readOnly) { menu = null; drag = null } }
    val located=rows.mapIndexed {i,pair->val saved=positions.optJSONObject(pair.first.id);val point=if(drag?.first==pair.first.id)drag!!.second else Offset(saved?.optDouble("x",24.0+pair.second*260)?.toFloat() ?: (24+pair.second*260).toFloat(),saved?.optDouble("y",24.0+i*112)?.toFloat() ?: (24+i*112).toFloat());pair.first to point};val byId=located.toMap()
    val savedZoom=view.optDouble("zoom",1.0).coerceIn(.4,2.0).toFloat()
    var zoom by remember(map.id) { mutableFloatStateOf(savedZoom) }
    val currentLocated by rememberUpdatedState(located)
    val currentZoom by rememberUpdatedState(zoom)
    var pendingScroll by remember { mutableStateOf<Offset?>(null) }
    val latestView by rememberUpdatedState(view);val latestOnView by rememberUpdatedState(onView)
    LaunchedEffect(savedZoom) { zoom=savedZoom }
    LaunchedEffect(map.id,resetKey) {
        val root=located.firstOrNull {it.first.parentId==null}?.second ?: Offset.Zero
        horizontal.scrollTo(((root.x-16f)*density*zoom).roundToInt().coerceAtLeast(0))
        vertical.scrollTo(((root.y-16f)*density*zoom).roundToInt().coerceAtLeast(0))
    }
    LaunchedEffect(pendingScroll) { pendingScroll?.let { target->
        withFrameNanos { }
        horizontal.scrollTo(target.x.roundToInt().coerceAtLeast(0));vertical.scrollTo(target.y.roundToInt().coerceAtLeast(0))
    } }
    val contentWidth=(located.maxOfOrNull {it.second.x} ?: 0f)+300;val contentHeight=(located.maxOfOrNull {it.second.y} ?: 0f)+180
    val line=mapColor(map.appearance?.optString("lineColor"),if (LocalEveningTheme.current) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant)
    val background=if (LocalEveningTheme.current) androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surface,MaterialTheme.colorScheme.primary,.09f) else androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.background, Color.Black, .15f)
    val scaleState=genesisTranslate("Масштаб")
    val zoomIn=genesisTranslate("Увеличить масштаб");val zoomOut=genesisTranslate("Уменьшить масштаб")
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
    Column(modifier.fillMaxWidth()) {
    if(connecting!=null) Row(Modifier.fillMaxWidth().testTag("mindmap-link-controls"),verticalAlignment=Alignment.CenterVertically) {
        Text("Выберите второй узел для связи",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={connecting=null},modifier=Modifier.testTag("mindmap-cancel-link")) { Text("Отменить соединение") }
    }
    Box(Modifier.weight(1f).fillMaxWidth().clip(MaterialTheme.shapes.medium).background(background).testTag("mindmap-canvas")
        .semantics {
            stateDescription="$scaleState ${(zoom*100).roundToInt()}%"
            customActions=listOf(CustomAccessibilityAction(zoomIn) { latestOnView(JSONObject(latestView.toString()).put("zoom",(zoom+.2f).coerceAtMost(2f)));true },
                CustomAccessibilityAction(zoomOut) { latestOnView(JSONObject(latestView.toString()).put("zoom",(zoom-.2f).coerceAtLeast(.4f)));true })
        }
        .pointerInput(map.id, readOnly) {
            detectTapGestures(onTap={connecting=null},onLongPress = { point ->
                val documentPoint=Offset((point.x+horizontal.value)/(currentZoom*density),(point.y+vertical.value)/(currentZoom*density))
                if(currentLocated.any { (_, nodePoint) -> documentPoint.x in nodePoint.x..(nodePoint.x+220f) && documentPoint.y in nodePoint.y..(nodePoint.y+84f) }) return@detectTapGestures
                menuAnchor = point
                menu = documentPoint
            })
        }
        .pointerInput(map.id) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed=false,pass=PointerEventPass.Initial)
                var transformed=false
                var gestureScroll=Offset(horizontal.value.toFloat(),vertical.value.toFloat())
                do {
                    val event=awaitPointerEvent(PointerEventPass.Initial)
                    if(event.changes.count {it.pressed}>=2) {
                        if(!transformed) { gestureScroll=Offset(horizontal.value.toFloat(),vertical.value.toFloat());transformed=true }
                        val oldZoom=zoom;val nextZoom=(oldZoom*event.calculateZoom()).coerceIn(.4f,2f)
                        val centroid=event.calculateCentroid(useCurrent=false);val pan=event.calculatePan()
                        gestureScroll=((gestureScroll+centroid)*(nextZoom/oldZoom)-centroid-pan).let {Offset(it.x.coerceAtLeast(0f),it.y.coerceAtLeast(0f))}
                        zoom=nextZoom;pendingScroll=gestureScroll
                    }
                    if(transformed) event.changes.forEach {it.consume()}
                } while(event.changes.any {it.pressed})
                // One encrypted view write per gesture; single-finger scrolling and long-press dragging keep their own handlers.
                if(transformed) latestOnView(JSONObject(latestView.toString()).put("zoom",zoom.toDouble()))
            }
        }) {
        Box(Modifier.fillMaxSize().horizontalScroll(horizontal).verticalScroll(vertical)) {
            Box(Modifier.width((contentWidth*zoom).dp).height((contentHeight*zoom).dp)) {
            Box(Modifier.width(contentWidth.dp).height(contentHeight.dp).graphicsLayer(scaleX=zoom,scaleY=zoom,transformOrigin=TransformOrigin(0f,0f))
) {
                Canvas(Modifier.matchParentSize()) {located.forEach { (n,p)->n.parentId?.let {parentId->byId[map.nodes.first {it.id==parentId}] }?.let {parent->val a=Offset((parent.x+220)*density,(parent.y+42)*density);val b=Offset(p.x*density,(p.y+42)*density);val path=Path().apply{moveTo(a.x,a.y);cubicTo(a.x+40*density,a.y,b.x-40*density,b.y,b.x,b.y)};drawPath(path,mapColor(map.appearance?.optString("lineColor"),mapColor(n.style?.optString("border"),line)),style=androidx.compose.ui.graphics.drawscope.Stroke(2*density))} }
                    map.links.forEach {link->val a=located.firstOrNull {it.first.id==link.from}?.second;val b=located.firstOrNull {it.first.id==link.to}?.second;if(a!=null&&b!=null){val path=Path().apply {moveTo((a.x+110)*density,(a.y+84)*density);quadraticTo((maxOf(a.x,b.x)+260)*density,(a.y+b.y)/2*density,(b.x+110)*density,b.y*density)};drawPath(path,mapColor(link.color,line),style=Stroke(2*density,pathEffect=androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5*density,5*density))))}}
                }
                located.forEach { (n,point)->
                    val currentPoint by rememberUpdatedState(point);val currentView by rememberUpdatedState(view)
                    val fill=mapColor(n.style?.optString("fill"),if (LocalEveningTheme.current) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceContainerHigh)
                    val ink=if(n.style?.has("fill")==true)if(fill.luminance()>.179f)Color.Black else Color.White else MaterialTheme.colorScheme.onSurface
                    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                    Surface(onClick={val from=connecting;if(from!=null){connecting=null;if(from!=n.id&&!readOnly)onLink(from,n.id)}else onSelect(n.id)},shape=MaterialTheme.shapes.medium,color=fill,contentColor=ink,border=selectedControlBorder(connecting==n.id,
                        fallback=BorderStroke(1.dp,mapColor(n.style?.optString("border"),MaterialTheme.colorScheme.outline)),background=fill),
                    modifier=Modifier.testTag("mindmap-node-${n.id}").zIndex(if(drag?.first==n.id)10f else 0f).offset {IntOffset(point.x.dp.roundToPx(),point.y.dp.roundToPx())}.width(220.dp).height(84.dp).pointerInput(n.id,readOnly){detectDragGesturesAfterLongPress(onDragEnd={val moved=drag;drag=null;if(moved!=null){val next=JSONObject(currentView.toString());val ps=next.optJSONObject("positions") ?: JSONObject();ps.put(n.id,JSONObject().put("x",moved.second.x).put("y",moved.second.y));onView(next.put("positions",ps))}},onDragCancel={drag=null}){change,delta->if(readOnly)return@detectDragGesturesAfterLongPress;change.consume();val start=drag?.takeIf {it.first==n.id}?.second ?: currentPoint;drag=n.id to Offset((start.x+delta.x/density).coerceAtLeast(0f),(start.y+delta.y/density).coerceAtLeast(0f))}}) {
                    Row(Modifier.padding(start=12.dp,top=12.dp,end=if(readOnly)40.dp else 56.dp), verticalAlignment=Alignment.CenterVertically) {
                        n.mindmapIcon()?.let { MindmapGlyph(it, Modifier.padding(end=8.dp).size(24.dp), ink) }
                        Column(Modifier.weight(1f)){Text(if(n.kind=="idea")"Мысль" else "GENESIS",style=MaterialTheme.typography.labelSmall);Text(label(n),maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.titleSmall)}
                    }
                    if(!readOnly)Box(Modifier.fillMaxSize(),contentAlignment=Alignment.CenterEnd){AffairsIconButton(if(connecting==n.id)"Отменить соединение" else "Создать связь",AffairsAction.LINK,{val from=connecting;if(from!=null&&from!=n.id){connecting=null;onLink(from,n.id)}else connecting=if(from==n.id)null else n.id},modifier=Modifier.testTag("mindmap-connect-${n.id}"),contentColor=ink,outlined=false,selected=connecting==n.id)}
                    }
                    }
                }

            }
        }
        }
        Box(Modifier.offset { IntOffset(menuAnchor.x.roundToInt(), menuAnchor.y.roundToInt()) }.size(1.dp)) {
            DropdownMenu(expanded=menu!=null,onDismissRequest={menu=null}) {
                if (!readOnly) {
                DropdownMenuItem(text={Text("Добавить мысль")}, modifier=Modifier.testTag("mindmap-context-add"),
                    leadingIcon={AffairsActionIcon(AffairsAction.ADD)},
                    enabled=!readOnly,onClick={val point=menu;menu=null;if(point!=null)onAdd(point)})
                DropdownMenuItem(text={Text("Добавить из дел")},leadingIcon={AffairsActionIcon(AffairsAction.TASK)},
                    enabled=!readOnly,modifier=Modifier.testTag("mindmap-context-affair"),onClick={menu=null;onAffair()})
                }
                DropdownMenuItem(text={Text("К началу")},leadingIcon={AffairsActionIcon(AffairsAction.CENTER)},
                    modifier=Modifier.testTag("mindmap-context-home"),onClick={menu=null;connecting=null;onHome()})
                if(view.optString("focus").isNotBlank()) DropdownMenuItem(text={Text("Вся карта")},
                    leadingIcon={AffairsActionIcon(AffairsAction.MINDMAP)},onClick={menu=null;onView(JSONObject(view.toString()).removeFocus())})
                if(connecting!=null)DropdownMenuItem(text={Text("Отменить соединение")},
                    leadingIcon={AffairsActionIcon(AffairsAction.CLOSE)},onClick={menu=null;connecting=null})
            }
        }
    }
    }
    }
}

private fun mapColor(hex:String?,fallback:Color):Color=if(hex!=null&&Regex("#[a-fA-F0-9]{6}").matches(hex))Color(android.graphics.Color.parseColor(hex)) else fallback

private fun JSONObject.removeFocus():JSONObject=apply {remove("focus")}
