package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.doOnLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog
import java.io.ByteArrayInputStream
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Exact site SVG, bundled offline. Only validated selection links reach native code; no JS bridge. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun SolarCalendarModel(calendar: GenesisCalendar, shown: LocalDate,
    onOpenDate: (LocalDate) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val dark = LocalEveningTheme.current
    val scheme = MaterialTheme.colorScheme
    val palette = LocalDarkPalette.current
    fun css(color: androidx.compose.ui.graphics.Color) = "#%06x".format(color.toArgb() and 0xffffff)
    val paper = if (dark && palette == "green") "#071d20" else css(scheme.background)
    val ink = css(scheme.onBackground)
    val muted = css(scheme.onSurfaceVariant)
    val accent = css(scheme.primary)
    val year = calendar.sacredDate(shown).sacredYear
    var selectedMonth by remember { mutableIntStateOf(calendar.sacredDate(shown).monthIndex) }
    var selectedDay by remember { mutableIntStateOf(calendar.sacredDate(shown).day) }
    var view by remember { mutableStateOf<WebView?>(null) }
    var ready by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val source by produceState<String?>(null, paper, ink, muted, accent, language) {
        ready = false; failed = false
        value = withContext(Dispatchers.IO) { runCatching {
            val template = context.assets.open("solar-model.html").bufferedReader().use { it.readText() }
            val svg = context.assets.open("originals/calendar-art/genesis-sacred-calendar-v8.svg")
                .bufferedReader().use { it.readText() }
            val localization = if (language == "ru") "" else {
                val script = context.assets.open("originals/i18n/solar-model-localization.js").bufferedReader().use { it.readText() }.replace("export function ", "function ")
                val labels = org.json.JSONObject(solarModelLabels(context, language)).toString().replace("<", "\\u003c")
                "<script>$script;localizeSolarModel(document.querySelector('svg'),solarLabelTranslator($labels,${org.json.JSONObject.quote(language)}),${org.json.JSONObject.quote(language)});</script>"
            }
            template.replace("</body>", "$localization</body>").replace("__PAPER__", paper)
                .replace("__INK__", ink)
                .replace("__MUTED__", muted)
                .replace("__GOLD__", accent)
                .replace("__SVG__", svg)
        }.getOrNull() }
        failed = value == null
    }
    val selectedDate = calendar.gregorianDate(year, selectedMonth,
        selectedDay.coerceIn(1, calendar.sacredMonthLength(year, selectedMonth)))
    val month = SacredCatalog.months[selectedMonth]
    val dateLabel = selectedDate.format(DateTimeFormatter.ofPattern("d MMMM yyyy",
        Locale.forLanguageTag(LocalGenesisLanguage.current)))
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("solar-calendar-model"), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Круг GENESIS", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    AffairsIconButton("Закрыть модель календаря", AffairsAction.CLOSE, onClose,
                        Modifier.testTag("solar-model-close"))
                }
                Text("Выберите месяц, пяту или день. Масштабируйте двумя пальцами и перемещайте круг.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AffairsIconButton("Уменьшить модель", AffairsAction.DECREASE,
                        { view?.evaluateJavascript("genesisModel.zoom(1.5)", null) }, Modifier.testTag("solar-model-zoom-out"), enabled = ready)
                    OutlinedButton({ view?.evaluateJavascript("genesisModel.fit()", null) },
                        Modifier.weight(1f).heightIn(min = 48.dp).testTag("solar-model-fit"), enabled = ready) { Text("Весь круг") }
                    AffairsIconButton("Увеличить модель", AffairsAction.ADD,
                        { view?.evaluateJavascript("genesisModel.zoom(0.67)", null) }, Modifier.testTag("solar-model-zoom-in"), enabled = ready)
                }
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds(), contentAlignment = Alignment.Center) {
                    source?.let { html ->
                        key(html) {
                        AndroidView(factory = { appContext -> WebView(appContext).apply {
                            view = this
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            settings.javaScriptEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.domStorageEnabled = false
                            settings.setSupportMultipleWindows(false)
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(web: WebView, request: WebResourceRequest): Boolean {
                                    val uri = request.url
                                    if (uri.scheme == "https" && uri.host == "genesis-model.invalid" && uri.path == "/select") {
                                        val index = uri.getQueryParameter("month")?.toIntOrNull()?.minus(1)
                                        val day = uri.getQueryParameter("day")?.toIntOrNull()
                                        if (index != null && index in SacredCatalog.months.indices && day != null &&
                                            day in 1..calendar.sacredMonthLength(year, index)) {
                                            selectedMonth = index; selectedDay = day
                                        }
                                    }
                                    return true
                                }
                                override fun shouldInterceptRequest(web: WebView, request: WebResourceRequest) =
                                    WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                                override fun onPageFinished(web: WebView, url: String) {
                                    // An offline page can finish before AndroidView's first layout.
                                    // Request its first draw before waiting for the visual-state fence.
                                    web.doOnLayout {
                                        web.postVisualStateCallback(1L, object : WebView.VisualStateCallback() {
                                            override fun onComplete(requestId: Long) { ready = true; web.postInvalidateOnAnimation() }
                                        })
                                        web.postInvalidateOnAnimation()
                                    }
                                }
                            }
                            loadDataWithBaseURL("https://genesis-model.invalid/", html, "text/html", "UTF-8", null)
                        } }, modifier = Modifier.fillMaxSize().testTag("solar-model-webview"),
                            onRelease = { it.stopLoading(); it.destroy(); view = null })
                        }
                    }
                    if (!ready && !failed) WorkspaceLoadingIndicator()
                    if (failed) Text("Не удалось открыть модель календаря.", color = MaterialTheme.colorScheme.error)
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    AffairsIconButton("Предыдущий месяц модели", AffairsAction.BACK, {
                        val index = (selectedMonth + 12) % 13
                        view?.evaluateJavascript("genesisModel.month(${index + 1})", null)
                    }, Modifier.testTag("solar-model-previous"), enabled = ready)
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(month.name, Modifier.testTag("solar-model-month"), style = MaterialTheme.typography.titleMedium)
                        Text("$selectedDay · $dateLabel", style = MaterialTheme.typography.bodySmall)
                    }
                    AffairsIconButton("Следующий месяц модели", AffairsAction.NEXT, {
                        val index = (selectedMonth + 1) % 13
                        view?.evaluateJavascript("genesisModel.month(${index + 1})", null)
                    }, Modifier.testTag("solar-model-next"), enabled = ready)
                }
                Button({ onOpenDate(selectedDate); onClose() }, Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("solar-model-open-date"), enabled = ready) { Text("Открыть день в календаре") }
            }
        }
    }
}
