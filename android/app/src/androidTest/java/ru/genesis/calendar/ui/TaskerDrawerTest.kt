package ru.genesis.calendar.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.UiVisibility

/** Real drawer layout and callbacks, synthetic status only; no account or device data changes. */
class TaskerDrawerTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = args.getString("genesisDark") == "true"
    private val font get() = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f

    @Test fun everyLanguageFitsAndRefreshBelongsToAccount() {
        var language by mutableStateOf("ru")
        var refreshes = 0
        compose.setContent {
            val configuration = Configuration(LocalConfiguration.current).apply { screenWidthDp = width }
            val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, font)
            SideEffect {
                androidx.core.view.WindowInsetsControllerCompat(compose.activity.window, compose.activity.window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
            CompositionLocalProvider(LocalConfiguration provides configuration, LocalDensity provides density,
                LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        MobileWorkspaceShell("Сегодня", null, mobileDestinations(
                            listOf("Сегодня", "Календарь", "Проекты", "Дневник", "Сообщения", "Привычки", "Сакральное", "Настройки"),
                            UiVisibility(), true, true), "Аккаунт Genesis.\nЗащищенная локальная копия.\nСинхронизированно.", true,
                            onNavigate = {}, actions = {}, footerStatusLines = listOf(
                                genesisTranslate("Аккаунт Genesis.").trimEnd('.') + " · " + genesisTranslate("Синхронизированно.").trimEnd('.'),
                                genesisTranslate("Защищенная локальная копия.").trimEnd('.')), footerActions = {
                                WorkspaceAccountRefreshButton("Обновить аккаунт", onClick = { refreshes++ })
                            }) { Text("Synthetic workspace") }
                    }
                }
            }
        }
        compose.onNodeWithTag("workspace-menu").performClick()
        val codes = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        for (code in codes) {
            compose.runOnIdle { language = code }
            compose.onNodeWithTag("drawer-account-row").performScrollTo().assertIsDisplayed()
            compose.waitForIdle()
            val statuses = (0..1).map { index ->
                val status = compose.onNodeWithTag("drawer-account-status-$index").assertIsDisplayed()
                    .assert(hasAnyAncestor(hasTestTag("drawer-account-row")))
                val layouts = mutableListOf<TextLayoutResult>()
                status.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                assertEquals("Each account line must be measurable in $code", 1, layouts.size)
                assertFalse("Account line $index clips in $code/$width/font$font", layouts.single().hasVisualOverflow)
                assertEquals("Account line $index must stay on one line in $code", 1, layouts.single().lineCount)
                status
            }
            compose.onNodeWithTag("drawer-account-status-2").assertDoesNotExist()
            compose.onNodeWithTag("drawer-actions").performScrollTo().assertIsDisplayed()
            val button = compose.onNodeWithTag("account-refresh").assertIsDisplayed()
                .assert(hasAnyAncestor(hasTestTag("drawer-actions")))
            val bounds = button.fetchSemanticsNode().boundsInRoot
            val textBounds = statuses.map { it.assertIsDisplayed().fetchSemanticsNode().boundsInRoot }
            assertTrue("Account identity precedes the protected local copy", textBounds[0].bottom <= textBounds[1].top)
            assertTrue("Refresh actions must sit below the account status", bounds.top >= textBounds[1].bottom)
            val measuredDensity = button.fetchSemanticsNode().layoutInfo.density.density
            assertTrue("Refresh retains a 48dp touch target", bounds.width / measuredDensity >= 47.9f && bounds.height / measuredDensity >= 47.9f)
            button.performClick()
            if (code in listOf("ru", "en", "de", "ja")) captureNativeWindow(File(
                compose.activity.getExternalFilesDir(null), "tasker-306/drawer-$width-$dark-font$font-$code.png").apply { parentFile?.mkdirs() })
        }
        compose.runOnIdle { assertEquals(codes.size, refreshes) }
    }
}
