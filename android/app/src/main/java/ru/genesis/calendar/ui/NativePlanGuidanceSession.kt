package ru.genesis.calendar.ui

import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.reminders.PlanGuidanceNotifications
import java.time.Instant

internal val LocalNativePlanGuidance = staticCompositionLocalOf<NativePlanGuidanceSession?> { null }

@Composable
internal fun rememberNativePlanGuidance(controller: AuthController, uid: String?, language: String,
    enabled: Boolean): NativePlanGuidanceSession? {
    if (!enabled || uid == null) return null
    val context = LocalContext.current.applicationContext
    val scope = rememberCoroutineScope()
    val currentLanguage = rememberUpdatedState(language)
    val session = remember(controller, uid) { NativePlanGuidanceSession(context, controller, uid, scope) { currentLanguage.value } }
    DisposableEffect(session) { onDispose { session.close() } }
    return session
}

internal class NativePlanGuidanceSession(private val context: Context, private val controller: AuthController,
    val uid: String, private val scope: CoroutineScope, private val language: () -> String) {
    var latest by mutableStateOf<PlanGuidanceNotice?>(null); private set
    var automatic by mutableStateOf<PlanGuidanceClaim?>(null); private set
    var contextual by mutableStateOf<PlanGuidanceClaim?>(null); private set
    var policy by mutableStateOf<JSONObject?>(null); private set
    var nextAt by mutableStateOf<Instant?>(null); private set
    var comparisonVisible by mutableStateOf(false)
    private var closed = false
    private var contextJob: Job? = null
    private val ackJobs = mutableMapOf<String, Job>()
    private val readJobs = mutableSetOf<Job>()
    private val visible = mutableMapOf<String, MutableSet<Any>>()
    private val acknowledged = mutableSetOf<String>()
    private val read = mutableSetOf<String>()
    private val lastContext = mutableMapOf<String, Long>()
    private var serverClock: Pair<Instant, Long>? = null

    fun now(): Instant = serverClock?.let { (instant, elapsed) ->
        instant.plusMillis((SystemClock.elapsedRealtime() - elapsed).coerceAtLeast(0L))
    } ?: Instant.now()

    private fun observe(claim: PlanGuidanceClaim) {
        claim.serverNow?.let { serverClock = it to SystemClock.elapsedRealtime() }
        nextAt = claim.nextAt
    }

    private suspend fun claim(request: PlanGuidanceRequest): PlanGuidanceClaim {
        val response = controller.planGuidance(uid, "/account/plan-guidance/claim", request.json())
        return try { PlanGuidanceClaim.fromJson(response) } catch (failure: Exception) {
            response.optString("token").takeIf { it.matches(Regex("[a-f0-9]{48}")) }
                ?.let { controller.releasePlanGuidance(uid, it) }
            throw failure
        }
    }

    fun eligible(): Boolean {
        val auth = controller.state.value
        return !closed && auth.ready && !auth.requiresSignIn && auth.user?.uid == uid &&
            (context as? ru.genesis.calendar.GenesisApplication)?.workspaceScope == CloudAccountSnapshot.scopeFor(uid) &&
            auth.accountSettings?.emailVerification?.required != true &&
            auth.accountSettings?.featureAccess?.let(::nativePlanGuidanceEligible) == true
    }

    fun copy(): JSONObject {
        val all = context.assets.open("originals/i18n/plan-guidance-copy.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        return all.optJSONObject(language()) ?: all.getJSONObject("en")
    }

    suspend fun loadLatest() {
        if (!eligible()) return
        try {
            val row = controller.planGuidance(uid, "/account/plan-guidance")
            if (eligible()) latest = PlanGuidanceNotice.fromJson(row.optJSONObject("notice"))?.takeUnless { it.id in read }
        } catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive() }
        catch (_: Exception) { /* A later foreground visit can read the same unread notice. */ }
    }

    suspend fun loadPolicy() {
        if (policy != null || !eligible()) return
        try { policy = withContext(Dispatchers.IO) {
            context.assets.open("originals/catalogs/feature-access-policy.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        } } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
        try {
            val catalog = controller.billing("GET", "/billing/catalog?client=" + if (ru.genesis.calendar.BuildConfig.PLAY_DISTRIBUTION) "android-play" else "android")
            if (eligible()) catalog.optJSONObject("policy")?.let { policy = it }
        } catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive() } catch (_: Exception) { }
    }

    suspend fun claimAutomatic(topic: String): PlanGuidanceClaim? {
        if (!eligible()) return null
        val claim = claim(PlanGuidanceRequest(topic, "scheduled"))
        observe(claim)
        if (!eligible()) { release(claim); return null }
        return claim.takeIf { it.show }
    }

    fun presentAutomatic(claim: PlanGuidanceClaim) {
        if (eligible() && claim.leaseUntil?.isAfter(now()) == true) automatic = claim else release(claim)
    }

    fun contextual(feature: String?, message: String? = null) {
        if (!eligible() || feature == null || !feature.matches(Regex("[a-z][a-z0-9-]{0,63}"))) return
        if (feature in (controller.state.value.accountSettings?.featureAccess?.disabledFeatures ?: emptySet())) return
        val explicitResource = message?.takeIf { it.startsWith("SUBSCRIPTION_QUOTA_") }?.removePrefix("SUBSCRIPTION_QUOTA_")
        val quota = message != "FEATURE_SUBSCRIPTION_REQUIRED" &&
            (explicitResource?.let { it in nativePlanGuidanceResources } == true || feature in nativePlanGuidanceResources)
        val resource = if (quota) (explicitResource ?: feature).takeIf { it in nativePlanGuidanceResources } else null
        val request = PlanGuidanceRequest(nativePlanGuidanceTopic(feature), if (quota) "quota" else "feature", resource,
            feature.takeUnless { quota })
        val key = "${request.topic}:${request.resource ?: request.feature}"
        val now = SystemClock.elapsedRealtime()
        if (lastContext[key]?.let { now - it < 5_000L } == true) return
        lastContext[key] = now
        contextJob?.cancel(); contextual?.let(::release); contextual = null
        contextJob = scope.launch {
            try {
                val claim = claim(request)
                observe(claim)
                if (!eligible()) { release(claim); return@launch }
                if (claim.show) contextual = claim
            } catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive() }
            catch (_: Exception) { /* Existing quota/feature UI remains available. */ }
        }
    }

    fun presentation(claim: PlanGuidanceClaim, shown: Boolean, source: Any) {
        val token = claim.token ?: return
        if (!shown) {
            visible[token]?.let { it.remove(source); if (it.isEmpty()) visible.remove(token) }
            return
        }
        if (!eligible()) return
        visible.getOrPut(token) { mutableSetOf() } += source
        if (token in acknowledged || ackJobs[token]?.isActive == true) return
        ackJobs[token] = scope.launch {
            repeat(3) { attempt ->
                if (!eligible() || visible[token].isNullOrEmpty() || claim.leaseUntil?.isAfter(now()) != true) return@launch
                try {
                    val response = controller.planGuidance(uid, "/account/plan-guidance/shown", JSONObject().put("token", token))
                    if (!eligible()) return@launch
                    if (response.getBoolean("ok")) {
                        acknowledged += token
                        nextAt = response.optString("nextAt").takeUnless { !response.has("nextAt") || response.isNull("nextAt") }?.let(Instant::parse)
                        val notice = PlanGuidanceNotice.fromJson(response.optJSONObject("notice"))
                        latest = notice?.takeUnless { it.id in read }
                        if (notice != null && notice.id !in read) PlanGuidanceNotifications.deliver(context, uid, notice, copy())
                        return@launch
                    }
                    return@launch
                } catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive() }
                catch (_: Exception) { }
                delay((attempt + 1) * 1_000L)
            }
        }
        ackJobs[token]?.invokeOnCompletion {
            if (token !in acknowledged && visible[token].isNullOrEmpty()) controller.releasePlanGuidance(uid, token)
        }
    }

    fun markRead(notice: PlanGuidanceNotice) {
        if (!eligible()) return
        val job = scope.launch {
            try {
                val result = controller.planGuidance(uid, "/account/plan-guidance/read", JSONObject().put("id", notice.id))
                if (eligible() && result.getBoolean("ok")) {
                    read += notice.id
                    if (latest?.id == notice.id) { latest = null; PlanGuidanceNotifications.clear(context, uid) }
                }
            } catch (cancelled: CancellationException) { currentCoroutineContext().ensureActive() } catch (_: Exception) { }
        }
        readJobs += job
        job.invokeOnCompletion { readJobs.remove(job) }
    }

    private fun release(claim: PlanGuidanceClaim) {
        claim.token?.takeUnless { it in acknowledged || ackJobs[it]?.isActive == true }?.let { controller.releasePlanGuidance(uid, it) }
    }
    fun wasAcknowledged(claim: PlanGuidanceClaim): Boolean = claim.token?.let { it in acknowledged } == true
    fun pendingContextual(now: Instant): Boolean = contextual?.let { !wasAcknowledged(it) && it.leaseUntil?.isAfter(now) == true } == true
    fun discard(claim: PlanGuidanceClaim) = release(claim)
    fun dismissAutomatic() { automatic?.let(::release); automatic = null }

    fun pause() {
        contextJob?.cancel(); ackJobs.values.forEach { it.cancel() }; readJobs.toList().forEach { it.cancel() }
        visible.clear()
        automatic?.let(::release); contextual?.let(::release)
        automatic = null; contextual = null; comparisonVisible = false
    }

    fun close() {
        closed = true
        pause()
        latest = null
        PlanGuidanceNotifications.clear(context, uid)
    }
}
