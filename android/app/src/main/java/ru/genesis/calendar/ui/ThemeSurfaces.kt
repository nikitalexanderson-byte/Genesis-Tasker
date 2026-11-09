package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal val GenesisShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))

/** All native overflow and selection menus share the same visible boundary. */
@Composable internal fun DropdownMenu(expanded: Boolean, onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest,
        modifier = modifier, shape = AffairsLayout.shape,
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 0.dp, shadowElevation = 8.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.secondary), content = content)
}

/** Legacy feature buttons participate in paid palettes just like shared surfaces. */
@Composable private fun paletteButtonColors(colors: ButtonColors): ButtonColors {
    if (LocalPreserveCalendarColors.current || LocalEveningTheme.current && LocalDarkPalette.current == "green") return colors
    return colors.copy(containerColor = eveningSurface(colors.containerColor),
        contentColor = paletteSurfaceInk(eveningSurface(colors.containerColor),colors.contentColor),
        disabledContainerColor = eveningSurface(colors.disabledContainerColor),
        disabledContentColor = eveningInk(colors.disabledContentColor))
}

@Composable private fun selectedButtonColors(colors: ButtonColors, selected: Boolean): ButtonColors {
    val palette = paletteButtonColors(colors)
    if (!selected) return palette
    val selection = selectedControlColors()
    return palette.copy(containerColor = selection.container, contentColor = selection.content,
        disabledContainerColor = selection.disabledContainer, disabledContentColor = selection.disabledContent)
}

private fun Modifier.selectedControl(selected: Boolean): Modifier = if (selected) semantics { this.selected = true } else this

@Composable private fun selectedChipColors(colors: SelectableChipColors): SelectableChipColors {
    val selection = selectedControlColors()
    return colors.copy(selectedContainerColor = selection.container, selectedLabelColor = selection.content,
        selectedLeadingIconColor = selection.content, selectedTrailingIconColor = selection.content,
        disabledSelectedContainerColor = selection.disabledContainer)
}

/** Explicit state stays with Material's input/focus/ripple semantics in every native screen. */
@Composable internal fun FilterChip(selected: Boolean, onClick: () -> Unit, label: @Composable () -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true, leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null, shape: Shape = AffairsLayout.controlShape,
    colors: SelectableChipColors = FilterChipDefaults.filterChipColors(),
    elevation: SelectableChipElevation? = FilterChipDefaults.filterChipElevation(),
    border: BorderStroke? = FilterChipDefaults.filterChipBorder(enabled, selected),
    interactionSource: MutableInteractionSource? = null) {
    androidx.compose.material3.FilterChip(selected = selected, onClick = onClick, label = label,
        modifier = modifier.heightIn(min = 48.dp), enabled = enabled, leadingIcon = leadingIcon,
        trailingIcon = trailingIcon, shape = shape, colors = selectedChipColors(colors), elevation = elevation,
        border = selectedControlBorder(selected, enabled, border), interactionSource = interactionSource)
}

@Composable internal fun InputChip(selected: Boolean, onClick: () -> Unit, label: @Composable () -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true, leadingIcon: (@Composable () -> Unit)? = null,
    avatar: (@Composable () -> Unit)? = null, trailingIcon: (@Composable () -> Unit)? = null,
    shape: Shape = AffairsLayout.controlShape, colors: SelectableChipColors = InputChipDefaults.inputChipColors(),
    elevation: SelectableChipElevation? = InputChipDefaults.inputChipElevation(),
    border: BorderStroke? = InputChipDefaults.inputChipBorder(enabled, selected),
    interactionSource: MutableInteractionSource? = null) {
    androidx.compose.material3.InputChip(selected = selected, onClick = onClick, label = label,
        modifier = modifier.heightIn(min = 48.dp), enabled = enabled, leadingIcon = leadingIcon, avatar = avatar,
        trailingIcon = trailingIcon, shape = shape, colors = selectedChipColors(colors), elevation = elevation,
        border = selectedControlBorder(selected, enabled, border), interactionSource = interactionSource)
}

/** Checked icon actions retain Material's toggle semantics, focus and ripple. */
@Composable internal fun IconToggleButton(checked: Boolean, onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true,
    colors: IconToggleButtonColors = IconButtonDefaults.iconToggleButtonColors(),
    interactionSource: MutableInteractionSource? = null, shape: Shape = AffairsLayout.controlShape,
    content: @Composable () -> Unit) {
    val selection = selectedControlColors()
    val selectedColors = colors.copy(checkedContainerColor = selection.container, checkedContentColor = selection.content,
        disabledContainerColor = if (checked) selection.disabledContainer else colors.disabledContainerColor,
        disabledContentColor = if (checked) selection.disabledContent else colors.disabledContentColor)
    androidx.compose.material3.IconToggleButton(checked = checked, onCheckedChange = onCheckedChange,
        modifier = modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).selectedControlDecoration(checked, enabled),
        enabled = enabled, colors = selectedColors, interactionSource = interactionSource, shape = shape, content = content)
}

