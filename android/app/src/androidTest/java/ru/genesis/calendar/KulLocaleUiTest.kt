package ru.genesis.calendar

import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

/** Real production surfaces and platform rendering; no external account or user records. */
class KulLocaleUiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun allLanguagesAndFourCalendarConfigurationsRenderWithoutChangingTheSelectedCivilDate() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisKulCapture") == "true")
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val languages = args.getString("genesisKulLanguages", "ru").let { if (it == "all") listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja") else it.split(',') }
        val expectedWidth = args.getString("genesisWidth")!!.toFloat()
        val folder = File(app.getExternalFilesDir(null), "kul-ui").apply { mkdirs() }
        var language by mutableStateOf("ru"); var dark by mutableStateOf(false); var welcome by mutableStateOf(true)
        var mode by mutableStateOf(CalendarMode.PROFANE); var march by mutableStateOf(false)
        val date = LocalDate.parse("2024-02-29"); val selected = mutableListOf<LocalDate>()
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize().testTag("kul-root")) {
                        if (welcome) WelcomeScreen(AuthPanelState(), AuthController.get(app), language) { language = it }
                        else key(mode, march) { CalendarScreen(date, mode, { selected.add(it) }, experimental = true, gregorianYearStartsInMarch = march) }
                    }
                }
            }
        }
        fun capture(name: String) {
            compose.waitForIdle(); compose.onNodeWithTag("kul-root").captureToImage()
            val root = compose.onNodeWithTag("kul-root").fetchSemanticsNode()
            assertEquals(expectedWidth, root.boundsInRoot.width / root.layoutInfo.density.density, 1f)
            val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
            ParcelFileDescriptor.AutoCloseInputStream(pipe).use { input -> File(folder, "$name.png").outputStream().use(input::copyTo) }
        }
        for (locale in languages) for (night in listOf(false, true)) {
            compose.runOnIdle { language = locale; dark = night; welcome = true }
            compose.onNodeWithTag("welcome-google-sign-in").assertExists()
            capture("${expectedWidth.toInt()}-$locale-${if (night) "dark" else "light"}-welcome")
            for ((calendar, startsInMarch) in listOf(CalendarMode.PROFANE to false, CalendarMode.PROFANE to true, CalendarMode.SACRED to false, CalendarMode.LUNAR to false)) {
                compose.runOnIdle { welcome = false; mode = calendar; march = startsInMarch }
                compose.onNodeWithTag("genesis-page-header").assertExists()
                capture("${expectedWidth.toInt()}-$locale-${if (night) "dark" else "light"}-${calendar.name}-$startsInMarch")
            }
        }
        assertTrue("Rendering and switching language must not select or move a date", selected.isEmpty())
    }
}
