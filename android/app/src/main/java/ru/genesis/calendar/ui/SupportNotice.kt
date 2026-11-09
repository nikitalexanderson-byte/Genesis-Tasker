package ru.genesis.calendar.ui

import androidx.compose.material3.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.EmailVerificationStatus

@Composable internal fun SupportNotice(uid:String,verification:EmailVerificationStatus,controller:AuthController){
    val context=LocalContext.current
    val language=LocalGenesisLanguage.current
    val copy=remember(context,language){context.assets.open("originals/i18n/support-notice-copy.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText()).getJSONObject(language)}}
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    var open by remember(uid){mutableStateOf(false)}
    val donation = rememberDonationAction(controller) { open = false }
    val currentVerification by rememberUpdatedState(verification)
    LaunchedEffect(uid){
        delay(3000)
        var next=0L
        while(true){
            val email=currentVerification
            val emailDue=email.required&&(email.dismissedUntil?.let{runCatching{java.time.Instant.parse(it).toEpochMilli()}.getOrDefault(0L)}?:0L)<=System.currentTimeMillis()
            if(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)&&!emailDue&&System.currentTimeMillis()>=next){
                try{
                    val result=controller.claimSupportNotice(uid,"android")
                    next=java.time.Instant.parse(result.getString("nextAt")).toEpochMilli()
                    if(result.getBoolean("show"))open=true
                }catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){}
            }
            delay(60000)
        }
    }
    if(open)AlertDialog(onDismissRequest={if(!donation.preparing)open=false},
        modifier=Modifier.testTag("support-notice-dialog"), maxWidth=520.dp, closeEnabled=!donation.preparing,
        title={
            Row(verticalAlignment=Alignment.CenterVertically, horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                GenesisBrandLogo(Modifier.size(48.dp))
                UntranslatedText(copy.getString("title"), Modifier.weight(1f), style=MaterialTheme.typography.titleLarge)
            }
        },
        text={
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                UntranslatedText(copy.getString("body"), style=MaterialTheme.typography.bodyLarge,
                    color=MaterialTheme.colorScheme.onSurface)
            }
        },
        confirmButton={
            Column(Modifier.fillMaxWidth(), verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Button(onClick=donation.open, enabled=!donation.preparing,
                    modifier=Modifier.fillMaxWidth().testTag("support-notice-donate")) {
                    if(donation.preparing) {
                        CircularProgressIndicator(Modifier.size(18.dp), color=LocalContentColor.current, strokeWidth=2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    UntranslatedText(copy.getString("action"))
                }
                TextButton(onClick={open=false}, enabled=!donation.preparing,
                    modifier=Modifier.fillMaxWidth().testTag("support-notice-later")) {
                    UntranslatedText(copy.getString("later"))
                }
            }
        })
}
