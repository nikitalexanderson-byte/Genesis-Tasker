package ru.genesis.calendar.ui

import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import ru.genesis.calendar.BuildConfig

/** Close the actual IME without a Back event that could dismiss the editor. */
internal fun ComposeTestRule.dismissValidationKeyboard() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    check(BuildConfig.DEBUG && instrumentation.targetContext.packageName in setOf("ru.genesis.calendar.v313.debug", "ru.genesis.calendar.qa1103.debug", "ru.genesis.calendar.qa322.debug"))
    waitForIdle()
    Espresso.closeSoftKeyboard()
    waitForIdle()
}
