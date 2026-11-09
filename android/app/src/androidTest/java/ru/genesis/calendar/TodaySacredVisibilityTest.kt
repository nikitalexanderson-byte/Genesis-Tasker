package ru.genesis.calendar

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.io.File
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

class TodaySacredVisibilityTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun plainTodayIsCompactInBothThemesAndRestoresSacredArtwork() {
        var sacred by mutableStateOf(false)
        var dark by mutableStateOf(false)
        var mode by mutableStateOf(CalendarMode.SACRED)
        compose.setContent {
            CompositionLocalProvider(LocalSacredFeaturesEnabled provides sacred,
                LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            DayHeader(LocalDate.of(2026, 10, 17), mode)
                            DayRhythmPanel(true)
                        }
                    }
                }
            }
        }
        for (eveningMode in listOf(false, true)) {
            compose.runOnIdle { dark = eveningMode; sacred = false }
            for (savedMode in CalendarMode.entries) {
                compose.runOnIdle { mode = savedMode }
                val heroHeight = compose.onNodeWithTag("today-hero").fetchSemanticsNode().boundsInRoot.height
                assertTrue(heroHeight <= 260 * compose.activity.resources.displayMetrics.density)
                compose.onNodeWithText("Суббота").assertIsDisplayed()
                compose.onNodeWithText("17 октября 2026").assertIsDisplayed()
                compose.onAllNodesWithText("17 октября 2026").assertCountEquals(1)
                compose.onNodeWithText("ГРИГОРИАНСКИЙ КАЛЕНДАРЬ", substring = true).assertDoesNotExist()
                compose.onNodeWithTag("today-calendar-plaque").assertDoesNotExist()
                compose.onNodeWithTag("today-hero-date").assertDoesNotExist()
                compose.onNodeWithTag("today-hero-description").assertDoesNotExist()
                compose.onNodeWithTag("today-calendar-image").assertDoesNotExist()
                compose.onNodeWithTag("today-lunar-phase").assertDoesNotExist()
                compose.onNodeWithTag("today-day-rhythm").assertDoesNotExist()
            }
            val name = if (eveningMode) "dark" else "light"
            compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
                File(compose.activity.cacheDir, "plain-today-$name.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            }
            compose.runOnIdle { sacred = true; mode = CalendarMode.PROFANE }
            compose.onNodeWithTag("today-calendar-name", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-calendar-image", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-hero-date", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-day-rhythm").assertExists()
        }
    }
}
