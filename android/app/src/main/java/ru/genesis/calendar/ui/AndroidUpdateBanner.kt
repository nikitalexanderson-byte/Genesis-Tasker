package ru.genesis.calendar.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding

import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import ru.genesis.calendar.BuildConfig

/** Remains in Settings until the installed version catches up with the release manifest. */
@Composable
internal fun AndroidUpdateBanner(compact: Boolean = false) {
    if (BuildConfig.PLAY_DISTRIBUTION) return
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val copy = appUpdateCopy(language)
    var release by remember { mutableStateOf<AndroidRelease?>(null) }
    var dialogOpen by remember { mutableStateOf(false) }
    LaunchedEffect(context) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching(::fetchAndroidRelease) }
                .onSuccess { release = it }
            delay(5 * 60 * 1000L)
        }
    }
    release?.let { available ->
        val glow by rememberInfiniteTransition(label = "update-banner-glow").animateFloat(
            .60f, 1f, infiniteRepeatable(tween(1700), RepeatMode.Reverse),
            label = "update-banner-border")
        if (compact) WorkspaceStatusNotice("${copy.title}\nGENESIS ${available.versionName}",
            Modifier.padding(horizontal = 16.dp, vertical = 4.dp).testTag("android-update-banner")) {
            TextButton(onClick = { dialogOpen = true }, modifier = Modifier.testTag("android-update-banner-action")) {
                UntranslatedText(copy.action, maxLines = 1)
            }
        } else Surface(Modifier.fillMaxWidth().testTag("android-update-banner"),
            color = eveningSurface(Color(0xff123b36)), shape = MaterialTheme.shapes.large,
            border = BorderStroke(2.dp, Color(0xfff2cc78).copy(alpha = glow)),
            shadowElevation = 6.dp) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                UntranslatedText(copy.title, color = Color(0xffffefc2),
                    style = MaterialTheme.typography.titleMedium)
                UntranslatedText("GENESIS ${available.versionName}", color = Color(0xffd3e5d9),
                    style = MaterialTheme.typography.bodyMedium)
                Button(onClick = { dialogOpen = true },
                    modifier = Modifier.fillMaxWidth().testTag("android-update-banner-action"),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xfff2cc78),
                        contentColor = Color(0xff182522))) {
                    UntranslatedText(copy.action)
                }
            }
        }
        if (dialogOpen) AndroidUpdateDialog(context, available) { dialogOpen = false }
    }
}
