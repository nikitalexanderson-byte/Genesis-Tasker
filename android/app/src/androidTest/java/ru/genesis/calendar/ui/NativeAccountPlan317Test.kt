package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import kotlin.math.abs
import kotlin.math.max

/** Production composables with test entitlements and the bundled canonical catalog; no account/payment requests. */
class NativeAccountPlan317Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun access(plan: String) = FeatureAccess(enforcementEnabled = true, declaredPlan = plan,
        effectivePlan = if (plan == "premium4life") "business" else plan, lifetimePremium = plan == "premium4life",
        validUntil = Instant.parse("2100-01-01T00:00:00Z"))

    @Composable private fun Frame(dark: Boolean, language: String = "ru", fontScale: Float? = null,
        featureAccess: FeatureAccess = FeatureAccess(), onUpgrade: (String?) -> Unit = {}, content: @Composable () -> Unit) {
        val deviceDensity = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(deviceDensity.density, fontScale ?: deviceDensity.fontScale),
            LocalEveningTheme provides dark, LocalGenesisLanguage provides language,
            LocalFeatureAccess provides featureAccess, LocalNativeUpgrade provides onUpgrade) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
                }
            }
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "account-plan317-$name.png"))
    }
    private fun save(name: String, result: JSONObject) {
        result.put("runId", InstrumentationRegistry.getArguments().getString("genesisRunId", "manual"))
            .put("density", context.resources.displayMetrics.density)
            .put("deviceFontScale", context.resources.configuration.fontScale)
            .put("scope", "isolated real production composables, no account/network/purchase flow")
        File(context.getExternalFilesDir(null), "account-plan317-$name.json").writeText(result.toString(2))
    }
    private fun assertTextFits(node: SemanticsNodeInteraction) {
        val layouts = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("A real text layout must be measured", layouts.isNotEmpty())
        assertTrue("Localized words must stay fully visible", layouts.none { it.didOverflowHeight || it.didOverflowWidth })
    }

    @Test fun accountActionKeepsPlanLabelsTouchTargetAndCallbackAcrossThemesAndFonts() {
        var plan by mutableStateOf("free")
        var dark by mutableStateOf(false)
        var language by mutableStateOf("ru")
        val actualScale = context.resources.configuration.fontScale
        var scale by mutableFloatStateOf(actualScale)
        val calls = mutableListOf<String?>()
        val states = JSONArray()
        val result = JSONObject().put("completed", false).put("states", states)
            .put("fontStress", "Only the test composition uses max(device font scale, 1.5); Android settings are unchanged")
        compose.setContent { Frame(dark, language, scale, access(plan), { calls += it }) { NativeAccountPlanHeader() } }
        try {
            for (eveningMode in listOf(false, true)) for (locale in listOf("ru", "en"))
                for ((scaleName, value) in listOf("actual" to actualScale, "stress" to max(actualScale, 1.5f)))
                    for (candidate in listOf("free", "standart", "premium", "business", "premium4life")) {
                        compose.runOnIdle { dark = eveningMode; language = locale; scale = value; plan = candidate }
                        val title = (if (locale == "en") "Current plan: " else "Ваш тариф: ") + nativePlanName(candidate)
                        val label = if (candidate == "free") {
                            if (locale == "en") "Unlock more features" else "Подключить больше функций"
                        } else if (locale == "en") "Compare plans" else "Сравнить тарифы"
                        val header = compose.onNodeWithTag("settings-billing-plan").performScrollTo()
                        val action = compose.onNodeWithTag("settings-compare-plans").assertIsEnabled()
                            .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).assertContentDescriptionEquals(label)
                        val current = compose.onNodeWithTag("settings-current-plan", useUnmergedTree = true).assertTextEquals(title)
                        assertTextFits(current)
                        assertTextFits(compose.onNodeWithText(label, useUnmergedTree = true))
                        val frame = header.getUnclippedBoundsInRoot()
                        val button = action.getUnclippedBoundsInRoot()
                        val text = current.getUnclippedBoundsInRoot()
                        val frameWidth = frame.right - frame.left
                        val buttonWidth = button.right - button.left
                        val buttonHeight = button.bottom - button.top
                        assertTrue("Action stays in account header", button.left >= frame.left && button.right <= frame.right + 1.dp)
                        assertTrue("Tier label stays in account header", text.left >= frame.left && text.right <= frame.right + 1.dp)
                        val sameRow = button.top < text.bottom && button.bottom > text.top
                        if (sameRow) assertTrue("Action is on the right of the tier", button.left >= text.right)
                        else assertTrue("Wrapped action stays on the right", button.top >= text.bottom && abs((frame.right - button.right).value) <= 1f)
                        if (frameWidth >= 520.dp && value <= 1.6f ||
                            locale == "en" && candidate != "free" && value <= 1.1f && frameWidth >= 300.dp)
                            assertTrue("The action shares a row when its real content fits", sameRow)
                        states.put(JSONObject().put("plan", candidate).put("language", locale).put("dark", eveningMode)
                            .put("fontScale", value).put("scaleCase", scaleName).put("sameRow", sameRow)
                            .put("headerWidthDp", frameWidth.value).put("buttonWidthDp", buttonWidth.value)
                            .put("buttonHeightDp", buttonHeight.value))
                        if (locale == "ru") capture("header-$candidate-${if (eveningMode) "dark" else "light"}-$scaleName")
                        val before = calls.size
                        action.performClick()
                        compose.runOnIdle { assertEquals(before + 1, calls.size); assertNull(calls.last()) }
                    }
            result.put("completed", true).put("callbackCount", calls.size)
        } finally { save("header", result) }
    }

    @Test fun bundledFixedUsdPricesRenderThroughTheExistingNativeTierCards() {
        val bytes = context.assets.open("originals/catalogs/billing-catalog.json").use { it.readBytes() }
        val definition = JSONObject(bytes.toString(Charsets.UTF_8))
        val foreign = definition.getJSONObject("foreignPricing")
        assertEquals("fixed", foreign.getString("pricingModel")); assertFalse(foreign.has("rate"))
        // Inputs come from the packaged canonical catalog; expectations are independently approved amounts.
        val expected = mapOf(1 to listOf(4, 7, 10, 160), 12 to listOf(40, 70, 100, 160))
        val plans = listOf("standart", "premium", "business", "premium4life")
        val offers = JSONArray()
        for (candidate in plans) for (period in if (candidate == "premium4life") listOf(0) else listOf(1, 12)) {
            val amount = if (candidate == "premium4life") foreign.getLong("lifetimeAmountMinor")
                else foreign.getJSONObject("prices").getJSONObject(candidate).getLong(period.toString())
            offers.put(JSONObject().put("plan", candidate).put("periodMonths", period)
                .put("pricesByProvider", JSONObject().put("lemon-squeezy", JSONObject().put("amountMinor", amount).put("currency", foreign.getString("currency")))))
        }
        val catalog = JSONObject().put("offers", offers)
        val copy = JSONObject(context.assets.open("originals/i18n/billing-feature-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru")
        var dark by mutableStateOf(false)
        var months by mutableIntStateOf(1)
        val states = JSONArray()
        val result = JSONObject().put("completed", false).put("states", states).put("catalogRevision", definition.getString("revision"))
            .put("canonicalAssetSha256", MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
            .put("limits", "No parent-dialog FX/quote/provider/checkout behavior; offer envelope is an offline adapter of the canonical definition")
        compose.setContent { Frame(dark) {
            plans.forEach { candidate ->
                NativeUpgradeTier(candidate, months, true, false, false, null, "ru", copy, true,
                    nativeBillingProviderPrice(nativeBillingOffer(catalog, candidate, months), "lemon-squeezy")) {}
            }
        } }
        try {
            for (eveningMode in listOf(false, true)) for (period in listOf(1, 12)) {
                compose.runOnIdle { dark = eveningMode; months = period }
                plans.forEachIndexed { index, candidate ->
                    val price = expected.getValue(period)[index]
                    val card = compose.onNodeWithTag("billing-tier-$candidate", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
                    card.assert(hasAnyDescendant(hasText("$price USD", substring = false)))
                    assertEquals(price * 100L to "USD", nativeBillingProviderPrice(nativeBillingOffer(catalog, candidate, period), "lemon-squeezy"))
                    states.put(JSONObject().put("dark", eveningMode).put("months", period).put("plan", candidate).put("displayedUsd", price))
                }
                compose.onNodeWithTag("billing-tier-standart").performScrollTo()
                capture("fixed-usd-$period-${if (eveningMode) "dark" else "light"}-top")
                compose.onNodeWithTag("billing-tier-premium4life").performScrollTo()
                capture("fixed-usd-$period-${if (eveningMode) "dark" else "light"}-elite")
            }
            result.put("completed", true)
        } finally { save("fixed-usd", result) }
    }
}
