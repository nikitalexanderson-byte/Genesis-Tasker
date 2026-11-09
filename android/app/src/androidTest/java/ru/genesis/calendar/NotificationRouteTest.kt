package ru.genesis.calendar

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import ru.genesis.calendar.reminders.habitNotificationBody
import ru.genesis.calendar.reminders.habitNotificationOpenIntent
import ru.genesis.calendar.reminders.supportTipsOpenIntent

class NotificationRouteTest {
    @Test fun supportNotificationOpensTheScopedSettingsButtonWithoutACheckoutUrl() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val intent = supportTipsOpenIntent(app, app.workspaceScope)
        assertEquals("donation", requestedSection(intent, app.workspaceScope))
        assertEquals("genesis", intent.data?.scheme)
        assertEquals("section", intent.data?.host)
        assertFalse(intent.toUri(0).contains("cloudtips"))
        assertEquals(null, requestedSection(intent, "another-account-scope"))
    }

    @Test fun habitNotificationUsesPlainCopyAndOpensHabits() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val intent = habitNotificationOpenIntent(app, app.workspaceScope)
        assertEquals("habits", requestedSection(intent, app.workspaceScope))
        assertFalse(habitNotificationBody("heroic", "habit", 1, false)
            .contains(Regex("\\(\\d+\\)")))
    }
}
