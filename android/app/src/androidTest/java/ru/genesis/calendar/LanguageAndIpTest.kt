package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.resolveSeasonZoneByIp

class LanguageAndIpTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun accountLanguageChangesWorkspaceNavigationAndLayoutDirection() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first().language }
        try {
            val menu = compose.onNodeWithTag("workspace-menu")
            compose.waitUntil(20_000) { menu.isDisplayed() }
            menu.performClick()
            val today = hasTestTag("drawer-Сегодня-root")
            val projects = compose.onNodeWithTag("drawer-Проекты-root")
            val titles = mapOf("pl" to "Dzisiaj", "ja" to "今日", "he" to "היום",
                "ar" to "اليوم", "ko" to "오늘", "nl" to "Vandaag")
            for ((code, title) in titles) {
                runBlocking { prefs.set("language", code) }
                val translated = today and hasContentDescription(title)
                compose.waitUntil(20_000) {
                    compose.onAllNodes(translated).fetchSemanticsNodes().isNotEmpty()
                }
                val direction = if (code == "he" || code == "ar") LayoutDirection.Rtl else LayoutDirection.Ltr
                assertEquals(code, direction, compose.onNode(translated).fetchSemanticsNode().layoutInfo.layoutDirection)
                assertEquals(code, direction, projects.fetchSemanticsNode().layoutInfo.layoutDirection)
                assertEquals(code, runBlocking { LocalPreferences(app, app.workspaceScope).selectedLanguage.first().selected })
            }
            projects.performScrollTo().performClick()
            compose.onNodeWithTag("app-header").assertIsDisplayed()
        } finally { runBlocking { prefs.set("language", original) } }
    }

    @Test fun taskReminderCountHintExplainsGoogleLimitInJapaneseAndTurkish() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first().language }
        try {
            compose.scrollToTodayNode(hasTestTag("create-task"))
            compose.onNodeWithTag("create-task").performClick()
            runBlocking { prefs.set("language", "ja") }
            compose.onNodeWithText("この数字は追加した通知の数です。Google カレンダーでは、予定ごとに最大5件まで設定できます。")
                .performScrollTo().assertExists()
            runBlocking { prefs.set("language", "tr") }
            compose.onNodeWithText("Sayı, eklenen hatırlatıcıların sayısını gösterir. Google Takvim bir etkinlik için en fazla beş hatırlatıcıya izin verir.")
                .performScrollTo().assertExists()
        } finally { runBlocking { prefs.set("language", original) } }
    }

    @Test fun ipRegionReturnsNamedIanaZoneOnEmulatorNetwork() {
        val region = runBlocking { withContext(Dispatchers.IO) { resolveSeasonZoneByIp() } }
        assertEquals(region.zone, ZoneId.of(region.zone.id))
        assertTrue(region.label.isNotBlank())
    }

    @Test fun todayIconChangesDisplayCalendarOnly() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first() }
        try {
            runBlocking { prefs.set("display", "sacred") }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("today-calendar-plaque").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("today-calendar-plaque").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("calendar-mode-icon-lunar", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
            assertEquals(CalendarMode.LUNAR, runBlocking { prefs.values.first().display })
            assertEquals(original.input, runBlocking { prefs.values.first().input })
        } finally { runBlocking { prefs.set("display", original.display.wireValue) } }
    }
}
