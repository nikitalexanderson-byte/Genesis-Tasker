package ru.genesis.calendar.ui

import android.content.Context
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

internal fun nativeWebVersionSupported(version:String?,minimum:Int):Boolean {
    if(minimum<1 || version==null || !version.matches(Regex("[0-9]{1,5}(?:\\.[0-9]+){2,3}(?:[- ].*)?")))return false
    return (version.substringBefore('.').toIntOrNull()?:0)>=minimum
}

/** Match the packaged JS target before constructing an editor WebView. This
 * checks runtime compatibility, never account access or cryptographic authority. */
internal fun nativeWebRuntimeProblem(context:Context,language:String):String? {
    val policy=context.assets.open("originals/i18n/native-web-runtime-v1.json").bufferedReader().use{JSONObject(it.readText())}
    val minimum=policy.getInt("minimumChromiumMajor")
    check(policy.getInt("protocol")==1 && minimum>=111 && policy.getString("buildTarget")=="chrome$minimum")
    val version=runCatching{WebView.getCurrentWebViewPackage()?.versionName}.getOrNull()
    if(nativeWebVersionSupported(version,minimum))return null
    return context.assets.open("originals/i18n/native-web-runtime-copy.json").bufferedReader(Charsets.UTF_8).use {
        val copy=JSONObject(it.readText());copy.optString(language).ifBlank{copy.getString("en")}
    }
}

@Composable internal fun rememberNativeWebRuntimeProblem(language:String):String? {
    val context=LocalContext.current
    return remember(context,language){nativeWebRuntimeProblem(context,language)}
}
