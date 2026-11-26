package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.platform.app.InstrumentationRegistry
import org.hamcrest.Matcher
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Local shared catalogue, synthetic navigation only; no account or production API. */
class Release336OlympianQaTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun js(expression: String): String {
        val result = AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object : ViewAction {
            override fun getConstraints(): Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription() = "Inspect the local Olympian catalogue"
            override fun perform(controller: UiController, view: View) {
                (view as WebView).evaluateJavascript("JSON.stringify(($expression))") {
                    result.set(JSONTokener(it).nextValue() as? String ?: "null")
                }
            }
        })
        compose.waitUntil(15_000) { result.get() != null }
        return result.get()!!
    }

    private fun shot(name: String) {
        val ready = AtomicBoolean(false)
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object : ViewAction {
            override fun getConstraints(): Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription() = "Wait for local WebView drawing"
            override fun perform(controller: UiController, view: View) {
                (view as WebView).postVisualStateCallback(336, object : WebView.VisualStateCallback() {
                    override fun onComplete(requestId: Long) { ready.set(true) }
                })
            }
        })
        compose.waitUntil(10_000) { ready.get() }
        captureNativeWindow(File(context.getExternalFilesDir(null), "release336-olympian-$name.png"))
    }

    @Test fun nativeHeaderKeepsOneCloseAndCenteredStoicheionNavigation() {
        check(context.packageName == "ru.genesis.calendar.qa1103.debug")
        var width by mutableIntStateOf(390)
        var dark by mutableStateOf(false)
        var palette by mutableStateOf("blue")
        var epoch by mutableIntStateOf(0)
        var letterOpens = 0
        compose.setContent { key(epoch) {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalDarkPalette provides palette,
                LocalEveningTheme provides dark,
                LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f)) {
                MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    NativeOlympianDialog("13 олимпийцев и их сакральные числа", {}, { letterOpens++ }, {})
                }
            }
        } }
        val cases = buildList {
            for (w in listOf(360, 390, 768, 1440)) for (night in listOf(false, true)) add(Triple(w, "blue", night))
            for (p in listOf("green", "burgundy", "violet")) for (night in listOf(false, true)) add(Triple(390, p, night))
        }
        for ((w, p, night) in cases) {
            compose.runOnIdle { width = w; palette = p; dark = night; epoch++ }
            val label = "$w-$p-${if (night) "dark" else "light"}-scale130"
            compose.waitUntil(20_000) { js("document.querySelectorAll('.olympian-tile').length") == "13" }
            compose.waitUntil(15_000) { js("[...document.images].every(i=>i.complete&&i.naturalWidth>0)") == "true" }
            assertEquals("Centered button $label", "true", js("(()=>{const e=document.querySelector('.olympian-stoicheion-link'),s=getComputedStyle(e);return s.justifyContent==='center'&&s.textAlign==='center'&&e.getBoundingClientRect().height>=48})()"))
            compose.onNodeWithTag("olympian-catalog-close").assertIsDisplayed()
                .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            shot("catalog-$label")
            val previousOpens = letterOpens
            js("(document.querySelector('.olympian-stoicheion-link').click(),true)")
            compose.waitUntil(5_000) { letterOpens == previousOpens + 1 }
            js("(document.querySelector('[data-olympian=hestia]').click(),true)")
            compose.waitUntil(15_000) { js("Boolean(document.querySelector('.olympian-knowledge'))") == "true" }
            assertEquals("Only native Close $label", "0", js("document.querySelectorAll('.olympian-reading-modal .dialog-close-button').length"))
            assertEquals("Static back action $label", "\"static\"", js("getComputedStyle(document.querySelector('.olympian-reading-toolbar')).position"))
            compose.onNodeWithTag("olympian-catalog-close").assertIsDisplayed()
            shot("reading-$label")
            js("(()=>{document.querySelector('.olympian-knowledge details').open=true;return true})()")
            js("(()=>{document.querySelector('.olympian-reading-modal').scrollTop=500;return true})()")
            shot("reading-scroll-$label")
            assertEquals("Back never overlays the reading $label", "true", js("document.querySelector('.olympian-reading-toolbar').getBoundingClientRect().bottom<=0"))
            File(context.getExternalFilesDir(null), "release336-olympian-layout-$label.json").writeText(js("({viewport:[innerWidth,innerHeight],textZoom:130,toolbar:document.querySelector('.olympian-reading-toolbar').getBoundingClientRect().toJSON(),reading:document.querySelector('.olympian-reading-modal').getBoundingClientRect().toJSON()})"))
            js("(window.GenesisOlympianRuntime.back(),true)")
            compose.waitUntil(5_000) { js("document.querySelectorAll('.olympian-reading-modal').length") == "0" }
        }
    }
}
