package ru.genesis.calendar.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.security.*
import java.io.ByteArrayOutputStream

private fun memberCopy(context:Context,language:String,name:String)=context.assets.open(name).use{input->val bytes=input.readBytes();try{check(bytes.size<=512*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}finally{bytes.fill(0)}}
private fun memberRows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
private fun memberApproval(context:Context,uri:Uri,current:()->Unit):JSONObject=context.contentResolver.openInputStream(uri)?.use{input->
    val output=ByteArrayOutputStream();val buffer=ByteArray(8192);try{while(true){current();val size=input.read(buffer);if(size<0)break;if(size==0)continue;check(output.size()+size<=2*1024*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};output.write(buffer,0,size)}
        val bytes=output.toByteArray();try{E2eeFileManifestJson.readPrivateDocument(bytes)}finally{bytes.fill(0)}}finally{buffer.fill(0);output.close()}
}?:error("E2EE_MEMBERSHIP_FILE_TRUNCATED")

@Composable internal fun PrivateMembershipHost(controller:AuthController,auth:AuthPanelState){
    val view by NativeMembershipUiState.state.collectAsStateWithLifecycle()
    LaunchedEffect(auth.user?.uid,auth.requiresSignIn){view?.takeIf{it.owner!=auth.user?.uid||auth.requiresSignIn}?.let{NativeMembershipUiState.clearOwner(it.owner)}}
    view?.takeIf{it.owner==auth.user?.uid&&!auth.requiresSignIn}?.let{saved->key(saved.id,LocalLifecycleOwner.current.lifecycle){
        val night=rememberEveningTheme(AppearanceSettings.read("{}",auth.accountSettings?.theme?:"auto"));val palette=auth.accountSettings?.darkPalette?:"green"
        MaterialTheme(colorScheme=if(night)eveningPalette(palette)else daylightPalette(palette),typography=GenesisTypography,shapes=GenesisShapes){MembershipDialog(controller,saved)}
    }}
}
@Composable private fun MembershipDialog(controller:AuthController,view:NativeMembershipUiState.View){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val storage=app.workspaceScope;val account=remember(view.id){NativePrivateProducts.currentAccount(storage)}
    val lifecycle=LocalLifecycleOwner.current.lifecycle;val jobs=rememberCoroutineScope();val alive=remember{java.util.concurrent.atomic.AtomicBoolean(true)}
    val c=remember(view.language){memberCopy(context,view.language,"membership-review-copy-v2.json")};val roles=remember(view.language){memberCopy(context,view.language,"device-access-copy-v1.json").getJSONObject("roles")};val projectRoles=remember(view.language){memberCopy(context,view.language,"project-creation-copy-v1.json").getJSONObject("roles")}
    var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")};var message by remember{mutableStateOf("")};var draft by remember{mutableStateOf<JSONObject?>(null)}
    var reviewed by remember{mutableStateOf<JSONObject?>(null)};var fingerprint by remember{mutableStateOf(view.fingerprint?:"")};var index by remember{mutableIntStateOf(0)};var detail by remember{mutableStateOf<JSONObject?>(null)}
    var ownerOperation by remember{mutableStateOf<JSONObject?>(null)};var counts by remember{mutableStateOf<JSONObject?>(null)};var desiredPermissions by remember{mutableStateOf<JSONObject?>(null)}
    var ownerGrants by remember{mutableStateOf<List<JSONObject>>(emptyList())};var grantPage by remember{mutableIntStateOf(0)}
    var final by remember{mutableStateOf<JSONObject?>(null)};var ack by remember{mutableStateOf(false)};var finalAck by remember{mutableStateOf(false)};var cancelAck by remember{mutableStateOf(false)}
    var choices by remember{mutableStateOf<List<JSONObject>>(emptyList())};var export by remember{mutableStateOf<Triple<String,String,String>?>(null)}
    fun current(){account.requireOpen();check(alive.get()&&NativeMembershipUiState.state.value?.id==view.id&&app.workspaceScope==storage&&NativePrivateProducts.currentAccount(storage)===account&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)){"E2EE_ACCOUNT_CHANGED"}}
    fun failure(reason:Throwable):String{val code=reason.message?:"";return c.getString(when{code=="E2EE_MEMBERSHIP_CANCELLED"->"cancelled";Regex("STALE|CONFLICT|DIVERGED|REVIEW_MISMATCH").containsMatchIn(code)->"stale";Regex("OUTCOME|RECEIPT|FINAL_REVIEW").containsMatchIn(code)->"unknown";else->"error"})}
    fun run(action:suspend()->Unit){if(busy)return;busy=true;error="";message="";jobs.launch{try{current();action();current()}catch(cancel:CancellationException){throw cancel}catch(reason:Throwable){if(alive.get()&&NativeMembershipUiState.state.value?.id==view.id)error=failure(reason)}finally{if(alive.get())busy=false}}}
    suspend fun labels(scope:String){detail=try{controller.describePrivateMembershipScope(scope).also{current()}}catch(cancel:CancellationException){throw cancel}catch(_:Exception){current();null}}
    suspend fun owners(value:String){val result=controller.reviewPrivateAtomicOwners(value);current();val request=memberRows(controller.pendingPrivateAtomicOwnerReviews()).single{it.get("fingerprint")==value}.getJSONObject("request");current()
        val stats=JSONObject().put("taskAssignments",0).put("categories",0).put("events",0);val acl=mutableListOf<JSONObject>();val grants=mutableListOf<JSONObject>();var header:JSONObject?=null;val refs=request.getJSONObject("plan").getJSONArray("pages")
        for(at in 0 until refs.length())if(refs.getJSONObject(at).get("kind") in setOf("operation","operation-grants","acl","product-operations")){
            val page=controller.readPrivateAtomicOwnerPart(value,"plan",at).getJSONObject("page");current()
            when(page.get("kind")){"operation"->header=page.getJSONArray("items").getJSONObject(0);"acl"->acl.addAll(memberRows(page.getJSONArray("items")));"operation-grants"->grants.addAll(memberRows(page.getJSONArray("items")));"product-operations"->for(batch in memberRows(page.getJSONArray("items")))for(op in memberRows(batch.getJSONArray("operations"))){val key=when(op.get("kind")){"task"->"taskAssignments";"category"->"categories";"history"->"events";else->null};if(key!=null)stats.put(key,stats.getInt(key)+1)}}
        }
        ownerOperation=header;ownerGrants=grants;grantPage=0;val user=header?.optString("userId");val category=header?.optString("categoryId");val changed=acl.firstOrNull{it.get("table")=="shared_space_members"&&it.getJSONObject("key").optString("user_id")==user||it.get("table")=="shared_member_categories"&&it.getJSONObject("key").optString("id")==category}
        val raw=changed?.optJSONObject("after")?.optString("permissions_json","");desiredPermissions=raw?.takeIf{it.isNotEmpty()}?.let{E2eeFileManifestJson.readPrivateDocument(it.toByteArray(Charsets.UTF_8))};counts=stats
        fingerprint=value;reviewed=result;val scopes=memberRows(result.getJSONArray("scopes"));index=if(view.mode=="owner")scopes.indexOfFirst{it.get("ownerId")==view.owner}.coerceAtLeast(0)else 0;ack=false;final=null;if(scopes.isNotEmpty())labels(scopes[index].getString("scopeId"))
    }
    suspend fun load(){if(view.mode=="owner"){owners(requireNotNull(view.fingerprint));return};var value=controller.loadPrivateMembershipOperation(requireNotNull(view.intentId));current();draft=value
        if(!value.getBoolean("started")&&!value.optBoolean("cancelled",false)){value=controller.previewPrivateMembershipOperation(requireNotNull(view.intentId)).getJSONObject("state");current();draft=value}
        val pending=memberRows(controller.pendingPrivateAtomicOwnerReviews()).filter{it.getJSONObject("request").getJSONObject("plan").get("intentId")==view.intentId};current();choices=pending
        if(pending.size==1)owners(pending.single().getString("fingerprint"))else value.optJSONObject("proposal")?.getJSONObject("plan")?.getJSONArray("requiredScopes")?.takeIf{it.length()>0}?.getJSONObject(0)?.let{labels(it.getString("scopeId"))}
    }
    suspend fun finish(){val result=controller.completedPrivateMembershipOperation(requireNotNull(view.intentId));current();check(result!=null){"E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED"};NativeMembershipUiState.complete(view.id,result)}
    DisposableEffect(lifecycle,view.id){alive.set(true);val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP)jobs.coroutineContext.cancelChildren()};lifecycle.addObserver(observer);onDispose{alive.set(false);lifecycle.removeObserver(observer)}}
    LaunchedEffect(view.id){run{load()}}
    val approvalPicker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)run{val value=withContext(Dispatchers.IO){memberApproval(context,uri,::current)};current();controller.acceptPrivateAtomicOwnerApproval(fingerprint,value.toString());current();message=c.getString("approvalSaved")}}
    val exportPicker=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->val request=export;export=null;if(uri!=null&&request!=null)run{
        if(request.first=="review")controller.exportPrivateMembershipReviewFile(request.second,uri)else{val approval=controller.exportPrivateAtomicOwnerApproval(request.second,request.third);current();withContext(Dispatchers.IO){val bytes=approval.toString().toByteArray(Charsets.UTF_8);try{current();context.contentResolver.openOutputStream(uri,"w")?.use{it.write(bytes)}?:kotlin.error("E2EE_MEMBERSHIP_FILE_TRUNCATED");current()}finally{bytes.fill(0)}}}
    }}
    val scopes=reviewed?.getJSONArray("scopes")?.let(::memberRows)?:emptyList();val selected=scopes.getOrNull(index);val operation=draft?.getJSONObject("operation")?:ownerOperation
    fun name(id:String)=detail?.optJSONArray("members")?.let(::memberRows)?.firstOrNull{it.get("userId")==id}?.optString("displayName")?.takeIf{it.isNotBlank()}?:id
    fun role(value:String?)=when(value){null,"none"->c.getString("noAccess");"admin"->c.getString("admin");"guest"->c.getString("guest");else->roles.optString(value,projectRoles.optString(value,value))}
    @Composable fun Code(value:String){UntranslatedText(value,Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),style=MaterialTheme.typography.bodySmall,maxLines=1,softWrap=false)}
    @Composable fun Action(key:String,enabled:Boolean=true,action:suspend()->Unit){OutlinedButton({run(action)},enabled=!busy&&enabled,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString(key))}}
    @Composable fun Check(key:String,value:Boolean,change:(Boolean)->Unit){Row(Modifier.fillMaxWidth().heightIn(min=48.dp).toggleable(value,enabled=!busy,role=Role.Checkbox,onValueChange=change)){Checkbox(value,onCheckedChange=null,enabled=!busy);UntranslatedText(c.getString(key),Modifier.weight(1f).padding(8.dp))}}
    Dialog(onDismissRequest={if(!busy)NativeMembershipUiState.close(view.id)},properties=DialogProperties(dismissOnBackPress=!busy,dismissOnClickOutside=false,usePlatformDefaultWidth=false,securePolicy=SecureFlagPolicy.SecureOn)){
        Surface(Modifier.padding(12.dp).widthIn(max=680.dp).fillMaxWidth(),shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.surface){Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            UntranslatedText(c.getString("title"),style=MaterialTheme.typography.headlineSmall);UntranslatedText(c.getString("notice"))
            operation?.let{input->UntranslatedText(c.getJSONObject("actions").getString(input.getString("kind")),style=MaterialTheme.typography.titleMedium);detail?.optString("title")?.takeIf{it.isNotBlank()}?.let{UntranslatedText(it)}
                if(input.has("userId")){val user=input.getString("userId");UntranslatedText(name(user));Code(user)};if(input.has("role"))UntranslatedText(role(input.getString("role")))
                val permissions=input.optJSONObject("permissions")?:desiredPermissions
                if(permissions!=null){val names=listOf("Создавать проекты и списки","Создавать и редактировать задачи","Перемещать и удалять задачи","Комментировать","Управлять проектами и досками","Приглашать участников");for((at,key)in listOf("createProjects","editTasks","organizeTasks","comment","manageProjects","inviteMembers").withIndex())Row(Modifier.fillMaxWidth().heightIn(min=48.dp)){Checkbox(permissions.getBoolean(key),onCheckedChange=null,enabled=false);UntranslatedText(translateGenesisText(context,names[at],view.language),Modifier.weight(1f).padding(8.dp))}}
            }
            draft?.optJSONObject("proposal")?.getJSONObject("plan")?.let{plan->for(key in listOf("scopes","changes")){val count=if(key=="scopes")plan.getJSONArray("scopeIds").length()else plan.getJSONArray("changes").length();UntranslatedText(c.getString(key)+": "+java.text.NumberFormat.getIntegerInstance(java.util.Locale.forLanguageTag(view.language)).format(count))}}
            if(operation?.optString("kind")=="project-grants"){
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp)){Checkbox(operation.getBoolean("allProjects"),onCheckedChange=null,enabled=false);UntranslatedText(c.getString("allProjects"),Modifier.weight(1f).padding(8.dp))}
                val grants=operation.optJSONArray("grants")?.let(::memberRows)?:ownerGrants
                for(grant in grants.drop(grantPage*20).take(20)){Code(grant.getString("projectId"));UntranslatedText(role(grant.getString("role")));UntranslatedText(c.getString(if(grant.getBoolean("includeDescendants"))"includeDescendants"else"onlyProject"))}
                if(grants.size>20)Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){OutlinedButton({grantPage--},enabled=!busy&&grantPage>0,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(c.getString("previous"))};UntranslatedText("${grantPage+1} / ${(grants.size+19)/20}");OutlinedButton({grantPage++},enabled=!busy&&(grantPage+1)*20<grants.size,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(c.getString("next"))}}
            }
            counts?.let{value->for(key in listOf("taskAssignments","categories","events"))UntranslatedText(c.getString(key)+": "+java.text.NumberFormat.getIntegerInstance(java.util.Locale.forLanguageTag(view.language)).format(value.getInt(key)))}
            if(reviewed==null&&final==null&&draft!=null&&!draft!!.optBoolean("cancelled",false)){
                choices.takeIf{it.size>1}?.forEach{choice->OutlinedButton({run{owners(choice.getString("fingerprint"))}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(choice.getString("fingerprint"),maxLines=1)}}
                Check("planAck",ack){ack=it};Action(if(draft!!.getBoolean("started"))"prepare"else"confirm",ack&&!draft!!.isNull("proposal")){
                    val value=draft!!;if(value.isNull("review")){draft=controller.confirmPrivateMembershipOperation(value.getString("intentId"),value.getJSONObject("proposal").getString("fingerprint")).getJSONObject("state");current()}
                    val result=controller.composePrivateMembershipOperation(value.getString("intentId"));current();if(result.get("state")=="unchanged")finish()else owners(result.getString("fingerprint"))
                }
            }
            if(selected!=null&&final==null){UntranslatedText(c.getString("owners"),style=MaterialTheme.typography.titleMedium);detail?.optString("title")?.takeIf{it.isNotBlank()}?.let{UntranslatedText(it)};Code(selected.getString("scopeId"));Code(fingerprint);UntranslatedText(name(selected.getString("ownerId")));Code(selected.getString("ownerId"))
                UntranslatedText(c.getString("recipients"),style=MaterialTheme.typography.titleSmall)
                for(recipient in memberRows(selected.getJSONArray("roles"))){UntranslatedText(name(recipient.getString("userId"))+" · "+role(if(recipient.isNull("role"))null else recipient.getString("role")));Code(recipient.getString("userId"));Code(recipient.getString("deviceId"))}
                Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){OutlinedButton({run{index--;ack=false;labels(scopes[index].getString("scopeId"))}},enabled=!busy&&index>0,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(c.getString("previous"))};UntranslatedText("${index+1} / ${scopes.size}");OutlinedButton({run{index++;ack=false;labels(scopes[index].getString("scopeId"))}},enabled=!busy&&index+1<scopes.size,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(c.getString("next"))}}
                if(selected.get("ownerId")==view.owner){Check("ack",ack){ack=it};Action("approve",ack){controller.approvePrivateAtomicOwner(fingerprint,selected.getString("scopeId"),fingerprint,selected.getJSONArray("roles"));current();ack=false;message=c.getString("approvalSaved")}
                    OutlinedButton({export=Triple("approval",fingerprint,selected.getString("scopeId"));exportPicker.launch("genesis-owner-approval.json")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("exportApproval"))}
                }else UntranslatedText(c.getString("awaiting"))
                OutlinedButton({export=Triple("review",fingerprint,"");exportPicker.launch("genesis-access-review.genesis-review")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("exportReview"))}
                if(view.mode=="operation"){OutlinedButton({approvalPicker.launch(arrayOf("application/json","application/octet-stream"))},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("importApproval"))};Action("finalReview"){controller.preparePrivateMembershipPackets(requireNotNull(view.intentId),fingerprint);current();final=controller.describePrivateAtomicMembership(requireNotNull(view.intentId));current();finalAck=false}}
            }
            final?.let{value->UntranslatedText(c.getString("apply"),style=MaterialTheme.typography.titleMedium);Code(value.getString("fingerprint"));Check("finalAck",finalAck){finalAck=it};Action("apply",finalAck){controller.confirmPrivateAtomicMembership(requireNotNull(view.intentId),value.getString("fingerprint"));current();controller.submitPrivateAtomicMembership(requireNotNull(view.intentId));current();finish()}}
            if(view.mode=="operation"){Action("check"){controller.reconcilePrivateAtomicMembership(requireNotNull(view.intentId));current();finish()};Action("resolve"){val result=controller.resolvePrivateMembershipOperation(requireNotNull(view.intentId));current();NativeMembershipUiState.replace(view.id,result.getString("intentId"))};Check("cancelAck",cancelAck){cancelAck=it};Action("cancel",cancelAck){val result=controller.cancelPrivateMembershipOperation(requireNotNull(view.intentId));current();if(result.get("outcome")=="reconcile-required")error=c.getString("unknown")else NativeMembershipUiState.close(view.id,"E2EE_MEMBERSHIP_CANCELLED")}}
            if(busy)UntranslatedText(c.getString("busy"));if(message.isNotEmpty())UntranslatedText(message);if(error.isNotEmpty())UntranslatedText(error,color=MaterialTheme.colorScheme.error)
            OutlinedButton({NativeMembershipUiState.close(view.id)},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("keep"))}
        }}
    }
}

