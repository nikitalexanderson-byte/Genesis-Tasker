package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/** Selection is a bright outline plus a tonal fill, independent of an ordinary primary CTA. */
internal data class GenesisSelectionColors(val container: Color, val content: Color, val outline: Color,
    val disabledContainer: Color, val disabledContent: Color, val disabledOutline: Color)

internal fun genesisSelectionColors(scheme: ColorScheme, dark: Boolean): GenesisSelectionColors {
    val fill = scheme.primary.copy(alpha = if (dark) .22f else .12f).compositeOver(scheme.surface)
    return GenesisSelectionColors(fill, scheme.onSurface, scheme.primary,
        scheme.primary.copy(alpha = .08f).compositeOver(scheme.surface),
        scheme.onSurface.copy(alpha = .38f), scheme.primary.copy(alpha = .38f).compositeOver(scheme.surface))
}

@Composable internal fun selectedControlColors(): GenesisSelectionColors = MaterialTheme.colorScheme.let {
    genesisSelectionColors(it, it.surface.luminance() < .5f)
}

@Composable internal fun selectedControlBorder(selected: Boolean, enabled: Boolean = true,
    fallback: BorderStroke? = null, background: Color? = null): BorderStroke? {
    if (!selected) return fallback
    val colors = selectedControlColors()
    val outline = background?.let { fill ->
        val a = colors.outline.luminance(); val b = fill.luminance()
        if ((maxOf(a,b) + .05f) / (minOf(a,b) + .05f) >= 3f) colors.outline
        else if (b > .179f) Color.Black else Color.White
    } ?: colors.outline
    return BorderStroke(if (enabled) 2.dp else 1.dp,
        if (enabled) outline else if (background != null) outline.copy(alpha=.38f).compositeOver(background) else colors.disabledOutline)
}

@Composable internal fun selectedControlContainer(selected: Boolean, enabled: Boolean = true,
    fallback: Color = Color.Transparent): Color = if (!selected) fallback else selectedControlColors().let {
        if (enabled) it.container else it.disabledContainer
    }

/** Draw-only treatment for existing menu rows; their click/focus/selection semantics stay intact. */
@Composable internal fun Modifier.selectedControlDecoration(selected: Boolean, enabled: Boolean = true): Modifier {
    if (!selected) return this
    val border = selectedControlBorder(true,enabled)!!
    return background(selectedControlContainer(true,enabled), AffairsLayout.controlShape)
        .border(border, AffairsLayout.controlShape)
}
