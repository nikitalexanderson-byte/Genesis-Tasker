package ru.genesis.calendar.ui

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics

/** A full-window dialog layout otherwise hides Android's outside-window dismiss area. */
@Composable
internal fun DialogBackdrop(onDismissRequest: () -> Unit, modifier: Modifier) {
    val dismiss by rememberUpdatedState(onDismissRequest)
    // Place behind the Surface: only taps in its surrounding space reach this layer.
    Box(modifier.clearAndSetSemantics { }.pointerInput(Unit) {
        detectTapGestures { dismiss() }
    })
}
