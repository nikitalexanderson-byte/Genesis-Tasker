package ru.genesis.calendar.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding

import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.BuildConfig
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayOutputStream
import java.util.Locale

internal data class NativeAd(val id: String, val title: String, val description: String,
    val imageUrl: String, val linkUrl: String, val repeatHours: Int, val targetVersionCode: Int? = null) {
    val isUpdate: Boolean get() = targetVersionCode != null
    fun canShow(installedVersionCode: Int, dismissed: Boolean, lastShown: Long, now: Long): Boolean =
        targetVersionCode?.let { it > installedVersionCode }
            ?: (!dismissed && (lastShown == 0L || now - lastShown >= repeatHours * 3_600_000L))
    fun destination(playDistribution: Boolean): String = if (isUpdate && playDistribution)
        "https://play.google.com/store/apps/details?id=ru.genesis.calendar" else linkUrl
    companion object {
        fun fromJson(value: JSONObject) = NativeAd(value.getString("id"), value.getString("title"),
            value.getString("description"), value.getString("imageUrl"),
            value.getString("linkUrl"), value.getInt("repeatHours"),
            value.optInt("targetVersionCode").takeIf { value.optString("kind") == "android-update" && it > 0 })
    }
}

private data class AdCopy(val label: String, val open: String, val close: String, val wait: String, val unit: String)
private val adCopy = mapOf(
    "ru" to AdCopy("Реклама", "Подробнее", "Закрыть", "Закрыть через", "с"),
    "en" to AdCopy("Advertisement", "Learn more", "Close", "Close in", "s"),
    "el" to AdCopy("Διαφήμιση", "Περισσότερα", "Κλείσιμο", "Κλείσιμο σε", "δ."),
    "de" to AdCopy("Anzeige", "Mehr erfahren", "Schließen", "Schließen in", "s"),
    "fr" to AdCopy("Publicité", "En savoir plus", "Fermer", "Fermer dans", "s"),
    "es" to AdCopy("Publicidad", "Más información", "Cerrar", "Cerrar en", "s"),
    "it" to AdCopy("Pubblicità", "Scopri di più", "Chiudi", "Chiudi tra", "s"),
    "pt" to AdCopy("Publicidade", "Saiba mais", "Fechar", "Fechar em", "s"),
    "pl" to AdCopy("Reklama", "Dowiedz się więcej", "Zamknij", "Zamknij za", "s"),
    "sr" to AdCopy("Реклама", "Сазнајте више", "Затвори", "Затвори за", "с"),
    "uk" to AdCopy("Реклама", "Докладніше", "Закрити", "Закрити через", "с"),
    "zh" to AdCopy("广告", "了解更多", "关闭", "可关闭倒计时", "秒"),
    "tr" to AdCopy("Reklam", "Ayrıntılar", "Kapat", "Kapatmaya kalan süre:", "sn"),
    "ja" to AdCopy("広告", "詳しく見る", "閉じる", "閉じるまで", "秒"),
)

private val manageAdCopy = mapOf(
    "ru" to "Управление рекламой в веб-панели", "en" to "Manage ads in the web panel",
    "el" to "Διαχείριση διαφημίσεων στον ιστό", "de" to "Anzeigen im Web verwalten",
    "fr" to "Gérer les publicités sur le Web", "es" to "Gestionar anuncios en la web",
    "it" to "Gestisci gli annunci sul Web", "pt" to "Gerir anúncios na Web",
    "pl" to "Zarządzaj reklamami w przeglądarce", "sr" to "Управљање рекламама на вебу",
    "uk" to "Керування рекламою у веб-панелі", "zh" to "在网页面板管理广告",
    "tr" to "Reklamları web panelinde yönet", "ja" to "ウェブ画面で広告を管理",
)

@Composable
internal fun manageAdsLabel(): String = manageAdCopy[LocalGenesisLanguage.current] ?: manageAdCopy.getValue("ru")

