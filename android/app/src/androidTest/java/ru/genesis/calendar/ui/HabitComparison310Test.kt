package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import java.io.File
import java.time.LocalDate

class HabitComparison310Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    @Test fun periodsAndResultsAreLabeledWithoutClippingOrAmbiguousFractions() {
        val args = InstrumentationRegistry.getArguments()
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 360
        val dark = args.getString("genesisEvening") == "true"
        var language by mutableStateOf("ru")
        var mode by mutableStateOf(CalendarMode.SACRED)
        var elapsed by mutableIntStateOf(5)
        val current = HabitComparisonPart(0, 5, 4, 0); val previous = HabitComparisonPart(2, 4, 3, 0)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, 1f),
                LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        HabitComparisonDetails(HabitGoalComparison(current, previous, elapsed, LocalDate.of(2026, 10, 19),
                            LocalDate.of(2026, 10, 12), if (elapsed == 0) null else LocalDate.of(2026, 10, 16), 0), GenesisCalendar(), mode)
                    } }
                }
            }
        }
        compose.onNodeWithText("Текущий период").assertIsDisplayed()
        compose.onNodeWithText("Предыдущий период").assertIsDisplayed()
        compose.onNodeWithText("Выполнено 0 из 5 целей").assertExists()
        compose.onNodeWithText("Выполнено 2 из 4 целей").assertExists()
        compose.onNodeWithText("Разница: -2").assertExists()
        compose.onNodeWithTag("habit-comparison-change").performScrollTo().assertIsDisplayed()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "comparison310-$width-${if(dark) "dark" else "light"}.png"))
        listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja").forEach { lang ->
            compose.runOnIdle { language = lang }
            listOf("habit-comparison-current", "habit-comparison-previous", "habit-comparison-change").forEach { tag ->
                val parent = compose.onNodeWithTag(tag).performScrollTo().fetchSemanticsNode().boundsInRoot
                compose.onAllNodes(hasAnyAncestor(hasTestTag(tag)) and hasText("{", substring = true)).assertCountEquals(0)
                assertTrue("$lang $tag must fit the available width", parent.left >= 0 && parent.right <= compose.activity.resources.displayMetrics.widthPixels + 1)
            }
        }
        compose.runOnIdle { language = "ru"; elapsed = 0 }
        compose.onNodeWithTag("habit-comparison-empty").assertExists()
        compose.onNodeWithTag("habit-comparison-change").assertDoesNotExist()
    }
}
