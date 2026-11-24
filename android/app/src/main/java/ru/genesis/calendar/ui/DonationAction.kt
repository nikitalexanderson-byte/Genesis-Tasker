package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController

internal data class DonationAction(val preparing: Boolean, val open: () -> Unit)

/** The suggested order never restricts the donor's explicit choice of card method. */
@Composable internal fun rememberDonationAction(controller: AuthController, onOpened: () -> Unit = {}): DonationAction {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val copy = remember(context, language) { context.assets.open("originals/i18n/donation-method-copy.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(language) } }
    val scope = rememberCoroutineScope()
    var preparing by remember(controller) { mutableStateOf(false) }
    var choosing by remember(controller) { mutableStateOf(false) }
    var methods by remember(controller) { mutableStateOf<JSONObject?>(null) }
    val currentOnOpened by rememberUpdatedState(onOpened)
    LaunchedEffect(choosing, controller) {
        if (choosing) {
            methods = null
            try { methods = controller.donationMethods() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* The existing CloudTips method remains available. */ }
        }
    }
    fun open(provider: String) {
        if (preparing) return
        preparing = true
        scope.launch {
            try {
                val url = controller.donationUrl(provider)
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                choosing = false
                currentOnOpened()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { Toast.makeText(context, copy.getString("error"), Toast.LENGTH_SHORT).show() }
            finally { preparing = false }
        }
    }
    if (choosing) AlertDialog(onDismissRequest = { if (!preparing) choosing = false }, closeEnabled = !preparing,
        modifier = Modifier.testTag("donation-method-dialog"),
        title = { UntranslatedText(copy.getString("title"), style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                UntranslatedText(copy.getString("note"), style = MaterialTheme.typography.bodyLarge)
                val options = if (methods?.optString("region") == "RU") listOf("cloudtips", "boosty") else listOf("boosty", "cloudtips")
                for (provider in options) Button(onClick = { open(provider) },
                    enabled = !preparing && (provider == "cloudtips" || methods?.optJSONObject("boosty")?.optBoolean("available") == true),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("donation-method-$provider")) {
                    UntranslatedText(copy.getString(if (provider == "cloudtips") "domestic" else "international"))
                }
                if (methods?.optJSONObject("boosty")?.optBoolean("available") != true)
                    UntranslatedText(copy.getString("pending"), style = MaterialTheme.typography.bodyMedium)
            }
        }, confirmButton = {})
    return DonationAction(preparing) { if (!preparing) choosing = true }
}
