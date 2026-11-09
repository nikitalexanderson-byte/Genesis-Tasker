package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import java.util.UUID

class PersonalInboxLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun visibilityAndPositionSurviveARecreatedScreenAndStayInsideTheirAccount() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val accountA = UUID.randomUUID().toString()
        val accountB = UUID.randomUUID().toString()
        val savedScopes = mutableListOf<String>()
        var screen by mutableIntStateOf(0)
        try {
            app.activateAccount(accountA); savedScopes += app.workspaceScope
            compose.setContent { MaterialTheme(colorScheme = standart) { key(screen) {
                val (layout, setLayout) = rememberPersonalInboxLayout(app)
                Column {
                    Text("${layout.hidden}:${layout.atBottom}", Modifier.testTag("layout-state"))
                    Button({ setLayout(layout.copy(hidden = !layout.hidden)) }, Modifier.testTag("hide")) { Text("visibility") }
                    Button({ setLayout(layout.copy(atBottom = !layout.atBottom)) }, Modifier.testTag("move")) { Text("position") }
                }
            } } }
            compose.onNodeWithTag("layout-state").assertTextEquals("false:false")
            compose.onNodeWithTag("hide").performClick()
            compose.onNodeWithTag("move").performClick()
            compose.runOnIdle { screen++ }
            compose.onNodeWithTag("layout-state").assertTextEquals("true:true")
            compose.runOnIdle { app.activateAccount(accountB); savedScopes += app.workspaceScope; screen++ }
            compose.onNodeWithTag("layout-state").assertTextEquals("false:false")
            compose.runOnIdle { app.activateAccount(accountA); screen++ }
            compose.onNodeWithTag("layout-state").assertTextEquals("true:true")
            assertTrue(app.workspaceScope.startsWith("account-"))
        } finally {
            app.activateAccount(null)
            app.getSharedPreferences("genesis.personal-layout.v1", 0).edit().apply {
                savedScopes.forEach { remove("$it:inbox:hidden"); remove("$it:inbox:bottom") }
            }.commit()
        }
    }
}
