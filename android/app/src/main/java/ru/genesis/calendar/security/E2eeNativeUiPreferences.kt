package ru.genesis.calendar.security

import org.json.JSONObject

/** Device-local appearance and its public-profile pending changes. This document
 * cannot restore identity, entitlement, membership, keys or old commands. */
internal class E2eeNativeUiPreferences(private val account:E2eeProductAccount,private val current:()->Unit){
    companion object {
        const val ID="native-ui-preferences-v1"
        private val name=Regex("[A-Za-z][A-Za-z0-9_-]{0,127}")
        private val pendingNames=setOf("display","input","time","weekStart","gregorianYearStart","language","stoicheionDivinationDisabled","sharedProjectsEnabled","theme","themeRevision","darkPalette")
        fun validate(input:JSONObject,owner:String):JSONObject {
            E2eeKeys.exact(input,setOf("format","ownerId","values","pending"))
            check(input.get("format")=="genesis-native-ui-preferences-v1"&&input.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
            for(field in listOf("values","pending")){
                val values=input.getJSONObject(field);check(values.length()<=1024){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
                for(key in values.keys())check(name.matches(key)&&values.get(key) is String&&values.getString(key).length<=65536&&(field!="pending"||key in pendingNames)){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
            }
            check(input.toString().toByteArray(Charsets.UTF_8).size<=256*1024){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
            return JSONObject(input.toString())
        }
        private fun seed(owner:String,legacy:JSONObject)=JSONObject().put("format","genesis-native-ui-preferences-v1").put("ownerId",owner)
            .put("values",JSONObject().apply{for(key in legacy.keys())if(name.matches(key))put(key,legacy.getString(key))})
            // Old pending requests stay in their retained source history.
            .put("pending",JSONObject())
    }
    private val document=E2eeDeviceDocument(account.device,ID,{validate(it,account.ownerId)},current)
    fun apply(legacy:JSONObject,change:((JSONObject)->Unit)?):Pair<JSONObject,Boolean>{
        current();val old=document.load();current();val value=old?.value?:validate(seed(account.ownerId,legacy),account.ownerId)
        val next=JSONObject(value.toString());change?.invoke(next);current();val checked=validate(next,account.ownerId)
        val changed=old==null||!E2eeProductJson.same(value,checked)
        if(changed){document.save(checked,old?.serial);current()}
        return JSONObject(checked.toString()) to changed
    }
}
