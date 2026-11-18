package ru.genesis.calendar.ui

import android.content.Context
import ru.genesis.calendar.data.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.NativeLegacyScopeFence
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class DailyAdviceCacheSecurityTest {
    private class Rig:AutoCloseable{
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val app=context.applicationContext as GenesisApplication
        val owner="advice-cache-${UUID.randomUUID()}";val scope=CloudAccountSnapshot.scopeFor(owner)
        val alias="genesis.qa.advice-cache.${UUID.randomUUID()}";val cipher=LocalCipher(alias)
        val key=hash("$owner\u0000en\u0000synthetic-preferences")
        val legacy=context.getSharedPreferences("daily_advice_day_v1",Context.MODE_PRIVATE)
        val kind="advice-cache-v2"
        init{check(BuildConfig.DEBUG&&context.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner)}
        fun cache()=DailyAdviceCache(context,owner,"en","synthetic-preferences",cipher)
        fun response(day:String)=JSONObject().put("dayKey",day).put("state","ready")
            .put("advice",JSONObject().put("id",ID).put("dayKey",day).put("title","Synthetic private selection")
                .put("body",BODY).put("language","en").put("dismissed",false).put("categories",JSONArray().put("aretology")).put("sources",JSONArray()))
        suspend fun originals()=app.database.dao().backupDocuments(scope).associate{it.kind to it.encrypted}
        override fun close(){app.activateAccount(null)}
        companion object{
            const val BODY="Synthetic private cached advice with a unique sentence"
            const val ID="advice-0123456789abcdef01234567"
            fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
        }
    }
    private suspend fun rejected(code:String,action:suspend ()->Unit){
        try{action();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected redacted failure: ${error.javaClass.simpleName}",error.message?.contains(code)==true)}
    }
    @Test fun knownLegacyBytesAreProtectedBeforeFetchAndEveryReplacedCiphertextRemainsReadableHistory()=runBlocking{
        val f=Rig();try{
            val legacy=JSONObject().put("deviceDay","2026-11-18").put("response",f.response("2026-11-18")).toString()
            assertTrue(f.legacy.edit().putString(f.key,legacy).commit());val calls=AtomicInteger()
            assertEquals(Rig.BODY,f.cache().today("2026-11-18"){calls.incrementAndGet();error("No network expected")}.getJSONObject("advice").getString("body"));assertEquals(0,calls.get())
            val previous=requireNotNull(f.app.database.dao().document(f.scope,f.kind));assertFalse(previous.encrypted.contains(Rig.BODY));assertEquals(legacy,JSONObject(f.cipher.decrypt(previous.encrypted,"${f.scope}/${f.kind}")).getJSONObject("profiles").getJSONObject(f.key).getString("legacyOriginal"));assertEquals(legacy,f.legacy.getString(f.key,null))
            f.cache().today("2026-11-19"){
                assertNotNull(f.app.database.dao().document(f.scope,f.kind));calls.incrementAndGet();f.response("2026-11-19")
            }
            assertEquals(1,calls.get());val history=f.app.database.dao().backupDocuments(f.scope).single{it.kind.startsWith("advice-cache-history-v2:")}
            assertEquals(previous.encrypted,history.encrypted);assertEquals(legacy,JSONObject(f.cipher.decrypt(history.encrypted,"${f.scope}/${f.kind}")).getJSONObject("profiles").getJSONObject(f.key).getString("legacyOriginal"));assertEquals(legacy,f.legacy.getString(f.key,null))
            assertEquals("2026-11-19",f.cache().today("2026-11-19"){error("Must use encrypted Room")}.getString("dayKey"));assertTrue(f.originals().values.none{it.contains(Rig.BODY)})
        }finally{f.close()}
    }
    @Test fun concurrentViewsDeduplicateUnderTheSameOwnerAndProtectKnownOldMarkers()=runBlocking{
        val f=Rig();try{
            val seen=AtomicInteger();coroutineScope{(1..8).map{async{f.cache().recordOnce("2026-11-18",Rig.ID){seen.incrementAndGet();delay(10)}}}.awaitAll()};assertEquals(1,seen.get())
            val markers=f.app.database.dao().backupDocuments(f.scope);assertEquals(1,markers.size);assertEquals("advice-cache-v2",markers.single().kind);assertFalse(markers.single().kind.contains(f.key));assertFalse(markers.single().kind.contains(Rig.ID));assertFalse(markers.single().encrypted.contains(Rig.ID))
            val protected=JSONObject(f.cipher.decrypt(markers.single().encrypted,"${f.scope}/${f.kind}"));assertEquals(1,protected.getJSONObject("profiles").getJSONObject(f.key).getJSONObject("seen").length())
            assertTrue(f.legacy.edit().putString("${f.key}:seen:${Rig.ID}","2026-11-19").commit())
            f.cache().recordOnce("2026-11-19",Rig.ID){seen.incrementAndGet()};assertEquals(1,seen.get());assertEquals(2,f.app.database.dao().backupDocuments(f.scope).size)
            val current=requireNotNull(f.app.database.dao().document(f.scope,f.kind));val complete=JSONObject(f.cipher.decrypt(current.encrypted,"${f.scope}/${f.kind}"));assertEquals(2,complete.getJSONObject("profiles").getJSONObject(f.key).getJSONObject("seen").length())
        }finally{f.close()}
    }
    @Test fun actualAccountChangeDuringFetchOrRecordCannotSaveOrAcknowledgeAnotherOwnersCache()=runBlocking{
        for(record in listOf(false,true)){
            val f=Rig();try{
                val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val before=f.originals()
                coroutineScope{
                    val operation=async{runCatching{
                        if(record)f.cache().recordOnce("2026-11-19",Rig.ID){started.complete(Unit);release.await()}
                        else f.cache().today("2026-11-19"){started.complete(Unit);release.await();f.response("2026-11-19")}
                    }}
                    started.await();f.app.activateAccount("foreign-${UUID.randomUUID()}");release.complete(Unit)
                    assertEquals("E2EE_ACCOUNT_CHANGED",operation.await().exceptionOrNull()?.message)
                }
                assertEquals(before,f.originals());assertNull(f.legacy.getString(f.key,null))
            }finally{f.close()}
        }
    }
    @Test fun preparingWaitsForCompleteIOAndThenBlocksCacheFetchesBeforeNetwork()=runBlocking{
        val f=Rig();try{
            val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val fenceEntered=CompletableDeferred<Unit>();val calls=AtomicInteger()
            coroutineScope{
                val fetch=async{f.cache().today("2026-11-19"){calls.incrementAndGet();entered.complete(Unit);release.await();f.response("2026-11-19")}}
                entered.await();val fence=async{NativeLegacyScopeFence(f.app.database,f.owner,"personal:${f.owner}",{check(f.app.workspaceScope==f.scope)}).withFence{
                    assertNotNull(f.app.database.dao().document(f.scope,f.kind));fenceEntered.complete(Unit)
                }}
                assertNull(withTimeoutOrNull(150){fenceEntered.await()});assertNull(f.app.database.dao().legacyScopeFence(f.scope));release.complete(Unit);fetch.await();fence.await()
            }
            val before=f.originals();rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){f.cache().today("2026-11-20"){calls.incrementAndGet();f.response("2026-11-20")}}
            assertEquals(1,calls.get());assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun anUnreadableLegacyRoomAdviceWitnessAlsoBlocksFirstTimeCacheCreation()=runBlocking{
        val f=Rig();try{
            val witness="advice-snapshots-v1"
            f.app.database.withTransaction{f.app.database.dao().putDocument(ru.genesis.calendar.data.DocumentRecord(f.scope,witness,f.cipher.encrypt("{}","${f.scope}/$witness"),1))}
            KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(f.alias)}
            val before=f.originals();var calls=0
            rejected("ADVICE_CACHE_KEY_OR_CONTENT_UNAVAILABLE"){f.cache().today("2026-11-19"){calls++;f.response("2026-11-19")}}
            assertEquals(0,calls);assertEquals(before,f.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))
        }finally{f.close()}
    }
    @Test fun missingPrimaryWithRetainedHistoryIsNeverTreatedAsANewEmptyCache()=runBlocking{
        val f=Rig();try{
            f.cache().today("2026-11-18"){f.response("2026-11-18")};f.cache().today("2026-11-19"){f.response("2026-11-19")}
            f.app.database.withTransaction{f.app.database.dao().deleteDocument(f.scope,f.kind)}
            val before=f.originals();assertTrue(before.keys.any{it.startsWith("advice-cache-history-v2:")});var calls=0
            rejected("ADVICE_CACHE_PRIMARY_MISSING"){f.cache().today("2026-11-20"){calls++;f.response("2026-11-20")}}
            assertEquals(0,calls);assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun authenticatedButMalformedContainersNeverFallBackOrOverwritePrivateFields()=runBlocking{
        val mutations=listOf<(JSONObject,String)->Unit>(
            {value,key->value.getJSONObject("profiles").put(key,"unknown private profile")},
            {value,key->value.getJSONObject("profiles").getJSONObject(key).put("current","unknown private state")},
            {value,key->value.getJSONObject("profiles").getJSONObject(key).getJSONObject("seen").put("a".repeat(64),"unknown private event")},
            {value,_->value.put("ownerId","foreign-owner")},
            {value,_->value.put("protocol",99)},
            {value,key->value.getJSONObject("profiles").getJSONObject(key).put("unknownPrivateField","preserve this")})
        for(mutate in mutations){val f=Rig();try{
            f.cache().today("2026-11-18"){f.response("2026-11-18")};val row=requireNotNull(f.app.database.dao().document(f.scope,f.kind))
            val value=JSONObject(f.cipher.decrypt(row.encrypted,"${f.scope}/${f.kind}"));mutate(value,f.key)
            f.app.database.withTransaction{f.app.database.dao().putDocument(row.copy(encrypted=f.cipher.encrypt(value.toString(),"${f.scope}/${f.kind}")))}
            val before=f.originals();var calls=0
            rejected("ADVICE_CACHE_CONTENT_INVALID"){DailyAdviceCache(f.context,f.owner,"en","other-profile",f.cipher).today("2026-11-19"){calls++;f.response("2026-11-19")}}
            assertEquals(0,calls);assertEquals(before,f.originals())
        }finally{f.close()}}
    }
    /** The original qa330 cache assertions, retained in the current strictly
     * isolated qa1103 package with the real owner guard and encrypted store. */
    @Test fun recreationEightConcurrentLoadsDismissalAndDayRolloverRetainTheirOriginalBehavior()=runBlocking{
        val f=Rig();try{
            var loads=0;var seen=0;val first=f.cache()
            coroutineScope{(1..8).map{async{first.today("2026-11-18"){loads++;delay(10);f.response("2026-11-18")}}}.awaitAll()}
            val recreated=f.cache();recreated.today("2026-11-18"){error("Must use persisted day")};assertEquals(1,loads)
            repeat(3){recreated.recordOnce("2026-11-18",Rig.ID){seen++}};assertEquals(1,seen)
            recreated.dismiss("2026-11-18",Rig.ID);assertTrue(recreated.today("2026-11-18"){error("Must remain cached")}.getJSONObject("advice").getBoolean("dismissed"))
            recreated.today("2026-11-19"){loads++;f.response("2026-11-19")};assertEquals(2,loads)
            val before=f.originals();val other=f.owner+"-other";f.app.activateAccount(other)
            DailyAdviceCache(f.context,other,"en","synthetic-preferences",f.cipher).today("2026-11-19"){loads++;f.response("2026-11-19")};assertEquals(3,loads)
            rejected("E2EE_ACCOUNT_CHANGED"){recreated.today("2026-11-19"){error("Must not fetch under changed account")}}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun corruptRoomOrLostKeystoreNeverFallsBackToPlaintextNetworkOrReplacementKeys()=runBlocking{
        for(loseKey in listOf(false,true)){
            val f=Rig();try{
                f.cache().today("2026-11-18"){f.response("2026-11-18")}
                val old=requireNotNull(f.app.database.dao().document(f.scope,f.kind))
                val raw=JSONObject().put("deviceDay","2026-11-18").put("response",f.response("2026-11-18")).toString()
                assertTrue(f.legacy.edit().putString(f.key,raw).commit())
                if(loseKey)KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(f.alias)}
                else f.app.database.withTransaction{f.app.database.dao().putDocument(old.copy(encrypted=f.cipher.encrypt(raw,"wrong-synthetic-context")))}
                val before=f.originals();var calls=0
                rejected("ADVICE_CACHE_KEY_OR_CONTENT_UNAVAILABLE"){f.cache().today("2026-11-19"){calls++;f.response("2026-11-19")}}
                rejected("ADVICE_CACHE_KEY_OR_CONTENT_UNAVAILABLE"){f.cache().recordOnce("2026-11-20",Rig.ID){calls++}}
                rejected("ADVICE_CACHE_KEY_OR_CONTENT_UNAVAILABLE"){DailyAdviceCache(f.context,f.owner,"en","different-preferences",f.cipher).today("2026-11-19"){calls++;f.response("2026-11-19")}}
                assertEquals(0,calls);assertEquals(before,f.originals());assertEquals(raw,f.legacy.getString(f.key,null))
                if(loseKey)assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))
            }finally{f.close()}
        }
    }
}
