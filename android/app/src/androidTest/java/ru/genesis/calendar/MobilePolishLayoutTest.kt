package ru.genesis.calendar

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

class MobilePolishLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 360
    private fun content(block: @Composable () -> Unit) {
        compose.setContent {
            val original = LocalDensity.current
            val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, original.fontScale)
            CompositionLocalProvider(LocalDensity provides density) {
                MaterialTheme(colorScheme = standart) {
                    Surface(Modifier.fillMaxSize(), color = standart.background) {
                        Column(Modifier.safeDrawingPadding().padding(8.dp)) { block() }
                    }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val file = File(instrumentation.targetContext.getExternalFilesDir(null), "2.3.4-${width}dp-$name.png")
        file.outputStream().use { output ->
            assertTrue(compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, output))
        }
    }

    @Test fun sacredHeroAndPyatasShareCardAndKeepDisclosureAndDayNavigation() {
        content { CalendarScreen(LocalDate.of(2026, 9, 28), CalendarMode.SACRED, {}, experimental = true) }
        compose.onNodeWithTag("sacred-month-pyatas").assertExists()
        compose.onNodeWithTag("sacred-month-hero").assert(hasAnyAncestor(hasTestTag("sacred-month-pyatas")))
        compose.onNodeWithTag("pyata-1").assert(hasAnyAncestor(hasTestTag("sacred-month-pyatas")))
        capture("sacred-month-top")
        compose.onNodeWithTag("pyata-1").performScrollTo().performClick()
        capture("sacred-pyata-expanded")
        compose.onNodeWithTag("calendar-day-2026-09-26").performScrollTo().performClick()
        compose.waitUntil(10_000) {
            val card = compose.onNodeWithTag("calendar-selected-day").fetchSemanticsNode().boundsInRoot
            val viewport = compose.onNodeWithTag("calendar-month").fetchSemanticsNode().boundsInRoot
            card.top >= viewport.top - 3 && card.top <= viewport.top + 12 * compose.activity.resources.displayMetrics.density
        }
    }

    @Test fun animatedHeadersChangeAcrossCycleWhileMenuIconsStayStill() {
        compose.mainClock.autoAdvance = false
        content {
            GenesisPageHeader("Задачи", "Последовательная прорисовка галочек", "")
            Spacer(Modifier.height(12.dp))
            GenesisPageHeader("Проекты", "Прорисовка дерева внутри папки", "")
            Spacer(Modifier.height(12.dp))
            GenesisPageHeader("Привычки", "Мягкое дыхание листика и движение точки", "")
            Spacer(Modifier.height(12.dp))
            GenesisPageHeader("Теокиклос", "Импульсы от центра к восьми точкам", "", animatedMandala = true)
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                listOf(GenesisPageIcon.TASKS, GenesisPageIcon.PROJECTS, GenesisPageIcon.HABITS).forEach {
                    GenesisVectorIcon(it, Modifier.size(32.dp), animated = false)
                }
            }
        }
        compose.mainClock.advanceTimeBy(32)
        fun bitmap(tag: String): Bitmap = compose.onNodeWithTag(tag, useUnmergedTree = true).captureToImage().asAndroidBitmap()
        val fixed = listOf("tasks", "projects", "habits").associateWith { bitmap("genesis-icon-$it-static") }
        val animated = listOf("tasks", "projects", "habits").associateWith { bitmap("genesis-icon-$it-animated") }
        val mandala = bitmap("genesis-theokyklos-mandala")
        capture("icons-start")
        compose.mainClock.advanceTimeBy(1_360)
        capture("icons-drawing")
        compose.mainClock.advanceTimeBy(2_200)
        capture("icons-drawn")
        fixed.forEach { (name, before) -> assertTrue("Menu $name must stay static", before.sameAs(bitmap("genesis-icon-$name-static"))) }
        animated.forEach { (name, before) -> assertFalse("Heading $name must animate", before.sameAs(bitmap("genesis-icon-$name-animated"))) }
        assertFalse(mandala.sameAs(bitmap("genesis-theokyklos-mandala")))
        compose.mainClock.advanceTimeBy(2_700)
        capture("icons-erasing")
    }
}
