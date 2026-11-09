package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp

/** Native extension of STANDART: Material roles come from the existing green/paper/gold themes. */
internal object AffairsLayout {
    val gutter = 16.dp
    val gap = 8.dp
    val sectionGap = 16.dp
    val touchTarget = 48.dp
    val formMaxWidth = 720.dp
    val shape = RoundedCornerShape(10.dp)
    val controlShape = RoundedCornerShape(10.dp)
}

internal val LocalAffairsControlWidth = compositionLocalOf { 48.dp }
internal val LocalAffairsControlOutlined = compositionLocalOf { true }

@Composable internal fun AffairsLoading(modifier: Modifier = Modifier) {
    if (LocalWorkspaceBackgroundStatuses.current != null) {
        WorkspaceBackgroundStatus(true, genesisTranslate("Загрузка…"))
        return
    }
    Box(modifier.fillMaxWidth().heightIn(min = 144.dp), contentAlignment = Alignment.Center) {
        WorkspaceLoadingIndicator(Modifier.size(36.dp), color = MaterialTheme.colorScheme.primary)
    }
}

/** Warm inbox distinguishes unassigned work without the semantics of an error. */
@Composable internal fun chaosBoxColor() = if (LocalEveningTheme.current) Color(0xff302b1f) else Color(0xfff0e2bc)
@Composable internal fun chaosBoxBorder() = if (LocalEveningTheme.current) Color(0xffa58b58) else Color(0xffb99858)

internal enum class AffairsAction { BACK, NEXT, MORE, CLOSE, SEARCH, FILTER, SORT, EXPAND, COLLAPSE, REFRESH, MOVE, MOVE_UP, MOVE_DOWN, ADD, EDIT, SETTINGS, DELETE, REPORT, IMPORT, HISTORY, VIEW, HIDE, MINDMAP, LIST, BOARD, CALENDAR, GANTT, PROJECT, TASK_LIST, UNDO, TEMPLATE, SUBTASK, DECREASE, TASK, AUTOMATION, PAUSE, RESUME, ARCHIVE, RESTORE, TIMER, LINK, CENTER, TEAM, CREATE_BOARD, CREATE_TASK, TOOLS, COPY, SAVE, PHONE, WEBSITE }

@Composable internal fun GenesisAccountFooter(status: String, modifier: Modifier = Modifier) {
    Text(status, modifier.padding(vertical = 4.dp)
        .testTag("app-account-status"), style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The same 24-unit, rounded line geometry as GenesisVectorIcon. */
@Composable internal fun AffairsActionIcon(action: AffairsAction, modifier: Modifier = Modifier) {
    GenesisLucideIcon(action.lucideName(), modifier.size(if (action == AffairsAction.CLOSE || LocalAffairsControlWidth.current < 48.dp) 22.dp else 24.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun AffairsIconButton(label: String, action: AffairsAction, onClick: () -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true, fillWidth: Boolean = false, selected: Boolean? = null,
    contentColor: Color = Color.Unspecified, outlined: Boolean = LocalAffairsControlOutlined.current,
    translate: Boolean = true) {
    val description = if (translate) genesisTranslate(label) else label
    val selection = selectedControlColors()
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label, translate = translate) } }, state = rememberTooltipState()) {
        OutlinedIconButton(onClick = onClick, enabled = enabled, shape = AffairsLayout.controlShape,
            border = selectedControlBorder(selected == true, enabled,
                if (outlined && action != AffairsAction.CLOSE) IconButtonDefaults.outlinedIconButtonBorder(enabled) else null),
            colors = if (selected == true) IconButtonDefaults.outlinedIconButtonColors(
                containerColor = selection.container, contentColor = selection.content,
                disabledContainerColor = selection.disabledContainer, disabledContentColor = selection.disabledContent)
                else if (contentColor != Color.Unspecified) IconButtonDefaults.outlinedIconButtonColors(contentColor = contentColor)
                else IconButtonDefaults.outlinedIconButtonColors(),
            modifier = modifier.then(if (fillWidth) Modifier.fillMaxWidth().heightIn(min = AffairsLayout.touchTarget)
                else Modifier.size(width = LocalAffairsControlWidth.current, height = AffairsLayout.touchTarget))
                .semantics { contentDescription = description; if (selected != null) this.selected = selected }) { AffairsActionIcon(action) }
    }
}

@Composable internal fun AffairsPageHeader(title: String, context: String,
    icon: GenesisPageIcon = GenesisPageIcon.PROJECTS, onBack: (() -> Unit)? = null,
    backLabel: String = "Назад", backEnabled: Boolean = true, titleIsUserContent: Boolean = false,
    contextIsUserContent: Boolean = false, contextMaxLines: Int = Int.MAX_VALUE, actions: @Composable RowScope.() -> Unit = {}) {
    if (LocalGenesisModal.current) {
        Box(Modifier.testTag("affairs-page-header")) {
            AffairsDialogHeader(title, if (contextIsUserContent) context else genesisTranslate(context),
                onClose = null, onBack = onBack, backEnabled = backEnabled, backTag = "affairs-back",
                titleIsUserContent = titleIsUserContent, subtitleMaxLines = contextMaxLines, actions = actions)
        }
        return
    }
    Surface(shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().testTag("affairs-page-header")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (onBack != null) AffairsIconButton(backLabel, AffairsAction.BACK, onBack,
                Modifier.testTag("affairs-back"), enabled = backEnabled)
            else Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                GenesisVectorIcon(icon, Modifier.size(30.dp), MaterialTheme.colorScheme.primary)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                UntranslatedText(if (titleIsUserContent) title else genesisTranslate(title),
                    style = MaterialTheme.typography.titleLarge)
                if (context.isNotBlank()) UntranslatedText(
                    if (contextIsUserContent) context else genesisTranslate(context), style = MaterialTheme.typography.bodySmall, maxLines = contextMaxLines, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            actions()
        }
    }
}

@Composable internal fun AffairsDisclosure(title: String, modifier: Modifier = Modifier,
    titleIsUserContent: Boolean = false,
    initiallyExpanded: Boolean = false,
    content: @Composable ColumnScope.() -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(initiallyExpanded) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            if (titleIsUserContent) UntranslatedText(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            else Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            AffairsActionIcon(if (expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        if (expanded) content()
    }
}

@Composable internal fun AffairsSaveBar(onSave: () -> Unit, enabled: Boolean, busy: Boolean) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Button(onClick = onSave, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp).heightIn(min = 48.dp).testTag("affairs-save")) {
                if (busy) WorkspaceLoadingIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
                Text(if (busy) "Сохранение…" else "Сохранить")
            }
        }
    }
}

