package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.security.NativePrivateProducts
import ru.genesis.calendar.security.E2eeSharedTrust

/** The fingerprint is intentionally never prefilled into the comparison input.
 * A server discovery is not promoted into a cryptographic trust decision. */
@Composable internal fun PrivateSharedSecurityEntry(){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val storageScope=app.workspaceScope;if(!NativePrivateProducts.isProtected(storageScope))return
    val account=remember(storageScope){NativePrivateProducts.currentAccount(storageScope)}
    val language=LocalGenesisLanguage.current
    val text=remember(language){context.assets.open("shared-security-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val coroutine=rememberCoroutineScope();var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf("")}
    var scopes by remember{mutableStateOf<List<JSONObject>?>(null)};var candidate by remember{mutableStateOf<JSONObject?>(null)}
    var compared by remember{mutableStateOf("")};var accepted by remember{mutableStateOf(false)}
    val alive=remember{java.util.concurrent.atomic.AtomicBoolean(true)};DisposableEffect(Unit){onDispose{alive.set(false)}}
    fun current(){account.requireOpen();check(alive.get()&&app.workspaceScope==storageScope&&NativePrivateProducts.currentAccount(storageScope)===account){"E2EE_ACCOUNT_CHANGED"}}
    fun <T> run(operation:()->T,complete:(T)->Unit){if(busy)return;busy=true;message="";coroutine.launch{
        try{val result=withContext(Dispatchers.IO){current();operation().also{current()}};current();complete(result)}
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(alive.get())message=text.getString("error")}
        finally{if(alive.get())busy=false}
    }}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(text.getString("title"),style=MaterialTheme.typography.titleMedium)
        Text(text.getString("notice"),style=MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick={run({val rows=account.scopeSummaries();(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.getString("kind")!="personal"}},{scopes=it})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("load"))}
        if(scopes?.isEmpty()==true)Text(text.getString("empty"))
        scopes?.takeIf{it.isNotEmpty()}?.let{rows->Column(Modifier.heightIn(max=240.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
            rows.forEach{row->OutlinedButton(onClick={candidate=null;compared="";accepted=false;run({val proposed=account.proposeSharedTrust(row.getString("scopeId"));val trust=E2eeSharedTrust(account).list();proposed.put("accepted",(0 until trust.length()).any{trust.getJSONObject(it).let{known->known.get("scopeId")==row.get("scopeId")&&known.get("fingerprint")==proposed.get("fingerprint")}})},{candidate=it;accepted=it.getBoolean("accepted")})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(row.getString("resourceId"))}}
        }}
        candidate?.let{value->
            val proposal=value.getJSONObject("proposal");val fingerprint=value.getString("fingerprint")
            UntranslatedText(fingerprint,modifier=Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),style=MaterialTheme.typography.bodyMedium)
            if(!accepted){
                OutlinedTextField(value=compared,onValueChange={compared=it.trim().take(64)},label={Text(text.getString("compare"))},enabled=!busy,singleLine=true,modifier=Modifier.fillMaxWidth())
                Button(onClick={val submitted=compared;run({val trust=E2eeSharedTrust(account);trust.accept(proposal,submitted);trust.open(proposal.getString("scopeId"))},{accepted=true;message=text.getString("saved")})},enabled=!busy&&compared==fingerprint,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("accept"))}
            }
            if(accepted&&proposal.getString("ownerId")==account.ownerId)Button(onClick={run({
                val scopeId=proposal.getString("scopeId");E2eeSharedTrust(account).open(scopeId)
                val products=NativePrivateProducts.sharedRecords(storageScope,scopeId,proposal.getString("kind"),proposal.getString("resourceId"));products.bootstrap.prepare();current();products.bootstrap.flush()
            },{message=text.getString("complete")})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("baseline"))}
        }
        if(message.isNotEmpty())Text(message,style=MaterialTheme.typography.bodyMedium)
    }
}
