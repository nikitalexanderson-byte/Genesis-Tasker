package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Shared action style for the Experimental habit and tracker sections. */
@Composable
internal fun HabitsFeatureActionButton(label: String, onClick: () -> Unit,
    containerColor: Color, contentColor: Color, borderColor: Color,
    modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(onClick=onClick, enabled=enabled,
        modifier=modifier.fillMaxWidth().heightIn(min=48.dp),
        shape=AffairsLayout.controlShape, border=BorderStroke(1.dp,borderColor),
        colors=ButtonDefaults.outlinedButtonColors(containerColor=containerColor,
            contentColor=contentColor)) {
        Text(label, style=MaterialTheme.typography.labelLarge)
    }
}
