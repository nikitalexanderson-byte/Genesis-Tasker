package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.security.NativePrivateProducts

@Composable internal fun PrivatePendingOperations(scope:String,feature:String,language:String,trigger:Any?,onResolved:()->Unit){
    val context=LocalContext.current;val revision by NativePrivateProducts.revision.collectAsStateWithLifecycle();val operations=rememberCoroutineScope()
    var pending by remember(scope,feature){mutableStateOf<List<String>>(emptyList())};var busy by remember(scope,feature){mutableStateOf(false)};var failed by remember(scope,feature){mutableStateOf(false)}
    val text=remember(context,language){val all=context.assets.open("pending-copy-v1.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText())};all.optJSONObject(language)?:all.getJSONObject("en")}
    LaunchedEffect(scope,feature,revision,trigger){if(!NativePrivateProducts.isProtected(scope)||!NativePrivateProducts.isOpen(scope)){pending=emptyList();return@LaunchedEffect}
        try{pending=withContext(Dispatchers.IO){if(feature=="advice")if(NativePrivateProducts.advice(scope).hasPending())listOf("advice")else emptyList()else NativePrivateProducts.stoicheion(scope).pendingKinds()}}
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(pending.isNotEmpty())failed=true}}
    if(pending.isEmpty())return
    Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        UntranslatedText(text.getString(if(failed)"error"else"message"))
        for(kind in pending)Button(onClick={if(!busy){busy=true;failed=false;operations.launch{try{
            withContext(Dispatchers.IO){if(feature=="advice"){val prefs=NativePrivateProducts.preferences(scope).snapshot().getJSONObject("advicePreferences");NativePrivateProducts.advice(scope).execute("resume",JSONObject(),language,prefs)}else NativePrivateProducts.stoicheion(scope).resume(kind);NativePrivateProducts.changed(scope)}
            pending=pending.filter{it!=kind};onResolved()
        }catch(cancel:CancellationException){throw cancel}catch(_:Exception){failed=true}finally{busy=false}}}},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){
            UntranslatedText(text.getString("retry")+if(pending.size>1)" · "+when(kind){"daily"->translateGenesisText(context,"Карта дня",language);"spread"->text.getString("spread");else->text.getString("timeline")}else"")}
    }}
}
