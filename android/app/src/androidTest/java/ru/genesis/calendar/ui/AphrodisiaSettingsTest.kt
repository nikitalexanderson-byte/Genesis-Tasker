package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.*

class AphrodisiaSettingsTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun categoryStartsOffAndEachAnswerIsSavedOnlyAfterTheAgeDialog() {
        var saved by mutableStateOf(AdvicePreferences())
        var requests=0
        compose.setContent { MaterialTheme(colorScheme=standart) { Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                DailyAdviceSettings(saved,adviceCategories,true,"ru",true) { patch ->
                    requests++
                    saved=AdvicePreferences.fromJson(JSONObject(saved.toJson().toString()).apply {
                        patch.keys().forEach { put(it,patch.get(it)) }
                    });saved
                }
            }
        } } }
        assertFalse("Default preference must exclude Aphrodisia", "aphrodisia" in saved.categories)
        compose.onNodeWithTag("advice-category-aphrodisia").performScrollTo().assertIsOff().performClick()
        compose.onNodeWithText("Вам есть 18 лет?").assertExists()
        compose.runOnIdle { assertEquals(0,requests);assertNull(saved.aphrodisiaAdult) }
        compose.onNodeWithTag("advice-age-no").performClick()
        compose.waitUntil { requests==1 }
        compose.runOnIdle { assertEquals(false,saved.aphrodisiaAdult);assertTrue("aphrodisia" in saved.categories) }
        compose.onNodeWithTag("advice-age-manage").performScrollTo().performClick()
        compose.onNodeWithTag("advice-age-yes").performClick()
        compose.waitUntil { requests==2 }
        compose.runOnIdle { assertEquals(true,saved.aphrodisiaAdult) }
        compose.onNodeWithTag("advice-category-aphrodisia").performScrollTo().performClick()
        compose.waitUntil { requests==3 }
        compose.runOnIdle { assertFalse("aphrodisia" in saved.categories) }
    }
    @Test fun legacyAllCategoryPreferenceCannotSilentlyOptIntoAphrodisia() {
        val legacy=AdvicePreferences.fromJson(JSONObject().put("categories",org.json.JSONArray(adviceCategories)))
        assertNull(legacy.aphrodisiaAdult);assertFalse("aphrodisia" in legacy.categories)
    }
}
