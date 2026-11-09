package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.auth.GenesisPlayBilling
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal val nativeBillingPlans = listOf("free", "standart", "premium", "business", "premium4life")
internal fun nativePlanName(plan: String) = when (plan) {
    "standart" -> "Standard"; "premium" -> "Premium"; "business" -> "Business"; "premium4life" -> "Elite"; else -> "Free"
}

/** Approved list prices are presentation only; orders and credits come from the server. */
internal fun nativePlanListAmount(plan: String, months: Int): Long = when (plan) {
    "standart" -> if (months == 12) 333000L else 33300L
    "premium" -> if (months == 12) 555000L else 55500L
    "business" -> if (months == 12) 777000L else 77700L
    "premium4life" -> 1290000L
    else -> 0L
}

private fun JSONArray?.strings(): List<String> = this?.let { array -> (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) } }.orEmpty()
internal fun nativeBillingOffer(catalog: JSONObject?, plan: String, months: Int): JSONObject? {
    val offers = catalog?.optJSONArray("offers") ?: return null
    val period = if (plan == "premium4life") 0 else months
    return (0 until offers.length()).mapNotNull(offers::optJSONObject)
        .firstOrNull { it.optString("plan") == plan && it.optInt("periodMonths") == period }
}
internal fun nativeBillingProviderPrice(offer: JSONObject?, provider: String): Pair<Long,String>? {
    val price = offer?.optJSONObject("pricesByProvider")?.optJSONObject(provider) ?: return null
    val raw = price.opt("amountMinor")
    if (raw !is Int && raw !is Long) return null
    val amount = (raw as Number).toLong(); val currency = price.optString("currency")
    if (amount !in 1L..9_007_199_254_740_991L || currency != if (provider == "lemon-squeezy") "USD" else "RUB") return null
    return amount to currency
}
internal fun nativeBillingProviderChoices(catalog: JSONObject?, offer: JSONObject?, playDistribution: Boolean): List<String> {
    val preferred = catalog?.optJSONObject("routing")?.optString("preferredProvider")
    val providers = catalog?.optJSONArray("providers") ?: return emptyList()
    return (0 until providers.length()).mapNotNull { providers.optJSONObject(it) }.filter {
        val id = it.optString("id")
        id in setOf("google-play", "yookassa", "lemon-squeezy") && (!playDistribution || id == "google-play") &&
            it.optString("reason") != "client-unavailable" && nativeBillingProviderPrice(offer,id) != null
    }.map { it.getString("id") }.distinct().sortedBy { if (it == preferred) 0 else 1 }
}
internal fun nativeBillingMoney(amount: Long, language: String, currency: String = "RUB"): String {
    val format = NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply {
        minimumFractionDigits = if (amount % 100L == 0L) 0 else 2; maximumFractionDigits = 2
    }
    return format.format(java.math.BigDecimal.valueOf(amount, 2)) + if (currency == "RUB") " ₽" else " $currency"
}

private val upgradeScheme = darkColorScheme(primary = Color(0xffd9c2ff), onPrimary = Color(0xff2b0b55),
    primaryContainer = Color(0xff7531ce), onPrimaryContainer = Color.White, secondary = Color(0xffe6c0ff),
    surface = Color(0xff180c2b), onSurface = Color(0xfffaf4ff), onSurfaceVariant = Color(0xffd1c2e2),
    surfaceContainerHigh = Color(0xff30203f), outline = Color(0xffb49bcf), outlineVariant = Color(0xff6a4a87),
    error = Color(0xffffb4ab))

@Composable private fun UpgradeText(value: String, modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium, color: Color = MaterialTheme.colorScheme.onSurface,
    maxLines: Int = Int.MAX_VALUE) = Text(value, modifier, style = style, color = color, maxLines = maxLines, adjustInk = false)

internal fun nativeUpgradeStarVertices(): List<Pair<Float, Float>> = List(24) { index ->
    val angle = -PI / 2 + index * PI / 12
    val radius = if (index % 2 == 0) 12.0 else 7.0
    (16 + cos(angle) * radius).toFloat() to (16 + sin(angle) * radius).toFloat()
}

@Composable private fun rememberUpgradeGlowPhase(): Float {
    if (!ValueAnimator.areAnimatorsEnabled()) return 1f
    val transition = rememberInfiniteTransition(label = "upgrade-glow")
    return transition.animateFloat(.74f, 1f,
        infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "upgrade-glow-opacity").value
}

/** Twelve-ray vector mark; the button supplies its accessible action name. */
@Composable internal fun UpgradeVectorMark(modifier: Modifier = Modifier, tint: Color = Color.White,
    glowPhase: Float? = null) {
    val phase = glowPhase ?: rememberUpgradeGlowPhase()
    val vertices = remember { nativeUpgradeStarVertices() }
    Canvas(modifier.clearAndSetSemantics {}) {
        val unit = size.minDimension / 32f
        val origin = Offset((size.width - 32f * unit) / 2f, (size.height - 32f * unit) / 2f)
        val path = Path().apply {
            vertices.forEachIndexed { index, (x, y) ->
                if (index == 0) moveTo(origin.x + x * unit, origin.y + y * unit)
                else lineTo(origin.x + x * unit, origin.y + y * unit)
            }
            close()
        }
        drawPath(path, tint.copy(alpha = tint.alpha * .08f * phase), style = Stroke(width = unit * 6.4f, join = StrokeJoin.Round))
        drawPath(path, tint.copy(alpha = tint.alpha * .12f * phase), style = Stroke(width = unit * 4f, join = StrokeJoin.Round))
        drawPath(path, tint.copy(alpha = tint.alpha * .22f * phase), style = Stroke(width = unit * 2.4f, join = StrokeJoin.Round))
        drawPath(path, tint, style = Stroke(width = unit * 1.25f, join = StrokeJoin.Round))
        drawCircle(tint, unit * 2f, Offset(size.width / 2f, size.height / 2f))
    }
}

