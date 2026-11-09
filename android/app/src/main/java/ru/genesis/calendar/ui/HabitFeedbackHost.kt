package ru.genesis.calendar.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitFeedbackEvent

@Composable internal fun feedbackCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        context.assets.open("originals/i18n/habit-feedback-copy.json").bufferedReader().use {
            val root = JSONObject(it.readText()); root.optJSONObject(language) ?: root.getJSONObject("en")
        }
    }
}

@Composable internal fun HabitFeedbackHost(app: GenesisApplication, scope: String) {
    val haptic = LocalHapticFeedback.current
    val player = remember(app) { HabitFeedbackPlayer(app) }
    var event by remember(scope) { mutableStateOf<HabitFeedbackEvent?>(null) }
    val language = LocalGenesisLanguage.current
    val copy = feedbackCopy()
    DisposableEffect(player) { onDispose { player.close() } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(app, scope, language, lifecycle) {
      lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        app.habitFeedback.collectLatest { next ->
            if (next.scope != scope || app.workspaceScope != scope) return@collectLatest
            event = next
            if (next.settings.sound) player.play(next.settings.soundScheme, next.kind)
            if (next.settings.haptics) runCatching { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
            if (next.settings.achievementPopups && next.achievements > 0)
                runCatching { app.scheduler.showAchievementNotification(next.achievements, language) }
            try { delay(2600) } finally { event = null }
        }
    }
    }
    event?.let { current ->
        HabitFeedbackNotice(copy.getString(current.kind), current.habitTitle, current.settings.animations,
            key = current, icon = when(current.kind) { "quest" -> "check-check"; "rank-up" -> "sparkles"
                "achievement" -> "star"; else -> "check" })
    }
}

@Composable internal fun HabitFeedbackNotice(title: String, detail: String, animations: Boolean,
    key: Any, icon: String = "check") {
    val motion = animations && android.animation.ValueAnimator.areAnimatorsEnabled()
    val phase = remember(key) { Animatable(if (motion) 0f else 1f) }
    LaunchedEffect(key, motion) { if (motion) phase.animateTo(1f) else phase.snapTo(1f) }
    Popup(alignment = Alignment.BottomCenter, properties = PopupProperties(focusable = false)) {
        Surface(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 16.dp, vertical = 76.dp)
            .widthIn(max = 480.dp).fillMaxWidth().testTag("habit-feedback-notice")
            .semantics { liveRegion = LiveRegionMode.Polite }
            .graphicsLayer { alpha = phase.value; translationY = (1 - phase.value) * 18.dp.toPx() },
            shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer, shadowElevation = 6.dp) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                GenesisLucideIcon(icon, Modifier.size(28.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    if (detail.isNotBlank()) Text(detail, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
                }
            }
        }
    }
}
