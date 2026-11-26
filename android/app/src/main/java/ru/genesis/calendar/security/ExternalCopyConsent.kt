package ru.genesis.calendar.security

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** One exact, explicitly reviewed external copy. No serialized representation
 * can recreate this capability and no content/identity import can approve it. */
internal class ExternalCopyConsent private constructor(private val account:E2eeProductAccount,private val provider:String,private val target:String,private val digest:ByteArray){
    private val expires=SystemClock.elapsedRealtime()+120000;private val used=AtomicBoolean(false)
    companion object{
        const val NOTICE_VERSION="external-copy-336-v1"
        private fun digest(value:JSONObject)=MessageDigest.getInstance("SHA-256").digest(E2eeCommands.canonical(value))
        fun approve(account:E2eeProductAccount,provider:String,target:String,payload:JSONObject,confirmed:Boolean):ExternalCopyConsent{
            account.requireOpen();check(!account.offline&&confirmed){"E2EE_EXTERNAL_COPY_CONSENT_REQUIRED"};check(provider in setOf("gemini","gigachat","google-tasks","google-calendar","yandex-speller")&&target.length in 1..256){"E2EE_EXTERNAL_COPY_INVALID"}
            val held=JSONObject(payload.toString());check(held.toString().toByteArray(Charsets.UTF_8).size<=8*1024*1024){"E2EE_EXTERNAL_COPY_TOO_LARGE"};return ExternalCopyConsent(account,provider,target,digest(held))
        }
        fun copy(context:Context,language:String,key:String):String{
            val document=context.assets.open("external-copy-copy-v1.json").use{E2eeFileManifestJson.readPrivateDocument(it.readBytes())};check(document.getString("version")==NOTICE_VERSION){"E2EE_EXTERNAL_COPY_INVALID"};val locales=document.getJSONObject("locales");return(locales.optJSONObject(language)?:locales.getJSONObject("en")).getString(key)
        }
    }
    fun consume(candidate:E2eeProductAccount,provider:String,target:String,payload:JSONObject):JSONObject{
        candidate.requireOpen();check(candidate===account&&this.provider==provider&&this.target==target&&SystemClock.elapsedRealtime()<=expires&&used.compareAndSet(false,true)){"E2EE_EXTERNAL_COPY_CONSENT_REQUIRED"}
        val held=JSONObject(payload.toString());check(MessageDigest.isEqual(digest,Companion.digest(held))){"E2EE_EXTERNAL_COPY_CHANGED"};candidate.requireOpen();return held
    }
    override fun toString()="ExternalCopyConsent([redacted])"
}
