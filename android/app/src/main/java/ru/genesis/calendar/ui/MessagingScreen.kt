package ru.genesis.calendar.ui

import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import ru.genesis.calendar.security.PrivateFileMetadata
import java.util.UUID
import java.io.ByteArrayOutputStream
import java.io.InputStream

@Composable internal fun MessagingScreen(repository: MessagingRepository, initialSpaceId: String? = null, onClose: () -> Unit) {
    val state by repository.state.collectAsStateWithLifecycle()
    val canExchange = LocalFeatureAccess.current.allows("data-export")
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(if (initialSpaceId == null) "inbox" else "participants") }
    var query by remember { mutableStateOf("") }
    var backup by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var backupSource by remember { mutableStateOf<String?>(null) }
    var backupExport by remember { mutableStateOf<String?>(null) }
    var more by remember { mutableStateOf(false) }
    var security by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf<MessagingRow?>(null) }
    var cancelEditConfirm by remember { mutableStateOf(false) }
    var recoverConfirm by remember { mutableStateOf(false) }
    var download by remember { mutableStateOf<Pair<MessagingRow, PrivateFileMetadata>?>(null) }
    val client = remember { UUID.randomUUID().toString() }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""
        scope.launch {
            try { withContext(Dispatchers.IO) { action() } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = messagingError(failure.message) }
            finally { busy = false }
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
    val exportKey = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val source = backupExport; backupExport = null
        if (uri != null && source != null) run {
            repository.writeBackup(source) { context.contentResolver.openOutputStream(uri) ?: error("FILE_WRITE_FAILED") }
            backup = false; password = ""; backupSource = null
        }
    }
    val importKey = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) run {
            repository.requireDataExchange()
            val source = context.contentResolver.openInputStream(uri)?.use { input ->
                val bytes = messagingRead(input, 4000); bytes.toString(Charsets.UTF_8)
            } ?: error("FILE_READ_FAILED")
            repository.requireDataExchange()
            backupSource = source
        }
    }
    val exportFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val selected = download; download = null
        if (uri != null && selected != null) run {
            val bytes = repository.download(selected.first, selected.second)
            try { context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("FILE_WRITE_FAILED") }
            finally { bytes.fill(0) }
        }
    }
    val attach = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) run {
            require((state.draft?.files?.size ?: 0) + uris.size <= 5) { "TOO_MANY_PRIVATE_FILES" }
            uris.forEach { uri ->
                val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "file"
                val bytes = context.contentResolver.openInputStream(uri)?.use { messagingRead(it, MessagingCrypto.FILE_LIMIT) } ?: error("FILE_READ_FAILED")
                try { require(bytes.size <= MessagingCrypto.FILE_LIMIT) { "PRIVATE_FILE_TOO_LARGE" }; repository.attach(name, context.contentResolver.getType(uri) ?: "application/octet-stream", bytes) }
                finally { bytes.fill(0) }
            }
        }
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
                                    TextButton({ download = row to file; exportFile.launch(file.name) }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = !busy) {
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
                var text by remember(draft.id, draft.revision) { mutableStateOf(draft.text) }
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
                        if (state.pending) {
                            Text("Отправка не подтверждена. Повторите запрос; сохранённое сообщение не будет продублировано.", style = MaterialTheme.typography.bodySmall)
                            TextButton({ recoverConfirm = true }, Modifier.heightIn(min = 48.dp), enabled = !busy) {
                                Text(if (state.pendingDelete) "Отменить повтор удаления" else "Сохранить копию сообщения")
                            }
                        }
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val attachmentLabel = genesisTranslate("Прикрепить файлы")
                            IconButton({ attach.launch(arrayOf("*/*")) }, Modifier.size(48.dp).semantics { contentDescription = attachmentLabel }, enabled = state.keyReady && !busy && !state.pending && draft.files.size < 5) {
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
                            IconButton({ run { repository.send(text) } }, Modifier.size(48.dp).testTag("messaging-send").semantics { contentDescription = sendLabel }, enabled = state.keyReady && !busy && (state.pending || text.isNotBlank() || draft.files.isNotEmpty())) {
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
    if (clearConfirm || deleteConfirm != null) AlertDialog(onDismissRequest = { clearConfirm = false; deleteConfirm = null },
        title = { Text(if (clearConfirm) "Очистить переписку для обоих?" else "Удалить сообщение для обоих?") },
        text = { Text("Сообщения и прикреплённые файлы будут удалены без возможности восстановления.") },
        confirmButton = { TextButton({ val row = deleteConfirm; val clear = clearConfirm; clearConfirm = false; deleteConfirm = null; run { if (clear) repository.clear() else if (row != null) repository.delete(row) } }, enabled = !busy) { Text("Удалить") } },
        dismissButton = { TextButton({ clearConfirm = false; deleteConfirm = null }) { Text("Отмена") } })
    if (backup) AlertDialog(onDismissRequest = { if (!busy) { backup = false; password = ""; backupSource = null } },
        title = { Text(if (state.keyReady && backupSource == null) "Резервная копия ключа" else "Импортировать ключ") }, text = {
        Column(Modifier.heightIn(max = (LocalConfiguration.current.screenHeightDp * .55f).dp)
            .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!canExchange) NativeAccessMessage("FEATURE_SUBSCRIPTION_REQUIRED", "data-export")
            Text("Копия защищена паролем. Сохраните её и пароль отдельно: без ключа старые сообщения недоступны.")
            OutlinedTextField(password, { password = it }, modifier = Modifier.fillMaxWidth().testTag("messaging-backup-password"),
                label = { Text("Пароль: не менее 12 символов") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, shape = RoundedCornerShape(10.dp))
            if (backupSource != null) Text("Файл ключа выбран. Введите его пароль и восстановите ключ.", style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedButton({ importKey.launch(arrayOf("application/json", "text/*", "application/octet-stream")) }, enabled = !busy && canExchange) { Text("Выбрать копию ключа") }
        }
    }, confirmButton = { Button({
        if (backupSource != null) run { repository.importBackup(backupSource!!, password); backup = false; password = ""; backupSource = null }
        else run { backupExport = repository.exportBackup(password); withContext(Dispatchers.Main) { exportKey.launch("genesis-messaging-key.json") } }
    }, enabled = !busy && canExchange && password.length >= 12 && (backupSource != null || state.keyReady)) {
        Text(if (backupSource != null || !state.keyReady) "Восстановить" else "Сохранить копию") } },
        dismissButton = { TextButton({ backup = false; password = ""; backupSource = null }, enabled = !busy) { Text("Закрыть") } })
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

private fun messagingRead(input: InputStream, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) {
        val count = input.read(buffer); if (count < 0) break
        require(output.size() + count <= maximum) { if (maximum == 4000) "INVALID_BACKUP" else "PRIVATE_FILE_TOO_LARGE" }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
