package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import kotlin.math.abs

/** Inspect rendered pixels: palette remapping must not darken the fixed welcome artwork. */
class WelcomeContrast334Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun everyLanguageCanReachSignInAndLegalAtLargeFont() {
        var language by mutableStateOf("en")
        var dark by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) {
            CompositionLocalProvider(LocalGenesisLanguage provides language,
                LocalEveningTheme provides dark, LocalDarkPalette provides "blue",
                LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels / 360f, 1.3f)) {
                MaterialTheme(colorScheme = if (dark) eveningPalette("blue") else daylightPalette("blue"),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    WelcomeContent(AuthPanelState(checkedAt = 1L), language, {}, {}, onRetry = {}, onWeb = {}, onLegal = {})
                }
            }
        } }
        for (lang in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            for (night in listOf(false, true)) {
                compose.runOnIdle { language = lang; dark = night; epoch++ }
                for (tag in listOf("welcome-purpose-title", "welcome-intro", "welcome-google-sign-in",
                    "welcome-open-web", "welcome-terms", "welcome-privacy")) {
                    compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
                }
                captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome334-locales-$lang-$night.png"))
            }
        }
    }

    @Test fun welcomeKeepsAuthoredInkAndSurfaceInEveryHostPalette() {
        var palette by mutableStateOf("green")
        var dark by mutableStateOf(false)
        var language by mutableStateOf("en")
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) {
            CompositionLocalProvider(LocalGenesisLanguage provides language,
                LocalEveningTheme provides dark, LocalDarkPalette provides palette) {
                MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    WelcomeContent(AuthPanelState(checkedAt = 1L), language, {}, {}, onRetry = {}, onWeb = {}, onLegal = {})
                }
            }
        } }
        fun matchingPixels(tag: String, red: Int, green: Int, blue: Int): Int {
            val bitmap = compose.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
            var matches = 0
            for (y in 0 until bitmap.height step 2) for (x in 0 until bitmap.width step 2) {
                val pixel = bitmap.getPixel(x, y)
                if (abs(android.graphics.Color.red(pixel) - red) <= 5 &&
                    abs(android.graphics.Color.green(pixel) - green) <= 5 &&
                    abs(android.graphics.Color.blue(pixel) - blue) <= 5) matches++
            }
            return matches
        }
        for (p in listOf("green", "blue", "burgundy", "violet")) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night; epoch++ }
            compose.onNodeWithTag("welcome-intro").performScrollTo().assertIsDisplayed()
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "welcome334-before-after-$p-$night.png"))
            assertTrue("Cream/muted copy remains readable over the dark welcome background in $p/$night",
                matchingPixels("welcome-intro", 184, 201, 194) > 10)
            compose.onNodeWithTag("welcome-auth-card").performScrollTo().assertIsDisplayed()
            assertTrue("The authored dark green sign-in card is not remapped by $p/$night",
                matchingPixels("welcome-auth-card", 16, 49, 52) > 100)
        }
    }
}
