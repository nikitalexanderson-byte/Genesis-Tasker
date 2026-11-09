package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/** Window height also covers a phone in landscape and a tablet in split screen. */
@Composable internal fun compactWindowHeight(): Boolean = LocalConfiguration.current.screenHeightDp < 480

@Composable internal fun TodayWorkspace(header: @Composable () -> Unit,
    rhythm: @Composable () -> Unit, tasks: @Composable () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 840.dp) Row(Modifier.fillMaxSize().padding(16.dp).testTag("today-two-pane"),
            horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) { header(); rhythm() }
            Column(Modifier.weight(1.15f).fillMaxHeight().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) { tasks() }
        } else LazyColumn(Modifier.fillMaxSize().testTag("today-list"),
            contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { header() }
            item { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { tasks() } }
            item { rhythm() }
        }
    }
}

/** Complete cards, in reading order, without nested scrolling containers. */
@Composable internal fun <T> AdaptiveCardGrid(items: List<T>, itemKey: (T) -> Any,
    content: @Composable (T) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= 760.dp) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items.chunked(columns).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { item -> key(itemKey(item)) { Box(Modifier.weight(1f)) { content(item) } } }
                    if (row.size < columns) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

/** Settings pages scroll from immediately below their submenu on a phone. */
@Composable internal fun SettingsPageSections(sequential: Boolean = false,
    retainedScrollState: ScrollState? = null, content: @Composable () -> Unit) {
    val scrollState = retainedScrollState ?: rememberScrollState()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 840.dp && !sequential) AdaptiveSettingsSections(scrollState, content)
        else Column(Modifier.fillMaxSize().verticalScroll(scrollState)
            .padding(16.dp).testTag("settings-page-sections"),
            verticalArrangement = Arrangement.spacedBy(14.dp)) { content() }
    }
}

internal const val FULL_WIDTH_SETTINGS_SECTION = "genesis-settings-full-width"

/** Equal columns use each other's free height; marked sections span the complete page. */
@Composable internal fun AdaptiveSettingsSections(scrollState: ScrollState = rememberScrollState(),
    content: @Composable () -> Unit) {
    Layout(content = content, modifier = Modifier.fillMaxSize()
        .verticalScroll(scrollState).padding(16.dp)) { children, constraints ->
        val gap = 14.dp.roundToPx()
        val columns = if (constraints.maxWidth >= 840.dp.roundToPx()) 2 else 1
        val width = constraints.maxWidth
        val cellWidth = (width - gap * (columns - 1)) / columns
        val fullWidth = children.mapIndexed { index, child -> index == 0 || child.layoutId == FULL_WIDTH_SETTINGS_SECTION }
        val measured = children.mapIndexed { index, child ->
            child.measure(Constraints.fixedWidth(if (fullWidth[index]) width else cellWidth))
        }
        val positions = mutableListOf<Pair<Int, Int>>()
        val bottom = IntArray(columns)
        measured.forEachIndexed { index, child ->
            if (fullWidth[index]) {
                val y = bottom.maxOrNull() ?: 0
                positions.add(0 to y)
                bottom.fill(y + child.height + gap)
            } else {
                val column = bottom.indices.minByOrNull { bottom[it] } ?: 0
                positions.add(column * (cellWidth + gap) to bottom[column])
                bottom[column] += child.height + gap
            }
        }
        layout(width, ((bottom.maxOrNull() ?: 0) - gap).coerceAtLeast(0)) {
            measured.forEachIndexed { index, child ->
                child.placeRelative(positions[index].first, positions[index].second)
            }
        }
    }
}
