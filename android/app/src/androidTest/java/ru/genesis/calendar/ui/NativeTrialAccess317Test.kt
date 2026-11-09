package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.auth.TrialAccess
import ru.genesis.calendar.auth.TrialLiveProof
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import java.time.Instant
import java.util.UUID

/** Production composables and a private fixture preference file; no account/server/purchase calls. */
class NativeTrialAccess317Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val start = Instant.parse("2026-11-03T10:00:00Z")
    private val end = start.plusSeconds(TrialAccess.DURATION_SECONDS)
    private fun metadata(status: String = "active", plan: String? = "premium", options: List<String> = emptyList()) =
        TrialAccess(status, plan, plan?.let { TrialAccess.label(it) }, if (plan == null) null else start,
            if (plan == null) null else end, start, options)
    private fun paid(plan: String = "free") = FeatureAccess(enforcementEnabled = true, declaredPlan = plan,
        effectivePlan = plan, validUntil = if (plan == "free") null else Instant.parse("2100-01-01T00:00:00Z"),
        policyRevision = "synthetic-trial-ui", allowedFeatures = if (plan == "free") setOf("tasks") else setOf("tasks", "data-export"),
        freeFeatures = setOf("tasks"), limits = mapOf("mindmaps" to if (plan == "free") 3 else 20),
        freeLimits = mapOf("mindmaps" to 3), source = "subscription")
    private fun overlay() = paid("premium").copy(declaredPlan = "standart", source = "trial",
        trial = metadata(), paidAccess = paid("standart"), validUntil = end,
        allowedFeatures = setOf("tasks", "data-export", "diary"), limits = mapOf("mindmaps" to 100))

    @Composable private fun Frame(dark: Boolean, access: FeatureAccess, language: String = "ru",
        onUpgrade: (String?) -> Unit = {}, content: @Composable () -> Unit) {
        check(BuildConfig.DEBUG)
        CompositionLocalProvider(LocalEveningTheme provides dark, LocalGenesisLanguage provides language,
            LocalFeatureAccess provides access, LocalNativeUpgrade provides onUpgrade) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
                }
            }
        }
    }

    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("genesisTrialCapture") != "true") return
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "trial317-$name.png"))
    }
    private fun evidence(name: String, value: JSONObject) {
        value.put("runId", InstrumentationRegistry.getArguments().getString("genesisRunId", "manual"))
            .put("scope", "production composables with synthetic entitlements; no live auth or payment coverage")
        File(context.getExternalFilesDir(null), "trial317-$name.json").writeText(value.toString(2))
    }

    @Test fun threeChoicesNeedConfirmationAndCancelNeverConsumesTheChoice() {
        val calls = mutableListOf<String>()
        val offer = metadata("available", null, listOf("standart", "premium", "business"))
        val access = paid().copy(trial = offer)
        var dark by mutableStateOf(false)
        var language by mutableStateOf("ru")
        compose.setContent { Frame(dark, access, language) {
            NativeTrialPanel(access, offer, rememberTrialCopy(), false, null, { calls += it }, {})
        } }
        for (locale in listOf("ru", "en")) for (night in listOf(false, true)) {
            compose.runOnIdle { language = locale; dark = night }
            compose.onNodeWithTag("trial-start-free").assertDoesNotExist()
            compose.onNodeWithTag("trial-start-premium4life").assertDoesNotExist()
            compose.onNodeWithTag("trial-start-elite").assertDoesNotExist()
            for (plan in listOf("standart", "premium", "business")) {
                val before = calls.size
                compose.onNodeWithTag("trial-start-$plan").performScrollTo().assertIsEnabled()
                    .assertHeightIsAtLeast(48.dp).performClick()
                compose.runOnIdle { assertEquals(before, calls.size) }
                compose.onNodeWithTag("trial-cancel").assertHeightIsAtLeast(48.dp).performClick()
                compose.runOnIdle { assertEquals(before, calls.size) }
                compose.onNodeWithTag("trial-start-$plan").performScrollTo().performClick()
                compose.onNodeWithTag("trial-confirm").assertHeightIsAtLeast(48.dp).performClick()
                compose.runOnIdle { assertEquals(before + 1, calls.size); assertEquals(plan, calls.last()) }
            }
            compose.onNodeWithTag("billing-trial-panel").performScrollTo()
            capture("offer-$locale-${if (night) "dark" else "light"}")
        }
        evidence("confirmation", JSONObject().put("completed", true).put("confirmedChoices", calls.size).put("cancelConsumed", false))
    }

    @Test fun cachedTrialRequiresOnlineProofThenExpiresToPaidBaselineInBothThemes() {
        var clock = 1_000L
        val cached = FeatureAccess.fromJson(overlay().json())
        var access by mutableStateOf(cached)
        var dark by mutableStateOf(false)
        var refreshes = 0
        compose.setContent { Frame(dark, access) {
            NativeAccountPlanHeader()
            NativeTrialPanel(access, null, rememberTrialCopy(), false, null, {}, { refreshes++ })
        } }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night; access = cached; clock = 1_000L }
            compose.onNodeWithTag("trial-online-required").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("trial-active").assertDoesNotExist()
            compose.onNodeWithTag("settings-current-plan", useUnmergedTree = true).assertTextEquals("Ваш тариф: " + nativePlanName("standart"))
            assertFalse(access.allows("diary")); assertTrue(access.allows("data-export"))
            compose.onNodeWithTag("trial-refresh").performScrollTo().performClick()
            capture("cached-${if (night) "dark" else "light"}")
            compose.runOnIdle {
                access = overlay().copy(trialProof = TrialLiveProof("fixture", start, 1_000L, metadata(), { true }, { clock }))
            }
            compose.onNodeWithTag("trial-active").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("settings-current-plan", useUnmergedTree = true).assertTextEquals("Ваш тариф: Trial-Premium")
            compose.onNodeWithTag("trial-remaining").assertTextContains("71:59:59", substring = true)
            assertTrue(access.allows("diary")); assertEquals(100, access.limit("mindmaps"))
            capture("active-${if (night) "dark" else "light"}")
            compose.runOnIdle { clock += TrialAccess.DURATION_SECONDS * 1_000; access = access.copy(trialRevision = 1) }
            compose.onNodeWithTag("trial-expired").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("trial-active").assertDoesNotExist()
            compose.onNodeWithTag("settings-current-plan", useUnmergedTree = true).assertTextEquals("Ваш тариф: " + nativePlanName("standart"))
            assertFalse(access.allows("diary")); assertTrue(access.allows("data-export"))
            assertEquals(20, access.limit("mindmaps"))
            capture("expired-${if (night) "dark" else "light"}")
        }
        assertEquals(2, refreshes)
        evidence("lifecycle", JSONObject().put("completed", true).put("themes", 2).put("cacheLease", false).put("paidFallback", "standart"))
    }

    @Test fun expiredTrialOffersPaymentOnceWithoutNaggingEqualOrHigherPaidAccounts() {
        val fixture = UUID.randomUUID().toString()
        val preferences = context.getSharedPreferences("genesis.validation.trial.$fixture", Context.MODE_PRIVATE)
        var access by mutableStateOf(paid("standart").copy(trial = metadata("expired")))
        var shown by mutableStateOf(true)
        var paymentCalls = 0
        compose.setContent { Frame(false, access, onUpgrade = { paymentCalls++ }) {
            if (shown) NativeTrialExpiryPrompt("fixture-$fixture", access, preferences)
        } }
        try {
            compose.onNodeWithTag("trial-expiry-dialog").assertIsDisplayed()
            compose.onNodeWithTag("trial-expiry-payment").assertHeightIsAtLeast(48.dp).performClick()
            compose.runOnIdle { assertEquals(1, paymentCalls); shown = false }
            compose.runOnIdle { shown = true }
            compose.onNodeWithTag("trial-expiry-dialog").assertDoesNotExist()
            for (plan in listOf("premium", "business")) {
                compose.runOnIdle { access = paid(plan).copy(trial = metadata("expired")) }
                compose.onNodeWithTag("trial-expiry-dialog").assertDoesNotExist()
            }
            evidence("expiry-notice", JSONObject().put("completed", true).put("paymentNavigationCalls", paymentCalls)
                .put("ordersOrCharges", 0).put("noticeOncePerWindow", true))
        } finally {
            compose.runOnIdle { shown = false }
            preferences.edit().clear().commit() // Only this test's UUID-named preference file.
            context.deleteSharedPreferences("genesis.validation.trial.$fixture")
        }
    }

    @Test fun allBundledLocalesDescribeTheSameTrialWithoutUnresolvedPlaceholders() {
        val expected = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        val catalog = JSONObject(context.assets.open("originals/i18n/billing-trial-copy.json").bufferedReader().use { it.readText() })
        assertEquals(expected, catalog.keys().asSequence().toSet())
        for (locale in expected) {
            val copy = catalog.getJSONObject(locale)
            assertEquals(29, copy.length())
            for (key in copy.keys().asSequence().toList()) {
                val text = trialText(copy, key, "trial" to "Trial-Premium", "date" to "06.11.2026 10:00:00",
                    "time" to "71:59:59", "plan" to "Standart")
                assertTrue("$locale/$key must be translated", text.isNotBlank())
                assertFalse("$locale/$key has an unfilled placeholder", Regex("\\{[A-Za-z]+\\}").containsMatchIn(text))
            }
        }
        evidence("catalog", JSONObject().put("completed", true).put("locales", expected.size).put("keysPerLocale", 29))
    }
}
