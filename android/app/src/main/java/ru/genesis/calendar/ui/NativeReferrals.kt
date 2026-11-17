package ru.genesis.calendar.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController

@Composable internal fun referralCopy(language: String = LocalGenesisLanguage.current): JSONObject {
    val context = LocalContext.current
    return remember(context, language) { context.assets.open("originals/i18n/referral-copy.json").bufferedReader().use { JSONObject(it.readText()).getJSONObject(language) } }
}

/** Source preparation for 3.3.5. Prices and rewards are always checked by the server. */
@Composable internal fun NativeReferrals(controller: AuthController, userId: String, language: String) {
    val c = referralCopy(language); val context = LocalContext.current; val scope = rememberCoroutineScope()
    var data by remember(userId) { mutableStateOf<JSONObject?>(null) }
    var expanded by remember(userId) { mutableStateOf(false) }
    var busy by remember(userId) { mutableStateOf(false) }
    var error by remember(userId) { mutableStateOf(false) }
    var message by remember(userId) { mutableStateOf<String?>(null) }
    var reload by remember(userId) { mutableIntStateOf(0) }
    LaunchedEffect(userId, reload) {
        error = false
        try { data = controller.referrals("GET", "/referrals/me") }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { error = true }
    }
    Column(Modifier.fillMaxWidth().testTag("consumer-referrals"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            UntranslatedText(c.getString("title"), style = MaterialTheme.typography.titleSmall)
        }
        if (expanded) {
            UntranslatedText(c.getString("intro")); UntranslatedText(c.getString("rules")); UntranslatedText(c.getString("monthlyOnly"))
            data?.let { current ->
                UntranslatedText("${c.getString("registered")}: ${current.getInt("registeredThisMonth")} / 10")
                UntranslatedText("${c.getString("current")} · ${current.getString("month")}: ${current.getJSONObject("current").getInt("percent")}%")
                UntranslatedText("${c.getString("next")} · ${current.getString("nextMonth")}: ${current.getJSONObject("next").getInt("percent")}%")
                if (!current.isNull("code")) {
                    val code = current.getString("code"); val link = current.getString("link")
                    UntranslatedText("${c.getString("code")}: $code")
                    OutlinedTextField(value = link, onValueChange = {}, readOnly = true, modifier = Modifier.fillMaxWidth(),
                        label = { UntranslatedText(c.getString("link")) })
                    OutlinedButton(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(c.getString("link"), link))
                        message = c.getString("copied")
                    }, modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("copy")) }
                } else Button(onClick = { if (!busy) scope.launch {
                    busy = true; error = false
                    try { data = controller.referrals("POST", "/referrals/code", JSONObject()) }
                    catch (cancel: CancellationException) { throw cancel }
                    catch (_: Exception) { error = true } finally { busy = false }
                } }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("create")) }
                if (current.optBoolean("used")) UntranslatedText(c.getString("used"))
                if (current.optBoolean("canRedeemFreeMonth")) Button(onClick = { if (!busy) scope.launch {
                    busy = true; error = false
                    try {
                        controller.referrals("POST", "/referrals/redeem", JSONObject())
                        message = c.getString("success"); reload++; controller.checkSession()
                    } catch (cancel: CancellationException) { throw cancel }
                    catch (_: Exception) { error = true } finally { busy = false }
                } }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("freeMonth")) }
            }
            UntranslatedText(c.getString("privacy"), style = MaterialTheme.typography.bodySmall)
            message?.let { UntranslatedText(it) }
            if (error) {
                UntranslatedText(c.getString("error"), color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { reload++ }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("retry")) }
            }
        }
    }
}

@Composable internal fun NativeReferralInvitation(controller: AuthController, language: String, onBusyChange: (Boolean) -> Unit) {
    val c = referralCopy(language); val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(false) }; var code by remember { mutableStateOf("") }
    var accepted by remember { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf(false) }
    LaunchedEffect(controller) {
        try { accepted = controller.referrals("GET", "/referrals/invitation").optBoolean("accepted") }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { /* Capture remains available after a transient status failure. */ }
    }
    DisposableEffect(Unit) { onDispose { onBusyChange(false) } }
    Column(Modifier.fillMaxWidth().testTag("referral-invitation"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("invitation")) }
        if (accepted) UntranslatedText(c.getString("saved"))
        else if (expanded) {
            OutlinedTextField(value = code, onValueChange = { if (it.length <= 22) code = it }, enabled = !busy,
                label = { UntranslatedText(c.getString("code")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { if (!busy) scope.launch {
                busy = true; onBusyChange(true); error = false
                try { accepted = controller.referrals("POST", "/referrals/invitation", JSONObject().put("code", code.trim())).getBoolean("accepted") }
                catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { error = true } finally { busy = false; onBusyChange(false) }
            } }, enabled = !busy && code.trim().matches(Regex("g_[a-f0-9]{20}")), modifier = Modifier.heightIn(min = 48.dp)) { UntranslatedText(c.getString("apply")) }
        }
        if (error) UntranslatedText(c.getString("error"), color = MaterialTheme.colorScheme.error)
    }
}