internal fun genesisImageBitmap(url: String, maximumDimension: Int = 1200): Bitmap? {
    val bytes = if (url.startsWith("data:image/")) {
        val encoded = url.substringAfter(";base64,", "")
        if (encoded.isEmpty() || encoded.length > 700_000) return null
        Base64.decode(encoded, Base64.DEFAULT)
    } else {
        if (!url.startsWith("https://")) return null
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        try {
            if (connection.responseCode != 200) return null
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 500_000) return null
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        } finally { connection.disconnect() }
    }
    if (bytes.size > 500_000) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > maximumDimension || bounds.outHeight / sample > maximumDimension) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
        BitmapFactory.Options().apply { inSampleSize = sample })
}

@Composable
internal fun TodayAdPanel(controller: AuthController, userId: String?, language: String) {
    val context = LocalContext.current
    val view = LocalView.current
    val prefs = remember(context) { context.getSharedPreferences("genesis.today.ads", Context.MODE_PRIVATE) }
    val country = remember { Locale.getDefault().country.uppercase(Locale.ROOT) }
    val copy = adCopy[language] ?: adCopy.getValue("ru")
    val candidates by produceState(emptyList<NativeAd>(), userId, language, country) {
        if (userId == null) return@produceState
        value = runCatching {
            val response = controller.todayAds(language, country)
            val array = response.getJSONArray("ads")
            (0 until array.length()).map { NativeAd.fromJson(array.getJSONObject(it)) }
                .filter { it.targetVersionCode == null || it.targetVersionCode > BuildConfig.VERSION_CODE }
        }.getOrDefault(emptyList())
    }
    var dismissed by remember(userId, language) { mutableStateOf(false) }
    val ad = remember(candidates, userId, language, dismissed) {
        if (userId == null) null else candidates.firstOrNull { candidate ->
            val last = prefs.getLong("$userId:${candidate.id}", 0L)
            candidate.canShow(BuildConfig.VERSION_CODE, dismissed, last, System.currentTimeMillis())
        }
    }
    if (ad == null) return
    val bitmap by produceState<Bitmap?>(null, ad.imageUrl) {
        value = withContext(Dispatchers.IO) { runCatching { genesisImageBitmap(ad.imageUrl) }.getOrNull() }
    }
    var visible by remember(ad.id) { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var resumed by remember(lifecycleOwner) {
        mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) resumed = true
            if (event == Lifecycle.Event.ON_PAUSE) resumed = false
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    var viewedSeconds by remember(ad.id) { mutableIntStateOf(0) }
    var recorded by remember(ad.id, userId) { mutableStateOf(false) }
    LaunchedEffect(visible, resumed, ad.id, userId) {
        if (visible && resumed && !recorded && userId != null) {
            prefs.edit().putLong("$userId:${ad.id}", System.currentTimeMillis()).apply()
            recorded = true
        }
    }
    LaunchedEffect(visible, resumed, ad.id) {
        while (!ad.isUpdate && visible && resumed && viewedSeconds < 60) { delay(1_000); viewedSeconds++ }
    }
    Card(Modifier.fillMaxWidth().testTag("today-ad-card")
        .onGloballyPositioned { coordinates ->
            val bounds = coordinates.boundsInWindow()
            val overlap = (minOf(bounds.bottom, view.height.toFloat()) - maxOf(bounds.top, 0f)).coerceAtLeast(0f)
            visible = bounds.height > 0 && overlap >= minOf(bounds.height * .5f,
                120f * view.resources.displayMetrics.density)
        }, border = BorderStroke(1.dp, MaterialTheme.colorScheme.secondary)) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            bitmap?.let { Image(it.asImageBitmap(), contentDescription = null,
                modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp),
                contentScale = ContentScale.Crop) }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(copy.label, color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelMedium)
                UntranslatedText(ad.title, style = MaterialTheme.typography.titleLarge)
                UntranslatedText(ad.description, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ad.destination(BuildConfig.PLAY_DISTRIBUTION)))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }, modifier = Modifier.weight(1f)) {
                        UntranslatedText(copy.open)
                    }
                    if (!ad.isUpdate) OutlinedButton(onClick = { dismissed = true }, enabled = viewedSeconds >= 60,
                        modifier = Modifier.weight(1f).testTag("today-ad-close")) {
                        UntranslatedText(if (viewedSeconds >= 60) copy.close
                            else "${copy.wait} ${60 - viewedSeconds} ${copy.unit}")
                    }
                }
            }
        }
    }
}
