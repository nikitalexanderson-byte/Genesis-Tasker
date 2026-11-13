package ru.genesis.calendar.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal val LocalCalendarPeriodSwipeEnabled = staticCompositionLocalOf { true }

/** Horizontal touch slop leaves vertical scrolling and taps to the calendar's children. */
@Composable
internal fun <T : Any> CalendarPeriodPager(period: T, previousPeriod: T?, nextPeriod: T?,
    onPrevious: () -> Unit, onNext: () -> Unit,
    modifier: Modifier = Modifier, fillHeight: Boolean = false,
    transitionMillis: Int = 420,
    content: @Composable (T, () -> Unit, () -> Unit) -> Unit) {
    var dragPixels by remember(period) { mutableFloatStateOf(0f) }
    var incoming by remember(period) { mutableStateOf<Pair<T, Int>?>(null) }
    var width by remember { mutableIntStateOf(0) }
    var settling by remember { mutableStateOf(false) }
    var motionJob by remember { mutableStateOf<Job?>(null) }
    val scope = rememberCoroutineScope()
    val threshold = with(LocalDensity.current) { 64.dp.toPx() }
    val previous by rememberUpdatedState(onPrevious)
    val next by rememberUpdatedState(onNext)
    val previousPage by rememberUpdatedState(previousPeriod)
    val nextPage by rememberUpdatedState(nextPeriod)
    val durationMillis by rememberUpdatedState(transitionMillis.coerceAtLeast(0))
    val swipeEnabled = LocalCalendarPeriodSwipeEnabled.current
    DisposableEffect(period) {
        onDispose { motionJob?.cancel(); settling = false }
    }
    val finish: (Int) -> Unit = { step ->
        if (durationMillis == 0) {
            dragPixels = 0f; incoming = null
            if (step < 0) previous() else if (step > 0) next()
        } else {
            settling = true
            motionJob = scope.launch {
                try {
                    val destination = -step * width.toFloat()
                    val duration = (abs(destination - dragPixels) / width.coerceAtLeast(1) * durationMillis)
                        .roundToInt().coerceIn(minOf(180, durationMillis), durationMillis)
                    Animatable(dragPixels).animateTo(destination,
                        if (step == 0) spring(dampingRatio = 1f, stiffness = 240f)
                        else tween(duration, easing = CubicBezierEasing(.22f, .8f, .22f, 1f))) {
                        dragPixels = value
                    }
                    if (step < 0) previous() else if (step > 0) next()
                } finally {
                    dragPixels = 0f; incoming = null; settling = false
                }
            }
        }
    }
    val navigate: (Int) -> Unit = { step ->
        if (!settling) {
            val page = if (step < 0) previousPage else nextPage
            if (page == null || width == 0) {
                if (step < 0) previous() else next()
            } else {
                incoming = page to step
                finish(step)
            }
        }
    }
    val swipeModifier = if (swipeEnabled) Modifier.pointerInput(period, threshold) {
        detectHorizontalDragGestures(
            onDragCancel = { if (!settling) finish(0) },
            onDragEnd = {
                if (!settling) {
                    if (abs(dragPixels) >= threshold) navigate(if (dragPixels < 0) 1 else -1)
                    else finish(0)
                }
            },
            onHorizontalDrag = { change, amount ->
                if (!settling) {
                    change.consume()
                    dragPixels = (dragPixels + amount).coerceIn(-size.width * .85f, size.width * .85f)
                    incoming = if (dragPixels < 0) nextPage?.let { it to 1 }
                        else previousPage?.let { it to -1 }
                }
            })
    } else Modifier
    Box(modifier.clipToBounds().onSizeChanged { width = it.width }
        .animateContentSize(if (durationMillis == 0) snap() else
            tween(minOf(320, durationMillis), easing = CubicBezierEasing(.22f, .8f, .22f, 1f)))
        .then(swipeModifier)) {
        val pageModifier = if (fillHeight) Modifier.fillMaxSize() else Modifier.fillMaxWidth()
        key(period) {
            Box(pageModifier.offset { IntOffset(dragPixels.roundToInt(), 0) }) {
                content(period, { navigate(-1) }, { navigate(1) })
            }
        }
        incoming?.let { (page, step) ->
            key(page) {
                Box(pageModifier.offset { IntOffset((dragPixels + step * width).roundToInt(), 0) }) {
                    content(page, { navigate(-1) }, { navigate(1) })
                }
            }
        }
    }
}

