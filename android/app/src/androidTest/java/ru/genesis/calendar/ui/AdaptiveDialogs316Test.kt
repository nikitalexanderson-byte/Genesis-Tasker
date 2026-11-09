package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
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
import java.io.File
import org.json.JSONObject
import ru.genesis.calendar.auth.AdvicePreferences
import ru.genesis.calendar.auth.DailyAdvice

/** Geometry is measured on the actual Compose shells; the fixture has no account or network. */
class AdaptiveDialogs316Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val fontScale = InstrumentationRegistry.getArguments().getString("genesisFontScale")?.toFloatOrNull() ?: 1f
    private var dark by mutableStateOf(false)
    private var shell by mutableIntStateOf(0)
    private var expanded by mutableStateOf(false)
    private var density = 1f
    private var dialogDensity = 1f

    @Composable private fun Body() {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Короткое содержимое окна")
            if (expanded) repeat(32) { Text("Подробная информация · ${it + 1}") }
        }
    }
    @Composable private fun Actions() {
        dialogDensity = LocalDensity.current.density
        Button({ expanded = !expanded }, Modifier.fillMaxWidth().testTag("adaptive-toggle")) { Text(if (expanded) "Свернуть" else "Подробнее") }
    }
    @Composable private fun Card() {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            EditorDialogHeader("Проверка высоты окна", "adaptive-close") {}
            Box(Modifier.weight(1f, fill = false)) { Body() }
            Actions()
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "adaptive316-$width-$fontScale-${if(dark)"dark"else"light"}-$shell-$name.png"))
    }
    @Test fun dialogsGrowAndShrinkWithContentAtTheSameWidthAndKeepActionsVisible() {
        compose.setContent {
            density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
            CompositionLocalProvider(LocalDensity provides Density(density, fontScale), LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                        when(shell) {
                            0 -> Dialog({}) { GenesisModalFrame({}) { Card() } }
                            1 -> Dialog({}) { Surface { Card() } }
                            else -> AlertDialog({}, { Actions() }, title = { Text("Проверка высоты окна") }, text = { Body() })
                        }
                    }
                }
            }
        }
        for (night in listOf(false, true)) for (kind in 0..2) {
            compose.runOnIdle { expanded = false; dark = night; shell = kind }
            val short = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInWindow
            val action = compose.onNodeWithTag("adaptive-toggle").assertIsDisplayed().fetchSemanticsNode().boundsInWindow
            capture("short")
            // Android's separate Dialog window owns its density; the parent-only
            // override does not resize that window. Measure its actual dp units.
            assertTrue("No empty lower half: parentWidth=$width shell=$kind density=$dialogDensity surface=$short action=$action", (short.bottom - action.bottom) / dialogDensity < 40f)
            compose.onNodeWithTag("adaptive-toggle").performClick()
            val tall = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInWindow
            assertEquals("Width stays standard", short.width, tall.width, 1f)
            assertTrue("Expanded content increases height", tall.height > short.height + 80 * dialogDensity)
            compose.onNodeWithTag("adaptive-toggle").assertIsDisplayed()
            capture("expanded")
            compose.onNodeWithTag("adaptive-toggle").performClick()
            val restored = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInWindow
            assertEquals("Collapsing releases unused height", short.height, restored.height, 1f)
        }
    }

    @Test fun emptyAdminPanelFitsItsContentWithoutAnEmptyListViewport() {
        var open by mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides "qa-adaptive316", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                        if(open) NativeAdminPanel({ open = false },
                            load = { JSONObject().put("users", org.json.JSONArray()) },
                            deleteUser = { _, _ -> error("No admin mutation is allowed in this fixture") })
                    }
                }
            }
        }
        for(night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            compose.onNodeWithText("Пользователей пока нет.").assertIsDisplayed()
            val frame = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInWindow
            val close = compose.onNodeWithTag("admin-close-text").assertIsDisplayed().fetchSemanticsNode().boundsInWindow
            val actualDensity = compose.activity.resources.displayMetrics.density
            assertTrue("An empty admin list must not fill the screen", frame.height < compose.activity.resources.displayMetrics.heightPixels * .7f)
            assertTrue("Actions end at the common padding", (frame.bottom - close.bottom) / actualDensity < 40f)
            capture("admin-compact")
        }
        compose.onNodeWithTag("admin-close-text").performClick()
        compose.onNodeWithTag("genesis-modal-surface").assertDoesNotExist()
    }

    @Test fun adviceAttributionUsesOneLineAndOriginOpensASeparateDialog() {
        var settings by mutableStateOf(false)
        var attributionLines = 0
        var notice = ""
        compose.setContent {
            density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
            val context = LocalContext.current
            val copy = remember { JSONObject(context.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru") }
            notice = copy.getString("privacyNotice")
            CompositionLocalProvider(LocalDensity provides Density(density, fontScale), LocalGenesisLanguage provides "ru",
                LocalGenesisTextLayoutAudit provides { text, layout -> if(text.contains(" · Гестиология")) attributionLines = layout.lineCount }) {
                MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                            if(settings) DailyAdviceSettings(AdvicePreferences(), listOf("hestiology"), true, "ru", true) { AdvicePreferences() }
                            else DailyAdviceCard(DailyAdvice("advice-" + "a".repeat(24), "2026-11-03", "Смысл дня", "Полный текст совета", "ru",
                                listOf("hestiology"), null, false, emptyList()), copy, null, false, false,
                                showReactions = false, showDismiss = false, onDismiss = {})
                        }
                    }
                }
            }
        }
        compose.onNodeWithTag("daily-advice-attribution").assertIsDisplayed()
        compose.runOnIdle { assertEquals("Attribution must stay on one line", 1, attributionLines); settings = true }
        compose.onNodeWithText(notice).assertDoesNotExist()
        compose.onNodeWithTag("advice-origin-open").performScrollTo().performClick()
        compose.onNodeWithTag("genesis-modal-surface").assertIsDisplayed()
        compose.onNodeWithText(notice).assertExists()
        capture("advice-origin")
        compose.onNodeWithContentDescription("Закрыть").performClick()
        compose.onNodeWithTag("genesis-modal-surface").assertDoesNotExist()
    }
}
