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
    private class Entry(val account:E2eeProductAccount,val product:E2eePersonalProduct,val preferences:E2eePrivatePreferences?){val mutex=Mutex()}
    private val entries=mutableMapOf<String,Entry>();private val protectedScopes=mutableSetOf<String>()
    private var inventory:E2eePrivatePaths?=null
    val revision=MutableStateFlow(0L)
    @Synchronized fun initialize(context:Context){
        inventory=E2eePrivatePaths.load(context)
        for((scope,value)in context.getSharedPreferences("genesis.e2ee.product-scopes.v1",Context.MODE_PRIVATE).all)
            if(value==true&&scope.matches(Regex("account-[a-f0-9]{32}")))protectedScopes+=scope
    }
    @Synchronized fun protect(context:Context,owner:String){val scope=CloudAccountSnapshot.scopeFor(owner)
        if(scope in protectedScopes)return
        check(context.getSharedPreferences("genesis.e2ee.product-scopes.v1",Context.MODE_PRIVATE).edit().putBoolean(scope,true).commit()){"E2EE_STORAGE_UNAVAILABLE"};protectedScopes+=scope;revision.value++}
    @Synchronized fun isProtected(scope:String)=scope in protectedScopes
    @Synchronized fun isOpen(scope:String):Boolean=entries[scope]?.let{try{it.account.requireOpen();true}catch(_:IllegalStateException){false}}?:false
    @Synchronized fun isOffline(scope:String):Boolean=entries[scope]?.account?.offline==true
    @Synchronized fun attach(account:E2eeProductAccount,product:E2eePersonalProduct,preferences:E2eePrivatePreferences?=null){
        account.requireOpen();val scope=CloudAccountSnapshot.scopeFor(account.ownerId);check(scope in protectedScopes){"E2EE_SCOPE_BINDING_MISMATCH"};entries.remove(scope)?.account?.close();entries[scope]=Entry(account,product,preferences);revision.value++
    }
    @Synchronized fun lock(){for(entry in entries.values)entry.account.close();entries.clear();revision.value++}
    @Synchronized private fun entry(scope:String):Entry{check(scope in protectedScopes){"E2EE_SCOPE_BINDING_MISMATCH"};val value=entries[scope]?:error("E2EE_UNLOCK_REQUIRED");value.account.requireOpen();return value}
    fun account(scope:String,owner:String):E2eeProductAccount=entry(scope).account.also{check(it.ownerId==owner){"E2EE_SCOPE_BINDING_MISMATCH"}}
    fun preferences(scope:String):E2eePrivatePreferences=checkNotNull(entry(scope).preferences){"E2EE_PRODUCT_READ_REQUIRED"}
    fun history(scope:String,owner:String,domain:String,id:String):E2eeMigrationProductHistory.Result{val account=account(scope,owner)
        return E2eeMigrationProductHistory.read(account.device,account.directory,requireNotNull(inventory){"E2EE_INVALID_COVERAGE_REGISTRY"},domain,id)}
    fun snapshot(scope:String):JSONObject=entry(scope).product.snapshot()
    fun contentRevision(scope:String):Long=entry(scope).product.contentRevision()
    fun snapshots(scope:String)=revision.map{if(isProtected(scope))snapshot(scope)else null}
    suspend fun <T> mutate(scope:String,change:suspend(JSONObject)->Pair<JSONObject,T>):T=withContext(Dispatchers.IO){val value=entry(scope)
        value.mutex.withLock{value.account.requireOpen();val before=value.product.snapshot();val original=before.toString();val (next,result)=change(before);value.account.requireOpen();
            if(next.toString()!=original){value.product.stageSnapshot(next);value.account.requireOpen();revision.value++};result}}
    suspend fun flush(scope:String)=withContext(Dispatchers.IO){val value=entry(scope);value.mutex.withLock{value.account.requireOpen();val before=value.product.contentRevision();value.product.flush();value.preferences?.flush();value.account.requireOpen();if(value.product.contentRevision()!=before)revision.value++}}
    override fun toString()="NativePrivateProducts([redacted])"
}
