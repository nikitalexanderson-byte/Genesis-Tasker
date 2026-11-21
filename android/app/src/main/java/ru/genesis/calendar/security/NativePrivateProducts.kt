package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.CloudAccountSnapshot

/** Registry holds foreground capabilities only. Its persisted marker is a
 * hashed local scope, not a credential, private content or decryption key. */
internal object NativePrivateProducts{
    private class Entry(val account:E2eeProductAccount,val product:E2eePersonalProduct){val mutex=Mutex()}
    private val entries=mutableMapOf<String,Entry>();private val protectedScopes=mutableSetOf<String>()
    val revision=MutableStateFlow(0L)
    @Synchronized fun initialize(context:Context){
        for((scope,value)in context.getSharedPreferences("genesis.e2ee.product-scopes.v1",Context.MODE_PRIVATE).all)
            if(value==true&&scope.matches(Regex("account-[a-f0-9]{32}")))protectedScopes+=scope
    }
    @Synchronized fun protect(context:Context,owner:String){val scope=CloudAccountSnapshot.scopeFor(owner)
        if(scope in protectedScopes)return
        check(context.getSharedPreferences("genesis.e2ee.product-scopes.v1",Context.MODE_PRIVATE).edit().putBoolean(scope,true).commit()){"E2EE_STORAGE_UNAVAILABLE"};protectedScopes+=scope;revision.value++}
    @Synchronized fun isProtected(scope:String)=scope in protectedScopes
    @Synchronized fun isOpen(scope:String):Boolean=entries[scope]?.let{try{it.account.requireOpen();true}catch(_:IllegalStateException){false}}?:false
    @Synchronized fun attach(account:E2eeProductAccount,product:E2eePersonalProduct){
        account.requireOpen();val scope=CloudAccountSnapshot.scopeFor(account.ownerId);check(scope in protectedScopes){"E2EE_SCOPE_BINDING_MISMATCH"};entries.remove(scope)?.account?.close();entries[scope]=Entry(account,product);revision.value++
    }
    @Synchronized fun lock(){for(entry in entries.values)entry.account.close();entries.clear();revision.value++}
    @Synchronized private fun entry(scope:String):Entry{check(scope in protectedScopes){"E2EE_SCOPE_BINDING_MISMATCH"};val value=entries[scope]?:error("E2EE_UNLOCK_REQUIRED");value.account.requireOpen();return value}
    fun snapshot(scope:String):JSONObject=entry(scope).product.snapshot()
    fun localRevision(scope:String):Long=entry(scope).product.localRevision()
    fun snapshots(scope:String)=revision.map{if(isProtected(scope))snapshot(scope)else null}
    suspend fun <T> mutate(scope:String,change:suspend(JSONObject)->Pair<JSONObject,T>):T=withContext(Dispatchers.IO){val value=entry(scope)
        value.mutex.withLock{value.account.requireOpen();val before=value.product.snapshot();val original=before.toString();val (next,result)=change(before);value.account.requireOpen();
            if(next.toString()!=original){value.product.stageSnapshot(next);value.account.requireOpen();revision.value++};result}}
    suspend fun flush(scope:String)=withContext(Dispatchers.IO){val value=entry(scope);value.mutex.withLock{value.account.requireOpen();value.product.flush();value.account.requireOpen();revision.value++}}
    override fun toString()="NativePrivateProducts([redacted])"
}
