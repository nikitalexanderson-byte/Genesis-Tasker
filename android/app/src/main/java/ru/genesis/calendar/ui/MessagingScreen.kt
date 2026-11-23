package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.genesis.calendar.data.*
import ru.genesis.calendar.security.MessagingCrypto
import ru.genesis.calendar.security.NativeMessageKeyTransfer
import ru.genesis.calendar.security.NativeContentFileDestination
import ru.genesis.calendar.security.NativeUserFileInput
import ru.genesis.calendar.security.NativeUserFileOutput
import ru.genesis.calendar.security.PrivateFileMetadata
import org.json.JSONObject
import java.util.UUID

@Composable internal fun MessagingScreen(repository: MessagingRepository, initialSpaceId: String? = null, onClose: () -> Unit) {
    val state by repository.state.collectAsStateWithLifecycle()
    val canExchange = LocalFeatureAccess.current.allows("data-export")
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val language=LocalGenesisLanguage.current
    val recoveryCopy=remember(context,language){ru.genesis.calendar.security.LocalRecoveryCopy.read(context,language)}
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(if (initialSpaceId == null) "inbox" else "participants") }
    var query by remember { mutableStateOf("") }
    var backup by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var backupSource by remember { mutableStateOf<String?>(null) }
    var recoveryKeySaved by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var security by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf<MessagingRow?>(null) }
    var cancelEditConfirm by remember { mutableStateOf(false) }
    var recoverConfirm by remember { mutableStateOf(false) }
    var restoreFileDraft by remember{mutableStateOf<Pair<String,String?>?>(null)}
    val client = remember { UUID.randomUUID().toString() }
    val authController=remember(context){ru.genesis.calendar.auth.AuthController.get(context)}
    val keyTransfer by NativeMessageKeyTransfer.state.collectAsStateWithLifecycle()
    val ownKeyTransfer=keyTransfer?.takeIf{it.request.owner==repository.ownerUid}
    val fileDestination by NativeContentFileDestination.state.collectAsStateWithLifecycle()
    val ownFileDestination=fileDestination?.takeIf{it.request.owner==repository.ownerUid&&it.request.purpose in setOf("message","message-input")}
    val fileAccess=remember(repository){java.util.concurrent.atomic.AtomicReference<AutoCloseable?>(null)}
    val fileText=remember(language){context.assets.open("message-files-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val outputText=remember(language){context.assets.open("content-file-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val draftRecoveryText=remember(language){context.assets.open("message-draft-recovery-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val foreground=remember(repository,lifecycle){java.util.concurrent.atomic.AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
    DisposableEffect(repository,lifecycle){
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->
            if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
            if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);password="";backupSource=null;recoveryKeySaved=false;fileAccess.getAndSet(null)?.close()
                NativeContentFileDestination.state.value?.takeIf{it.request.owner==repository.ownerUid&&it.request.purpose in setOf("message","message-input")&&it.phase=="io"}?.let{NativeContentFileDestination.failed(it.request)}}
        };lifecycle.addObserver(observer)
        onDispose{foreground.set(false);lifecycle.removeObserver(observer);password="";backupSource=null;recoveryKeySaved=false;fileAccess.getAndSet(null)?.close()}
    }
    fun fileForeground(){check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"};repository.requireDataExchange()}
    fun messageFileForeground(){check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"};repository.requireFileOwner()}
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""
        scope.launch {
            try { withContext(Dispatchers.IO) { action() } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = if(failure.message?.startsWith("MESSAGING_FILE_")==true)fileText.getString("error")else messagingError(failure.message) }
            finally {runCatching{withContext(Dispatchers.IO){repository.refreshFileIntakes()}};busy = false }
        }
    }
    fun back() { if (state.selected != null) run { repository.closeConversation() } else onClose() }
    BackHandler(onBack = ::back)
    LaunchedEffect(repository) {
        busy = true
        try { withContext(Dispatchers.IO) { repository.initialize(); if (initialSpaceId != null) repository.participants(initialSpaceId, true, client) } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = messagingError(failure.message) }
        finally { busy = false }
    }
    LaunchedEffect(repository, lifecycle, initialSpaceId, state.initialized) {
        if (initialSpaceId != null && state.initialized) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(45_000)
                runCatching { withContext(Dispatchers.IO) { repository.participants(initialSpaceId, true, client) } }
                    .onFailure { if (it is CancellationException) throw it }
            }
        }
    }
    val pollingConversation = state.selected?.id
    LaunchedEffect(repository, tab, query, state.initialized, pollingConversation) {
        if (tab == "contacts" && state.initialized && pollingConversation == null) {
            delay(250)
            try { withContext(Dispatchers.IO) { repository.contacts(query) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = messagingError(failure.message) }
        }
    }
    LaunchedEffect(repository, lifecycle, pollingConversation, state.accepted, state.keyReady, state.keyChanged, state.accessBlocked) {
        if (pollingConversation != null && state.accepted && state.keyReady && !state.keyChanged && !state.accessBlocked) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    delay(5_000)
                    try { withContext(Dispatchers.IO) { repository.refreshConversation(pollingConversation) } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { error = "Не удалось обновить переписку. Повторите после подключения." }
                }
            }
        }
    }
    LaunchedEffect(repository,state.initialized,ownKeyTransfer?.request?.id,ownKeyTransfer?.phase){
        val selected=ownKeyTransfer?:return@LaunchedEffect
        if(selected.phase=="ready"&&selected.request.kind=="import"&&state.initialized){
            try{fileForeground();backupSource=selected.request.encryptedSource(::fileForeground);backup=true;password="";recoveryKeySaved=false}
            catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=messagingError("INVALID_BACKUP")}
        }
        if(selected.phase=="complete"&&selected.request.kind=="export"){backup=false;password="";backupSource=null;recoveryKeySaved=false}
        if(selected.phase=="failed"){password="";backupSource=null;recoveryKeySaved=false;error=messagingError("INVALID_BACKUP")}
    }
    val headerActions: @Composable () -> Unit = {
            Box {
                WorkspaceHeaderButton(genesisTranslate("Действия"), "messaging-actions", onClick = { more = true }) { GenesisLucideIcon("ellipsis") }
                DropdownMenu(more, { more = false }) {
                    DropdownMenuItem(text = { Text("Обновить") }, leadingIcon = { GenesisLucideIcon("refresh-cw") }, onClick = { more = false; run {
                        if (!state.initialized) repository.initialize() else if (state.selected != null && state.accepted) repository.messages() else repository.refreshInbox()
                        if (initialSpaceId != null) repository.participants(initialSpaceId, true, client)
                    } }, enabled = !busy)
                    DropdownMenuItem(text = { Text("Резервная копия ключа") }, leadingIcon = { GenesisLucideIcon("key-round") }, onClick = { more = false; backup = true }, enabled = !busy)
                    if (state.securityCode != null) DropdownMenuItem(text = { Text("Код безопасности") }, leadingIcon = { GenesisLucideIcon("lock-keyhole") }, onClick = { more = false; security = true })
                    if (state.accepted) DropdownMenuItem(text = { Text("Очистить переписку") }, leadingIcon = { GenesisLucideIcon("trash-2") }, onClick = { more = false; clearConfirm = true }, enabled = !busy && !state.pending)
                }
            }
    }
    val headerInShell = WorkspaceScreenHeader(state.selected?.peerName ?: "Личные сообщения",
        if (state.selected != null) "Сквозное шифрование" else null,
        navigation = { if (state.selected != null) WorkspaceHeaderButton(genesisTranslate("Назад"), "messaging-back", onClick = ::back) {
            GenesisLucideIcon("chevron-left")
        } }, showThemeToggle = state.selected == null, actions = headerActions)
    Column(Modifier.fillMaxSize().imePadding().testTag("messaging-screen")) {
        if (!headerInShell) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AffairsIconButton("Назад", AffairsAction.BACK, ::back)
            Text("Личные сообщения", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            headerActions()
        }
        if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        ownFileDestination?.takeIf{it.phase=="ready"}?.let{destination->Column(Modifier.fillMaxWidth().padding(12.dp)){
            if(destination.request.purpose=="message-input"){
                Text(fileText.getString("notice"),style=MaterialTheme.typography.bodySmall)
                Button(onClick={run{
                    val request=destination.request;messageFileForeground();request.current();val ownerGuard=authController.privateUiOwnerGuard(repository.ownerUid)
                    fun current(){messageFileForeground();ownerGuard();request.current()}
                    val input=NativeUserFileInput(::current)
                    try{check(fileAccess.compareAndSet(null,input)){"E2EE_FILE_DESTINATION_BUSY"};request.attach(input);val sources=request.sources()
                        repository.beginFileIntake(request.intentId,sources.size,::current);current()
                        sources.forEachIndexed{index,uri->val file=input.read(context.applicationContext,uri)
                            try{current();repository.stageFileIntake(request.intentId,index,file.name,file.type,file.bytes,::current);current()}finally{input.release(file)}}
                        NativeContentFileDestination.complete(request)
                    }catch(reason:Throwable){NativeContentFileDestination.failed(request);throw reason}
                    finally{fileAccess.compareAndSet(input,null);request.detach(input);input.close()}
                }},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(fileText.getString("import"))}
            }else{
                Text(outputText.getString("notice"),style=MaterialTheme.typography.bodySmall)
                Button(onClick={run{
                    val request=destination.request;fileForeground();request.current();val ownerGuard=authController.privateDataExchangeOwnerGuard(repository.ownerUid)
                    fun current(){fileForeground();ownerGuard();request.current()}
                    val bytes=repository.openFileOutput(request.intentId,::current);var output:NativeUserFileOutput?=null
                    try{val access=NativeUserFileOutput(bytes,::current);output=access;check(fileAccess.compareAndSet(null,access)){"E2EE_FILE_DESTINATION_BUSY"};request.attach(access)
                        access.write(context.applicationContext,request.uri());current();NativeContentFileDestination.complete(request)
                    }catch(reason:Throwable){NativeContentFileDestination.failed(request);throw reason}
                    finally{output?.let{fileAccess.compareAndSet(it,null);request.detach(it);it.close()};bytes.fill(0)}
                }},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(outputText.getString("download"))}
            }
        }}
        if (error.isNotBlank()) Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(error, Modifier.weight(1f), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            AffairsIconButton("Закрыть", AffairsAction.CLOSE, { error = "" })
        }
        if (state.restoreRequired) Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(10.dp), modifier = Modifier.padding(12.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text("Восстановите ключ сообщений", style = MaterialTheme.typography.titleMedium)
                Text("В аккаунте уже есть ключ. Импортируйте его резервную копию с другого устройства, чтобы читать и отправлять сообщения.", style = MaterialTheme.typography.bodySmall)
                TextButton({ backup = true }, Modifier.heightIn(min = 48.dp)) { Text("Импортировать ключ") }
            }
        }
        if (state.selected == null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(IntrinsicSize.Min)
                .testTag("messaging-tabs"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(tab == "inbox", { tab = "inbox" },
                    { CompactChoiceLabel("Переписки") },
                    modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("messaging-tab-inbox"))
                FilterChip(tab == "contacts", { tab = "contacts" },
                    { CompactChoiceLabel("Контакты") },
                    modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("messaging-tab-contacts"))
                if (initialSpaceId != null) FilterChip(tab == "participants", { tab = "participants" },
                    { CompactChoiceLabel("Участники") },
                    modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("messaging-tab-participants"))
            }
            if (tab == "contacts") OutlinedTextField(query, { query = it.take(200) },
                Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag("messaging-contacts-search"),
                label = { Text("Поиск контактов") }, leadingIcon = { GenesisLucideIcon("search") },
                singleLine = true, shape = AffairsLayout.controlShape)
            LazyColumn(Modifier.weight(1f).testTag("messaging-inbox"), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (tab == "inbox") {
                    if (state.invitations.isNotEmpty()) item { Text("Приглашения", style = MaterialTheme.typography.titleMedium) }
                    items(state.invitations, key = { "invite:${it.id}" }) { notice -> MessagingNoticeRow(notice, busy) { run { repository.select(notice) } } }
                    if (state.invitations.isNotEmpty()) item { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
                    items(state.conversations, key = { it.id }) { notice -> MessagingNoticeRow(notice, busy) { run { repository.select(notice) } } }
                    if (state.conversations.isEmpty() && state.invitations.isEmpty() && !busy) item {
                        Text("Личных переписок пока нет. Выберите участника общего пространства.", Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (tab == "contacts") {
                    items(state.contacts, key = { it.id }) { notice -> MessagingNoticeRow(notice, busy) { run { repository.select(notice) } } }
                    if (state.contactsCursor != null) item { TextButton({ run { repository.contacts(query, state.contactsCursor) } }, enabled = !busy && state.contactsQuery == query) { Text("Загрузить ещё") } }
                }
                if (tab == "participants") {
                    items(state.participants.filter { it.id != repository.ownerUid }, key = { it.id }) { peer ->
                        TextButton({ if (initialSpaceId != null) run { repository.open(initialSpaceId, peer.id) } }, Modifier.fillMaxWidth().heightIn(min = 64.dp), enabled = state.keyReady && !busy) {
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                                UntranslatedText(peer.name, style = MaterialTheme.typography.titleSmall)
                                Text(if (peer.viewing) "Сейчас в пространстве" else "Участник пространства", style = MaterialTheme.typography.bodySmall)
                            }
                            GenesisLucideIcon("chevron-right")
                        }
                        HorizontalDivider()
                    }
                }
            }
        } else if (state.accessBlocked) {
            Text("Доступ к переписке изменился. Вернитесь в общие дела и обновите доступ.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
        } else if (state.keyChanged) {
            Column(Modifier.padding(16.dp)) {
                Text("Ключ собеседника изменился", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.error)
                Text("Отправка и загрузка файлов остановлены. Сверьте код безопасности с собеседником по другому каналу.")
                OutlinedButton({ security = true }, Modifier.heightIn(min = 48.dp)) { Text("Код безопасности") }
            }
        } else if (!state.accepted) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (state.declined) "Приглашение отклонено" else if (state.initiator == repository.ownerUid) "Приглашение отправлено" else "Приглашение в личную переписку", style = MaterialTheme.typography.titleLarge)
                Text("Сообщения доступны только участникам переписки. Для начала оба устройства должны настроить ключ сообщений.")
                if (!state.declined && state.initiator != repository.ownerUid) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button({ run { repository.respond(true) } }, enabled = !busy && state.keyReady) { Text("Принять") }
                    OutlinedButton({ run { repository.respond(false) } }, enabled = !busy) { Text("Отклонить") }
                }
            }
        } else {
            if (state.offline) Text("Нет сети. Черновик сохранён; показана последняя загруженная переписка.", Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall)
            LazyColumn(Modifier.weight(1f).testTag("messaging-messages"), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (state.before != null) item { TextButton({ run { repository.messages(true) } }, enabled = !busy) { Text("Ранние сообщения") } }
                items(state.messages, key = { it.id }) { row ->
                    var menu by remember(row.id) { mutableStateOf(false) }
                    Surface(color = if (row.senderId == repository.ownerUid) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                        shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth().testTag("message-${row.id}")) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(if (row.senderId == repository.ownerUid) "Вы" else state.selected!!.peerName, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                                if (row.senderId == repository.ownerUid && !row.deleted && !row.failed) Box {
                                    AffairsIconButton("Действия сообщения", AffairsAction.MORE, { menu = true })
                                    DropdownMenu(menu, { menu = false }) {
                                        DropdownMenuItem(text = { Text("Редактировать") }, onClick = { menu = false; run { repository.edit(row) } }, enabled = !busy && !state.pending)
                                        DropdownMenuItem(text = { Text("Удалить") }, onClick = { menu = false; deleteConfirm = row }, enabled = !busy && !state.pending)
                                    }
                                }
                            }
                            if (row.deleted) Text("Сообщение удалено", style = MaterialTheme.typography.bodySmall)
                            else if (row.failed) Text("Не удалось расшифровать сообщение. Проверьте ключ и код безопасности.", color = MaterialTheme.colorScheme.error)
                            else row.content?.let { content ->
                                SelectionContainer { UntranslatedText(content.text, style = MaterialTheme.typography.bodyLarge) }
                                content.files.forEach { file ->
                                    TextButton({val conversation=state.selected?.id;if(conversation!=null)run{fileForeground();val id=repository.prepareFileOutput(conversation,row,file)
                                        NativeContentFileDestination.prepare(repository.ownerUid,id,authController.privateDataExchangeOwnerGuard(repository.ownerUid),"message")
                                    }}, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !busy) {
                                        GenesisLucideIcon("download", Modifier.size(20.dp)); Spacer(Modifier.width(8.dp))
                                        UntranslatedText(file.name, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        Text("${(file.size + 1023) / 1024} КБ", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
                if (state.messages.isEmpty() && !busy) item { Text("Начните защищённую переписку", Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            state.draft?.let { draft ->
                val composerConversation = state.selected!!.id
                var text by remember(draft.id, draft.revision,state.draftRestoreEpoch) { mutableStateOf(draft.text) }
                LaunchedEffect(draft.id, draft.revision, state.pending) { if (!state.pending && draft.text.isEmpty()) text = "" }
                Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (draft.revision > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Редактирование сообщения", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                            AffairsIconButton("Отменить редактирование", AffairsAction.CLOSE, { cancelEditConfirm = true }, enabled = !busy && !state.pending)
                        }
                        draft.files.forEach { file -> Row(verticalAlignment = Alignment.CenterVertically) {
                            UntranslatedText(file.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            AffairsIconButton("Убрать файл", AffairsAction.CLOSE, { run { repository.removeFile(file.id) } }, enabled = !busy && !state.pending)
                        } }
                        state.fileIntakes.forEach{intake->Column(Modifier.fillMaxWidth()){
                            Text(fileText.getString(if(intake.retained)"retained"else"pending"),style=MaterialTheme.typography.labelMedium)
                            intake.names.forEach{name->UntranslatedText(name,maxLines=2,overflow=TextOverflow.Ellipsis)}
                            Text(fileText.getString("notice"),style=MaterialTheme.typography.bodySmall)
                            if(!intake.complete)TextButton(onClick={run{messageFileForeground();repository.resumeFileIntake(intake.id)
                                NativeContentFileDestination.prepare(repository.ownerUid,intake.id,authController.privateUiOwnerGuard(repository.ownerUid),"message-input")
                            }},enabled=!busy&&!state.pending,modifier=Modifier.heightIn(min=48.dp)){Text(fileText.getString("resume"))}
                            if(!intake.complete)TextButton(onClick={restoreFileDraft=intake.id to null},enabled=!busy&&!state.pending,modifier=Modifier.heightIn(min=48.dp)){Text(draftRecoveryText.getString("restore"))}
                            intake.savedDraftIds.forEachIndexed{index,id->TextButton(onClick={restoreFileDraft=intake.id to id},enabled=!busy&&!state.pending,modifier=Modifier.heightIn(min=48.dp)){Text(draftRecoveryText.getString("copy")+" ${index+1}")}}
                            if(!intake.retained)TextButton(onClick={run{repository.retainFileIntake(intake.id)}},enabled=!busy&&!state.pending,modifier=Modifier.heightIn(min=48.dp)){Text(fileText.getString("retain"))}
                        }}
                        if (state.pending) {
                            Text("Отправка не подтверждена. Повторите запрос; сохранённое сообщение не будет продублировано.", style = MaterialTheme.typography.bodySmall)
                            TextButton({ recoverConfirm = true }, Modifier.heightIn(min = 48.dp), enabled = !busy) {
                                Text(if (state.pendingDelete) "Отменить повтор удаления" else "Сохранить копию сообщения")
                            }
                        }
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val attachmentLabel = genesisTranslate("Прикрепить файлы")
                            IconButton({val conversation=composerConversation;val draftId=draft.id;val revision=draft.revision;run{messageFileForeground()
                                val id=repository.prepareFileIntake(conversation,draftId,revision);messageFileForeground()
                                NativeContentFileDestination.prepare(repository.ownerUid,id,authController.privateUiOwnerGuard(repository.ownerUid),"message-input")
                            }}, Modifier.size(48.dp).semantics { contentDescription = attachmentLabel }, enabled = state.keyReady && !busy && !state.pending && draft.files.size < 5&&state.fileIntakes.none{it.draftId==draft.id&&!it.retained}) {
                                GenesisLucideIcon("paperclip", Modifier.size(22.dp))
                            }
                            OutlinedTextField(text, { value ->
                                if (value.toByteArray(Charsets.UTF_8).size <= 30000) {
                                    text = value
                                    // Acquire the repository mutex in UI event order; the Room adapter moves disk IO off the main thread.
                                    scope.launch(Dispatchers.Main.immediate) { try { repository.saveDraft(value, composerConversation, draft.id, draft.revision) } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { error = "Не удалось сохранить черновик сообщения." } }
                                }
                            }, Modifier.weight(1f).testTag("messaging-composer"), placeholder = { Text("Сообщение") }, maxLines = 5, shape = RoundedCornerShape(10.dp), enabled = state.keyReady && !busy && !state.pending)
                            val sendLabel = genesisTranslate(if (state.pending) "Повторить отправку" else "Отправить сообщение")
                            IconButton({ run { repository.send(text) } }, Modifier.size(48.dp).testTag("messaging-send").semantics { contentDescription = sendLabel }, enabled = state.keyReady && !busy && (state.pending || text.isNotBlank() || draft.files.isNotEmpty())&&(state.pending||state.fileIntakes.none{it.draftId==draft.id&&!it.retained})) {
                                GenesisLucideIcon(if (state.pending) "refresh-cw" else "send", Modifier.size(22.dp))
                            }
                        }
                        Text("До 5 файлов, каждый до 10 МБ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    if (security) AlertDialog(onDismissRequest = { security = false }, title = { Text("Код безопасности") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Сверьте этот код с собеседником по другому каналу. Совпадение подтверждает ключи устройств.")
            SelectionContainer { UntranslatedText(state.securityCode.orEmpty(), style = MaterialTheme.typography.titleMedium) }
        }
    }, confirmButton = {})
    if (cancelEditConfirm) AlertDialog(onDismissRequest = { cancelEditConfirm = false }, title = { Text("Отменить редактирование сообщения?") },
        text = { Text("Несохранённая правка и выбранные файлы будут удалены из черновика. Отправленное сообщение сохранится.") },
        confirmButton = { TextButton({ cancelEditConfirm = false; run { repository.cancelEdit() } }, enabled = !busy) { Text("Отменить редактирование") } },
        dismissButton = { TextButton({ cancelEditConfirm = false }) { Text("Продолжить редактирование") } })
    if (recoverConfirm) AlertDialog(onDismissRequest = { recoverConfirm = false }, title = { Text(if (state.pendingDelete) "Отменить повтор удаления?" else "Сохранить копию сообщения?") },
        text = { Text(if (state.pendingDelete) "Приложение проверит переписку и прекратит повтор удаления. Уже выполненное удаление отменить нельзя."
            else "Приложение сначала проверит отправку. Если она не подтверждена, текст и доступные файлы станут новым черновиком. Проверьте переписку перед повторной отправкой.") },
        confirmButton = { TextButton({ recoverConfirm = false; run { repository.recoverPending() } }, enabled = !busy) { Text(if (state.pendingDelete) "Прекратить повтор" else "Сохранить копию") } },
        dismissButton = { TextButton({ recoverConfirm = false }) { Text("Отмена") } })
    restoreFileDraft?.let{selected->AlertDialog(onDismissRequest={if(!busy)restoreFileDraft=null},title={Text(draftRecoveryText.getString("restore"))},text={Text(draftRecoveryText.getString("notice"))},
        confirmButton={TextButton(onClick={restoreFileDraft=null;run{repository.restoreFileIntakeDraft(selected.first,selected.second)}},enabled=!busy){Text(draftRecoveryText.getString("restore"))}},
        dismissButton={TextButton(onClick={restoreFileDraft=null},enabled=!busy){Text("Назад")}})}
    if (clearConfirm || deleteConfirm != null) AlertDialog(onDismissRequest = { clearConfirm = false; deleteConfirm = null },
        title = { Text(if (clearConfirm) "Очистить переписку для обоих?" else "Удалить сообщение для обоих?") },
        text = { Text("Сообщения и прикреплённые файлы будут удалены без возможности восстановления.") },
        confirmButton = { TextButton({ val row = deleteConfirm; val clear = clearConfirm; clearConfirm = false; deleteConfirm = null; run { if (clear) repository.clear() else if (row != null) repository.delete(row) } }, enabled = !busy) { Text("Удалить") } },
        dismissButton = { TextButton({ clearConfirm = false; deleteConfirm = null }) { Text("Отмена") } })
    if (backup) AlertDialog(onDismissRequest = { if (!busy) { ownKeyTransfer?.takeIf{it.phase=="ready"}?.request?.let(NativeMessageKeyTransfer::failed);backup = false; password = ""; backupSource = null } },
        properties=androidx.compose.ui.window.DialogProperties(securePolicy=androidx.compose.ui.window.SecureFlagPolicy.SecureOn),
        title = { Text(if (state.keyReady && backupSource == null) "Резервная копия ключа" else "Импортировать ключ") }, text = {
        Column(Modifier.heightIn(max = (LocalConfiguration.current.screenHeightDp * .55f).dp)
            .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!canExchange) NativeAccessMessage("FEATURE_SUBSCRIPTION_REQUIRED", "data-export")
            Text(recoveryCopy.getString("notice"))
            OutlinedTextField(password, { password = it.take(4096);recoveryKeySaved=false }, modifier = Modifier.fillMaxWidth().testTag("messaging-backup-password"),
                label = { Text(recoveryCopy.getString("input")) }, visualTransformation = if(backupSource==null)androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(), singleLine = true, shape = RoundedCornerShape(10.dp))
            if(backupSource==null&&state.keyReady){
                OutlinedButton({password=GenesisBackupContainer.newRecoveryKey();recoveryKeySaved=false},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){Text(recoveryCopy.getString("generate"))}
                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(recoveryKeySaved,{recoveryKeySaved=it},enabled=!busy&&MessagingCrypto.isRecoveryKey(password));Text(recoveryCopy.getString("saved"),Modifier.weight(1f))}
            }
            if (backupSource != null) Text("Файл ключа выбран. Введите его пароль и восстановите ключ.", style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedButton({try{fileForeground();val guard=authController.privateDataExchangeOwnerGuard(repository.ownerUid);password="";backupSource=null;recoveryKeySaved=false;NativeMessageKeyTransfer.prepareImport(repository.ownerUid,guard)}catch(_:Exception){error=messagingError("INVALID_BACKUP")}}, enabled = !busy && canExchange && ownKeyTransfer?.phase !in setOf("requested","picking","io")) { Text("Выбрать копию ключа") }
        }
    }, confirmButton = { Button({
        val supplied=password;password="";recoveryKeySaved=false
        if (backupSource != null){val selected=ownKeyTransfer?.takeIf{it.phase=="ready"&&it.request.kind=="import"}?.request;run{
            val request=requireNotNull(selected){"INVALID_BACKUP"};val source=request.encryptedSource(::fileForeground)
            repository.importBackup(source,supplied){request.current();fileForeground()};request.current();NativeMessageKeyTransfer.consumed(request);backup=false;backupSource=null
        }}
        else{try{val guard=authController.privateDataExchangeOwnerGuard(repository.ownerUid);run{
            val source=repository.exportBackup(supplied);withContext(Dispatchers.Main.immediate){fileForeground();guard();NativeMessageKeyTransfer.prepareExport(repository.ownerUid,source,guard)}
        }}catch(_:Exception){error=messagingError("INVALID_BACKUP")}}
    }, enabled = !busy && canExchange && (if(backupSource!=null)password.length>=12 else state.keyReady&&recoveryKeySaved&&MessagingCrypto.isRecoveryKey(password))) {
        Text(if (backupSource != null || !state.keyReady) "Восстановить" else "Сохранить копию") } },
        dismissButton = { TextButton({ ownKeyTransfer?.takeIf{it.phase=="ready"}?.request?.let(NativeMessageKeyTransfer::failed);backup = false; password = ""; backupSource = null }, enabled = !busy) { Text("Закрыть") } })
}

@Composable private fun MessagingNoticeRow(notice: MessagingNotice, busy: Boolean, onClick: () -> Unit) {
    TextButton(onClick, Modifier.fillMaxWidth().heightIn(min = 64.dp), enabled = !busy) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            UntranslatedText(notice.peerName, style = MaterialTheme.typography.titleMedium)
            UntranslatedText(notice.spaceTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (notice.unread > 0) Badge { UntranslatedText(notice.unread.toString()) }
        Spacer(Modifier.width(8.dp)); GenesisLucideIcon("chevron-right", Modifier.size(20.dp))
    }
    HorizontalDivider()
}

private fun messagingError(code: String?): String = when (code) {
    "FEATURE_SUBSCRIPTION_REQUIRED" -> exportErrorText(code)
    "MESSAGING_BACKUP_REQUIRED", "MESSAGING_KEY_MISMATCH", "PRIVATE_PUBLIC_MISMATCH" -> "Ключ не совпадает. Импортируйте правильную резервную копию и сверьте код безопасности."
    "PRIVATE_FILE_TOO_LARGE", "TOO_MANY_PRIVATE_FILES" -> "Можно прикрепить до 5 файлов, каждый не больше 10 МБ."
    "BACKUP_PASSWORD_REQUIRED", "INVALID_BACKUP" -> "Не удалось открыть копию ключа. Проверьте файл и пароль."
    "MESSAGING_PENDING_COMMAND" -> "Сначала подтвердите отправку сохранённого сообщения."
    "MESSAGING_DRAFT_EXISTS" -> "Сначала завершите текущий черновик. Его текст и файлы сохранены."
    "INVALID_MESSAGE" -> "Сообщение слишком длинное. Сократите текст или имена файлов; черновик сохранён."
    else -> "Не удалось выполнить запрос. Черновик и неподтверждённая отправка сохранены. Обновите данные или повторите отправку."
}

