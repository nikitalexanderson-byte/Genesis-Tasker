package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.unit.dp

internal val LocalTodayHeroTint=staticCompositionLocalOf{Color.Transparent}
@Composable internal fun todayHeroBlockBackground(darkAlpha:Float=.30f):Color{
    val base=Color.Black.copy(alpha=darkAlpha)
    return LocalTodayHeroTint.current.compositeOver(base)
}
/** Selection stays visible in every palette, including the filled state. */
@Composable internal fun choiceBorder(selected:Boolean,enabled:Boolean=true)=BorderStroke(
    if(selected)2.dp else 1.dp,
    (if(selected)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline).copy(alpha=if(enabled)1f else .5f))
