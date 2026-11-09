package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable internal fun SharedTaskDiscussion(gateway: SharedWorkspaceGateway, project: String, task: String,
    active: Boolean, canComment: Boolean, disabled: Boolean, draft: String, onDraft: (String) -> Unit,
    actions: @Composable RowScope.() -> Unit = {}) {
    val account = LocalGenesisUserId.current
    val state = remember(gateway, account, project, task) { SharedDiscussionState(gateway, project, task) }
    DisposableEffect(state) { onDispose { state.close() } }
    var expanded by rememberSaveable(project, task) { mutableStateOf(false) }
    var visible by remember(state) { mutableStateOf(emptySet<String>()) }
    val scope = rememberCoroutineScope()
    val currentDraft by rememberUpdatedState(draft)
    val changeDraft by rememberUpdatedState(onDraft)
    LaunchedEffect(state, active) {
        if (active) while (isActive) { state.refresh(); delay(5_000) }
    }
    // A collapsed history and off-screen entries never count as read.
    LaunchedEffect(state, active, visible, state.offline) {
        if (active && !state.offline && visible.isNotEmpty()) {
            delay(300)
            while (isActive) {
                try { gateway.readSharedTaskUpdates(project, task, visible.toList()); break }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { delay(5_000) }
            }
        }
    }
    val root = LocalView.current
    val footer = with(LocalDensity.current) { 96.dp.toPx() }
    val onVisible: (String, Boolean) -> Unit = { id, shown -> visible = if (shown) visible + id else visible - id }
    val recent = state.comments.takeLast(5)
    val history = state.comments.dropLast(recent.size)
    Column(Modifier.fillMaxWidth().testTag("shared-discussion"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Обсуждение", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
            AffairsIconButton("Обновить обсуждение", AffairsAction.REFRESH, { scope.launch { state.refresh() } },
                Modifier.testTag("shared-comments-refresh"), enabled = !state.loading && !state.sending, outlined = false)
        }
        if (state.loading && !state.loaded) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        WorkspaceBackgroundStatus(state.loading && state.loaded, genesisTranslate("Загрузка…"))
        if (state.error.isNotBlank()) Text("Не удалось загрузить комментарии. Повторите обновление.", color = MaterialTheme.colorScheme.error)
        if (state.offline) Text("Сохранённые комментарии. Обновление после подключения.", style = MaterialTheme.typography.bodySmall)
        if (state.loaded && state.comments.isEmpty()) Text("Комментариев пока нет.", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (history.isNotEmpty() || state.hasMore) {
            OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("shared-comments-history-toggle")) {
                Text(if (expanded) "Скрыть предыдущие комментарии" else "Предыдущие комментарии", Modifier.weight(1f))
                Text("${history.size}${if (state.hasMore) "+" else ""}", style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.width(8.dp)); AffairsActionIcon(if (expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
            }
            if (expanded) {
                if (state.hasMore) TextButton(onClick = { scope.launch { state.refresh(older = true) } },
                    enabled = !state.loading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("shared-comments-older")) {
                    Text("Загрузить более ранние комментарии")
                }
                history.forEach { comment -> key(comment.getString("id")) {
                    SharedComment(comment, account, root.height.toFloat() - footer, onVisible)
                } }
                HorizontalDivider()
            }
        }
        if (recent.isNotEmpty()) Text("Свежие комментарии", style = MaterialTheme.typography.titleSmall)
        recent.forEach { comment -> key(comment.getString("id")) {
            SharedComment(comment, account, root.height.toFloat() - footer, onVisible)
        } }
        if (canComment) {
            HorizontalDivider()
            OutlinedTextField(draft, onDraft, label = { Text("Ваш комментарий") }, minLines = 3,
                enabled = !disabled && !state.sending, modifier = Modifier.fillMaxWidth().testTag("shared-comment-draft"))
            if (state.sendError) Text("Отправка не подтверждена. Черновик сохранён. Обновите обсуждение перед повторной отправкой.",
                color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("shared-comment-send-error"))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            actions()
            Spacer(Modifier.weight(1f))
            Button(onClick = {
                val submitted = currentDraft
                scope.launch { state.send(submitted) { if (currentDraft == submitted) changeDraft("") } }
            }, enabled = !disabled && !state.sending && draft.isNotBlank(), modifier = Modifier
                .heightIn(min = 48.dp).testTag("shared-comment-send")) {
                Text(if (state.sending) "Отправка…" else "Отправить")
            }
            }
        } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), content = actions)
    }
}

@Composable private fun SharedComment(comment: org.json.JSONObject, account: String, viewportBottom: Float,
    onVisible: (String, Boolean) -> Unit) {
    val id = comment.getString("id")
    val visibility by rememberUpdatedState(onVisible)
    DisposableEffect(id) { onDispose { visibility(id, false) } }
    val own = comment.optString("authorId") == account
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val timestamp = remember(comment.optString("createdAt"), locale) {
        runCatching { DateTimeFormatter.ofPattern("d MMM yyyy · HH:mm", locale).withZone(ZoneId.systemDefault())
            .format(Instant.parse(comment.getString("createdAt"))) }.getOrDefault("")
    }
    Surface(Modifier.fillMaxWidth().testTag("shared-comment-$id").onGloballyPositioned {
        val bounds = it.boundsInWindow()
        visibility(id, bounds.width > 0 && bounds.height > 0 && bounds.top < viewportBottom && bounds.bottom > 0)
    }, shape = AffairsLayout.shape, color = if (own) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                UntranslatedText(comment.optString("authorName").ifBlank { if (own) genesisTranslate("Вы") else genesisTranslate("Участник") },
                    style = MaterialTheme.typography.titleSmall)
                if (timestamp.isNotBlank()) UntranslatedText(timestamp, style = MaterialTheme.typography.labelSmall,
                    color = if (own) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SelectionContainer { UntranslatedText(comment.getString("body"), style = MaterialTheme.typography.bodyMedium) }
        }
    }
}
