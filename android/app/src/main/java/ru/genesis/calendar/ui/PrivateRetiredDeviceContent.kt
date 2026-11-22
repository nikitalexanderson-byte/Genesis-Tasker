package ru.genesis.calendar.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.security.NativeMigrationCredential
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** The ordinary credential and ciphertext SAF handoff remain separate. No
 * historical reader survives a completed credential operation. */
@Composable internal fun PrivateRetiredDeviceContentPanel(controller:AuthController,owner:String,language:String){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle
    val slots=remember(owner){runCatching{controller.retainedPrivateDeviceSlots(owner)}.getOrDefault(emptyList())};if(slots.isEmpty())return
    val copy=remember(language){context.assets.open("personal-device-entry-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val common=remember(language){context.assets.open("shared-security-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val backup=remember(language){if(language=="ru")null else context.assets.open("originals/i18n/backup-locales/$language.json").bufferedReader().use{JSONObject(it.readText())}};fun text(ru:String)=backup?.getString(ru)?:ru
    var slot by remember(owner){mutableStateOf(slots.last().first)};var recovery by remember(owner){mutableStateOf("")};var saved by remember(owner){mutableStateOf(false)};var consent by remember(owner){mutableStateOf(false)};var busy by remember(owner){mutableStateOf(false)};var failed by remember(owner){mutableStateOf(false)}
    val alive=remember(owner){AtomicBoolean(true)};val attempt=remember(owner){AtomicLong()};val viewId=remember(owner){UUID.randomUUID().toString()};val pending=remember(owner){AtomicReference<NativeMigrationCredential?>(null)};val captured=remember(owner){AtomicReference<Pair<String,String>?>(null)};var activity by remember(owner){mutableStateOf<NativeMigrationCredential?>(null)}
    fun current(){check(alive.get()&&controller.state.value.user?.uid==owner){"E2EE_ACCOUNT_CHANGED"}}
    DisposableEffect(owner,lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP){recovery="";saved=false;consent=false}};lifecycle.addObserver(observer);onDispose{alive.set(false);attempt.incrementAndGet();pending.getAndSet(null)?.close();captured.set(null);lifecycle.removeObserver(observer)}}
    RecoveryCredentialActivity(activity,copy.getString("retainedTitle"),copy.getString("retainedAck"),operation={request,_,admit->
        fun owns(){current();admit();check(pending.get()===request&&attempt.get()==request.attempt){"E2EE_CREDENTIAL_REVOKED"}}
        owns();val input=captured.get()?:error("E2EE_RETIRED_DEVICE_REQUIRED");controller.exportRetiredPrivateContent(owner,input.first,input.second,::owns);owns()
    },finished={request,reason->if(pending.compareAndSet(request,null)&&alive.get()){activity=null;captured.set(null);busy=false;failed=reason!=null}})
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
        UntranslatedText(copy.getString("retainedTitle"),style=MaterialTheme.typography.titleMedium);UntranslatedText(copy.getString("retainedNotice"))
        for((id,deviceId)in slots)Row(Modifier.fillMaxWidth()){RadioButton(slot==id,{slot=id;consent=false},enabled=!busy);UntranslatedText(copy.getString("retainedSlot")+": "+deviceId,modifier=Modifier.weight(1f))}
        OutlinedTextField(recovery,{recovery=it.take(64);saved=false},enabled=!busy,label={UntranslatedText(text("Ключ копии"))},modifier=Modifier.fillMaxWidth())
        OutlinedButton({recovery=GenesisBackupContainer.newRecoveryKey();saved=false},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(text("Создать ключ"))}
        Row(Modifier.fillMaxWidth()){Checkbox(saved,{saved=it},enabled=!busy);UntranslatedText(text("Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход."),modifier=Modifier.weight(1f))}
        Row(Modifier.fillMaxWidth()){Checkbox(consent,{consent=it},enabled=!busy);UntranslatedText(copy.getString("retainedAck"),modifier=Modifier.weight(1f))}
        OutlinedButton({try{current();val ownerGuard=controller.privateUiOwnerGuard(owner,allowOffline=true);val number=attempt.incrementAndGet();val input=slot to recovery;val request=NativeMigrationCredential.captureVault(owner,viewId,number,"",null,false,false,SystemClock.elapsedRealtime()){current();ownerGuard();check(attempt.get()==number){"E2EE_CREDENTIAL_REVOKED"}};check(pending.compareAndSet(null,request)){request.close();"E2EE_CREDENTIAL_PENDING"};captured.set(input);recovery="";saved=false;consent=false;busy=true;failed=false;activity=request}catch(_:Exception){failed=true;busy=false}},enabled=!busy&&saved&&consent&&recovery.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(copy.getString("retainedExport"))}
        if(failed)UntranslatedText(common.getString("error"),color=MaterialTheme.colorScheme.error)
    }
}
