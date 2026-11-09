package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.EmailVerificationStatus

@Composable internal fun EmailVerificationNotice(uid: String, email: String, initial: EmailVerificationStatus,
    controller: AuthController) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val copy = remember(context, language) {
        context.assets.open("originals/i18n/email-verification-copy.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()).getJSONObject(language) }
    }
    var status by remember(uid) { mutableStateOf(initial) }
    var busy by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf<String?>(null) }
    var cooldown by remember(uid) { mutableIntStateOf(initial.retryAfter) }
    var active by remember(uid) { mutableStateOf(true) }
    val noticePrefs=remember(context){context.getSharedPreferences("genesis.account.notices",android.content.Context.MODE_PRIVATE)}
    var dismissedUntil by remember(uid){mutableLongStateOf(noticePrefs.getLong("email:$uid",0))}
    var clock by remember {mutableLongStateOf(System.currentTimeMillis())}
    val scope = rememberCoroutineScope()
    suspend fun refresh(send: Boolean = false) {
        if (busy || !active) return
        busy = true
        if (send) message = null
        try {
            val result = controller.emailVerification(uid, send)
            if (active) {
                status = result; cooldown = result.retryAfter
                message = if (send) "sent" else null
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { if (active) message = "error" }
        finally { if (active) busy = false }
    }
    LaunchedEffect(uid, initial) { status = initial; cooldown = initial.retryAfter }
    LaunchedEffect(uid) {
        refresh()
        while (true) { delay(60000);clock=System.currentTimeMillis(); if (status.required) refresh() }
    }
    LaunchedEffect(uid, cooldown) { if (cooldown > 0) { delay(1000); cooldown-- } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(uid, lifecycle) {
        active = true
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && status.required) scope.launch { refresh() }
        }
        lifecycle.addObserver(observer)
        onDispose { active = false; lifecycle.removeObserver(observer) }
    }
    if (dismissedUntil<=clock&&(status.dismissedUntil?.let{runCatching{java.time.Instant.parse(it).toEpochMilli()}.getOrDefault(0L)}?:0L)<=clock) {
        EmailVerificationNoticeContent(email, status, copy, busy, cooldown, message,
            onSend = { scope.launch { refresh(true) } }, onCheck = { scope.launch { refresh() } },
            onDismiss = {
                dismissedUntil=System.currentTimeMillis()+86400000L
                noticePrefs.edit().putLong("email:$uid",dismissedUntil).apply()
                scope.launch {
                    try { status=controller.emailVerification(uid,dismiss=true) }
                    catch(cancelled:CancellationException) { throw cancelled }
                    catch(_:Exception) { }
                }
            })
    }
}

@Composable internal fun EmailVerificationNoticeContent(email: String, status: EmailVerificationStatus,
    copy: JSONObject, busy: Boolean, cooldown: Int, message: String?, onSend: () -> Unit, onCheck: () -> Unit, onDismiss: () -> Unit = {}) {
    if (!status.required) return
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("email-verification-notice"),
        shape = AffairsLayout.shape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                UntranslatedText(copy.getString("title"), Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium)
                TextButton(onClick=onDismiss,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(copy.optString("dismiss","Закрыть"))}
            }
            UntranslatedText(copy.getString("description").replace("{email}", email), style = MaterialTheme.typography.bodyMedium)
            UntranslatedText(copy.getString("hint"), style = MaterialTheme.typography.bodySmall)
            status.deadlineAt?.let{deadline->UntranslatedText(copy.getString("deadline").replace("{date}",
                runCatching{java.time.Instant.parse(deadline).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString()}.getOrDefault(deadline)),style=MaterialTheme.typography.bodySmall)}
            // Full-width actions preserve whole words and 48dp touch targets on small screens.
            OutlinedButton(onClick = onSend, enabled = !busy && cooldown == 0,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("email-verification-send")) {
                UntranslatedText(if (cooldown > 0) copy.getString("wait").replace("{seconds}", cooldown.toString())
                    else copy.getString(if (status.hasRequest) "resend" else "send"))
            }
            TextButton(onClick = onCheck, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("email-verification-check")) {
                UntranslatedText(copy.getString("check"))
            }
            message?.let { UntranslatedText(copy.getString(it), Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodySmall) }
        }
    }
}