@Composable internal fun NativeUpgradeSidebarButton(onClick: () -> Unit, modifier: Modifier = Modifier,
    label: String? = null, compact: Boolean = false, tag: String = "drawer-upgrade") {
    val phase = rememberUpgradeGlowPhase()
    val gold = LocalEveningTheme.current && LocalDarkPalette.current == "violet"
    val actionLabel = label ?: if (LocalGenesisLanguage.current == "en") "Unlock more features" else genesisTranslate("Подключить больше функций")
    androidx.compose.material3.Surface(onClick = onClick, shape = AffairsLayout.shape,
        color = if (gold) Color(0xffe2b855) else Color(0xff6525ad), contentColor = if (gold) Color(0xff2b1906) else Color.White,
        border = BorderStroke(1.dp, Color(0xffd0a7ff).copy(alpha = phase)),
        modifier = modifier.fillMaxWidth().heightIn(min = if (compact) 48.dp else 64.dp)
            .shadow(12.dp, AffairsLayout.shape, clip = false, ambientColor = (if(gold)Color(0xffe7b74a) else Color(0xffb36aff)).copy(alpha = .26f), spotColor = (if(gold)Color(0xffe7b74a) else Color(0xffa855f7)).copy(alpha = phase * .6f))
            .testTag(tag).semantics { contentDescription = actionLabel; role = Role.Button }) {
        Row(Modifier.background(Brush.horizontalGradient(listOf(if (gold) Color(0xffe2b855) else Color(0xff6525ad), if (gold) Color(0xffffe9a5) else Color(0xff8438d4))))
            .padding(horizontal = 14.dp, vertical = if (compact) 10.dp else 12.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            UpgradeVectorMark(Modifier.size(if (compact) 20.dp else 28.dp), if(gold)Color(0xff593506) else Color(0xfff1e2ff), phase)
            UpgradeText(actionLabel, Modifier.weight(1f), MaterialTheme.typography.labelLarge, if (gold) Color(0xff2b1906) else Color.White)
        }
    }
}

/** The account action shares the website's purple/gold treatment without changing drawer buttons. */
@Composable private fun NativeAccountUpgradeButton(onClick: () -> Unit, label: String) {
    val phase = rememberUpgradeGlowPhase()
    val gold = LocalEveningTheme.current && LocalDarkPalette.current == "violet"
    androidx.compose.material3.Surface(onClick = onClick, shape = AffairsLayout.shape,
        color = if (gold) Color(0xffe9c66f) else Color(0xff573285), contentColor = if (gold) Color(0xff2b1906) else Color(0xfffff2ce),
        border = BorderStroke(1.dp, Color(0xffd7b56b)),
        modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp)
            .shadow(12.dp, AffairsLayout.shape, clip = false,
                ambientColor = (if(gold)Color(0xffe7b74a) else Color(0xff713ca8)).copy(alpha = .26f),
                spotColor = (if(gold)Color(0xffe7b74a) else Color(0xffbd85ed)).copy(alpha = phase * .35f))
            .testTag("settings-compare-plans").semantics { contentDescription = label; role = Role.Button }) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            UpgradeVectorMark(Modifier.size(20.dp), if(gold)Color(0xff593506) else Color(0xfff2d38b), phase)
            UpgradeText(label, style = MaterialTheme.typography.labelLarge, color = if (gold) Color(0xff2b1906) else Color(0xfffff2ce))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeAccountPlanHeader(modifier: Modifier = Modifier) {
    val openUpgrade = LocalNativeUpgrade.current ?: return
    val access = LocalFeatureAccess.current
    val plan = access.currentPlan()
    val trialCopy = rememberTrialCopy()
    val planLabel = if (access.trialActive()) requireNotNull(access.trial?.label) else nativePlanName(plan)
    val en = LocalGenesisLanguage.current == "en"
    val free = plan == "free"
    FlowRow(modifier.fillMaxWidth().testTag("settings-billing-plan"),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
        verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically,
        maxItemsInEachRow = 2) {
        UpgradeText((if (en) "Current plan: " else "Ваш тариф: ") + planLabel,
            Modifier.weight(1f).widthIn(min = 120.dp).testTag("settings-current-plan"), MaterialTheme.typography.titleSmall)
        val actionLabel = if (access.trialNeedsPayment()) trialCopy.getString("payment") else if (free) {
            if (en) "Unlock more features" else genesisTranslate("Подключить больше функций")
        } else if (en) "Compare plans" else genesisTranslate("Сравнить тарифы")
        NativeAccountUpgradeButton({ openUpgrade(null) }, actionLabel)
    }
}

private val featureNames = linkedMapOf(
    "calendar-sync" to "Google Calendar и Tasks - синхронизация", "calendar" to "Три календаря", "tasks" to "Личные задачи", "habits" to "Привычки", "trackers" to "Сон и настроение",
    "dream-journal" to "Дневник снов с текстовым вводом", "dream-voice" to "Дневник снов с голосовым помощником",
    "dark-palettes" to "Дополнительные тёмные палитры", "habit-timer" to "Таймер привычек", "diary" to "Дневник", "mindmaps" to "Майндмепы", "stoicheion" to "Гадание на 1 карте",
    "stoicheion-timeline" to "Гадание на 3 картах", "stoicheion-spread" to "Гадание на 9 картах и разрешение ситуации",
    "future-modeling" to "Метод моделирования будущего", "stoicheion-letters" to "Буквы и их значения", "theokyklos" to "Теокиклос",
    "shared-projects" to "Общие проекты", "messenger" to "Личные сообщения", "automations" to "Автоматизации",
    "data-export" to "Экспорт данных", "physis" to "Фюзис и другие новые функции (доступны на сайте)")
private val quotaNames = linkedMapOf("personal-projects" to "Личные проекты", "habits" to "Привычки",
    "mindmaps" to "Личные майндмепы", "diary" to "Записи дневника", "shared-projects" to "Общие проекты", "shared-mindmaps" to "Общие майндмепы")
private val featureNamesEn = mapOf("calendar" to "Three calendars", "tasks" to "Personal tasks", "habits" to "Habits", "trackers" to "Sleep and mood",
    "habit-timer" to "Habit timer", "diary" to "Diary", "mindmaps" to "Mind maps", "stoicheion" to "Stoicheion: 1 and 9 cards",
    "stoicheion-timeline" to "Stoicheion: 3 cards and timeline", "theokyklos" to "Theokyklos", "theokyklos-olympians" to "Olympians and sacred numbers",
    "advice-settings" to "Smart advice and categories", "shared-projects" to "Shared projects", "messenger" to "Private messages", "automations" to "Automations",
    "calendar-sync" to "Google Calendar and Google Tasks", "physis" to "Physis", "data-export" to "Data export")
private val quotaNamesEn = mapOf("personal-projects" to "Personal projects", "habits" to "Habits",
    "mindmaps" to "Personal mind maps", "diary" to "Diary entries", "shared-projects" to "Shared projects", "shared-mindmaps" to "Shared mind maps")
private fun planAllows(policy: JSONObject?, plan: String, feature: String): Boolean = policy != null &&
    feature !in policy.optJSONArray("disabledFeatures").strings() &&
    (plan == "premium4life" && policy.optJSONObject("features")?.has(feature) == true ||
        plan in policy.optJSONObject("features")?.optJSONArray(feature).strings())

internal data class NativeBillingFeatureRow(val feature: String, val label: String, val included: Boolean)
private val featureCopyKeys = mapOf("calendar-sync" to "googleSync", "stoicheion" to "oneCard",
    "stoicheion-timeline" to "threeCards", "stoicheion-spread" to "nineCards", "future-modeling" to "futureModeling",
    "stoicheion-letters" to "letters", "physis" to "physis",
    "dream-journal" to "dreamJournal", "dream-voice" to "dreamVoice", "dark-palettes" to "darkPalettes")
internal fun nativeBillingPlanFeatureRows(policy: JSONObject?, plan: String, language: String,
    featureCopy: JSONObject): List<NativeBillingFeatureRow> {
    if (policy == null) return emptyList()
    return featureNames.map { (key, label) ->
        NativeBillingFeatureRow(key, featureCopyKeys[key]?.let(featureCopy::getString)
            ?: if (language == "en") featureNamesEn.getValue(key) else label, planAllows(policy, plan, key))
    }
}

private fun suggestedPlan(policy: JSONObject?, access: FeatureAccess, feature: String?): String {
    val currentPlan = access.currentPlan()
    if (currentPlan == "premium4life") return "premium4life"
    if (feature == null && (access.trialActive() || access.trialNeedsPayment()))
        access.trial?.plan?.takeIf { it in nativeBillingPlans }?.let { return it }
    val current = nativeBillingPlans.indexOf(currentPlan).coerceAtLeast(0)
    return nativeBillingPlans.drop(current + 1).firstOrNull { plan ->
        if (feature in quotaNames) {
            val quotas = policy?.optJSONObject("limits") ?: return@firstOrNull false
            val currentLimit = quotas.optJSONObject(currentPlan)?.optInt(feature) ?: return@firstOrNull false
            val candidate = quotas.optJSONObject(if (plan == "premium4life") "business" else plan)
            candidate?.has(feature) == true && (candidate.isNull(feature) || candidate.optInt(feature) > currentLimit)
        } else feature == null || planAllows(policy, plan, feature)
    } ?: access.declaredPlan.takeIf { it in nativeBillingPlans } ?: "standart"
}

internal fun nativeBillingSettlementCopyKey(order: JSONObject?): String? {
    if (order == null) return null
    val settlement = order.optJSONObject("settlement")
    if (settlement != null) return when (settlement.optString("status")) {
        "verifying" -> "settlementVerifying"
        "refund-required", "refund-pending" -> "settlementRefundPending"
        "failed" -> "settlementFailed"
        "refunded" -> "settlementRefunded"
        "cancelled" -> "settlementCancelled"
        else -> "settlementFailed"
    }
    return when (order.optString("status")) {
            "paid" -> "paymentPaid"
            "refunded" -> "settlementRefunded"
            "cancelled" -> "settlementCancelled"
            "failed" -> "settlementFailed"
            "pending" -> "paymentPending"
            "payment-verifying", "settlement-required" -> "settlementVerifying"
            else -> "settlementFailed"
    }
}

internal fun nativeBillingShouldPoll(order: JSONObject): Boolean = nativeBillingSettlementCopyKey(order) in
    setOf("paymentPending", "settlementVerifying", "settlementRefundPending")

internal data class NativeBillingQuote(val amount: Long, val list: Long, val credit: Long,
    val currency: String, val providers: List<String>, val validUntil: Instant?,
    val unavailableReason: String?, val recommendedPeriodMonths: Int?, val settlementOrderId: String? = null) {
    companion object {
        fun read(source: JSONObject, offer: JSONObject): NativeBillingQuote {
            require(source.getString("offerId") == offer.getString("id") && source.getString("plan") == offer.getString("plan") &&
                source.getInt("periodMonths") == offer.getInt("periodMonths"))
            fun minor(key: String): Long {
                val raw = source.get(key); require(raw is Int || raw is Long)
                return (raw as Number).toLong().also { require(it in 0L..9_007_199_254_740_991L) }
            }
            val amount = minor("amountMinor"); val list = minor("listAmountMinor"); val credit = minor("creditMinor")
            require(amount >= 0 && list >= amount && credit in 0..list && list - credit == amount)
            val pending = !source.isNull("pendingOrderId") && source.optString("pendingOrderId").isNotBlank()
            val currency = source.getString("currency"); require(currency.matches(Regex("[A-Z]{3}")) &&
                (pending || currency == offer.getString("currency") && list == offer.getLong("amountMinor")))
            return NativeBillingQuote(amount, list, credit, currency, source.optJSONArray("availableProviders").strings(),
                source.optString("validUntil").takeIf { !source.isNull("validUntil") && it.isNotBlank() }?.let(Instant::parse),
                source.optString("upgradeUnavailableReason").takeIf { !source.isNull("upgradeUnavailableReason") && it.isNotBlank() },
                source.optInt("recommendedPeriodMonths").takeIf { it in listOf(1, 12) },
                source.optString("settlementOrderId").takeIf { !source.isNull("settlementOrderId") && it.matches(Regex("[a-f0-9-]{36}")) })
        }
    }
}

@Composable internal fun NativeUpgradeDialog(controller: AuthController, userId: String, access: FeatureAccess,
    language: String, initialFeature: String? = null, open: Boolean = true, initialPlan: String? = null,
    onGuidanceVisibility: (Boolean) -> Unit = {}, onClose: () -> Unit) {
    val context = LocalContext.current; val activity = LocalActivity.current; val scope = rememberCoroutineScope()
    val en = language == "en"
    fun copy(ru: String, english: String) = if (en) english else ru
    val safetyCopy = remember(context, language) { context.assets.open("originals/i18n/billing-safety-copy.json")
        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(language) } }
    val featureCopy = remember(context, language) { context.assets.open("originals/i18n/billing-feature-copy.json")
        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(language) } }
    val bundledPolicy = remember(context) { runCatching { context.assets.open("originals/catalogs/feature-access-policy.json")
        .bufferedReader().use { JSONObject(it.readText()) } }.getOrNull() }
    var catalog by remember(userId) { mutableStateOf<JSONObject?>(null) }
    val policy = catalog?.optJSONObject("policy") ?: bundledPolicy
    var selected by rememberSaveable(userId) { mutableStateOf(initialPlan?.takeIf { it in nativeBillingPlans }
        ?: suggestedPlan(bundledPolicy, access, initialFeature)) }
    var expanded by rememberSaveable(userId) { mutableStateOf<String?>(selected) }
    var months by rememberSaveable(userId) { mutableIntStateOf(1) }
    var provider by rememberSaveable(userId) { mutableStateOf("") }
    var quoteProvider by remember { mutableStateOf("") }
    var quote by remember { mutableStateOf<NativeBillingQuote?>(null) }
    var quoteLoading by remember { mutableStateOf(false) }
    var quoteRefresh by remember { mutableIntStateOf(0) }
    var quoteChanged by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }; var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var serverNotice by remember { mutableStateOf<String?>(null) }
    var trialBusy by remember(userId) { mutableStateOf(false) }
    var trialError by remember(userId) { mutableStateOf<String?>(null) }
    val trialCopy = rememberTrialCopy()
    var observedOrderId by rememberSaveable(userId) { mutableStateOf<String?>(null) }
    var observedOrder by remember(userId) { mutableStateOf<JSONObject?>(null) }
    var orderRefresh by remember { mutableIntStateOf(0) }
    val billingLifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(billingLifecycle, userId, open, observedOrderId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && open && observedOrderId != null) orderRefresh++
        }
        billingLifecycle.addObserver(observer)
        onDispose { billingLifecycle.removeObserver(observer) }
    }
    val channel = if (BuildConfig.PLAY_DISTRIBUTION) "android-play" else "android"
    LaunchedEffect(open, initialFeature, initialPlan) {
        if (open) { selected = initialPlan?.takeIf { it in nativeBillingPlans } ?: suggestedPlan(policy, access, initialFeature); expanded = selected; quoteChanged = false }
    }
    LaunchedEffect(controller, userId, open) {
        if (!open) return@LaunchedEffect
        loading = true
        try { catalog = controller.billing("GET", "/billing/catalog?client=$channel") }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { catalog = null }
        finally { loading = false }
    }
    val offer = nativeBillingOffer(catalog, selected, months)
    val providerChoices = nativeBillingProviderChoices(catalog,offer,BuildConfig.PLAY_DISTRIBUTION)
    // Keep a still-valid manual choice when routing or plan data refreshes.
    LaunchedEffect(providerChoices) { if (provider !in providerChoices) provider = providerChoices.firstOrNull().orEmpty() }
    val selectedPrice = nativeBillingProviderPrice(offer,provider)
    val pricedOffer = if (offer != null && selectedPrice != null) JSONObject(offer.toString())
        .put("amountMinor", selectedPrice.first).put("currency", selectedPrice.second) else null
    LaunchedEffect(userId, pricedOffer?.toString(), provider, open, quoteRefresh) {
        quote = null; quoteProvider = ""; if (!open || pricedOffer == null || provider.isEmpty()) return@LaunchedEffect
        quoteLoading = true
        val requestedProvider = provider
        try {
            val response = controller.billing("GET", "/billing/quote?offerId=${Uri.encode(pricedOffer.getString("id"))}&client=$channel&provider=$requestedProvider")
            quote = NativeBillingQuote.read(response, pricedOffer); quoteProvider = requestedProvider
            quote?.settlementOrderId?.let { observedOrderId = it }
            if (!response.isNull("pendingOrderId")) response.optJSONArray("availableProviders").strings().singleOrNull()
                ?.takeIf { it in providerChoices && it != requestedProvider }?.let { provider = it }
        }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { quote = null }
        finally { quoteLoading = false }
    }
    LaunchedEffect(controller, userId, observedOrderId, open, orderRefresh) {
        val id = observedOrderId ?: return@LaunchedEffect
        if (!open || !id.matches(Regex("[a-f0-9-]{36}"))) return@LaunchedEffect
        repeat(20) {
            try {
                // Read-only status: neither a redirect nor the client grants access or initiates compensation.
                val order = controller.billing("GET", "/billing/orders/${Uri.encode(id)}")
                require(order.optString("id") == id) { "BILLING_ORDER_MISMATCH" }
                observedOrder = order
                if (!nativeBillingShouldPoll(order)) {
                    controller.checkSession(); quoteRefresh++; return@LaunchedEffect
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { return@LaunchedEffect }
            delay(3_000)
        }
    }
    val availableMethods = offer?.optJSONArray("availableProviders").strings().filter { it in providerChoices }
    val billing = remember(controller, userId) { GenesisPlayBilling(context, controller, scope, { controller.checkSession() }, { error = true }) }
    DisposableEffect(billing) { onDispose { billing.close() } }
    val canPay = !busy && !trialBusy && !quoteLoading && quote != null && quoteProvider == provider && !access.lifetimePremium && selected != "free" &&
        catalog?.optBoolean("checkoutEnabled") == true && provider in availableMethods && provider in quote!!.providers &&
        (quote!!.credit == 0L || catalog?.optBoolean("creditCheckoutEnabled") == true) &&
        observedOrder?.optString("status") !in setOf("payment-verifying", "settlement-required") &&
        quote!!.unavailableReason == null && quote!!.currency == selectedPrice?.second && (provider != "google-play" || activity != null)
    val unavailableText = quote?.unavailableReason?.let { reason -> when (reason) {
        "shorter-period" -> copy("Для перехода с действующего годового тарифа выберите год.", "Choose a yearly period to upgrade an active yearly plan.")
        "upgrade-pending" -> copy("Переход уже ожидает подтверждения. Дождитесь его завершения.", "A plan change is already awaiting confirmation. Please wait for it to finish.")
        "already-lifetime" -> copy("Пожизненный доступ уже подключён.", "Lifetime access is already active.")
        "credit-covers-price" -> copy("Остаток покрывает цену этого срока. Переход с нулевой доплатой пока недоступен; выберите другой срок.", "Your credit covers this period. A change with no additional payment is currently unavailable; choose another period.")
        "lifetime-credit-unavailable" -> safetyCopy.getString("lifetimeCreditUnavailable")
        "credit-currency-unavailable" -> safetyCopy.getString("currencyCreditUnavailable")
        "credit-source-unverified" -> safetyCopy.getString("creditSourceUnverified")
        "credit-checkout-unavailable" -> safetyCopy.getString("creditCheckoutUnavailable")
        "settlement-required" -> safetyCopy.getString("settlementRequired")
        else -> copy("Этот переход пока недоступен. Выберите другой тариф или срок.", "This change is currently unavailable. Choose another plan or period.")
    } }
    val paymentAvailabilityText = unavailableText ?: when {
        loading -> null
        catalog == null -> copy("Не удалось загрузить способы оплаты. Проверьте подключение и откройте окно снова.", "Could not load payment methods. Check your connection and open this window again.")
        quote == null && !quoteLoading && offer != null -> safetyCopy.getString("quoteError")
        BuildConfig.PLAY_DISTRIBUTION && (quote?.credit ?: 0L) > 0L -> copy("Перерасчёт суммы пока недоступен в Google Play.", "Prorated payments are currently unavailable through Google Play.")
        catalog?.optBoolean("checkoutEnabled") != true -> copy("Оплата пока не подключена. Списаний не будет.", "Payments are not connected yet. No payment can be taken.")
        provider !in availableMethods -> copy("Для выбранного перехода пока нет доступного способа оплаты.", "There is currently no payment method for this plan change.")
        else -> null
    }
    // Keep Play receipt verification alive when only the comparison is dismissed.
    if (!open) return
    MaterialTheme(colorScheme = upgradeScheme, typography = GenesisTypography, shapes = GenesisShapes) {
        CompositionLocalProvider(LocalGenesisLanguage provides language) {
            Dialog(onDismissRequest = { if (!busy) onClose() }) {
                GenesisModalFrame({ if (!busy) onClose() }) {
                    Column(Modifier.fillMaxWidth().testTag("native-upgrade-dialog")
                        .planGuidanceVisibility("$userId:comparison", onGuidanceVisibility)) {
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp, end = 8.dp, bottom = 12.dp), verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                UpgradeText(copy("Больше возможностей", "More possibilities"), style = MaterialTheme.typography.headlineSmall)
                                UpgradeText(copy("Ваш тариф: ", "Current plan: ") + (if (access.trialActive())
                                    requireNotNull(access.trial?.label) else nativePlanName(access.currentPlan())),
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            AffairsIconButton("Закрыть", AffairsAction.CLOSE, onClose, enabled = !busy, outlined = false,
                                contentColor = MaterialTheme.colorScheme.onSurface, modifier = Modifier.testTag("native-upgrade-close"))
                        }
                        HorizontalDivider(color = upgradeScheme.outlineVariant)
                        Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf(1, 12).forEach { period ->
                                    OutlinedButton({ months = period; quoteChanged = false }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("billing-period-$period")
                                        .semantics { this.selected = months == period }, enabled = !busy, selected = months == period,
                                        colors = ButtonDefaults.outlinedButtonColors(containerColor = if (months == period) upgradeScheme.primaryContainer else Color.Transparent)) {
                                        UpgradeText(if (period == 1) copy("Месяц", "Monthly") else copy("Год", "Yearly"), style = MaterialTheme.typography.labelLarge)
                                    }
                                }
                            }
                            UpgradeText(copy("Выберите тариф, чтобы посмотреть его возможности.", "Choose a plan to see its features."),
                                style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant)
                            NativeTrialPanel(access,
                                runCatching { ru.genesis.calendar.auth.TrialAccess.fromJson(catalog?.optJSONObject("trial")) }.getOrNull(),
                                trialCopy, busy || trialBusy || loading, trialError,
                                onStart = { plan ->
                                    if (!busy && !trialBusy) scope.launch {
                                        trialBusy = true; trialError = null
                                        try {
                                            controller.startTrial(plan)
                                            selected = plan; expanded = plan
                                        } catch (cancelled: CancellationException) { throw cancelled }
                                        catch (failure: Exception) {
                                            trialError = if (failure.message == "TRIAL_ALREADY_USED") "alreadyUsed" else "startFailed"
                                            controller.refreshTrialAccess()
                                        } finally { trialBusy = false }
                                    }
                                }, onRefresh = { controller.refreshTrialAccess() }, starting = trialBusy, checking = loading)
                            nativeBillingPlans.forEach { plan ->
                                val tierOffer = nativeBillingOffer(catalog, plan, months)
                                NativeUpgradeTier(plan, months, selected == plan, expanded == plan,
                                    access.source != "trial" && (access.lifetimePremium && plan == "premium4life" ||
                                        !access.lifetimePremium && access.currentPlan() == plan),
                                    policy, language, featureCopy, !busy, nativeBillingProviderPrice(tierOffer,provider)) {
                                    expanded = if (expanded == plan) null else plan; selected = plan; error = false; quoteChanged = false
                                }
                            }
                            if (selected == "premium4life") catalog?.optJSONObject("lifetimeSeats")?.let { seats ->
                                if (seats.has("remaining")) UpgradeText(copy("Осталось мест: ", "Places remaining: ") + seats.optInt("remaining"),
                                    style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant)
                            }
                            if (loading) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                            if (selected != "free" && !access.lifetimePremium) {
                                HorizontalDivider(color = upgradeScheme.outlineVariant)
                                if (providerChoices.isNotEmpty()) {
                                    UpgradeText(copy("Способ оплаты", "Payment method"), style = MaterialTheme.typography.titleSmall)
                                    providerChoices.forEach { method ->
                                        val methodName = when (method) { "google-play" -> "Google Play"; "yookassa" -> "ЮKassa"; else -> "Lemon Squeezy" }
                                        androidx.compose.material3.Surface(onClick = { provider = method }, enabled = !busy, shape = AffairsLayout.shape,
                                            color = selectedControlContainer(provider == method,!busy),
                                            border = selectedControlBorder(provider == method,!busy),
                                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { role = Role.RadioButton; this.selected = provider == method }) {
                                            Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                                RadioButton(provider == method, null, enabled = !busy); Spacer(Modifier.width(8.dp)); UpgradeText(methodName)
                                            }
                                        }
                                    }
                                }
                                if (provider == "lemon-squeezy" && catalog?.optJSONObject("foreignPricing")?.optString("pricingModel") != "fixed") catalog?.optJSONObject("foreignPricing")?.optJSONObject("rate")?.let { rate ->
                                    UpgradeText("1 USD = ${rate.optString("quotePerBase")} RUB · ${rate.optString("effectiveDate")}",
                                        style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant)
                                }
                                if (quoteLoading) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                                quote?.let { total ->
                                    if (total.credit > 0L) {
                                        UpgradeText(copy("Стоимость тарифа: ", "Plan price: ") + nativeBillingMoney(total.list, language, total.currency))
                                        UpgradeText(copy("Зачёт оплаченного остатка: −", "Unused paid period credit: −") + nativeBillingMoney(total.credit, language, total.currency), color = upgradeScheme.primary)
                                    }
                                    UpgradeText(copy("К оплате: ", "Total: ") + nativeBillingMoney(total.amount, language, total.currency), style = MaterialTheme.typography.titleMedium)
                                    total.validUntil?.let { expiry -> UpgradeText(copy("Новый срок доступа до: ", "New access period ends: ") +
                                        expiry.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag(language))),
                                        style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant) }
                                }
                                if (BuildConfig.PLAY_DISTRIBUTION && (quote?.credit ?: 0L) > 0L) UpgradeText(
                                    copy("Перерасчёт суммы пока недоступен в Google Play.", "Prorated payments are currently unavailable through Google Play."),
                                    style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant)
                                UpgradeText(if (loading) copy("Загружаем способы оплаты…", "Loading payment methods…")
                                    else if (catalog == null) copy("Не удалось загрузить способы оплаты. Проверьте подключение и откройте окно снова.", "Could not load payment methods. Check your connection and open this window again.")
                                    else if (catalog?.optBoolean("checkoutEnabled") != true)
                                    copy("Оплата пока не подключена. Списаний не будет.", "Payments are not connected yet. No payment can be taken.")
                                    else if (provider !in availableMethods) copy("Для выбранного перехода пока нет доступного способа оплаты.", "There is currently no payment method for this plan change.")
                                    else if (quote == null) copy("Итоговую сумму подтвердит платёжная система. Доступ изменится после подтверждения оплаты.", "The payment provider will confirm the final total. Access changes after verified payment.")
                                    else copy("Перерасчёт выполнен сервером по оставшемуся оплаченному сроку. Доступ изменится после подтверждения оплаты.", "The server calculated credit from the remaining paid period. Access changes after verified payment."),
                                    style = MaterialTheme.typography.bodySmall, color = upgradeScheme.onSurfaceVariant)
                            }
                            if (error) UpgradeText(copy("Не удалось проверить оплату. Проверьте соединение и повторите попытку. Ваш доступ не изменился.",
                                "Could not verify payment. Check your connection and try again. Your access has not changed."), color = upgradeScheme.error)
                            if (BuildConfig.PLAY_DISTRIBUTION) TextButton({ scope.launch {
                                try { billing.restore() } catch (cancel: CancellationException) { throw cancel } catch (_: Exception) { error = true }
                            } }, Modifier.heightIn(min = 48.dp), enabled = !busy && catalog?.optBoolean("checkoutEnabled") == true) {
                                UpgradeText(copy("Восстановить покупки", "Restore purchases"), color = upgradeScheme.primary)
                            }
                        }
                        if (selected != "free" && !access.lifetimePremium) {
                            HorizontalDivider(color = upgradeScheme.outlineVariant)
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                UpgradeText(copy("К оплате", "Total"), Modifier.weight(1f), MaterialTheme.typography.bodySmall, upgradeScheme.onSurfaceVariant)
                                UpgradeText(if (quoteLoading) copy("Расчёт…", "Calculating…") else quote?.let { nativeBillingMoney(it.amount, language, it.currency) }
                                    ?: selectedPrice?.let { nativeBillingMoney(it.first, language, it.second) } ?: "—",
                                    style = MaterialTheme.typography.titleMedium)
                            }
                            if (paymentAvailabilityText != null) UpgradeText(paymentAvailabilityText, style = MaterialTheme.typography.bodySmall,
                                color = upgradeScheme.onSurfaceVariant, modifier = Modifier.testTag("billing-upgrade-unavailable"))
                            nativeBillingSettlementCopyKey(observedOrder)?.let { key ->
                                UpgradeText(safetyCopy.getString(key), style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.testTag("billing-settlement-status").semantics { liveRegion = LiveRegionMode.Polite })
                                TextButton({ orderRefresh++ }, Modifier.heightIn(min = 48.dp), enabled = !busy) {
                                    UpgradeText(genesisTranslate("Обновить"), color = upgradeScheme.primary)
                                }
                            }
                            serverNotice?.let { key -> UpgradeText(safetyCopy.getString(key), style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                            if (quote?.unavailableReason == "shorter-period" && quote?.recommendedPeriodMonths == 12 && months != 12) {
                                TextButton({ months = 12; quoteChanged = false }, Modifier.heightIn(min = 48.dp).testTag("billing-use-year"), enabled = !busy) {
                                    UpgradeText(copy("Выбрать год", "Choose yearly"), color = upgradeScheme.primary)
                                }
                            }
                            if (quoteChanged) UpgradeText(copy("Сумма обновилась. Проверьте новый расчёт и подтвердите оплату ещё раз.", "The total changed. Review the new quote and confirm payment again."),
                                style = MaterialTheme.typography.bodySmall, color = upgradeScheme.primary,
                                modifier = Modifier.testTag("billing-quote-changed").semantics { liveRegion = LiveRegionMode.Polite })
                            Button({ scope.launch {
                                if (!canPay) return@launch
                                busy = true; error = false; quoteChanged = false; serverNotice = null
                                try {
                                    val order = controller.billing("POST", "/billing/orders", JSONObject().put("offerId", requireNotNull(offer).getString("id"))
                                        .put("expectedAmountMinor", requireNotNull(quote).amount)
                                        .put("expectedCurrency", requireNotNull(quote).currency)
                                        .put("provider", provider).put("client", channel).put("idempotencyKey", UUID.randomUUID().toString()))
                                    observedOrder = order
                                    observedOrderId = order.optString("id").takeIf { it.matches(Regex("[a-f0-9-]{36}")) }
                                    if (order.optJSONObject("settlement") != null || order.optString("status") != "pending") {
                                        serverNotice = nativeBillingSettlementCopyKey(order)
                                    } else if (provider == "google-play") billing.purchase(requireNotNull(activity), order)
                                    else {
                                        require(!BuildConfig.PLAY_DISTRIBUTION)
                                        val uri = Uri.parse(order.getString("checkoutUrl")); require(uri.scheme == "https" && !uri.host.isNullOrBlank())
                                        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                    }
                                } catch (cancel: CancellationException) { throw cancel }
                                catch (failure: Exception) {
                                    if (failure.message == "BILLING_QUOTE_CHANGED") { quoteChanged = true; quoteLoading = true; quoteRefresh++ }
                                    else if (failure.message == "BILLING_CREDIT_CHECKOUT_DISABLED") { serverNotice = "creditCheckoutUnavailable"; quoteRefresh++ }
                                    else if (failure.message == "BILLING_SETTLEMENT_REQUIRED") { serverNotice = "settlementRequired"; quoteRefresh++ }
                                    else error = true
                                }
                                finally { busy = false }
                            } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("billing-checkout"), enabled = canPay) {
                                UpgradeText(if (busy) copy("Подготавливаем оплату…", "Preparing payment…") else copy("Перейти к оплате", "Continue to payment"),
                                    color = if (canPay) upgradeScheme.onPrimary else upgradeScheme.onSurfaceVariant)
                            }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun NativeBillingFeatureLine(row: NativeBillingFeatureRow, featureCopy: JSONObject) {
    Row(Modifier.testTag("billing-feature-${row.feature}")
                        .semantics(mergeDescendants = true) { stateDescription = featureCopy.getString(if (row.included) "included" else "excluded") },
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GenesisLucideIcon(if (row.included) "check" else "x", Modifier.size(18.dp), tint = if (row.included) Color(0xfff4e4ff) else Color(0xffff8a94))
                        UpgradeText(row.label, Modifier.weight(1f), MaterialTheme.typography.bodySmall, Color(0xfff7eaff))
                    }
}

@Composable internal fun NativeUpgradeTier(plan: String, months: Int, selected: Boolean, expanded: Boolean, current: Boolean,
    policy: JSONObject?, language: String, featureCopy: JSONObject, enabled: Boolean, displayPrice: Pair<Long,String>?, onClick: () -> Unit) {
    val en = language == "en"
    val tint = when (plan) { "free" -> Color(0xff373268); "standart" -> Color(0xff6623a1); "premium" -> Color(0xff8c245f); "business" -> Color(0xff3e42a8); else -> Color(0xff6c286e) }
    androidx.compose.material3.Surface(onClick = onClick, enabled = enabled, shape = AffairsLayout.shape,
        color = tint.copy(alpha = if (selected) 1f else .48f), contentColor = Color.White,
        border = if (selected) BorderStroke(if (enabled) 2.dp else 1.dp, Color(0xffead5ff).copy(alpha = if (enabled) 1f else .38f)) else null,
        modifier = Modifier.fillMaxWidth().testTag("billing-tier-$plan").semantics { role = Role.Button; this.selected = selected; stateDescription = featureCopy.getString(if (expanded) "expanded" else "collapsed") }) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    UpgradeText(nativePlanName(plan), style = MaterialTheme.typography.titleMedium, color = Color.White)
                    if (current) UpgradeText(if (en) "Current plan" else "Ваш тариф", style = MaterialTheme.typography.labelSmall, color = Color(0xffecd9ff))
                }
                Column(horizontalAlignment = Alignment.End) {
                    UpgradeText(nativeBillingMoney(displayPrice?.first ?: nativePlanListAmount(plan, months), language, displayPrice?.second ?: "RUB"), style = MaterialTheme.typography.titleMedium, color = Color.White)
                    UpgradeText(when (plan) { "free" -> if (en) "free" else "бесплатно"; "premium4life" -> if (en) "one payment" else "один раз"; else -> if (months == 12) (if (en) "per year" else "за год") else (if (en) "per month" else "за месяц") },
                        style = MaterialTheme.typography.labelSmall, color = Color(0xffecd9ff))
                }
                GenesisLucideIcon(if (expanded) "chevron-up" else "chevron-down", Modifier.size(20.dp), tint = Color(0xffecd9ff))
            }
            if (expanded) {
                val featureRows = nativeBillingPlanFeatureRows(policy, plan, language, featureCopy)
                val limits = policy?.optJSONObject("limits")?.optJSONObject(if (plan == "premium4life") "business" else plan)
                quotaNames.forEach { (key, label) -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    UpgradeText(if (en) quotaNamesEn.getValue(key) else label, Modifier.weight(1f), MaterialTheme.typography.bodySmall, Color(0xfff7eaff))
                    UpgradeText(if (limits == null) "—" else if (!limits.has(key)) "0" else if (limits.isNull(key)) (if (en) "Unlimited" else "Без ограничений") else limits.optInt(key).toString(),
                        style = MaterialTheme.typography.labelLarge, color = Color.White)
                } }
                if (plan in setOf("business", "premium4life")) UpgradeText(if (en)
                    "100 top-level shared projects across all workspaces you own. Projects created by invited members use the owner's allowance. Subprojects are unlimited."
                else "100 общих проектов первого уровня на все ваши пространства. Проекты приглашённых участников используют лимит владельца. Подпроекты не ограничены.",
                    style = MaterialTheme.typography.bodySmall, color = Color(0xfff7eaff))
                if (policy == null) UpgradeText(if (en) "Feature details will load when connected." else "Состав возможностей загрузится после подключения.",
                    style = MaterialTheme.typography.bodySmall, color = Color(0xfff7eaff))
                else {
                    HorizontalDivider(color = Color.White.copy(alpha = .24f))
                    featureRows.forEach { row -> NativeBillingFeatureLine(row,featureCopy) }
                    if (plan == "premium4life") UpgradeText(if (en) "All features, including future additions. Lifetime access." else "Все функции, включая будущие нововведения. Пожизненный доступ.",
                        style = MaterialTheme.typography.bodyMedium, color = Color.White)
                }
            }
        }
    }
}
