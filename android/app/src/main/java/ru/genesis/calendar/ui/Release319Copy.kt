package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

@Composable internal fun release319Copy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    return remember(context, language) {
        context.assets.open("originals/i18n/release-319-copy.json").bufferedReader().use {
            JSONObject(it.readText()).getJSONObject(language)
        }
    }
}
