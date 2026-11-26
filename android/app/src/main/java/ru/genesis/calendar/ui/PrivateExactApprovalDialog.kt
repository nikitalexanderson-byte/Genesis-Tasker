package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTaskReviewGateway

/** Shared quick actions must display and bind the same exact encrypted task
 * proposal as the full task editor. The identifier survives an unknown retry
 * while this dialog is open; the product decision itself is durable. */
@Composable internal fun PrivateExactApprovalDialog(gateway:SharedTaskReviewGateway,task:JSONObject,onClose:()->Unit,onDone:()->Unit){
    val context=LocalContext.current;val language=LocalGenesisLanguage.current
    val text=remember(language){context.assets.open("approval-review-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val scope=rememberCoroutineScope();var preview by remember{mutableStateOf<JSONObject?>(null)};var selected by remember{mutableIntStateOf(0)}
    var reviewed by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(true)};var failed by remember{mutableStateOf(false)};val decisions=remember{mutableMapOf<String,String>()}
    LaunchedEffect(gateway,task.getString("id")){try{preview=gateway.sharedTaskApprovalPreview(task.getString("projectId"),task.getString("id"));failed=preview==null}catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}finally{busy=false}}
    val proposals=preview?.optJSONArray("proposals");val proposal=proposals?.takeIf{it.length()>selected}?.getJSONObject(selected)
    AlertDialog(onDismissRequest={if(!busy)onClose()},title={Text(text.getString("title"))},text={Column(Modifier.heightIn(max=440.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(text.getString("notice"));if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(failed||!busy&&proposal==null)Text(text.getString("empty"),color=MaterialTheme.colorScheme.error)
        if(proposals!=null&&proposals.length()>1)repeat(proposals.length()){at->Row{RadioButton(selected=selected==at,onClick={selected=at;reviewed=false},enabled=!busy);UntranslatedText(proposals.getJSONObject(at).getJSONObject("task").getString("title"))}}
        proposal?.let{row->Text(text.getString("details"));UntranslatedText(row.getJSONObject("task").toString(2));Row{Checkbox(checked=reviewed,onCheckedChange={reviewed=it},enabled=!busy);Text("Подтвердить выполнение")}}
    }},confirmButton={TextButton(enabled=!busy&&proposal!=null&&reviewed,onClick={val chosen=JSONObject(proposal!!.toString());chosen.remove("task");val id=chosen.getString("proposalId");val requestId=decisions.getOrPut(id){java.util.UUID.randomUUID().toString()};busy=true;failed=false;scope.launch{
        try{gateway.sharedTaskApproveReviewed(task.getString("projectId"),task.getString("id"),chosen,requestId);onDone();onClose()}
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}finally{busy=false}
    }}){Text("Подтвердить")}},dismissButton={TextButton(onClick=onClose,enabled=!busy){Text("Отмена")}})
}
