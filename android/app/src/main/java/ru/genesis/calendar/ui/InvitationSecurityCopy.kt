package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

@Composable internal fun invitationSecurityCopy(language:String):JSONObject {
    val context=LocalContext.current
    return remember(context,language){context.assets.open("invitation-recipient-copy-v1.json").use { input->
        val bytes=input.readBytes();try { check(bytes.size<=128*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en") } finally { bytes.fill(0) }
    }}
}