/** Artwork stays visible: no fill at night, 80% transparent fill in daylight. */
@Composable
internal fun calendarArtworkControlBackground(): Color = if (LocalEveningTheme.current) Color.Transparent
    else MaterialTheme.colorScheme.surface.copy(alpha = .20f)

@Composable
internal fun CalendarMonthHeroNavigation(onPrevious: () -> Unit, onNext: () -> Unit, title: String? = null,
    offerToday: Boolean = false, onToday: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().testTag("calendar-month-navigation"),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        // The matching empty slot keeps the period centered when the return action appears.
        if (title != null) Row(Modifier.width(104.dp)) {
            PeriodArrow(-1, "month", onPrevious, artwork = true)
        } else {
            PeriodArrow(-1, "month", onPrevious, artwork = true)
        }
        if (title != null) Box(Modifier.weight(1f).padding(horizontal = 4.dp).testTag("month-description-name")) {
            Text(title, Modifier.fillMaxWidth().testTag("calendar-month-period").semantics { heading() },
                textAlign = TextAlign.Center, style = MaterialTheme.typography.titleLarge,
                translate = false)
        } else Spacer(Modifier.weight(1f))
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            if (offerToday) IconButton(onToday, Modifier.size(48.dp)
                .clip(AffairsLayout.controlShape).background(calendarArtworkControlBackground())
                .testTag("calendar-month-today").genesisDescription("Сегодня")) {
                GenesisLucideIcon("undo-2", Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        PeriodArrow(1, "month", onNext, artwork = true)
    }
}

@Composable
internal fun CalendarPeriodNavigation(title: String, year: Boolean,
    onPrevious: () -> Unit, onNext: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val english = LocalGenesisLanguage.current == "en"
    Row(Modifier.fillMaxWidth().testTag(if (year) "calendar-year-navigation" else "calendar-month-navigation")
        .background(colors.surface).padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        PeriodArrow(-1, if (year) "year" else "month", onPrevious)
        Text(title, Modifier.weight(1f).testTag(if (year) "calendar-year-period" else "calendar-month-period"),
            color = colors.onSurface, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        PeriodArrow(1, if (year) "year" else "month", onNext)
    }
}

@Composable
private fun PeriodArrow(direction: Int, period: String, onClick: () -> Unit, artwork: Boolean = false) {
    val english = LocalGenesisLanguage.current == "en"
    val label = genesisTranslate(if (english) "${if (direction < 0) "Previous" else "Next"} $period"
        else "${if (direction < 0) "Предыдущий" else "Следующий"} ${if (period == "year") "год" else "месяц"}")
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shift by animateFloatAsState(if (pressed) direction * 3f else 0f, spring(stiffness = Spring.StiffnessLow), label = "arrow-press")
    val ink = MaterialTheme.colorScheme.primary
    val background = if (artwork) Modifier.clip(AffairsLayout.controlShape)
        .background(calendarArtworkControlBackground()) else Modifier
    IconButton(onClick, Modifier.size(48.dp).then(background).testTag("calendar-$period-${if (direction < 0) "previous" else "next"}")
        .semantics { contentDescription = label }, interactionSource = interaction) {
        GenesisLucideIcon(if (direction < 0) "chevron-left" else "chevron-right",
            Modifier.size(24.dp).offset(x = shift.dp), tint = ink)
    }
}
