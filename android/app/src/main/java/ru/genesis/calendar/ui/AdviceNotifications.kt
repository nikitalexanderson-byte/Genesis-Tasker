package ru.genesis.calendar.ui

import android.content.Intent
import android.graphics.Bitmap
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.reminders.AdviceNotificationOpenRequest
import ru.genesis.calendar.reminders.AdviceReminderScheduler
import ru.genesis.calendar.ui.UntranslatedText as NativeText

@Composable private fun notificationCopy(language: String): JSONObject {
    val context = LocalContext.current
    return remember(context, language) { AdviceReminderScheduler.notificationCopy(context, language) }
}

@Composable internal fun AdviceNotificationControls(preferences: AdvicePreferences, language: String, use24: Boolean,
    enabled: Boolean, busy: Boolean, onChange: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as GenesisApplication
    val copy = notificationCopy(language)
    val globalAllowed = rememberNotificationsAllowed(app)
    val allowed = globalAllowed && AdviceReminderScheduler.allowed(app)
    val request = rememberRequestNotificationAccess(app)
    val saved = preferences.notifications
    var time by rememberSaveable(saved.time) { mutableStateOf(saved.time) }
    val canChange = enabled && !busy && preferences.enabled
    LaunchedEffect(app, language) { AdviceReminderScheduler.createChannel(app, language) }
    fun save(value: AdviceNotificationPreferences) { onChange(JSONObject().put("notifications", value.toJson())) }
    Column(Modifier.fillMaxWidth().testTag("advice-notification-settings"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("advice-notifications-enabled")
            .toggleable(saved.enabled, enabled = canChange, role = Role.Switch) { checked ->
                save(saved.copy(enabled = checked, timeZone = if (checked) AdviceNotificationPreferences.deviceTimeZone(saved.timeZone) else saved.timeZone))
                if (checked && !allowed) request()
            }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                NativeText(copy.getString("enable"), style = MaterialTheme.typography.titleSmall)
                NativeText(copy.getString("hint"), style = MaterialTheme.typography.bodyMedium)
            }
            Switch(saved.enabled, null, enabled = canChange)
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            NativeText(copy.getString("time"), Modifier.weight(1f))
            if (canChange && saved.enabled) AuthorTimePicker(time, use24,
                Modifier.heightIn(min = 48.dp).testTag("advice-notification-time")
                    .semantics { contentDescription = copy.getString("time") }) { value ->
                if (Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(value)) time = value
            }
            else OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.heightIn(min = 48.dp)
                .testTag("advice-notification-time")) { NativeText(timeLabel(saved.time, use24)) }
            if (time != saved.time) {
                val label = genesisTranslate("Сохранить")
                AffairsIconButton(label, AffairsAction.SAVE,
                    { save(saved.copy(time = time, timeZone = AdviceNotificationPreferences.deviceTimeZone(saved.timeZone))) },
                    Modifier.size(48.dp).testTag("advice-notification-time-save"), enabled = canChange && saved.enabled)
            }
        }
        NativeText(copy.getString("zone").replace("{zone}", saved.timeZone), style = MaterialTheme.typography.bodySmall)
        if (preferences.enabled && saved.enabled && !allowed) {
            NativeText(copy.getString("androidPermission"), style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag("advice-notification-permission").semantics { liveRegion = LiveRegionMode.Polite })
            TextButton(onClick = {
                if (!globalAllowed) request()
                else context.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, AdviceReminderScheduler.CHANNEL))
            }, modifier = Modifier.heightIn(min = 48.dp)) { NativeText(copy.getString("androidSettings")) }
        }
    }
}

/** This reader calls only GET /advice/saved. Mounting, retries and repeated taps never draw or record a view. */
@Composable internal fun SavedAdviceNotificationDialog(request: AdviceNotificationOpenRequest, gateway: DailyAdviceGateway,
    language: String, preferences: AdvicePreferences, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val copy = notificationCopy(language)
    val cardCopy = adviceCopy(language)
    var attempt by remember(request) { mutableIntStateOf(0) }
    var response by remember(request, preferences) { mutableStateOf<DailyAdviceResponse?>(null) }
    var loading by remember(request, preferences) { mutableStateOf(true) }
    var failed by remember(request, preferences) { mutableStateOf(false) }
    LaunchedEffect(request, gateway, preferences, attempt) {
        loading = true; failed = false
        try {
            val value = DailyAdviceProtocol.parse(gateway.saved(request.id, request.day, request.collection))
            require(value.day == request.day && (value.advice == null || value.advice.id == request.id && value.advice.collection == request.collection))
            response = value
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
        finally { loading = false }
    }
    val card = response?.advice?.takeIf { DailyAdviceProtocol.visible(it, preferences) }
    val bitmap by produceState<Bitmap?>(null, card?.id, card?.image) {
        value = try { card?.image?.let { path -> withContext(Dispatchers.IO) { DailyAdviceArtwork.load(context, path) } } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { null }
    }
    AlertDialog(onDismissRequest = onDismiss,
        modifier = Modifier.testTag("saved-advice-notification-dialog"),
        title = { NativeText(cardCopy.getString("title")) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    loading -> { WorkspaceLoadingLine(Modifier.fillMaxWidth()); NativeText(copy.getString("loading")) }
                    failed -> {
                        NativeText(copy.getString("savedError"), color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                        TextButton(onClick = { attempt++ }, modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("saved-advice-notification-retry")) { NativeText(copy.getString("retry")) }
                    }
                    card == null -> NativeText(copy.getString("savedUnavailable"),
                        modifier = Modifier.testTag("saved-advice-notification-unavailable"))
                    else -> DailyAdviceCard(card, cardCopy, bitmap, false, false,
                        showReactions = false, showDismiss = false,
                        authorizeShare = { DailyAdviceProtocol.parse(gateway.share(card.id, card.day, card.collection)).advice ?: error("ADVICE_SHARE_UNAVAILABLE") }, onDismiss = {})
                }
            }
        }, confirmButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)
                .testTag("saved-advice-notification-today")) { NativeText(copy.getString("today")) }
        })
}
