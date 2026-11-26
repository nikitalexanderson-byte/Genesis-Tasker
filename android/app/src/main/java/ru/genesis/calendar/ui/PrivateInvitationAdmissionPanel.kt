package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.security.NativePrivateProducts
import ru.genesis.calendar.security.NativeMembershipUiState

@Composable internal fun PrivateInvitationAdmissionPanel(){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val storage=app.workspaceScope
    val account=remember(storage){NativePrivateProducts.currentAccount(storage)};val language=LocalGenesisLanguage.current;val c=invitationSecurityCopy(language)
    val common=remember(language){context.assets.open("shared-security-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val lifecycle=LocalLifecycleOwner.current.lifecycle;val jobs=rememberCoroutineScope();val alive=remember(storage){java.util.concurrent.atomic.AtomicBoolean(true)}
    var items by remember(storage){mutableStateOf<List<JSONObject>>(emptyList())};var busy by remember(storage){mutableStateOf(false)};var loaded by remember(storage){mutableStateOf(false)};var message by remember(storage){mutableStateOf("")}
    fun current(){account.requireOpen();check(alive.get()&&app.workspaceScope==storage&&NativePrivateProducts.currentAccount(storage)===account&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)){"E2EE_ACCOUNT_CHANGED"}}
    DisposableEffect(storage,lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP)jobs.coroutineContext.cancelChildren()};lifecycle.addObserver(observer);onDispose{alive.set(false);lifecycle.removeObserver(observer)}}
    fun run(action:suspend()->Unit){if(busy)return;busy=true;message="";jobs.launch{try{current();action();current()}catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(alive.get())message=common.getString("error")}finally{if(alive.get())busy=false}}}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        UntranslatedText(c.getString("ownerTitle"),style=MaterialTheme.typography.titleMedium);UntranslatedText(c.getString("ownerNotice"))
        OutlinedButton({run{val rows=AuthController.get(context).pendingPrivateInvitationAdmissions();current();items=(0 until rows.length()).map{rows.getJSONObject(it)};loaded=true}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(common.getString("load"))}
        if(loaded&&items.isEmpty())UntranslatedText(common.getString("empty"))
        Column(Modifier.heightIn(max=320.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
            for(item in items){val operation=item.getJSONObject("operation");UntranslatedText(item.getString("title"));UntranslatedText(operation.getString("userId"))
                OutlinedButton({run{val draft=AuthController.get(context).createPrivateMembershipOperation(JSONObject(operation.toString()));current();NativeMembershipUiState.showOperation(account.ownerId,language,draft.getJSONObject("state").getString("intentId"))}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("ownerReview"))}
            }
        }
        if(message.isNotEmpty())UntranslatedText(message)
    }
}
