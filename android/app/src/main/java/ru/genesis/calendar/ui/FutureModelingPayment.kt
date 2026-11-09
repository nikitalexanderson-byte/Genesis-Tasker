package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthApiError
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import java.util.UUID

@Composable private fun modelingServiceJson(path: String): JSONObject {
    val context = LocalContext.current
    return remember(context, path) { context.assets.open("originals/$path").bufferedReader().use { JSONObject(it.readText()) } }
}

@Composable internal fun modelingServiceCopy(): JSONObject =
    modelingServiceJson("i18n/modeling-service-copy.json").getJSONObject(LocalGenesisLanguage.current)

private fun modelingMoney(minor: Int, currency: String, language: String): String =
    NumberFormat.getCurrencyInstance(Locale.forLanguageTag(language)).apply {
        this.currency = Currency.getInstance(currency)
        maximumFractionDigits = if (minor % 100 == 0) 0 else 2
        minimumFractionDigits = maximumFractionDigits
    }.format(minor / 100.0)

@Composable internal fun FutureModelingPrice() {
    val language = LocalGenesisLanguage.current
    val copy = modelingServiceJson("i18n/modeling-service-copy.json").getJSONObject(language)
    val prices = modelingServiceJson("catalogs/modeling-service.json").getJSONObject("prices")
    Column(Modifier.fillMaxWidth().testTag("modeling-service-price"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        HorizontalDivider()
        UntranslatedText(copy.getString("title"), style = MaterialTheme.typography.titleSmall)
        UntranslatedText(modelingMoney(prices.getInt("RUB"), "RUB", language) + " / " + modelingMoney(prices.getInt("USD"), "USD", language),
            style = MaterialTheme.typography.titleMedium)
        UntranslatedText(copy.getString("description"), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
    }
}

/** Used only on the final page of a completed method with an immutable server result ID. */
@Composable internal fun FutureModelingPayment(controller: AuthController, resultId: String, onUnlocked: (JSONObject) -> Unit) {
    val language = LocalGenesisLanguage.current
    val copy = modelingServiceJson("i18n/modeling-service-copy.json").getJSONObject(language)
    val prices = modelingServiceJson("catalogs/modeling-service.json").getJSONObject("prices")
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val unlock by rememberUpdatedState(onUnlocked)
    var methods by remember(resultId) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var elitePlus by remember(resultId) { mutableStateOf(false) }
    var provider by remember(resultId) { mutableStateOf<String?>(null) }
    var orderId by rememberSaveable(resultId) { mutableStateOf<String?>(null) }
    val idempotencyKey = rememberSaveable(resultId) { UUID.randomUUID().toString() }
    var order by remember(resultId) { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val client = if (BuildConfig.PLAY_DISTRIBUTION) "android-play" else "android"
    fun validMethod(method: JSONObject): Boolean {
        val currency = if (method.optString("provider") == "yookassa") "RUB" else "USD"
        return method.optString("provider") in setOf("yookassa", "lemon-squeezy") && method.optBoolean("available") &&
            method.optString("currency") == currency && method.optInt("amountMinor") == prices.getInt(currency)
    }
    suspend fun openResult() {
        val result = controller.billing("GET", "/billing/modeling/results/$resultId")
        require(result.getString("id") == resultId)
        message = copy.getString(if (elitePlus) "privileged" else "paid")
        unlock(result)
    }
    suspend fun checkPayment() {
        val id = orderId ?: return
        val fresh = controller.billing("GET", "/billing/modeling/orders/$id")
        require(fresh.getString("id") == id && fresh.getString("resultId") == resultId)
        order = fresh
        if (fresh.getString("status") == "paid") {
            openResult()
        } else message = copy.getString(if (fresh.getString("status") == "pending") "pending" else "unavailable")
    }
    LaunchedEffect(controller, resultId) {
        try {
            val catalog = controller.billing("GET", "/billing/modeling/catalog?client=$client")
            elitePlus = catalog.optBoolean("forecastElitePlus")
            val values = catalog.getJSONArray("methods")
            methods = (0 until values.length()).map(values::getJSONObject).filter(::validMethod)
            provider = methods.firstOrNull { it.getString("provider") == catalog.getJSONObject("routing").getString("preferredProvider") }
                ?.getString("provider") ?: methods.firstOrNull()?.getString("provider")
            checkPayment()
        } catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { message = copy.getString("error") }
    }
    DisposableEffect(lifecycle, controller, resultId, orderId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && orderId != null && !busy) scope.launch {
                busy = true
                try { checkPayment() } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { message = copy.getString("error") } finally { busy = false }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    Column(Modifier.fillMaxWidth().testTag("modeling-service-checkout"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (elitePlus) UntranslatedText(copy.getString("privileged"), color = MaterialTheme.colorScheme.primary)
        else FutureModelingPrice()
        (if (elitePlus) emptyList() else methods).forEach { method ->
            val id = method.getString("provider")
            FilterChip(selected = provider == id, onClick = { if (!busy && orderId == null) provider = id },
                enabled = !busy && orderId == null, label = {
                    UntranslatedText((if (id == "yookassa") "ЮKassa" else "Lemon Squeezy") + " · " +
                        modelingMoney(method.getInt("amountMinor"), method.getString("currency"), language))
                }, modifier = Modifier.heightIn(min = 48.dp))
        }
        Button(onClick = {
            val selected = methods.firstOrNull { it.getString("provider") == provider }
            if (!elitePlus && selected == null) return@Button
            if (!busy) scope.launch {
                busy = true; message = null
                try {
                    if (elitePlus) { openResult(); return@launch }
                    requireNotNull(selected)
                    val fresh = controller.billing("POST", "/billing/modeling/orders", JSONObject().put("resultId", resultId)
                        .put("provider", selected.getString("provider")).put("client", client).put("idempotencyKey", idempotencyKey))
                    require(fresh.getString("resultId") == resultId && fresh.getInt("amountMinor") == selected.getInt("amountMinor")
                        && fresh.getString("currency") == selected.getString("currency"))
                    orderId = fresh.getString("id"); order = fresh
                    if (fresh.getString("status") == "paid") checkPayment()
                    else if (!fresh.isNull("checkoutUrl")) {
                        val uri = Uri.parse(fresh.getString("checkoutUrl")); val host = uri.host.orEmpty()
                        val allowed = if (selected.getString("provider") == "yookassa") host in setOf("yoomoney.ru", "yookassa.ru")
                            else host == "lemonsqueezy.com" || host.endsWith(".lemonsqueezy.com")
                        require(uri.scheme == "https" && allowed && uri.userInfo == null && uri.port == -1)
                        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } else message = copy.getString("pending")
                } catch (cancel: CancellationException) { throw cancel }
                catch (error: AuthApiError) {
                    if (error.code == "MODELING_PAYMENT_NOT_REQUIRED") {
                        elitePlus = true
                        try { openResult() } catch (cancel: CancellationException) { throw cancel }
                        catch (_: Exception) { message = copy.getString("error") }
                    } else message = copy.getString("error")
                }
                catch (_: Exception) { message = copy.getString("error") } finally { busy = false }
            }
        }, enabled = (elitePlus || provider != null) && !busy && order?.optString("status") != "paid",
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("modeling-service-pay")) { UntranslatedText(copy.getString(if (elitePlus) "open" else "pay")) }
        if (!elitePlus && methods.isEmpty()) UntranslatedText(copy.getString("unavailable"), style = MaterialTheme.typography.bodySmall)
        if (orderId != null) OutlinedButton(onClick = { if (!busy) scope.launch {
            busy = true
            try { checkPayment() } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { message = copy.getString("error") } finally { busy = false }
        } }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { UntranslatedText(copy.getString("check")) }
        message?.let { UntranslatedText(it, style = MaterialTheme.typography.bodyMedium) }
    }
}
