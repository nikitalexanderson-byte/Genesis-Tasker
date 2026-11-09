package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextStyle

internal val LocalWorkspaceBackgroundStatuses = staticCompositionLocalOf<MutableMap<Any, String>?> { null }
internal data class WorkspacePageNoticeContent(val message: String, val tag: String, val isError: Boolean,
    val retryEnabled: Boolean, val onRetry: (() -> Unit)?)
internal val LocalWorkspacePageNotices = staticCompositionLocalOf<MutableMap<Any, WorkspacePageNoticeContent>?> { null }

/** A page owns the message and recovery action; its shell displays them in the drawer footer. */
@Composable
internal fun WorkspacePageNotice(message: String, tag: String, isError: Boolean = false,
    retryEnabled: Boolean = true, onRetry: (() -> Unit)? = null) {
    val notices = LocalWorkspacePageNotices.current
    val key = remember { Any() }
    val latestRetry = rememberUpdatedState(onRetry)
    val retry = remember { { latestRetry.value?.invoke(); Unit } }
    val notice = remember(message, tag, isError, retryEnabled, onRetry != null) {
        WorkspacePageNoticeContent(message, tag, isError, retryEnabled, if (onRetry == null) null else retry)
    }
    val active = LocalNavigationPageContext.current?.active != false
    if (notices == null) {
        if (active) WorkspacePageNoticeCard(notice)
    } else DisposableEffect(notices, key, notice, active) {
        if (active) notices[key] = notice
        onDispose { notices.remove(key) }
    }
}

@Composable
internal fun WorkspacePageNoticeCard(notice: WorkspacePageNoticeContent, modifier: Modifier = Modifier, tag: String = notice.tag) {
    WorkspaceStatusNotice(notice.message, modifier.testTag(tag).semantics { liveRegion = LiveRegionMode.Polite }, isError = notice.isError) {
        notice.onRetry?.let { retry ->
            TextButton(onClick = retry, enabled = notice.retryEnabled,
                modifier = Modifier.heightIn(min = 48.dp).testTag("$tag-retry")) { Text("Повторить") }
        }
    }
}

/** Background activity is displayed by the drawer without shifting the current page. */
@Composable
internal fun WorkspaceBackgroundStatus(active: Boolean, label: String) {
    val statuses = LocalWorkspaceBackgroundStatuses.current
    val key = remember { Any() }
    DisposableEffect(statuses, active, label) {
        if (active) statuses?.set(key, label)
        onDispose { statuses?.remove(key) }
    }
}

@Composable
internal fun WorkspaceLoadingText(text: String = "Загрузка…", modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall) {
    if (LocalWorkspaceBackgroundStatuses.current != null) WorkspaceBackgroundStatus(true, genesisTranslate(text))
    else Text(text, modifier, style = style)
}

/** Transient account messages share a compact, word-wrapped block in the drawer footer. */
@Composable
internal fun WorkspaceStatusNotice(message: String, modifier: Modifier = Modifier, isError: Boolean = false,
    actions: @Composable ColumnScope.() -> Unit = {}) {
    Surface(modifier.fillMaxWidth(), shape = AffairsLayout.shape,
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(message, style = MaterialTheme.typography.bodySmall)
            actions()
        }
    }
}

@Composable
internal fun WorkspaceLoadingIndicator(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary,
    strokeWidth: Dp = 4.dp) {
    if (LocalWorkspaceBackgroundStatuses.current != null) WorkspaceBackgroundStatus(true, genesisTranslate("Загрузка…"))
    else androidx.compose.material3.CircularProgressIndicator(modifier = modifier, color = color, strokeWidth = strokeWidth)
}

@Composable
internal fun WorkspaceLoadingLine(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceVariant) {
    if (LocalWorkspaceBackgroundStatuses.current != null) WorkspaceBackgroundStatus(true, genesisTranslate("Загрузка…"))
    else androidx.compose.material3.LinearProgressIndicator(modifier = modifier, color = color, trackColor = trackColor)
}
