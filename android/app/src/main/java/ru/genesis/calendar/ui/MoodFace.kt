package ru.genesis.calendar.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.R

/** Fixed authored colors: Image does not apply Material Icon's theme tint. */
@Composable
internal fun MoodFace(value: Int, modifier: Modifier = Modifier.size(32.dp)) {
    val resource = when (value.coerceIn(-5, 6)) {
        -5 -> R.drawable.genesis_mood_0
        -4 -> R.drawable.genesis_mood_1
        -3 -> R.drawable.genesis_mood_2
        -2 -> R.drawable.genesis_mood_3
        -1 -> R.drawable.genesis_mood_4
        0 -> R.drawable.genesis_mood_5
        1 -> R.drawable.genesis_mood_6
        2 -> R.drawable.genesis_mood_7
        3 -> R.drawable.genesis_mood_8
        4 -> R.drawable.genesis_mood_9
        5 -> R.drawable.genesis_mood_10
        else -> R.drawable.genesis_mood_11
    }
    Image(painterResource(resource), contentDescription = null, modifier = modifier)
}
