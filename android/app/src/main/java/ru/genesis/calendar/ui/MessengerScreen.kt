package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.MessengerRepository
import ru.genesis.calendar.data.MessengerChat
import ru.genesis.calendar.data.MessengerRow
import java.util.UUID

@Composable internal fun messengerText(key: String): String {
    val context=LocalContext.current; val language=LocalGenesisLanguage.current
    val copy=remember(context,language){context.assets.open("originals/i18n/messenger-copy.json").bufferedReader().use{JSONObject(it.readText()).let{root->root.optJSONObject(language)?:root.getJSONObject("en")}}}
    return copy.getString(key)
}

@Composable internal fun MessengerScreen(repository: MessengerRepository, language: String, initialProjectId: String? = null,
    onInitialProjectOpened: () -> Unit = {}, legacy: (@Composable (() -> Unit) -> Unit)? = null, onClose: () -> Unit) {
    val context=LocalContext.current
    val copy=remember(language,context){context.assets.open("originals/i18n/messenger-copy.json").bufferedReader().use{JSONObject(it.readText()).let{root->root.optJSONObject(language)?:root.getJSONObject("en")}}}
    fun c(key: String)=copy.getString(key)
    val state by repository.state.collectAsStateWithLifecycle()
    val scope=rememberCoroutineScope();val lifecycle=LocalLifecycleOwner.current.lifecycle
    var busy by remember{mutableStateOf(false)};var failure by remember{mutableStateOf("")}
    var tab by remember{mutableStateOf("chats")};var modal by remember{mutableStateOf<String?>(null)}
    var email by remember{mutableStateOf("")};var groupTitle by remember{mutableStateOf("")};var kind by remember{mutableStateOf("direct")}
    var project by remember{mutableStateOf("")};var projects by remember{mutableStateOf(emptyList<Pair<String,String>>())}
    var devices by remember{mutableStateOf(JSONArray())};var creationId by remember{mutableStateOf(UUID.randomUUID().toString())}
    var draft by remember{mutableStateOf("")};var delete by remember{mutableStateOf<MessengerRow?>(null)}
    var confirm by remember{mutableStateOf<Pair<String,suspend ()->Unit>?>(null)}
    var legacyOpen by remember{mutableStateOf(false)}
    var showHidden by remember{mutableStateOf(false)}
    var deletingChat by remember{mutableStateOf<MessengerChat?>(null)}
    fun run(action: suspend ()->Unit){if(busy)return;busy=true;failure="";scope.launch{try{withContext(Dispatchers.IO){action()}}catch(e:CancellationException){throw e}catch(e:Exception){failure=when{e.message?.contains("CONTACT_UNAVAILABLE")==true->c("contactUnavailable");e.message?.contains("RATE_LIMIT")==true->c("requestLimit");else->c("failure")}}finally{busy=false}}}
    fun back(){if(legacyOpen)legacyOpen=false else if(state.selected!=null)run{repository.close()}else if(showHidden)showHidden=false else onClose()}
    BackHandler{back()}
    LaunchedEffect(repository){run{repository.initialize();if(initialProjectId!=null){val chat=repository.create("project",projectId=initialProjectId,commandId=UUID.randomUUID().toString());repository.select(chat);onInitialProjectOpened()}}}
    LaunchedEffect(repository,lifecycle,state.selected?.id){lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){while(true){delay(5000);if(!busy)try{withContext(Dispatchers.IO){if(state.selected==null)repository.inbox()else repository.refresh()}}catch(e:CancellationException){throw e}catch(_:Exception){failure=c("failure")}}}}
    LaunchedEffect(state.selected?.id,state.editing?.id,state.pending){draft=state.draft}
    LaunchedEffect(draft,state.selected?.id){if(state.selected!=null&&!state.pending){delay(250);withContext(Dispatchers.IO){repository.saveDraft(draft)}}}
    if(legacyOpen&&legacy!=null){Column(Modifier.fillMaxSize()){TextButton({legacyOpen=false},Modifier.heightIn(min=48.dp)){Text(c("back"))};legacy{legacyOpen=false}};return}
    val current=state.selected;val own=current?.members?.firstOrNull{it.userId==repository.owner}
    val inboxActions: @Composable () -> Unit = {
        Box {
            var menu by remember { mutableStateOf(false) }
            WorkspaceHeaderButton(c("actions"), "messenger-actions", onClick={menu=true}) { GenesisLucideIcon("ellipsis") }
            DropdownMenu(menu,{menu=false}) {
                DropdownMenuItem(text={Text(c("newChat"))},leadingIcon={GenesisLucideIcon("message-circle")},enabled=!busy,
                    onClick={menu=false;modal="new";creationId=UUID.randomUUID().toString();run{projects=repository.projects()}})
                DropdownMenuItem(text={Text(c("refresh"))},leadingIcon={GenesisLucideIcon("refresh-cw")},enabled=!busy,
                    onClick={menu=false;run{if(tab=="contacts")repository.contacts()else repository.inbox()}})
                DropdownMenuItem(text={Text(c("devices"))},leadingIcon={GenesisLucideIcon("phone-source")},enabled=!busy,
                    onClick={menu=false;run{devices=repository.devices();modal="devices"}})
                DropdownMenuItem(text={Text(c("hiddenChats"))},leadingIcon={GenesisLucideIcon("eye-off")},enabled=!busy,
                    onClick={menu=false;tab="chats";showHidden=true})
                if(legacy!=null)DropdownMenuItem(text={Text(c("legacy"))},leadingIcon={GenesisLucideIcon("history")},enabled=!busy,
                    onClick={menu=false;legacyOpen=true})
            }
        }
    }
    val header=WorkspaceScreenHeader(current?.title?:c("title"),current?.let{c(it.kind)},navigation={if(current!=null)WorkspaceHeaderButton(c("back"),"messenger-back",onClick=::back){GenesisLucideIcon("chevron-left")}},showThemeToggle=current==null,actions={
        if(current==null) {
            inboxActions()
        } else {
        WorkspaceHeaderButton(c("members"),"messenger-members",onClick={modal="members"}){GenesisLucideIcon("users-round")}
        Box{var menu by remember{mutableStateOf(false)};WorkspaceHeaderButton(c("actions"),"messenger-actions",onClick={menu=true}){GenesisLucideIcon("ellipsis")}
            DropdownMenu(menu,{menu=false}){
                DropdownMenuItem(text={Text(c("refresh"))},onClick={menu=false;run{repository.refresh()}})
                DropdownMenuItem(text={Text(c("devices"))},onClick={menu=false;run{devices=repository.devices();modal="devices"}})
                if(state.securityCode!=null)DropdownMenuItem(text={Text(c("security"))},onClick={menu=false;modal="security"})
                if(legacy!=null)DropdownMenuItem(text={Text(c("legacy"))},onClick={menu=false;legacyOpen=true})
            }
        }
        }
    })
    Column(Modifier.fillMaxSize().imePadding().testTag("messenger-screen"),verticalArrangement=Arrangement.spacedBy(8.dp)){
        if(!header)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            AffairsIconButton(c("back"),AffairsAction.BACK,::back);Text(current?.title?:c("title"),Modifier.weight(1f))
            if(current==null) inboxActions()
        }
        WorkspaceBackgroundStatus(busy, c("loading"))
        if(failure.isNotBlank())Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){Text(failure,Modifier.weight(1f),color=MaterialTheme.colorScheme.error);AffairsIconButton(c("close"),AffairsAction.CLOSE,{failure=""})}
        if(current==null){
            ConnectedSubmenu(listOf(SubmenuItem("chats", c("chats")), SubmenuItem("contacts", c("contacts"))),
                tab, { next -> if (!busy) { showHidden=false; if (next == "contacts") run { repository.contacts(); tab = next } else tab = next } },
                Modifier.testTag("messenger-submenu"))
            if(tab=="chats" && showHidden)Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
                Text(c("hiddenChats"),Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
                TextButton({showHidden=false},enabled=!busy){Text(c("chats"))}
            }
            if(tab=="contacts") Row(Modifier.fillMaxWidth().padding(horizontal=12.dp).height(IntrinsicSize.Min)
                .testTag("messenger-contact-form"), verticalAlignment=Alignment.CenterVertically,
                horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(email,{email=it.take(254)},Modifier.weight(1f).testTag("messenger-contact-email"),
                    placeholder={Text(c("email"))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email))
                AffairsIconButton(c("addContact"),AffairsAction.ADD,{run{repository.addContact(email);email=""}},
                    Modifier.fillMaxHeight().testTag("messenger-contact-add"),enabled=!busy,outlined=true)
            }
            LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                if(tab=="chats"){
                    val listed=if(showHidden)state.hiddenChats else state.chats
                    if(listed.isEmpty()&&!busy)item{Text(c(if(showHidden)"hiddenEmpty"else"empty"),color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    items(listed,key={it.id}){chat->
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                            Row(Modifier.weight(1f).heightIn(min=64.dp).clip(AffairsLayout.controlShape)
                                .clickable(enabled=!busy,role=Role.Button){run{repository.select(chat)}}
                                .testTag("messenger-chat-${chat.id}").padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                                GenesisLucideIcon(if(chat.kind=="secret")"lock-keyhole" else if(chat.kind=="project")"folder" else "message-circle",tint=MaterialTheme.colorScheme.primary)
                                Column(Modifier.weight(1f).padding(horizontal=8.dp),horizontalAlignment=Alignment.Start){
                                    UntranslatedText(chat.title,style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
                                    Text(c(chat.kind)+(if(chat.members.any{it.userId==repository.owner&&it.status=="pending"})" · "+c("invitation")else ""),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
                                }
                                if(chat.unread>0)Text(chat.unread.toString(),color=MaterialTheme.colorScheme.primary)
                            }
                            // A removed lazy row must not retain Material3 IconButton child semantics.
                            Box(Modifier.size(48.dp).clip(AffairsLayout.controlShape)
                                .clickable(enabled=!busy,role=Role.Button){run{repository.visibility(chat.id,if(showHidden)"show"else"hide")}}
                                .testTag("messenger-chat-hide-${chat.id}")
                                .semantics{contentDescription=c(if(showHidden)"showChat"else"hideChat")+" · "+chat.title},contentAlignment=Alignment.Center){
                                GenesisLucideIcon(if(showHidden)"eye"else"eye-off")
                            }
                            Box(Modifier.size(48.dp).clip(AffairsLayout.controlShape)
                                .clickable(enabled=!busy,role=Role.Button){deletingChat=chat}
                                .testTag("messenger-chat-delete-${chat.id}")
                                .semantics{contentDescription=c("deleteChat")+" · "+chat.title},contentAlignment=Alignment.Center){GenesisLucideIcon("trash-2")}
                        }
                        HorizontalDivider()
                    }
                }else{
                    if(state.contacts.isEmpty())item{Text(c("contactEmpty"))}
                    items(state.contacts,key={it.userId}){contact->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){TextButton({run{val chat=repository.create("direct",email=contact.email,commandId=UUID.randomUUID().toString());repository.select(chat);tab="chats"}},Modifier.weight(1f).heightIn(min=64.dp),enabled=!busy){Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.Start){Text(contact.name);Text(contact.email,style=MaterialTheme.typography.bodySmall)}};AffairsIconButton(c("removeContact"),AffairsAction.DELETE,{run{repository.removeContact(contact.userId)}},enabled=!busy)};HorizontalDivider()}
                    items(state.blocked,key={"blocked:${it.userId}"}){contact->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(contact.name,Modifier.weight(1f));TextButton({run{repository.block(contact.userId,false)}},enabled=!busy){Text(c("unblock"))}}}
                }
            }
        }else{
            var help by remember(current.id){mutableStateOf(false)}
            TextButton({help=!help},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(c(current.kind));GenesisLucideIcon(if(help)"chevron-up" else "chevron-down")}
            if(help)Text(c(if(current.kind=="secret")"secretHelp"else"cloudHelp")+(if(current.kind=="project")"\n"+c("projectHelp")else""),Modifier.padding(horizontal=12.dp),style=MaterialTheme.typography.bodySmall)
            if(own?.status=="pending")Column(Modifier.padding(12.dp)){Text(c("invitation"));Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button({run{repository.membership("accept")}},enabled=!busy){Text(c("accept"))};OutlinedButton({run{repository.membership("decline")}},enabled=!busy){Text(c("decline"))}}}
            state.secretError?.let{Text(c(if(it=="MESSENGER_SECRET_DEVICE_ONLY")"deviceOnly"else"notReady"),Modifier.padding(12.dp),color=MaterialTheme.colorScheme.onSurfaceVariant)}
            if(state.offline)Text(c("failure"),Modifier.padding(horizontal=12.dp),style=MaterialTheme.typography.bodySmall)
            val list=rememberLazyListState()
            LaunchedEffect(state.rows.size,current.id){if(state.rows.isNotEmpty()&&(list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?:0)>=state.rows.size-5)list.animateScrollToItem(state.rows.size-1)}
            LazyColumn(Modifier.weight(1f).testTag("messenger-messages"),state=list,contentPadding=PaddingValues(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                if(state.before!=null)item{TextButton({run{repository.older()}},enabled=!busy){Text(c("older"))}}
                items(state.rows,key={it.id}){row->Row(Modifier.fillMaxWidth(),horizontalArrangement=if(row.senderId==repository.owner)Arrangement.End else Arrangement.Start){Surface(color=if(row.senderId==repository.owner)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer,shape=RoundedCornerShape(10.dp),modifier=Modifier.fillMaxWidth(.94f)){
                    Column(Modifier.padding(12.dp)){
                        Row(verticalAlignment=Alignment.CenterVertically){Text(if(row.senderId==repository.owner)c("you")else current.members.firstOrNull{it.userId==row.senderId}?.name?:"",Modifier.weight(1f),style=MaterialTheme.typography.labelMedium)
                            if(!row.deleted&&row.senderId==repository.owner){var more by remember{mutableStateOf(false)};Box{AffairsIconButton(c("actions"),AffairsAction.MORE,{more=true},enabled=!busy&&!state.pending,outlined=false);DropdownMenu(more,{more=false}){DropdownMenuItem(text={Text(c("edit"))},onClick={more=false;run{repository.edit(row);draft=row.text}},enabled=!row.failed);DropdownMenuItem(text={Text(c("delete"))},onClick={more=false;delete=row})}}}}
                        SelectionContainer{UntranslatedText(if(row.deleted)c("deleted")else if(row.failed)c("decryptError")else row.text,style=MaterialTheme.typography.bodyLarge)}
                    }
                }}}
            }
            if(state.pending)Text(c("pending"),Modifier.padding(horizontal=12.dp),style=MaterialTheme.typography.bodySmall)
            if(state.pending && state.pendingConflict) TextButton({run{repository.recoverPendingConflict()}}, enabled=!busy,
                modifier=Modifier.padding(horizontal=12.dp).testTag("messenger-recover-pending")) { Text(c("recoverPending")) }
            if(own?.status!="pending"&&state.secretError==null)Row(Modifier.fillMaxWidth().padding(12.dp).height(IntrinsicSize.Min),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                OutlinedTextField(draft,{if(it.toByteArray().size<=30000)draft=it},Modifier.weight(1f).testTag("messenger-draft"),placeholder={Text(c("message"))},maxLines=4,enabled=!busy&&!state.pending)
                AffairsIconButton(c(if(state.pending)"retry"else if(state.editing!=null)"save"else"send"),AffairsAction.NEXT,{run{if(!state.pending)repository.saveDraft(draft);repository.send();draft=""}},modifier=Modifier.fillMaxHeight(),enabled=!busy&&(state.pending||draft.isNotBlank()),outlined=true)
                if(state.editing!=null&&!state.pending)AffairsIconButton(c("cancel"),AffairsAction.CLOSE,{run{repository.edit(null);draft=""}},modifier=Modifier.fillMaxHeight(),enabled=!busy,outlined=true)
            }
        }
    }

    if (modal == "new") AlertDialog(
        onDismissRequest = { modal = null },
        title = { Text(c("newChat")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("direct", "group", "project", "secret").forEach { k ->
                        FilterChip(kind == k, { kind = k; creationId = UUID.randomUUID().toString() },
                            { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                if (k == "project") Text("PRO") else GenesisLucideIcon(when(k) {
                                    "direct" -> "user-round"; "group" -> "users-round"; else -> "eye"
                                })
                            } }, Modifier.weight(1f).heightIn(min = 48.dp)
                                .semantics { contentDescription = c(k) }.testTag("messenger-kind-$k"))
                    }
                }
                if (kind == "project") {
                    Text(c("chooseProject"))
                    Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
                        if (projects.isEmpty()) Text(c("noProjects"))
                        projects.forEach { p ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(project == p.first, { project = p.first })
                                TextButton({ project = p.first }, Modifier.weight(1f)) { Text(p.second) }
                            }
                        }
                    }
                } else {
                    OutlinedTextField(email, { email = it.take(12000) }, label = { Text(c(if (kind == "group") "emails" else "email")) },
                        modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                    if (kind == "group") OutlinedTextField(groupTitle, { groupTitle = it.take(120) }, label = { Text(c("groupName")) }, modifier = Modifier.fillMaxWidth())
                }
                Text(c(if (kind == "secret") "secretHelp" else "cloudHelp"), style = MaterialTheme.typography.bodySmall)
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton({ run {
                val chat = repository.create(kind, email, groupTitle, project, creationId)
                repository.select(chat); modal = null; email = ""; groupTitle = ""; tab = "chats"
            } }, enabled = !busy && (if (kind == "project") project.isNotBlank() else email.isNotBlank() && (kind != "group" || groupTitle.isNotBlank()))) { Text(c("create")) }
        },
        dismissButton = { TextButton({ modal = null }) { Text(c("cancel")) } }
    )
    if (modal == "security") AlertDialog(
        onDismissRequest = { modal = null }, title = { Text(c("security")) },
        text = { Column { SelectionContainer { UntranslatedText(state.securityCode ?: "") }; Text(c("securityHelp")) } },
        confirmButton = { TextButton({ modal = null }) { Text(c("close")) } }
    )
    if (modal == "devices") AlertDialog(
        onDismissRequest = { modal = null }, title = { Text(c("devices")) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                repeat(devices.length()) { i ->
                    val d = devices.getJSONObject(i)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(d.getString("label"))
                            Text(d.getString("createdAt").take(10), style = MaterialTheme.typography.bodySmall)
                            if (d.opt("revokedAt") is String) Text(c("revoked"))
                        }
                        if (d.opt("revokedAt") !is String) AffairsIconButton(c("revoke"), AffairsAction.CLOSE, {
                            confirm = c("confirmRevoke") to { repository.revokeDevice(d.getString("id")); devices = repository.devices() }
                        })
                    }
                }
            }
        }, confirmButton = { TextButton({ modal = null }) { Text(c("close")) } }
    )
    if (modal == "members" && current != null) AlertDialog(
        onDismissRequest = { modal = null }, title = { Text(c("members")) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                current.members.forEach { m ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.name)
                            if (m.status == "pending") Text(c("waiting"), style = MaterialTheme.typography.bodySmall)
                        }
                        if (current.kind == "group" && own?.role == "owner" && m.userId != repository.owner) {
                            AffairsIconButton(c("removeMember"), AffairsAction.DELETE, { run { repository.membership("remove", userId = m.userId) } })
                            if (m.status == "active") AffairsIconButton(c("transfer"), AffairsAction.NEXT, { run { repository.membership("transfer", userId = m.userId) } })
                        }
                    }
                }
                if (current.kind == "group" && own?.role == "owner") {
                    OutlinedTextField(email, { email = it.take(254) }, label = { Text(c("email")) }, modifier = Modifier.fillMaxWidth())
                    TextButton({ run { repository.membership("add", email = email); email = "" } }, enabled = !busy && email.isNotBlank()) { Text(c("addMember")) }
                }
                if (current.kind == "project") Text(c("projectHelp"))
                if (current.kind in setOf("direct", "secret")) current.members.firstOrNull { it.userId != repository.owner }?.let { peer ->
                    TextButton({ confirm = c("confirmBlock") to { repository.block(peer.userId, true); modal = null } }) { Text(c("block")) }
                }
                if (current.kind == "group" && own?.role != "owner") TextButton({ run { repository.membership("leave"); modal = null } }) { Text(c("leave")) }
            }
        }, confirmButton = { TextButton({ modal = null }) { Text(c("close")) } }
    )
    deletingChat?.let { chat -> AlertDialog(onDismissRequest = { if(!busy)deletingChat=null },
        title = { Text(c("deleteChat")) }, text = { Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            UntranslatedText(chat.title);Text(c("confirmDeleteChat"))
        } },
        confirmButton = { TextButton({run{repository.visibility(chat.id,"delete");deletingChat=null}},enabled=!busy,
            modifier=Modifier.heightIn(min=48.dp).testTag("messenger-chat-delete-confirm"),
            colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)){Text(c("delete"))} },
        dismissButton = { TextButton({deletingChat=null},enabled=!busy){Text(c("cancel"))} }) }
    delete?.let { row -> AlertDialog(onDismissRequest = { delete = null }, title = { Text(c("confirmDelete")) },
        confirmButton = { TextButton({ delete = null; run { repository.deleteMessage(row) } }, enabled = !busy) { Text(c("delete")) } },
        dismissButton = { TextButton({ delete = null }) { Text(c("cancel")) } }) }
    confirm?.let { action -> AlertDialog(onDismissRequest = { confirm = null }, title = { Text(action.first) },
        confirmButton = { TextButton({ confirm = null; run(action.second) }, enabled = !busy) { Text(c("accept")) } },
        dismissButton = { TextButton({ confirm = null }) { Text(c("cancel")) } }) }
}
