package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.auth.DailyAdvice
import ru.genesis.calendar.auth.DailyAdviceSource
import ru.genesis.calendar.auth.EmailVerificationStatus
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import java.io.File

/** Production composables, synthetic status only: no account login or external mail. */
class Release320UiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun theokyklosAxisAndGatesOpenInEveryColorScheme() {
        val app = compose.activity.application as ru.genesis.calendar.GenesisApplication
        check(BuildConfig.DEBUG && (app.packageName.endsWith(".qa320.debug") || app.packageName.endsWith(".aurora321.debug")))
        var dark by mutableStateOf(false)
        var palette by mutableStateOf("green")
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalDarkPalette provides palette) {
                MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else standart, typography = GenesisTypography) {
                    androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                        TheokyklosScreen(app, CalendarMode.SACRED, onOpenHabits = {})
                    }
                }
            }
        }
        for ((nightMode, next) in listOf(false to "green", true to "green", true to "burgundy", true to "blue", true to "violet")) {
            compose.runOnIdle { dark = nightMode; palette = next }
            compose.onNodeWithTag("theokyklos-mandala").performScrollTo().assertIsDisplayed()
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-theokyklos-$nightMode-$next.png"))
            for ((id, title) in listOf("zenith" to "Зенит · Вертикаль Власти", "entrance" to "Вход · Врата Света")) {
                compose.onNodeWithTag("theokyklos-sector-$id").performScrollTo().assertIsDisplayed()
                    .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).performClick()
                compose.onNodeWithText(title).assertIsDisplayed()
                compose.onNodeWithContentDescription("Закрыть").performClick()
            }
        }
    }

    @Test fun adviceDoesNotRenderImportedBlankRows() {
        var dark by mutableStateOf(false)
        val first = "Против врага: вынуждайте его принимать решения в условиях спешки и страха."
        val second = "Как союзник: трансформируйте её в \"молниеносную решимость\" при реализации просчитанных стратегий."
        val card = DailyAdvice("advice-" + "b".repeat(24), "2026-11-05", "Направление Опрометчивости (Пропетейа)",
            "$first\n\n \t\n\n$second", "ru", listOf("psychopompia"), null, false, emptyList())
        compose.setContent { CompositionLocalProvider(LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography) {
                val copy = LocalContext.current.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader()
                    .use { JSONObject(it.readText()).getJSONObject("ru") }
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                    DailyAdviceCard(card, copy, null, false, false, onDismiss = {})
                }
            }
        } }
        for(scheme in listOf("light", "dark")) {
            compose.runOnIdle { dark = scheme == "dark" }
            compose.onNodeWithTag("daily-advice-body").assertTextEquals("$first\n$second")
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-advice-spacing-$scheme.png"))
        }
    }
    @Test fun sacredArtworkUsesEveryAdditionalPaletteWhileGregorianKeepsItsOwnColors() {
        var palette by mutableStateOf("green")
        compose.setContent { CompositionLocalProvider(LocalEveningTheme provides true, LocalDarkPalette provides palette) {
            MaterialTheme(colorScheme = eveningPalette(palette)) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    OriginalImage("day-art-v1/month-07/day-09.webp", "Сакральная иллюстрация",
                        Modifier.fillMaxWidth().height(210.dp), artworkTint = todayHeroArtworkTint(CalendarMode.SACRED, true, palette))
                    OriginalImage("weekday-art/weekday-4-thursday-zeus-hera.webp", "Григорианская иллюстрация",
                        Modifier.fillMaxWidth().height(210.dp), artworkTint = todayHeroArtworkTint(CalendarMode.PROFANE, true, palette))
                }
            }
        } }
        for(next in listOf("green", "burgundy", "blue", "violet")) {
            compose.runOnIdle { palette = next }
            compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("Сакральная иллюстрация").fetchSemanticsNodes().isNotEmpty() &&
                compose.onAllNodesWithContentDescription("Григорианская иллюстрация").fetchSemanticsNodes().isNotEmpty() }
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-artwork-$next.png"))
        }
    }
    @Test fun translucentThemeInkKeepsContrastOnAccentSurfacesInEveryPalette() {
        var palette by mutableStateOf("green")
        compose.setContent {
            val scheme = eveningPalette(palette)
            CompositionLocalProvider(LocalEveningTheme provides true, LocalDarkPalette provides palette) {
                MaterialTheme(colorScheme = scheme, typography = GenesisTypography) {
                    androidx.compose.material3.Surface(color = scheme.primary) {
                        Column(Modifier.fillMaxWidth().safeDrawingPadding().padding(16.dp)) {
                            UntranslatedText("Проверка контраста", Modifier.testTag("contrast-role-text"), color = scheme.onPrimary.copy(alpha = .82f))
                            SacredYearDetailsButton("Подробнее", "Сакральная геометрия времени", "contrast-learn-more") {}
                            SacredYearDetailsButton("Круг GENESIS", "Интерактивная модель календаря", "contrast-genesis-circle") {}
                            SacredYearDetailsButton("Метод моделирования будущего", "От символического диагноза к намерению и действию", "contrast-future-modeling") {}
                        }
                    }
                }
            }
        }
        for(next in listOf("green", "burgundy", "blue", "violet")) {
            compose.runOnIdle { palette = next }
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("contrast-role-text").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val scheme = eveningPalette(next)
            assertEquals(scheme.onPrimary.copy(alpha = .82f), layouts.single().layoutInput.style.color)
            val ink = scheme.onPrimary.copy(alpha = .82f).compositeOver(scheme.primary).luminance()
            val background = scheme.primary.luminance()
            assertTrue("Accent contrast: $next", (maxOf(ink,background)+.05f)/(minOf(ink,background)+.05f)>=4.5f)
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-contrast-$next.png"))
        }
    }
    @Test fun mandatoryNoticeKeepsTouchTargetsAndHidesOnlyAfterConfirmation() {
        var dark by mutableStateOf(false)
        var status by mutableStateOf(EmailVerificationStatus(true, false))
        var cooldown by mutableIntStateOf(0)
        var requests = 0; var checks = 0
        compose.setContent { CompositionLocalProvider(LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography) {
                val copy = LocalContext.current.assets.open("originals/i18n/email-verification-copy.json").bufferedReader()
                    .use { JSONObject(it.readText()).getJSONObject("ru") }
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                    EmailVerificationNoticeContent("qa@example.invalid", status, copy, false, cooldown, null,
                        onSend = { requests++ }, onCheck = { checks++ })
                }
            }
        } }
        for(scheme in listOf("light", "dark")) {
            compose.runOnIdle { dark = scheme == "dark" }
            compose.onNodeWithTag("email-verification-send").assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
            compose.onNodeWithTag("email-verification-check").assertHeightIsAtLeast(48.dp).performClick()
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-email-$scheme.png"))
        }
        assertEquals(2, requests); assertEquals(2, checks)
        compose.runOnIdle { cooldown = 60 }
        compose.onNodeWithTag("email-verification-send").assertIsNotEnabled()
        compose.onNodeWithTag("email-verification-notice").assertExists()
        compose.runOnIdle { status = EmailVerificationStatus(false, true, true) }
        compose.onNodeWithTag("email-verification-notice").assertDoesNotExist()
    }

    @Test fun philosopherContextAndAuthorRemainSeparateInBothSchemes() {
        var dark by mutableStateOf(false)
        val card = DailyAdvice("advice-" + "a".repeat(24), "2026-11-04", "Афоризмы философов",
            "(О дружбе) Дружба — благо.\nЭпикур", "ru", emptyList(), null, false,
            listOf(DailyAdviceSource("quote", "Эпикур", "Античный источник", "")), collection = "philosophers")
        compose.setContent { CompositionLocalProvider(LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography) {
                val copy = LocalContext.current.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader()
                    .use { JSONObject(it.readText()).getJSONObject("ru") }
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                    DailyAdviceCard(card, copy, null, false, false, onDismiss = {})
                }
            }
        } }
        for(scheme in listOf("light", "dark")) {
            compose.runOnIdle { dark = scheme == "dark" }
            compose.onNodeWithTag("daily-advice-context").assertTextEquals("О дружбе")
            compose.onNodeWithTag("daily-advice-body").assertTextEquals("Дружба — благо.")
            compose.onNodeWithTag("daily-advice-author").assertTextEquals("(Эпикур)")
            val body = compose.onNodeWithTag("daily-advice-body").fetchSemanticsNode().boundsInRoot
            val author = compose.onNodeWithTag("daily-advice-author").fetchSemanticsNode().boundsInRoot
            assertTrue(author.top > body.bottom)
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-quote-$scheme.png"))
        }
    }
}
