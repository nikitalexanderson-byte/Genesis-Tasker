package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.FeatureAccess
import java.time.Instant

class FutureModelingGate322Test {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    @Test fun entryNeedsSavedNineCardsSignedInOwnerAndCurrentPremiumGrant() {
        fun deal(count:Int)=JSONObject().put("cards",JSONArray(List(count){JSONObject().put("cardId","qa-$it")}))
        fun policy(plan:String,granted:Boolean,expired:Boolean=false,legacy:Boolean=false)=FeatureAccess(
            enforcementEnabled=!legacy,declaredPlan=plan,effectivePlan=plan,
            validUntil=Instant.now().plusSeconds(if(expired)-60 else 3600),
            allowedFeatures=if(granted)setOf("future-modeling")else emptySet())
        var source by mutableStateOf<JSONObject?>(null)
        var signedIn by mutableStateOf(true)
        var access by mutableStateOf(policy("premium",true))
        var opened=0
        compose.setContent { CompositionLocalProvider(LocalFeatureAccess provides access,LocalGenesisLanguage provides "en") {
            MaterialTheme(colorScheme=standart) { Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                FutureModelingEntryButton(source,signedIn){opened++}
            } }
        } }
        fun hidden()=compose.onNodeWithTag("future-modeling-open").assertDoesNotExist()
        hidden()
        compose.runOnIdle {source=deal(8)};hidden()
        compose.runOnIdle {source=deal(9);access=policy("standart",false)};hidden()
        compose.runOnIdle {access=policy("free",false,legacy=true)};hidden()
        compose.runOnIdle {access=policy("premium",true,expired=true)};hidden()
        compose.runOnIdle {access=policy("premium",true);signedIn=false};hidden()
        compose.runOnIdle {signedIn=true}
        compose.onNodeWithTag("future-modeling-open").assertIsDisplayed().performClick()
        assertEquals(1,opened)
        compose.runOnIdle {access=policy("business",true)}
        compose.onNodeWithTag("future-modeling-open").assertIsDisplayed()
        compose.runOnIdle {access=policy("business",true).copy(declaredPlan="premium4life",lifetimePremium=true,validUntil=null)}
        compose.onNodeWithTag("future-modeling-open").assertIsDisplayed()
        // The testing owner's explicit server grant is retained even on Free.
        compose.runOnIdle {access=policy("free",true)}
        compose.onNodeWithTag("future-modeling-open").assertIsDisplayed()
        compose.runOnIdle {source=null};hidden()
    }
}
