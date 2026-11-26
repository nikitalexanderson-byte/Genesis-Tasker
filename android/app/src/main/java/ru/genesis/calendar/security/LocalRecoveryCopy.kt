package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONObject

internal object LocalRecoveryCopy{
    fun read(context:Context,language:String):JSONObject{val copy=context.assets.open("local-recovery-copy-v1.json").use{E2eeFileManifestJson.readPrivateDocument(it.readBytes())};check(copy.getInt("protocol")==1){"E2EE_RECOVERY_COPY_INVALID"};val locales=copy.getJSONObject("locales");return JSONObject((locales.optJSONObject(language)?:locales.getJSONObject("en")).toString())}
}