/** STANDART controls keep Material behavior with the shared rectangular silhouette. */
@Composable internal fun Button(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = AffairsLayout.controlShape, colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(), border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding, interactionSource: MutableInteractionSource? = null,
    selected: Boolean = false,
    content: @Composable RowScope.() -> Unit) {
    androidx.compose.material3.Button(onClick, modifier.heightIn(min = 48.dp).selectedControl(selected), enabled, shape,
        selectedButtonColors(colors, selected), elevation, selectedControlBorder(selected, enabled, border), contentPadding, interactionSource, content)
}

@Composable internal fun OutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = AffairsLayout.controlShape, colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding, interactionSource: MutableInteractionSource? = null,
    selected: Boolean = false,
    content: @Composable RowScope.() -> Unit) {
    androidx.compose.material3.OutlinedButton(onClick, modifier.heightIn(min = 48.dp).selectedControl(selected), enabled, shape,
        selectedButtonColors(colors, selected), elevation, selectedControlBorder(selected, enabled, border), contentPadding, interactionSource, content)
}

@Composable internal fun FilledTonalButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = AffairsLayout.controlShape, colors: ButtonColors = ButtonDefaults.filledTonalButtonColors(),
    elevation: ButtonElevation? = ButtonDefaults.filledTonalButtonElevation(), border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding, interactionSource: MutableInteractionSource? = null,
    selected: Boolean = false,
    content: @Composable RowScope.() -> Unit) {
    androidx.compose.material3.FilledTonalButton(onClick, modifier.heightIn(min = 48.dp).selectedControl(selected), enabled, shape,
        selectedButtonColors(colors, selected), elevation, selectedControlBorder(selected, enabled, border), contentPadding, interactionSource, content)
}

@Composable internal fun TextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = AffairsLayout.controlShape, colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding, interactionSource: MutableInteractionSource? = null,
    selected: Boolean = false,
    content: @Composable RowScope.() -> Unit) {
    androidx.compose.material3.TextButton(onClick, modifier.heightIn(min = 48.dp).selectedControl(selected), enabled, shape,
        if (selected) selectedButtonColors(colors, true) else paletteButtonColors(colors), elevation, selectedControlBorder(selected, enabled, border), contentPadding, interactionSource, content)
}

/** Shared theme treatment also covers the original feature cards and their dialogs. */
@Composable
internal fun Surface(modifier: Modifier = Modifier, shape: Shape = RectangleShape,
    color: Color = MaterialTheme.colorScheme.surface, contentColor: Color = contentColorFor(color),
    tonalElevation: Dp = 0.dp, shadowElevation: Dp = 0.dp, border: BorderStroke? = null,
    content: @Composable () -> Unit) {
    if (LocalGenesisModalFramePending.current) {
        GenesisModalFrame(LocalGenesisModalDismiss.current) {
            androidx.compose.material3.Surface(Modifier.fillMaxWidth().then(modifier), shape, eveningSurface(color), paletteSurfaceInk(eveningSurface(color),contentColor),
                tonalElevation, shadowElevation, border, content)
        }
    } else {
        androidx.compose.material3.Surface(modifier, shape, eveningSurface(color), paletteSurfaceInk(eveningSurface(color),contentColor),
            tonalElevation, shadowElevation, border, content)
    }
}

@Composable
internal fun Surface(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = RectangleShape, color: Color = MaterialTheme.colorScheme.surface,
    contentColor: Color = contentColorFor(color), tonalElevation: Dp = 0.dp, shadowElevation: Dp = 0.dp,
    border: BorderStroke? = null, interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit) {
    // Material3 1.4's clickable Surface retains tooltip ancestor observations after a lazy row
    // detaches (ChildSemanticsNode.applySemantics -> visitAncestors). Foundation clickable
    // keeps the same ripple, button role, focus and keyboard action without that observer.
    val interactions = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.Surface(modifier = modifier.clip(shape).clickable(
        interactionSource = interactions, indication = ripple(), enabled = enabled, role = Role.Button, onClick = onClick),
        shape = shape, color = eveningSurface(color), contentColor = paletteSurfaceInk(eveningSurface(color),contentColor),
        tonalElevation = tonalElevation, shadowElevation = shadowElevation, border = border,
        content = content)
}

@Composable private fun cardColors(colors: CardColors) =
    CardDefaults.cardColors(containerColor = eveningSurface(colors.containerColor),
        contentColor = paletteSurfaceInk(eveningSurface(colors.containerColor),colors.contentColor),
        disabledContainerColor = eveningSurface(colors.disabledContainerColor),
        disabledContentColor = eveningInk(colors.disabledContentColor))

@Composable
internal fun Card(modifier: Modifier = Modifier, shape: Shape = CardDefaults.shape,
    colors: CardColors = CardDefaults.cardColors(), elevation: CardElevation = CardDefaults.cardElevation(),
    border: BorderStroke? = null, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.Card(modifier, shape, cardColors(colors), elevation, border, content)
}

@Composable
internal fun Card(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = CardDefaults.shape, colors: CardColors = CardDefaults.cardColors(),
    elevation: CardElevation = CardDefaults.cardElevation(), border: BorderStroke? = null,
    interactionSource: MutableInteractionSource? = null, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.Card(onClick = onClick, modifier = modifier, enabled = enabled,
        shape = shape, colors = cardColors(colors), elevation = elevation, border = border,
        interactionSource = interactionSource, content = content)
}