@Composable internal fun AffairsSearchField(value: String, onChange: (String) -> Unit,
    label: String, modifier: Modifier = Modifier, labelAsPlaceholder: Boolean = false) {
    val accessibleLabel = genesisTranslate(label)
    // A scaled fixed line height can exceed the field's single-line content slot.
    val fieldTextStyle = MaterialTheme.typography.bodyLarge.copy(lineHeight = TextUnit.Unspecified)
    OutlinedTextField(value, onChange, label = if (labelAsPlaceholder) null else ({ Text(label) }),
        placeholder = if (labelAsPlaceholder) ({ Text(label, style = fieldTextStyle, maxLines = 1, overflow = TextOverflow.Ellipsis) }) else null,
        singleLine = true, textStyle = fieldTextStyle,
        leadingIcon = { AffairsActionIcon(AffairsAction.SEARCH) },
        trailingIcon = if (value.isNotEmpty()) ({
            AffairsIconButton("Очистить поиск", AffairsAction.CLOSE, { onChange("") })
        }) else null,
        shape = AffairsLayout.shape, modifier = modifier.fillMaxWidth()
            .semantics { contentDescription = accessibleLabel })
}

@Composable internal fun AffairsFilterDialog(onDismiss: () -> Unit, onApply: () -> Unit,
    onReset: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Фильтры") },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp), content = content) },
        confirmButton = { Button(onClick = onApply, modifier = Modifier.heightIn(min = 48.dp)
            .testTag("affairs-apply-filters")) { Text("Применить фильтры") } },
        dismissButton = { TextButton(onClick = onReset, modifier = Modifier.heightIn(min = 48.dp)) { Text("Сбросить") } })
}

/** One task anatomy shared by personal and team affairs; callers keep their own data/permission rules. */
@Composable internal fun AffairsTaskRow(title: String, completed: Boolean, onOpen: () -> Unit,
    modifier: Modifier = Modifier, metadata: List<String> = emptyList(), unreadComments: Int = 0,
    onComplete: (() -> Unit)? = null, enabled: Boolean = true,
    actions: @Composable (() -> Unit)? = null, extra: @Composable (() -> Unit)? = null,
    titleContent: @Composable (() -> Unit)? = null) {
    OutlinedCard(onClick = onOpen, enabled = enabled, modifier = modifier.fillMaxWidth(), shape = AffairsLayout.shape,
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, if (unreadComments > 0) MaterialTheme.colorScheme.secondary
            else MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                if (onComplete != null) {
                    val label = genesisTranslate(if (completed) "Вернуть в работу" else "Завершить задачу")
                    Checkbox(completed, { onComplete() }, enabled = enabled,
                        modifier = Modifier.size(48.dp).semantics { contentDescription = "$label: $title" })
                }
                Column(Modifier.weight(1f).padding(start = if (onComplete == null) 8.dp else 0.dp,
                    top = 9.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (titleContent != null) titleContent() else UntranslatedText(title, style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (unreadComments > 0) FontWeight.Bold else FontWeight.Medium,
                        color = if (completed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                }
                actions?.invoke()
            }
            if (metadata.isNotEmpty()) UntranslatedText(metadata.filter(String::isNotBlank).joinToString(" · "),
                modifier = Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (unreadComments > 0 && titleContent == null) Box(Modifier.padding(horizontal = 8.dp)) { UnreadCommentBadge(unreadComments) }
            extra?.invoke()
        }
    }
}
