package ru.genesis.calendar.ui

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.PlanGuidanceClaim
import ru.genesis.calendar.auth.nativePlanGuidanceTopic
import java.time.Instant

@Composable private fun rememberPlanGuidanceCopy(session: NativePlanGuidanceSession): JSONObject {
    val language = LocalGenesisLanguage.current
    return remember(session, language) { session.copy() }
}

/** One foreground scheduler; the server owns cadence, inactive returns and cross-platform leases. */
@Composable
internal fun NativePlanGuidanceHost(session: NativePlanGuidanceSession?, registry: NativeGuidanceSurfaces,
    topic: String, blocked: Boolean, openedSection: String?, upgrade: NativeUpgradeActions?) {
    if (session == null || upgrade == null) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val view = LocalView.current
    val density = LocalDensity.current
    val keyboard = WindowInsets.ime.getBottom(density) > 0
    val currentTopic by rememberUpdatedState(topic)
    val currentBlocked by rememberUpdatedState(blocked || keyboard)
    val owner = remember(session) { Any() }
    LaunchedEffect(session, registry, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var nextCheck = Instant.EPOCH // A real return is always checked with the server after quiet time.
            var quietSince = SystemClock.elapsedRealtime()
            var previousTopic = currentTopic
            try {
                session.loadLatest()
                launch { session.loadPolicy() }
                while (isActive) {
                    val now = session.now()
                    val tick = SystemClock.elapsedRealtime()
                    if (currentTopic != previousTopic) { previousTopic = currentTopic; quietSince = tick }
                    val automatic = session.automatic
                    if (automatic != null) {
                        if (!session.eligible() || currentBlocked || registry.hasOther(owner) ||
                            !session.wasAcknowledged(automatic) && automatic.leaseUntil?.isAfter(now) != true) session.dismissAutomatic()
                        delay(250); continue
                    }
                    val ready = session.eligible() && !currentBlocked && !session.pendingContextual(now) && !registry.hasAny() && view.isShown && view.hasWindowFocus()
                    if (!ready) quietSince = tick
                    quietSince = maxOf(quietSince, registry.lastInteractionAt)
                    if (ready && tick - quietSince >= 6_000L && !now.isBefore(nextCheck)) {
                        val requestedTopic = currentTopic
                        val claim = try { session.claimAutomatic(requestedTopic) }
                        catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive(); null }
                        catch (_: Exception) { null }
                        nextCheck = (session.nextAt ?: session.now().plusSeconds(300)).coerceAtLeast(session.now().plusSeconds(300))
                        if (claim != null) {
                            if (session.eligible() && !currentBlocked && !registry.hasAny() && view.hasWindowFocus() && requestedTopic == currentTopic &&
                                SystemClock.elapsedRealtime() - maxOf(quietSince, registry.lastInteractionAt) >= 6_000L)
                                session.presentAutomatic(claim)
                            else { session.discard(claim); nextCheck = session.now().plusSeconds(6) }
                        }
                    }
                    delay(250)
                }
            } finally { session.pause() }
        }
    }
    val contextual = session.contextual
    val comparisonVisible = session.comparisonVisible
    val comparisonOwner = remember(session) { Any() }
    DisposableEffect(session, contextual, comparisonVisible) {
        if (contextual != null) session.presentation(contextual, comparisonVisible, comparisonOwner)
        onDispose { if (contextual != null) session.presentation(contextual, false, comparisonOwner) }
    }
    LaunchedEffect(session, openedSection) {
        val requested = openedSection?.substringBefore('#')
        if (requested != "plan-guidance:${CloudAccountSnapshot.scopeFor(session.uid)}") return@LaunchedEffect
        session.dismissAutomatic()
        if (session.comparisonVisible) return@LaunchedEffect
        var consumed = false
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (consumed) awaitCancellation()
            while (isActive && (currentBlocked || registry.hasAny() || !view.hasWindowFocus())) delay(200)
            if (session.eligible()) { consumed = true; upgrade.feature(null) }
            // An explicit notification click is consumed once, rather than on each later resume.
            awaitCancellation()
        }
    }
    session.automatic?.let { claim ->
        if (!currentBlocked && !registry.hasOther(owner)) CompositionLocalProvider(LocalNativeGuidanceSurfaceOwner provides owner) {
            NativePlanGuidanceIntro(session, claim, upgrade) { session.dismissAutomatic() }
        }
    }
}

