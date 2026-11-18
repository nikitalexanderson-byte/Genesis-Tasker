package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.Keep
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.Base64

internal const val OLYMPIAN_NATIVE_ENTRY = "https://appassets.androidplatform.net/aurora/olympians.html"

@Keep
private class OlympianNavigationBridge(private val navigate: (String, String) -> Unit) {
    @Volatile var active = true
    @JavascriptInterface fun navigate(kind: String, id: String) {
        if (active && kind in setOf("close", "letter", "sector") && id.matches(Regex("[a-z-]{0,40}"))) navigate.invoke(kind, id)
    }
}

/** The current shared catalogue runs locally; only explicit navigation crosses into native UI. */
@SuppressLint("SetJavaScriptEnabled")
@Composable internal fun NativeOlympianDialog(title: String, onClose: () -> Unit,
    onOpenStoicheion: (String?) -> Unit, onOpenSector: (String) -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val dark = LocalEveningTheme.current
    val palette = LocalDarkPalette.current
    val scheme = MaterialTheme.colorScheme
    val textScale = LocalDensity.current.fontScale
    var web by remember { mutableStateOf<WebView?>(null) }
    var failed by remember { mutableStateOf(false) }
    val currentClose by rememberUpdatedState(onClose)
    val currentLetter by rememberUpdatedState(onOpenStoicheion)
    val currentSector by rememberUpdatedState(onOpenSector)
    fun hex(color: Color) = "#%06x".format(color.toArgb() and 0xffffff)
    val boot = JSONObject().put("language", language).put("dark", dark).put("palette", palette)
        .put("colors", JSONObject().put("--ink", hex(scheme.onSurface)).put("--ink-soft", hex(scheme.onSurfaceVariant))
            .put("--surface", hex(scheme.surface)).put("--paper", hex(scheme.background)).put("--line", hex(scheme.outlineVariant))
            .put("--ui-accent", hex(scheme.primary)).put("--ui-on-accent", hex(scheme.onPrimary)).put("--teal", hex(scheme.primary)))
    val encoded = Base64.getEncoder().encodeToString(boot.toString().toByteArray(Charsets.UTF_8))
    fun back() { web?.evaluateJavascript("window.GenesisOlympianRuntime?.back()", null) ?: currentClose() }
    Dialog(onDismissRequest = ::back, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = scheme.surface) {
            Column(Modifier.fillMaxSize().testTag("olympian-catalog-dialog")) {
                Box(Modifier.padding(horizontal = 12.dp)) {
                    EditorDialogHeader(title, "olympian-catalog-close") { currentClose() }
                }
                if (failed) Text("Не удалось загрузить данные", color = scheme.error, modifier = Modifier.padding(16.dp))
                AndroidView(factory = { ctx -> WebView(ctx).apply {
                    web = this
                    setBackgroundColor(scheme.surface.toArgb())
                    settings.javaScriptEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.domStorageEnabled = false
                    settings.databaseEnabled = false
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.setSupportMultipleWindows(false)
                    settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.textZoom = (textScale * 100).toInt().coerceIn(80, 250)
                    val bridge = OlympianNavigationBridge { kind, id -> post {
                        if (url == OLYMPIAN_NATIVE_ENTRY) when (kind) {
                            "close" -> currentClose()
                            "letter" -> currentLetter(id.takeIf(String::isNotBlank))
                            "sector" -> currentSector(id)
                        }
                    } }
                    tag = bridge
                    addJavascriptInterface(bridge, "GenesisOlympianBridge")
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val uri = request.url
                            if (request.hasGesture() && uri.scheme == "https" && uri.host != "appassets.androidplatform.net"
                                && uri.userInfo == null) runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                            return true
                        }
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                            val path = if (request.url.toString() == OLYMPIAN_NATIVE_ENTRY) "aurora/olympians.html"
                                else AuroraWebOrigin.assetPath(request.url.toString())
                            val mime = when (path?.substringAfterLast('.')) {
                                "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; "png" -> "image/png"
                                "webp" -> "image/webp"; "svg" -> "image/svg+xml"; "woff2" -> "font/woff2"; else -> "application/octet-stream"
                            }
                            val stream = path?.let { runCatching { ctx.assets.open(it) }.getOrNull() }
                            return WebResourceResponse(mime, "UTF-8", if (stream != null) 200 else 404,
                                if (stream != null) "OK" else "Not Found", mapOf("X-Content-Type-Options" to "nosniff"),
                                stream ?: ByteArrayInputStream(byteArrayOf()))
                        }
                        override fun onPageFinished(view: WebView, url: String) {
                            if (url == OLYMPIAN_NATIVE_ENTRY) view.evaluateJavascript(
                                "(function(){if(!window.GenesisOlympianRuntime)return false;window.GenesisOlympianRuntime.init('$encoded');return true})()"
                            ) { failed = it != "true" }
                        }
                    }
                    loadUrl(OLYMPIAN_NATIVE_ENTRY)
                } }, update = { view -> view.evaluateJavascript("window.GenesisOlympianRuntime?.theme('$encoded')", null) },
                    modifier = Modifier.fillMaxWidth().weight(1f).testTag("olympian-native-webview"), onRelease = { view ->
                        (view.tag as? OlympianNavigationBridge)?.active = false
                        view.removeJavascriptInterface("GenesisOlympianBridge")
                        view.stopLoading(); view.destroy(); web = null
                    })
            }
        }
    }
}
