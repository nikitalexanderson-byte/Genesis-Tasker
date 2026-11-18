package ru.genesis.calendar.ui

import android.content.Context
import ru.genesis.calendar.data.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.DailyAdviceProtocol
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.NativeLegacyOperationPermit
import ru.genesis.calendar.security.UpdateGate
import java.security.MessageDigest
import java.time.LocalDate

/** Private profile lookup/selection/view metadata lives INSIDE one encrypted
 * owner container. No preference hash or advice identity is a new Room key/AAD.
 * Known v1 bytes are protected before IO and retained read-only for migration;
 * unassigned historical hashes still require the complete source inventory. */
internal class DailyAdviceCache(context:Context,private val user:String,private val language:String,private val preferences:String,
    private val cipher:LocalCipher=LocalCipher()) {
    private val app=context.applicationContext as GenesisApplication
    private val scope=CloudAccountSnapshot.scopeFor(user)
    private val legacy=context.getSharedPreferences("daily_advice_day_v1",Context.MODE_PRIVATE)
    private val key=hash("$user\u0000$language\u0000$preferences") // Only inside ciphertext or the pre-existing v1 lookup.
    private val dao=app.database.dao()
    private val mutex get()=locks.getOrPut(scope){Mutex()}
    private fun check(){UpdateGate.requireOpen();check(app.workspaceScope==scope){"E2EE_ACCOUNT_CHANGED"}}
    private suspend fun <T> operation(action:suspend ()->T):T=NativeLegacyOperationPermit.run(app.database,scope,::check){
        mutex.withLock{withContext(Dispatchers.IO){check();verifyExistingKey();action().also{check()}}}
    }
    /** New preferences/day/view markers cannot replace a missing key while any
     * existing cache or older owner-bound advice snapshot needs that same key. */
    private suspend fun verifyExistingKey(){
        check();val witness=dao.documentKinds(scope).firstOrNull{it==KIND||it.startsWith(HISTORY)||it=="advice-snapshots-v1"||it.startsWith("advice-snapshot-v1-")}
        if(witness!=null)open(requireNotNull(dao.document(scope,witness)){"ADVICE_CACHE_CONTENT_INVALID"})
        check()
    }
    private fun open(row:DocumentRecord):String {
        check();check(row.encrypted.length<=6*1024*1024){"ADVICE_CACHE_CONTENT_INVALID"}
        val context=if(row.kind.startsWith(HISTORY))KIND else row.kind
        return try{cipher.decrypt(row.encrypted,"$scope/$context")}
        catch(_:Exception){check();throw IllegalStateException("ADVICE_CACHE_KEY_OR_CONTENT_UNAVAILABLE")}
    }
    private fun validate(value:JSONObject){try{DailyAdviceProtocol.parse(value)}catch(_:Exception){throw IllegalStateException("ADVICE_CACHE_CONTENT_INVALID")}}
    private fun entry(value:JSONObject):JSONObject=try{
        LocalDate.parse(value.getString("deviceDay"));validate(value.getJSONObject("response"));value
    }catch(_:Exception){throw IllegalStateException("ADVICE_CACHE_CONTENT_INVALID")}
    private suspend fun load():JSONObject {
        check();val row=dao.document(scope,KIND)
        if(row==null){
            check(dao.documentKinds(scope).none{it.startsWith(HISTORY)}){"ADVICE_CACHE_PRIMARY_MISSING"}
            return JSONObject().put("protocol",2).put("ownerId",user).put("profiles",JSONObject())
        }
        val raw=open(row)
        return try{
            check(raw.toByteArray(Charsets.UTF_8).size<=4*1024*1024)
            val value=JSONObject(raw);check(value.keys().asSequence().toSet()==setOf("protocol","ownerId","profiles")&&value.getInt("protocol")==2&&value.getString("ownerId")==user)
            val profiles=value.getJSONObject("profiles");check(profiles.length()<=256)
            for(name in profiles.keys()){
                check(name.matches(Regex("[a-f0-9]{64}")));val profile=profiles.getJSONObject(name)
                check(profile.keys().asSequence().toSet()==setOf("language","preferences","current","seen","legacyOriginal"))
                val lang=profile.getString("language");val prefs=profile.getString("preferences")
                check(lang.length in 1..16&&prefs.length<=16384&&name==hash("$user\u0000$lang\u0000$prefs"))
                if(!profile.isNull("current"))entry(profile.getJSONObject("current"))
                if(!profile.isNull("legacyOriginal"))check(profile.get("legacyOriginal") is String)
                val seen=profile.getJSONObject("seen");check(seen.length()<=10000)
                for(marker in seen.keys()){
                    val event=seen.getJSONObject(marker);check(event.keys().asSequence().toSet()==setOf("day","id"))
                    val day=event.getString("day");val id=event.getString("id");check(LocalDate.parse(day).toString()==day&&id.length in 1..128&&marker==hash("$id\u0000$day"))
                }
            }
            value
        }catch(_:Exception){throw IllegalStateException("ADVICE_CACHE_CONTENT_INVALID")}
    }
    private fun profile(blob:JSONObject,create:Boolean=false):JSONObject? {
        val profiles=blob.getJSONObject("profiles");val found=profiles.optJSONObject(key)
        if(found!=null){
            check(found.keys().asSequence().toSet()==setOf("language","preferences","current","seen","legacyOriginal")&&found.getString("language")==language&&found.getString("preferences")==preferences){"ADVICE_CACHE_CONTENT_INVALID"}
            found.getJSONObject("seen");return found
        }
        if(!create)return null
        check(profiles.length()<256&&preferences.length<=16384){"ADVICE_CACHE_CONTENT_LIMIT"}
        return JSONObject().put("language",language).put("preferences",preferences).put("current",JSONObject.NULL).put("seen",JSONObject()).put("legacyOriginal",JSONObject.NULL).also{profiles.put(key,it)}
    }
    private suspend fun saveBlob(value:JSONObject){
        check();val raw=value.toString();check(raw.toByteArray(Charsets.UTF_8).size<=4*1024*1024){"ADVICE_CACHE_CONTENT_LIMIT"}
        val encrypted=cipher.encrypt(raw,"$scope/$KIND");check()
        check(cipher.decrypt(encrypted,"$scope/$KIND")==raw){"ADVICE_CACHE_CONTENT_INVALID"}
        app.database.withTransaction{
            check();val old=dao.document(scope,KIND)
            if(old!=null){
                val previous=open(old);if(previous==raw)return@withTransaction
                val archived=old.copy(kind=HISTORY+hash(old.encrypted));val existing=dao.document(scope,archived.kind)
                check(existing==null||existing.encrypted==old.encrypted){"ADVICE_CACHE_HISTORY_CONFLICT"}
                if(existing==null)dao.putDocument(archived)
            }
            check(old==null||old.revision<Long.MAX_VALUE){"ADVICE_CACHE_CONTENT_INVALID"}
            check();dao.putDocument(DocumentRecord(scope,KIND,encrypted,(old?.revision?:0L)+1L));check()
        }
    }
    private suspend fun cached(blob:JSONObject):JSONObject? {
        val saved=profile(blob)?.optJSONObject("current");if(saved!=null)return entry(saved)
        // This exact hash is reproducible from the supplied owner and the same
        // historical serialization. Never enumerate another owner's v1 values.
        val raw=legacy.getString(key,null)?:return null
        check(raw.length<=4*1024*1024){"ADVICE_CACHE_CONTENT_LIMIT"}
        val value=try{entry(JSONObject(raw))}catch(_:Exception){throw IllegalStateException("ADVICE_CACHE_CONTENT_INVALID")}
        val target=requireNotNull(profile(blob,true));target.put("current",value).put("legacyOriginal",raw);saveBlob(blob);return value
    }
    private suspend fun saveCurrent(blob:JSONObject,day:String,value:JSONObject){
        check();LocalDate.parse(day);validate(value)
        requireNotNull(profile(blob,true)).put("current",JSONObject().put("deviceDay",day).put("response",value));saveBlob(blob)
    }
    suspend fun today(day:String,fetch:suspend ()->JSONObject):JSONObject=operation{
        LocalDate.parse(day);val blob=load();val current=cached(blob)
        if(current?.getString("deviceDay")==day)return@operation current.getJSONObject("response")
        val value=fetch();check();validate(value);saveCurrent(blob,day,value);value
    }
    suspend fun save(day:String,value:JSONObject)=operation{val blob=load();cached(blob);saveCurrent(blob,day,value)}
    suspend fun dismiss(day:String,id:String)=operation{
        val blob=load();val current=cached(blob)?:return@operation
        if(current.getString("deviceDay")!=day)return@operation
        val value=current.getJSONObject("response")
        value.optJSONObject("advice")?.takeIf{it.optString("id")==id}?.put("dismissed",true)
        value.optJSONArray("history")?.let{rows->for(index in 0 until rows.length()){
            rows.getJSONObject(index).takeIf{it.optString("id")==id}?.put("dismissed",true)
        }}
        saveCurrent(blob,day,value)
    }
    suspend fun recordOnce(day:String,id:String,record:suspend ()->Unit)=operation{
        LocalDate.parse(day);require(id.length in 1..128){"ADVICE_CACHE_CONTENT_INVALID"}
        val blob=load();val marker=hash("$id\u0000$day");val saved=profile(blob)?.getJSONObject("seen")?.optJSONObject(marker)
        if(saved!=null){check(saved.getString("day")==day&&saved.getString("id")==id){"ADVICE_CACHE_CONTENT_INVALID"};return@operation}
        check((profile(blob)?.getJSONObject("seen")?.length()?:0)<10000){"ADVICE_CACHE_CONTENT_LIMIT"}
        if(legacy.getString("$key:seen:$id",null)!=day){record();check()}
        requireNotNull(profile(blob,true)).getJSONObject("seen").put(marker,JSONObject().put("day",day).put("id",id));saveBlob(blob)
    }
    override fun toString()="DailyAdviceCache([redacted])"
    companion object{
        private const val KIND="advice-cache-v2"
        private const val HISTORY="advice-cache-history-v2:"
        private val locks=java.util.concurrent.ConcurrentHashMap<String,Mutex>()
        private fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
    }
}
