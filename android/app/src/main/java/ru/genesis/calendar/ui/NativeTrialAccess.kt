package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.auth.TrialAccess
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable internal fun rememberTrialCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        context.assets.open("originals/i18n/billing-trial-copy.json").bufferedReader(Charsets.UTF_8).use {
            val root = JSONObject(it.readText())
            root.optJSONObject(language) ?: root.getJSONObject("en")
        }
    }
}

internal fun trialText(copy: JSONObject, key: String, vararg values: Pair<String, String>): String =
    values.fold(copy.getString(key)) { text, (name, value) -> text.replace("{$name}", value) }

private fun trialRemaining(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1_000
    return "%02d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60)
}

/** Catalog metadata may offer a choice, but only FeatureAccess's live proof can show active rights. */
@Composable internal fun NativeTrialPanel(access: FeatureAccess, metadata: TrialAccess?, copy: JSONObject,
    busy: Boolean, error: String?, onStart: (String) -> Unit, onRefresh: () -> Unit,
    modifier: Modifier = Modifier, starting: Boolean = false, checking: Boolean = false) {
    val trial = access.trial ?: metadata ?: return
    val phase = if (access.trial != null) access.trialPhase()
        else if (trial.status == "active") "verification-required" else trial.status
    var confirmPlan by rememberSaveable(trial.startsAt?.toString(), trial.status) { mutableStateOf<String?>(null) }
    Column(modifier.fillMaxWidth().testTag("billing-trial-panel"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(copy.getString("trialTitle"), style = MaterialTheme.typography.titleMedium)
        Text(copy.getString("duration"))
        Text(copy.getString("noCharge"))
        when (phase) {
            "available" -> {
                Text(copy.getString("offerTitle"))
                Text(copy.getString("onceOnly"), style = MaterialTheme.typography.bodySmall)
                trial.eligiblePlans.forEach { plan ->
                    OutlinedButton({ confirmPlan = plan }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("trial-start-$plan")) {
                        Text(trialText(copy, "start", "trial" to TrialAccess.label(plan)))
                    }
                }
            }
            "active" -> {
                Text(trialText(copy, "active", "trial" to requireNotNull(trial.label)), Modifier.testTag("trial-active"))
                access.trialRemainingMillis()?.let {
                    Text(trialText(copy, "remaining", "time" to trialRemaining(it)), Modifier.testTag("trial-remaining"))
                }
            }
            "verification-required" -> {
                Text(copy.getString("onlineRequired"), Modifier.testTag("trial-online-required"))
                TextButton(onRefresh, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp).testTag("trial-refresh")) {
                    Text(copy.getString("refresh"))
                }
            }
            "expired", "revoked", "used" -> Text(trialText(copy, requireNotNull(phase),
                "trial" to (trial.label ?: copy.getString("trialTitle"))), Modifier.testTag("trial-$phase"))
            else -> Text(copy.getString("unavailable"), Modifier.testTag("trial-unavailable"))
        }
        trial.endsAt?.let { end ->
            Text(trialText(copy, "endsAt", "date" to DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss")
                .withZone(ZoneId.systemDefault()).format(end)), style = MaterialTheme.typography.bodySmall)
        }
        if (access.source == "trial") Text(trialText(copy, "paidPlan",
            "plan" to nativePlanName(access.paidAccess?.currentPlan() ?: "free")), style = MaterialTheme.typography.bodySmall)
        if (starting) Text(copy.getString("starting"), Modifier.testTag("trial-starting"))
        else if (checking) Text(copy.getString("checking"), Modifier.testTag("trial-checking"))
        error?.let { Text(copy.optString(it, copy.getString("startFailed")), color = MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("trial-error").semantics { liveRegion = LiveRegionMode.Polite }) }
    }
    confirmPlan?.let { plan ->
        AlertDialog(onDismissRequest = { if (!busy) confirmPlan = null },
            title = { Text(trialText(copy, "confirmTitle", "trial" to TrialAccess.label(plan))) },
            text = { Text(trialText(copy, "confirmBody", "trial" to TrialAccess.label(plan))) },
            confirmButton = {
                TextButton({ confirmPlan = null; onStart(plan) }, enabled = !busy,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("trial-confirm")) {
                    Text(trialText(copy, "confirmStart", "trial" to TrialAccess.label(plan)))
                }
            }, dismissButton = {
                TextButton({ confirmPlan = null }, enabled = !busy,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("trial-cancel")) { Text(copy.getString("back")) }
            })
    }
}

/** One dismissible notice per account/window; never charges, reactivates or deletes data. */
@Composable internal fun NativeTrialExpiryPrompt(userId: String?, access: FeatureAccess,
    noticePreferences: android.content.SharedPreferences? = null) {
    val uid = userId ?: return
    val trial = access.trial ?: return
    if (!access.trialNeedsPayment()) return
    val open = LocalNativeUpgrade.current ?: return
    val context = LocalContext.current
    val copy = rememberTrialCopy()
    val key = CloudAccountSnapshot.scopeFor(uid) + ":" + trial.startsAt + ":" + trial.endsAt
    val preferences = noticePreferences ?: remember(context) {
        context.getSharedPreferences("genesis.trial.notices.v1", Context.MODE_PRIVATE)
    }
    var dismissed by rememberSaveable(key) { mutableStateOf(preferences.getBoolean(key, false)) }
    LaunchedEffect(key) {
        // Record the offer when shown, so process death/background before dismiss is not a new nag.
        if (!dismissed) preferences.edit().putBoolean(key, true).apply()
    }
    fun dismiss() { dismissed = true; preferences.edit().putBoolean(key, true).apply() }
    if (!dismissed) AlertDialog(onDismissRequest = ::dismiss,
        modifier = Modifier.testTag("trial-expiry-dialog"),
        title = { Text(copy.getString("trialTitle")) },
        text = { Text(trialText(copy, "expired", "trial" to (trial.label ?: copy.getString("trialTitle"))) +
            "\n" + copy.getString("noCharge")) },
        confirmButton = {
            TextButton({ dismiss(); open(null) }, modifier = Modifier.heightIn(min = 48.dp).testTag("trial-expiry-payment")) {
                Text(copy.getString("payment"))
            }
        }, dismissButton = {
            TextButton(::dismiss, modifier = Modifier.heightIn(min = 48.dp).testTag("trial-expiry-dismiss")) {
                Text(copy.getString("back"))
            }
        })
}
