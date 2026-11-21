package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Revocable device-only cells for independent messages and local work. No
 * network/import/flush capability exists; retained versions are inert history.
 * An unreadable original always fails before a replacement can be created. */
internal class NativePrivateLocalCell(private val scope:String,private val owner:String,private val purpose:String,private val key:String){
    private val account=NativePrivateProducts.account(scope,owner)
    private val digest=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("$purpose\u0000$key".toByteArray(Charsets.UTF_8)))
    private fun current(){account.requireOpen();check(NativePrivateProducts.account(scope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    private fun document(id:String)=E2eeDeviceDocument(account.device,id,{value->
        E2eeKeys.exact(value,setOf("protocol","ownerId","purpose","key","value"));check(value.getInt("protocol")==1&&value.getString("ownerId")==owner&&value.getString("purpose")==purpose&&value.getString("key")==key&&(value.isNull("value")||value.get("value") is String)){"E2EE_SCOPE_BINDING_MISMATCH"};value},::current)
    private val store=document("private-cell:$digest")
    private fun content(value:String?)=JSONObject().put("protocol",1).put("ownerId",owner).put("purpose",purpose).put("key",key).put("value",value?:JSONObject.NULL)
    suspend fun load(original:suspend()->String?):String?{
        current();val saved=store.load();if(saved!=null)return saved.value.opt("value") as? String
        val retained=original();current();store.save(content(retained),null);current();return retained
    }
    suspend fun save(value:String?,original:suspend()->String?){
        current();var saved=store.load();if(saved==null){val retained=original();current();saved=store.save(content(retained),null)}
        val prior=saved.value.opt("value") as? String;if(prior==value)return
        document("private-cell-history:$digest:${UUID.randomUUID()}").save(saved.value,null);current();store.save(content(value),saved.serial);current()
    }
    override fun toString()="NativePrivateLocalCell([redacted])"
}
