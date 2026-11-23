package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Portable format matches the browser device bundle. Hardware presence protects
 * the Android copy; independent recovery never grants an account session. */
class UnlockedE2eeDevice private constructor(override val ownerId:String,private val bundle:JSONObject,
    private var privateKeys:E2eeKeys.DeviceKeys?,override val vault:UnlockedE2eeVault,private val persistence:E2eeDeviceVault,private val storage:E2eeSqliteStorage) : E2eeScopeDevice, E2eeDeviceReadView {
    override val deviceId:String=bundle.getString("deviceId")
    override val authorityPin:JSONObject get()=JSONObject(bundle.getJSONObject("authorityPin").toString())
    private val closed=AtomicBoolean(false)
    override fun requireOpen(){check(!closed.get()){"E2EE_UNLOCK_REQUIRED"};persistence.requireCurrentSlot();vault.requireOpen()}
    override fun readSavedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?)=savedDirectory(scopeId,onVerified)
    override fun readKeys():E2eeKeys.ReadKeys{requireOpen();val keys=requireNotNull(privateKeys);return E2eeKeys.ReadKeys(E2eeKeys.publicKeys(keys),keys.receiving,keys.signing.public)}
    override fun keys():E2eeKeys.DeviceKeys {requireOpen();return requireNotNull(privateKeys)}
    fun lock(){if(!closed.compareAndSet(false,true))return;vault.lock();privateKeys=null;bundle.remove("localRoot");bundle.remove("deviceKeys");storage.close()}
    override fun ensureDurableKeys() {
        requireOpen();val bytes=persistence.unlock()
        try {requireOpen();val saved=JSONObject(bytes.toString(Charsets.UTF_8))
            check(saved.get("protocol")==1&&saved.get("ownerId")==ownerId&&saved.getString("deviceId")==deviceId && saved.getString("localKeyId")==bundle.getString("localKeyId")
                &&saved.getString("localRoot")==bundle.getString("localRoot")
                &&E2eeCommands.canonical(saved.getJSONObject("deviceKeys")).contentEquals(E2eeCommands.canonical(bundle.getJSONObject("deviceKeys")))
                &&E2eeCommands.canonical(saved.getJSONObject("authorityPin")).contentEquals(E2eeCommands.canonical(bundle.getJSONObject("authorityPin")))) {"E2EE_DEVICE_KEY_UNAVAILABLE"}
        }finally{bytes.fill(0)}
    }
    internal fun retainDeviceRecovery(secret:ByteArray,kit:JSONObject,current:()->Unit){
        requireOpen();current();ensureDurableKeys();val bytes=persistence.unlock()
        try{
            persistence.retainRecovery(secret,kit,bytes);current()
            val custody=persistence.originalCustodyStorage();var retained=false
            for(id in custody.list(ownerId,current)){
                val reference=custody.describe(ownerId,id,current)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE")
                if(reference.getJSONObject("original").getString("deviceId")!=deviceId)continue
                val artifact=custody.get(ownerId,id,current)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE")
                E2eeOriginalCustody.open(ownerId,authorityPin,kit,secret,reference,artifact,storage,current).close();retained=true
            }
            if(!retained)preserveOriginalSources(secret,kit,current);current()
        }
        finally{bytes.fill(0)}
    }
    /** New artifact carries only the original local root/PUBLIC signer, signed
     * by the separately confirmed primary owner recovery authority. */
    internal fun preserveOriginalSources(secret:ByteArray,recoveryKit:JSONObject,assertCurrent:()->Unit):JSONObject {
        check(secret.size==32){"E2EE_INVALID_ORIGINAL_CUSTODY"};val held=secret.copyOf();var bytes:ByteArray?=null;var root:ByteArray?=null
        val current:()->Unit={requireOpen();assertCurrent()}
        try{
            val kit=JSONObject(recoveryKit.toString());current();ensureDurableKeys();current();bytes=persistence.unlock();current()
            val saved=JSONObject(bytes.toString(Charsets.UTF_8));check(saved.get("ownerId")==ownerId&&saved.get("deviceId")==deviceId&&saved.get("localKeyId")=="local:$deviceId"){"E2EE_DEVICE_KEY_UNAVAILABLE"}
            root=E2eeEnvelope.decode(saved.getString("localRoot"),32);val signer=saved.getJSONObject("deviceKeys").getString("signingKey");saved.remove("localRoot");saved.remove("deviceKeys");bytes.fill(0)
            val sealed=E2eeOriginalCustody.seal(E2eeOriginalSource.Identity(ownerId,"device:$deviceId",deviceId,1,1,1),"local:$deviceId",signer,root,authorityPin,kit,held,current)
            current();ensureDurableKeys();current();val reference=E2eeOriginalCustody.persist(persistence.originalCustodyStorage(),ownerId,sealed,current);ensureDurableKeys();current();return reference
        }finally{held.fill(0);bytes?.fill(0);root?.fill(0)}
    }
    private fun directoryId(scopeId:String):String = "directory-"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(E2eeKeys.technical(scopeId).toByteArray()))
    override fun rememberDirectory(scopeId:String,pin:JSONObject,events:JSONArray,scopeOwner:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified {
        requireOpen();val retainedPin=JSONObject(pin.toString());val retainedEvents=JSONArray(events.toString())
        val id=directoryId(scopeId);val previous=vault.read("key-check",id)
        try {
            val old=previous?.let{JSONObject(it.bytes.toString(Charsets.UTF_8))}
            if(old!=null)check(old.getString("ownerId")==scopeOwner&&E2eeCommands.canonical(old.getJSONObject("pin")).contentEquals(E2eeCommands.canonical(retainedPin))){"E2EE_AUTHORITY_CHANGED"}
            val checkpoint=old?.getJSONObject("checkpoint")?.let{E2eeDirectory.Checkpoint(it.getLong("revision"),it.getString("hash"))}
            val directory=E2eeDirectory.verify(scopeOwner,scopeId,retainedPin,retainedEvents,checkpoint,onVerified)
            val bytes=JSONObject().put("ownerId",scopeOwner).put("pin",retainedPin).put("events",retainedEvents)
                .put("checkpoint",JSONObject().put("revision",directory.checkpoint.revision).put("hash",directory.checkpoint.hash)).toString().toByteArray()
            try{
                if(previous!=null&&previous.bytes.contentEquals(bytes)){
                    // Keep identical history stable for other scopes' custody
                    // snapshots, while refusing a concurrent writer.
                    val actual=vault.read("key-check",id);requireOpen()
                    try{check(actual!=null&&actual.serial==previous.serial&&actual.bytes.contentEquals(previous.bytes)){"E2EE_LOCAL_CONFLICT"}}
                    finally{actual?.bytes?.fill(0)}
                }else vault.write(listOf(UnlockedE2eeVault.Write("key-check",id,bytes,previous?.serial)))
            }finally{bytes.fill(0)}
            return directory
        }finally{previous?.bytes?.fill(0)}
    }
    override fun savedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified? {
        val row=vault.read("key-check",directoryId(scopeId))?:return null
        try {val old=JSONObject(row.bytes.toString(Charsets.UTF_8));val checkpoint=old.getJSONObject("checkpoint")
            return E2eeDirectory.verify(old.getString("ownerId"),scopeId,old.getJSONObject("pin"),old.getJSONArray("events"),
                E2eeDirectory.Checkpoint(checkpoint.getLong("revision"),checkpoint.getString("hash")),onVerified)
        }finally{row.bytes.fill(0)}
    }
    override fun toString()="UnlockedE2eeDevice([redacted])"
    companion object {
        fun provision(context:Context,ownerId:String,secret:ByteArray,recoveryKit:JSONObject):UnlockedE2eeDevice {
            E2eeKeys.technical(ownerId);E2eeKeys.recoverAuthority(ownerId,secret,recoveryKit)
            val persistence=E2eeDeviceVault(context,ownerId);check(!persistence.exists()){"E2EE_DEVICE_ALREADY_EXISTS"}
            val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret();val id=UUID.randomUUID().toString()
            val bundle=JSONObject().put("protocol",1).put("ownerId",ownerId).put("deviceId",id).put("localKeyId","local:$id")
                .put("localRoot",E2eeEnvelope.encode(root)).put("deviceKeys",E2eeKeys.exportPrivateKeys(keys)).put("authorityPin",recoveryKit.getJSONObject("authority"))
            val bytes=bundle.toString().toByteArray()
            try{persistence.save(bytes,create=true)}finally{bytes.fill(0);root.fill(0);bundle.remove("localRoot");bundle.remove("deviceKeys")}
            // Open the persisted copy. An interrupted provisioning never replaces it.
            return openDevice(context,ownerId,allowCreateRecords=true)
        }
        /** Local candidate material only. Caller already verified the pinned
         * directory and admitted a foreground device-credential action. */
        internal fun provisionCandidate(context:Context,compared:E2eeComparedPersonalDeviceTarget,current:()->Unit):UnlockedE2eeDevice {
            current();val target=compared.target();val owner=target.getString("ownerId");val persistence=E2eeDeviceVault(context,owner);check(!persistence.exists()){"E2EE_DEVICE_ALREADY_EXISTS"}
            val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret();val id=UUID.randomUUID().toString();val bundle=JSONObject().put("protocol",1).put("ownerId",owner).put("deviceId",id).put("localKeyId","local:$id")
                .put("localRoot",E2eeEnvelope.encode(root)).put("deviceKeys",E2eeKeys.exportPrivateKeys(keys)).put("authorityPin",target.get("authority"));val bytes=bundle.toString().toByteArray(Charsets.UTF_8)
            try{current();persistence.save(bytes,create=true);current();return openDevice(context,owner,allowCreateRecords=true).also{current()}}finally{bytes.fill(0);root.fill(0);bundle.remove("localRoot");bundle.remove("deviceKeys")}
        }
        fun unlock(context:Context,ownerId:String):UnlockedE2eeDevice = openDevice(context,ownerId,false)
        internal fun replaceRevoked(context:Context,compared:E2eeComparedPersonalDeviceTarget,events:JSONArray,current:()->Unit):UnlockedE2eeDevice{
            current();val target=compared.target();val owner=target.getString("ownerId");val old=unlock(context,owner)
            try{current();check(E2eeProductJson.same(old.authorityPin,target.getJSONObject("authority"))){"E2EE_AUTHORITY_CHANGED"};val prior=old.savedDirectory(target.getString("scopeId"));val directory=E2eeDirectory.verify(owner,target.getString("scopeId"),old.authorityPin,events,prior?.checkpoint);current();val revoked=directory.devices[old.deviceId];val keys=E2eeKeys.publicKeys(old.keys())
                check(directory.kind=="personal"&&directory.resourceId==owner&&directory.state=="active"&&revoked!=null&&revoked.revoked&&revoked.userId==owner&&revoked.signingKey==keys.get("signingKey")&&revoked.receivingKey==keys.get("receivingKey")){"E2EE_REVOKED_REPLACEMENT_REQUIRED"};old.ensureDurableKeys();current()
                E2eeDeviceVault(context,owner).replaceIdentity(old.deviceId,current){val nextKeys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret();val id=UUID.randomUUID().toString();try{JSONObject().put("protocol",1).put("ownerId",owner).put("deviceId",id).put("localKeyId","local:$id").put("localRoot",E2eeEnvelope.encode(root)).put("deviceKeys",E2eeKeys.exportPrivateKeys(nextKeys)).put("authorityPin",target.get("authority")).toString().toByteArray(Charsets.UTF_8)}finally{root.fill(0)}}
                current();return unlock(context,owner).also{current()}
            }finally{old.lock()}
        }
        private fun openDevice(context:Context,ownerId:String,allowCreateRecords:Boolean):UnlockedE2eeDevice {
            val persistence=E2eeDeviceVault(context,ownerId);val bytes=persistence.unlock()
            try {
                val bundle=JSONObject(bytes.toString(Charsets.UTF_8))
                E2eeKeys.exact(bundle,setOf("protocol","ownerId","deviceId","localKeyId","localRoot","deviceKeys","authorityPin"))
                check(bundle.getInt("protocol")==1&&bundle.getString("ownerId")==ownerId){"E2EE_CORRUPT_DEVICE_VAULT"}
                val deviceId=E2eeKeys.technical(bundle.getString("deviceId"));val localKeyId=E2eeKeys.technical(bundle.getString("localKeyId"))
                E2eeKeys.exact(bundle.getJSONObject("authorityPin"),setOf("signingKey","receivingKey"))
                val keys=E2eeKeys.importDeviceKeys(bundle.getJSONObject("deviceKeys"));val raw=E2eeEnvelope.decode(bundle.getString("localRoot"),32)
                val root=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}
                val storage=E2eeSqliteStorage(context,allowCreateRecords)
                val vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(ownerId,"device:$deviceId",deviceId,1,1,1,localKeyId,keys.signing.private,mapOf(localKeyId to root)) {if(it==deviceId)keys.signing.public else null})
                return UnlockedE2eeDevice(ownerId,bundle,keys,vault,persistence,storage)
            }finally{bytes.fill(0)}
        }
    }
}
