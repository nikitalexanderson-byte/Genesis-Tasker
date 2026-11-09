package ru.genesis.calendar

import androidx.compose.runtime.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import ru.genesis.calendar.ui.StoicheionMotionDialog

class StoicheionGestureTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    private fun fingerCompletes(mode: String) {
        var chosen: Long? = null
        compose.setContent {
            var open by remember { mutableStateOf(true) }
            if (open) StoicheionMotionDialog(mode, false, onCancel = { open = false },
                onFinish = { chosen = it; open = false })
        }
        compose.waitForIdle()
        "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ".forEachIndexed { index, letter ->
            compose.onNodeWithTag("stoicheion-orbit-$index").assertTextEquals(letter.toString())
        }
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle()
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(app.getExternalFilesDir(null), "stoicheion-motion-$mode-after.png")))
        compose.onNodeWithTag("stoicheion-motion-field").performTouchInput {
            val middle = height / 2f
            down(Offset(width / 2f, middle))
            repeat(72) { index ->
                moveTo(Offset(if (index % 2 == 0) 20f else width - 20f, middle), 16)
            }
            up()
        }
        compose.waitUntil(10_000) { chosen != null }
        assertNotNull(chosen)
        compose.onNodeWithTag("stoicheion-motion-field").assertDoesNotExist()
    }

    @Test fun fingerDrawsDailyCard() = fingerCompletes("daily")
    @Test fun fingerDrawsNineCardSpread() = fingerCompletes("spread")
    @Test fun fingerDrawsThreeCardTimeline() = fingerCompletes("timeline")
}
