package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** The same header for project tools, nested editors and their compact IME state. */
@Composable internal fun AffairsDialogHeader(title: String, subtitle: String = "",
    onClose: (() -> Unit)?, onBack: (() -> Unit)? = null, enabled: Boolean = true, backEnabled: Boolean = enabled,
    closeTag: String = "dialog-close", backTag: String = "dialog-back", compact: Boolean = false,
    titleTag: String = "dialog-heading", titleIsUserContent: Boolean = false,
    subtitleMaxLines: Int = 2, actions: @Composable RowScope.() -> Unit = {}) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = if (compact) 4.dp else 8.dp)) {
        GenesisDialogHeader(closeTag, onClose, enabled,
            leading = if (onBack != null) ({
                AffairsIconButton("Назад", AffairsAction.BACK, onBack,
                    Modifier.testTag(backTag), enabled = backEnabled, outlined = false)
            }) else null, actions = actions) {
            Column(Modifier.padding(start = if (onBack == null) 8.dp else 0.dp,
                top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                UntranslatedText(if (titleIsUserContent) title else genesisTranslate(title),
                    Modifier.testTag(titleTag), style = MaterialTheme.typography.titleLarge,
                    maxLines = if (compact) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                if (!compact && subtitle.isNotBlank()) UntranslatedText(subtitle,
                    style = MaterialTheme.typography.bodySmall, maxLines = subtitleMaxLines, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