@Composable internal fun PrivateMembershipEntry(){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val storage=app.workspaceScope;if(!NativePrivateProducts.isProtected(storage))return;val account=remember(storage){NativePrivateProducts.currentAccount(storage)};val controller=remember(context){AuthController.get(context)}
    val language=LocalGenesisLanguage.current;val c=remember(language){memberCopy(context,language,"membership-review-copy-v2.json")};val jobs=rememberCoroutineScope();val alive=remember{java.util.concurrent.atomic.AtomicBoolean(true)};var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")};var loaded by remember{mutableStateOf(false)};var items by remember{mutableStateOf<List<JSONObject>>(emptyList())};var owners by remember{mutableStateOf<List<JSONObject>>(emptyList())}
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    DisposableEffect(storage,lifecycle){alive.set(true);val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP)jobs.coroutineContext.cancelChildren()};lifecycle.addObserver(observer);onDispose{alive.set(false);lifecycle.removeObserver(observer)}}
    fun current(){account.requireOpen();check(alive.get()&&app.workspaceScope==storage&&NativePrivateProducts.currentAccount(storage)===account&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)){"E2EE_ACCOUNT_CHANGED"}}
    fun run(action:suspend()->Unit){if(busy)return;busy=true;error="";jobs.launch{try{current();action();current()}catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(alive.get())error=c.getString("error")}finally{if(alive.get())busy=false}}}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)run{val result=controller.importPrivateMembershipReviewFile(uri);current();NativeMembershipUiState.showOwner(account.ownerId,language,result.getString("fingerprint"))}}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        UntranslatedText(c.getString("pending"),style=MaterialTheme.typography.titleMedium)
        OutlinedButton({run{items=memberRows(controller.pendingPrivateMembershipOperations().getJSONArray("items"));current();owners=memberRows(controller.pendingPrivateAtomicOwnerReviews()).filter{it.getJSONObject("request").getJSONObject("plan").get("actorId")!=account.ownerId};current();loaded=true}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("review"))}
        for(item in items)OutlinedButton({current();NativeMembershipUiState.showOperation(account.ownerId,language,item.getString("intentId"))},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getJSONObject("actions").getString(item.getJSONObject("operation").getString("kind")))}
        for(item in owners)OutlinedButton({current();NativeMembershipUiState.showOwner(account.ownerId,language,item.getString("fingerprint"))},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("owners")+": "+item.getJSONObject("request").getJSONObject("plan").getJSONArray("scopeIds").length())}
        if(loaded&&items.isEmpty()&&owners.isEmpty())UntranslatedText(c.getString("empty"))
        OutlinedButton({picker.launch(arrayOf("application/octet-stream","application/json"))},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("importReview"))};if(busy)UntranslatedText(c.getString("busy"));if(error.isNotEmpty())UntranslatedText(error,color=MaterialTheme.colorScheme.error)
    }
}
