package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.*
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.domain.trackers.*
import java.io.File
import java.time.Instant
import java.time.LocalDate

/** Runs against the isolated .v315.debug package on Samsung; never touches the release account. */
class Release315UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
    private fun policy() = JSONObject(app.assets.open("originals/catalogs/feature-access-policy.json").bufferedReader().use { it.readText() })
    private fun copy() = JSONObject(app.assets.open("originals/i18n/billing-feature-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru")
    private fun access(plan: String): FeatureAccess {
        val features=policy().getJSONObject("features")
        fun allowed(p: String) = features.keys().asSequence().filter { key ->
            val list=features.getJSONArray(key); (0 until list.length()).any { list.getString(it)==p } ||
                p=="premium4life" && key!="assistant"
        }.toSet()
        return FeatureAccess(enforcementEnabled=true,declaredPlan=plan,effectivePlan=if(plan=="premium4life")"business" else plan,
            lifetimePremium=plan=="premium4life",validUntil=Instant.now().plusSeconds(3600),
            allowedFeatures=allowed(plan),freeFeatures=allowed("free"))
    }
    @Composable private fun Frame(access: FeatureAccess = FeatureAccess(), upgrade: (String?) -> Unit = {}, content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalFeatureAccess provides access, LocalNativeUpgrade provides upgrade,
            LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes) {
                Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) { content() }
                }
            }
        }
    }
    private fun capture(name:String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null),"315-${if(dark)"dark" else "light"}-$name.png"))
    }
    @Test fun everyPlanCardExpandsCollapsesAndShowsBothIncludedAndExcludedFeatures() {
        val policy=policy();val copy=copy()
        var plan by mutableStateOf("free");var expanded by mutableStateOf(false)
        compose.setContent { Frame {
            NativeUpgradeTier(plan,1,true,expanded,false,policy,"ru",copy,true,null) { expanded=!expanded }
        } }
        for (candidate in nativeBillingPlans) {
            compose.runOnIdle { plan=candidate;expanded=false }
            compose.onNodeWithTag("billing-tier-$candidate").performClick()
            compose.onNodeWithTag("billing-feature-calendar-sync",useUnmergedTree=true).assertExists()
            compose.onNodeWithTag("billing-feature-stoicheion-spread",useUnmergedTree=true).assertExists()
            compose.onNodeWithTag("billing-feature-physis",useUnmergedTree=true).assertExists()
            assertEquals(candidate!="free",nativeBillingPlanFeatureRows(policy,candidate,"ru",copy).single{it.feature=="habit-timer"}.included)
            compose.onNodeWithTag("billing-feature-calendar-sync",useUnmergedTree=true).performScrollTo()
            capture("billing-$candidate")
            compose.onNodeWithText(nativePlanName(candidate),useUnmergedTree=true).performScrollTo().performTouchInput { click() }
            compose.onNodeWithTag("billing-feature-calendar-sync",useUnmergedTree=true).assertDoesNotExist()
            compose.onNodeWithTag("billing-tier-$candidate").performClick()
            compose.onNodeWithTag("billing-feature-calendar-sync",useUnmergedTree=true).assertExists()
        }
    }
    @Test fun futureModelingAsksForPremiumAndOpensAfterEntitlementChanges() {
        var current by mutableStateOf(access("free"));var requested:String?=null
        compose.setContent { Frame(current,{requested=it}) { FutureModelingGuide() } }
        compose.onNodeWithTag("future-modeling-open").performClick()
        assertEquals("future-modeling",requested)
        compose.onNodeWithTag("future-modeling-dialog").assertDoesNotExist()
        compose.runOnIdle { current=access("premium") }
        compose.onNodeWithTag("future-modeling-open").performClick()
        compose.onNodeWithTag("future-modeling-dialog").assertIsDisplayed()
        capture("future-modeling-premium")
        compose.onNodeWithTag("future-modeling-close").performClick()
        compose.onNodeWithTag("future-modeling-dialog").assertDoesNotExist()
    }
    @Test fun habitTimerRequiresStandardAndFreeCanStillSaveAnExistingSession() {
        val date=LocalDate.now();val habit=Habit(TrackerEntity.create("habit",id="315-timer"),"315 test",date,dailySleepSchedule(date,CalendarMode.PROFANE))
        var workspace by mutableStateOf(LocalHabitWorkspace(habits=listOf(habit)))
        var current by mutableStateOf(access("free"));var calls=0
        compose.setContent { Frame(current) {
            HabitTimerShelf(workspace,"315-device",habit.id,{},embedded=true) { command ->
                workspace=HabitTimerWorkspace.apply(workspace,command);calls++
            }
        } }
        compose.onNodeWithTag("habit-timer-start").performScrollTo().assertIsNotEnabled()
        assertEquals(0,calls)
        compose.runOnIdle { current=access("standart") }
        compose.onNodeWithTag("habit-timer-start").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(5000){calls==1}
        compose.onNodeWithTag("habit-timer-pause").performScrollTo().performClick()
        compose.waitUntil(5000){calls==2}
        compose.runOnIdle { current=access("free") }
        compose.onNodeWithTag("habit-timer-resume").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("habit-timer-finish").performScrollTo().performClick()
        compose.waitUntil(5000){calls==3}
        compose.onNodeWithTag("habit-timer-save").performScrollTo().performClick()
        compose.waitUntil(5000){calls==4}
        assertEquals("saved",HabitTimers.sessions(workspace.timers).single().state!!.status)
        capture("timer-free-saved-history")
    }
    private fun letters():List<StoicheionLetter> {
        val raw=JSONArray(app.assets.open("stoicheion.json").bufferedReader().use{it.readText()})
        return (0 until raw.length()).map{raw.getJSONObject(it).let { row ->
            StoicheionLetter(row.getString("id"),row.getInt("order"),row.getString("name"),row.getString("symbol"),
                row.getString("lowercase"),row.getInt("value"),row.getInt("pythmen"),row.getString("tagline"),row.getString("content"),"","","",Color.White)
        }}
    }
    @Test fun freeStandardAndPremiumExposeOnlyTheirAllowedDraws() {
        var current by mutableStateOf(access("free"));var launched=""
        val letters=letters()
        val draws=StoicheionDraws(daily=StoicheionDraw("daily",LocalDate.now().toString(),1234,1,1000,181000))
        compose.setContent { Frame(current) {
            StoicheionDrawPanel(letters,draws,1001,false,null,{launched=it},{})
        }}
        compose.onNodeWithTag("stoicheion-draw-spread").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("stoicheion-draw-timeline").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle {current=access("standart")}
        compose.onNodeWithTag("stoicheion-draw-spread").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("stoicheion-draw-timeline").performScrollTo().assertIsEnabled().performClick()
        assertEquals("timeline",launched)
        compose.runOnIdle {current=access("premium")}
        compose.onNodeWithTag("stoicheion-draw-spread").performScrollTo().assertIsEnabled().performClick()
        assertEquals("spread",launched)
        capture("oracle-premium")
    }
    @Test fun repositoriesRejectForbiddenMutationsWithoutWritingData() = runBlocking {
        val scope=app.workspaceScope
        try {
            app.rememberFeatureAccess(scope,access("free"))
            for(kind in listOf("spread","timeline")) {
                val failure=runCatching{StoicheionDrawRepository(app).save(kind,1234)}.exceptionOrNull()
                assertEquals("FEATURE_SUBSCRIPTION_REQUIRED",failure?.message)
            }
            for(action in listOf("start","resume")) {
                val failure=runCatching{HabitsRepository(app).applyTimer(HabitTimerCommand(action,"315-device",Instant.now().toString(),"315-denied"))}.exceptionOrNull()
                assertEquals("FEATURE_SUBSCRIPTION_REQUIRED",failure?.message)
            }
        } finally {app.rememberFeatureAccess(scope,FeatureAccess())}
    }
}