/** This small explanation is part of an already-visible limit/feature message, never another modal. */
@Composable
internal fun NativeContextualPlanGuidance(message: String, feature: String?) {
    val session = LocalNativePlanGuidance.current ?: return
    if (!session.eligible() || LocalNavigationPageContext.current?.active == false) return
    val resource = message.takeIf { it.startsWith("SUBSCRIPTION_QUOTA_") }?.removePrefix("SUBSCRIPTION_QUOTA_")
    val requested = feature ?: resource ?: return
    val copy = rememberPlanGuidanceCopy(session)
    val claim = session.contextual?.takeIf { it.notice?.resource?.let { value -> value == resource || value == requested } == true || it.notice?.feature == requested }
    val owner = remember { Any() }
    var requestedOnce by remember(session, message, requested) { mutableStateOf(false) }
    val modifier = Modifier.planGuidanceVisibility(claim?.token ?: "context:$requested:$message") {
        if (it && !requestedOnce) { requestedOnce = true; session.contextual(requested, message) }
        if (claim != null) session.presentation(claim, it, owner)
    }
    Text(copy.getString(claim?.notice?.topic ?: nativePlanGuidanceTopic(requested)), modifier.testTag("plan-guidance-context"),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, translate = false)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun NativePlanGuidanceNotice(session: NativePlanGuidanceSession?, upgrade: NativeUpgradeActions?, modifier: Modifier = Modifier) {
    val notice = session?.latest ?: return
    if (!session.eligible() || upgrade == null) return
    val copy = rememberPlanGuidanceCopy(session)
    WorkspaceStatusNotice(copy.getString("title") + "\n" + copy.getString(notice.topic), modifier.testTag("plan-guidance-notice")) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton({ session.markRead(notice); upgrade.feature(null) }, Modifier.heightIn(min = 48.dp)) {
                Text(copy.getString("compare"), translate = false)
            }
            TextButton({ session.markRead(notice) }, Modifier.heightIn(min = 48.dp)) { Text(copy.getString("read"), translate = false) }
        }
    }
}

@Composable
private fun NativePlanGuidanceIntro(session: NativePlanGuidanceSession, claim: PlanGuidanceClaim,
    upgrade: NativeUpgradeActions, onDismiss: () -> Unit) {
    val notice = claim.notice ?: return
    val copy = rememberPlanGuidanceCopy(session)
    val owner = remember(claim.token) { Any() }
    AlertDialog(onDismissRequest = onDismiss, modifier = Modifier.testTag("plan-guidance-dialog"),
        title = { Text(copy.getString("title"), translate = false) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .planGuidanceVisibility(requireNotNull(claim.token)) { session.presentation(claim, it, owner) },
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(copy.getString(notice.topic), translate = false)
                NativePlanGuidanceCards(session.policy, notice.topic, copy) { plan -> onDismiss(); upgrade.plan(plan) }
            }
        }, confirmButton = {
            TextButton({ onDismiss(); upgrade.feature(null) }, Modifier.heightIn(min = 48.dp)) { Text(copy.getString("compare"), translate = false) }
        }, dismissButton = { TextButton(onDismiss, Modifier.heightIn(min = 48.dp)) { Text(copy.getString("later"), translate = false) } })
}

/** Plan facts come from the same bundled/live policy used by the existing checkout comparison. */
@Composable
private fun NativePlanGuidanceCards(policy: JSONObject?, topic: String, copy: JSONObject, choose: (String) -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val featuresCopy = remember(context, language) {
        val all = context.assets.open("originals/i18n/billing-feature-copy.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        all.optJSONObject(language) ?: all.getJSONObject("en")
    }
    val resources = when (topic) {
        "projects" -> listOf("personal-projects"); "habits" -> listOf("habits")
        "mindmaps" -> listOf("mindmaps"); "diary" -> listOf("diary"); "dreams" -> emptyList()
        else -> listOf("personal-projects", "habits", "mindmaps", "diary")
    }
    val labels = mapOf("personal-projects" to "Личные проекты", "habits" to "Привычки", "mindmaps" to "Личные майндмепы", "diary" to "Записи дневника")
    fun quota(plan: String, resource: String): String = policy?.optJSONObject("limits")?.optJSONObject(plan)?.let {
        if (!it.has(resource)) "—" else if (it.isNull(resource)) "∞"
        else (it.opt(resource) as? Number)?.toLong()?.takeIf { value -> value >= 0 }?.toString() ?: "—"
    } ?: "—"
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf("standart", "premium").forEach { plan ->
            androidx.compose.material3.Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(nativePlanName(plan), style = MaterialTheme.typography.titleMedium, translate = false)
                    resources.forEach { resource ->
                        Text(genesisTranslate(labels.getValue(resource)) + ": " + quota(plan, resource) +
                            " · " + copy.getString("free") + ": " + quota("free", resource),
                            style = MaterialTheme.typography.bodySmall, translate = false)
                    }
                    if (topic in setOf("dreams", "overview")) nativeBillingPlanFeatureRows(policy, plan, language, featuresCopy)
                        .filter { it.feature in setOf("dream-journal", "dream-voice") }.forEach { feature ->
                            Row(Modifier.semantics(mergeDescendants = true) {
                                stateDescription = featuresCopy.getString(if (feature.included) "included" else "excluded")
                            }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GenesisLucideIcon(if (feature.included) "check" else "x", Modifier.size(18.dp),
                                    tint = if (feature.included) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                                Text(feature.label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    TextButton({ choose(plan) }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(copy.getString("choose").replace("{plan}", nativePlanName(plan)), translate = false)
                    }
                }
            }
        }
    }
}
