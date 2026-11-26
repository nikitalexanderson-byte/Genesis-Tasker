package ru.genesis.calendar.security

import org.json.JSONObject
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.SecretKey

/** Owner-private original roots. Never address a device-local root to project
 * membership/recovery keys. Existing bundle/command crypto and purpose separation. */
internal object E2eeOriginalCustody {
    const val PURPOSE="original-root-custody-v1"
    private val uuid=Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    private fun invalid():Nothing=throw IllegalStateException("E2EE_INVALID_ORIGINAL_CUSTODY")
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun rootHash(root:ByteArray):String {
        val bytes="GENESIS-E2EE-ORIGINAL-ROOT\u0000v1\u0000".toByteArray()+root
        return try{hash(bytes)}finally{bytes.fill(0)}
    }
    fun prefix(owner:String):String="original-custody:${hash(E2eeKeys.technical(owner).toByteArray(Charsets.UTF_8))}:"
    fun validateId(owner:String,id:String):String {E2eeKeys.technical(id);val prefix=prefix(owner);if(!id.startsWith(prefix)||!uuid.matches(id.substring(prefix.length)))invalid();return id}
    fun identity(value:E2eeOriginalSource.Identity)=JSONObject().put("ownerId",value.ownerId).put("scopeId",value.scopeId).put("deviceId",value.deviceId)
        .put("generation",value.generation).put("cryptoEpoch",value.cryptoEpoch).put("securityEpoch",value.securityEpoch)
    private fun original(row:JSONObject,keyId:String):E2eeOriginalSource.Identity {
        E2eeKeys.exact(row,setOf("ownerId","scopeId","deviceId","generation","cryptoEpoch","securityEpoch"))
        val value=E2eeOriginalSource.Identity(E2eeKeys.technical(row.get("ownerId") as? String?:invalid()),E2eeKeys.technical(row.get("scopeId") as? String?:invalid()),
            E2eeKeys.technical(row.get("deviceId") as? String?:invalid()),E2eeCommands.integer(row.get("generation"),1),E2eeCommands.integer(row.get("cryptoEpoch"),1),E2eeCommands.integer(row.get("securityEpoch"),1))
        E2eeKeys.technical(keyId);if(value.scopeId!="device:${value.deviceId}"||keyId!="local:${value.deviceId}")invalid();return value
    }
    private fun pin(value:JSONObject){E2eeKeys.exact(value,setOf("signingKey","receivingKey"));E2eeEnvelope.decode(value.get("signingKey") as? String?:invalid(),91);E2eeEnvelope.decode(value.get("receivingKey") as? String?:invalid(),65)}
    private fun samePin(left:JSONObject,right:JSONObject){pin(left);pin(right);check(left.getString("signingKey")==right.getString("signingKey")&&left.getString("receivingKey")==right.getString("receivingKey")){"E2EE_AUTHORITY_CHANGED"}}
    private fun signer(encoded:String):PublicKey=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(encoded,91))).also(E2eeEnvelope::assertP256)
    private fun artifact(value:JSONObject):JSONObject=JSONObject(value.toString()).also{
        E2eeKeys.exact(it,setOf("protocol","id","bundle"));if(E2eeCommands.integer(it.get("protocol"))!=1L)invalid()
        val bundle=it.getJSONObject("bundle");E2eeKeys.exact(bundle,setOf("protocol","ownerId","purpose","salt","nonce","ciphertext"))
        if(E2eeCommands.integer(bundle.get("protocol"))!=1L||bundle.get("purpose")!=PURPOSE)invalid()
        E2eeEnvelope.decode(bundle.getString("salt"),32);E2eeEnvelope.decode(bundle.getString("nonce"),12);E2eeEnvelope.decode(bundle.getString("ciphertext"),16,65552)
    }
    fun reference(value:JSONObject):JSONObject=JSONObject(value.toString()).also{
        E2eeKeys.exact(it,setOf("protocol","id","hash","original","keyId","signer","authority"));if(E2eeCommands.integer(it.get("protocol"))!=1L)invalid()
        original(it.getJSONObject("original"),it.getString("keyId"));E2eeKeys.technical(it.getString("id"));E2eeEnvelope.decode(it.getString("hash"),32);E2eeEnvelope.decode(it.getString("signer"),91);pin(it.getJSONObject("authority"))
    }
    private fun artifactHash(value:JSONObject)=hash(E2eeCommands.canonical(value))
    class Sealed(artifact:JSONObject,reference:JSONObject) {
        private val savedArtifact=artifact.toString();private val savedReference=reference.toString()
        val artifact:JSONObject get()=JSONObject(savedArtifact)
        val reference:JSONObject get()=JSONObject(savedReference)
        override fun toString()="E2eeOriginalCustody.Sealed([ciphertext])"
    }
    /** Component codec. A sealed in-memory bundle is not durable protection. */
    fun seal(original:E2eeOriginalSource.Identity,keyId:String,signer:String,root:ByteArray,primaryPin:JSONObject,recoveryKit:JSONObject,secret:ByteArray,assertCurrent:()->Unit):Sealed {
        check(secret.size==32&&root.size==32){"E2EE_INVALID_ORIGINAL_CUSTODY"};val held=secret.copyOf();val raw=root.copyOf();var clear:ByteArray?=null
        try{
            val pin=JSONObject(primaryPin.toString());val kit=JSONObject(recoveryKit.toString());val context=identity(original);this.original(context,keyId);assertCurrent();samePin(pin,kit.getJSONObject("authority"));this.signer(signer);assertCurrent()
            val authority=E2eeKeys.recoverAuthority(original.ownerId,held,kit);assertCurrent();val operation=UUID.randomUUID().toString();val id=prefix(original.ownerId)+operation
            val command=command(original,keyId,signer,rootHash(raw),pin,id,operation)
            val certificate=E2eeCommands.sign(command,authority.signing.private);assertCurrent()
            clear=JSONObject().put("protocol",1).put("root",E2eeEnvelope.encode(raw)).put("certificate",certificate).toString().toByteArray(Charsets.UTF_8)
            val value=JSONObject().put("protocol",1).put("id",id).put("bundle",E2eeKeys.protectBundle(original.ownerId,PURPOSE,held,clear));assertCurrent()
            val ref=JSONObject().put("protocol",1).put("id",id).put("hash",artifactHash(value)).put("original",context).put("keyId",keyId).put("signer",signer).put("authority",pin)
            assertCurrent();return Sealed(value,ref)
        }finally{held.fill(0);raw.fill(0);clear?.fill(0)}
    }
    private fun command(original:E2eeOriginalSource.Identity,keyId:String,signer:String,rootHash:String,pin:JSONObject,id:String,operation:String)=JSONObject()
        .put("protocol",1).put("ownerId",original.ownerId).put("scopeId",original.scopeId).put("deviceId","recovery-authority").put("action",PURPOSE).put("expectedRevision",0)
        .put("checkpointHash","genesis").put("securityEpoch",original.securityEpoch).put("operationId",operation).put("payload",JSONObject().put("purpose",PURPOSE).put("artifactId",id)
            .put("original",identity(original)).put("keyId",keyId).put("signer",signer).put("rootHash",rootHash).put("authority",pin))
    fun open(owner:String,primaryPin:JSONObject,recoveryKit:JSONObject,secret:ByteArray,reference:JSONObject,artifact:JSONObject,records:E2eeRecordStorage,assertCurrent:()->Unit):Reader {
        check(secret.size==32){"E2EE_INVALID_ORIGINAL_CUSTODY"};val held=secret.copyOf();var clear:ByteArray?=null;var raw:ByteArray?=null
        try{
            val pin=JSONObject(primaryPin.toString());val kit=JSONObject(recoveryKit.toString());val ref=this.reference(reference);val value=this.artifact(artifact);assertCurrent()
            samePin(pin,kit.getJSONObject("authority"));samePin(pin,ref.getJSONObject("authority"));val original=original(ref.getJSONObject("original"),ref.getString("keyId"))
            if(owner!=original.ownerId||value.get("id")!=ref.get("id")||value.getJSONObject("bundle").get("ownerId")!=owner)invalid()
            validateId(owner,value.getString("id"));if(artifactHash(value)!=ref.get("hash"))invalid();assertCurrent()
            val authority=E2eeKeys.recoverAuthority(owner,held,kit);assertCurrent();clear=E2eeKeys.openBundle(owner,PURPOSE,held,value.getJSONObject("bundle"));assertCurrent()
            val payload=JSONObject(Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(clear)).toString())
            E2eeKeys.exact(payload,setOf("protocol","root","certificate"));if(E2eeCommands.integer(payload.get("protocol"))!=1L)invalid();raw=E2eeEnvelope.decode(payload.getString("root"),32)
            val certificate=E2eeCommands.verify(payload.getJSONObject("certificate"),authority.signing.public);assertCurrent()
            val expected=command(original,ref.getString("keyId"),ref.getString("signer"),rootHash(raw),pin,value.getString("id"),value.getString("id").substringAfterLast(':'))
            if(!MessageDigest.isEqual(E2eeCommands.canonical(certificate),E2eeCommands.canonical(expected)))invalid()
            val publicSigner=signer(ref.getString("signer"));val root=E2eeEnvelope.importRoot(raw);assertCurrent();return Reader(records,ref,original,root,publicSigner,assertCurrent)
        }finally{held.fill(0);clear?.fill(0);raw?.fill(0)}
    }
    fun persist(storage:E2eeOriginalCustodyStorage,owner:String,sealed:Sealed,assertCurrent:()->Unit):JSONObject {
        val value=artifact(sealed.artifact);val ref=reference(sealed.reference);assertCurrent()
        if(owner!=ref.getJSONObject("original").get("ownerId")||value.get("id")!=ref.get("id")||artifactHash(value)!=ref.get("hash"))invalid()
        validateId(owner,value.getString("id"));storage.create(owner,value,assertCurrent,ref);assertCurrent()
        val stored=storage.get(owner,value.getString("id"),assertCurrent)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE")
        if(artifactHash(artifact(stored))!=ref.get("hash"))error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE");assertCurrent()
        val metadata=storage.describe(owner,value.getString("id"),assertCurrent)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE")
        if(!MessageDigest.isEqual(E2eeCommands.canonical(this.reference(metadata)),E2eeCommands.canonical(ref)))error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE");assertCurrent();return ref
    }
    fun recover(storage:E2eeOriginalCustodyStorage,owner:String,primaryPin:JSONObject,recoveryKit:JSONObject,secret:ByteArray,reference:JSONObject,records:E2eeRecordStorage,assertCurrent:()->Unit):Reader {
        check(secret.size==32){"E2EE_INVALID_ORIGINAL_CUSTODY"};val held=secret.copyOf()
        try{
            val pin=JSONObject(primaryPin.toString());val kit=JSONObject(recoveryKit.toString());val ref=this.reference(reference);assertCurrent();samePin(pin,kit.getJSONObject("authority"));samePin(pin,ref.getJSONObject("authority"))
            if(owner!=ref.getJSONObject("original").get("ownerId"))invalid();validateId(owner,ref.getString("id"))
            val value=storage.get(owner,ref.getString("id"),assertCurrent)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE");assertCurrent();return open(owner,pin,kit,held,ref,value,records,assertCurrent)
        }finally{held.fill(0)}
    }
    /** Public reference is stored with the encrypted artifact, outside the lost
     * root/alias. Metadata becomes trusted only after owner-certificate checks. */
    fun recoverById(storage:E2eeOriginalCustodyStorage,owner:String,primaryPin:JSONObject,recoveryKit:JSONObject,secret:ByteArray,id:String,records:E2eeRecordStorage,assertCurrent:()->Unit):Reader {
        check(secret.size==32){"E2EE_INVALID_ORIGINAL_CUSTODY"};val held=secret.copyOf()
        try{
            val pin=JSONObject(primaryPin.toString());val kit=JSONObject(recoveryKit.toString());assertCurrent();samePin(pin,kit.getJSONObject("authority"));validateId(owner,id)
            val ref=storage.describe(owner,id,assertCurrent)?:error("E2EE_ORIGINAL_CUSTODY_UNAVAILABLE");assertCurrent();if(ref.get("id")!=id)invalid()
            return recover(storage,owner,pin,kit,held,ref,records,assertCurrent)
        }finally{held.fill(0)}
    }
    /** Revocable and purpose-limited. Never returns roots or original private
     * signing keys; cannot enroll, replay queues, restore rights or activate. */
    class Reader internal constructor(private val records:E2eeRecordStorage,reference:JSONObject,private val original:E2eeOriginalSource.Identity,root:SecretKey,private val signer:PublicKey,private val checkCurrent:()->Unit):Closeable {
        private val saved=reference.toString();val reference:JSONObject get()=JSONObject(saved)
        private val keyId=reference.getString("keyId");private val material=AtomicReference<SecretKey?>(root);private val closed=AtomicBoolean(false);private val children=mutableSetOf<Closeable>()
        private fun current(){check(!closed.get()){"E2EE_ORIGINAL_SOURCE_CLOSED"};checkCurrent()}
        private fun roots():Map<String,SecretKey>{current();return mapOf(keyId to (material.get()?:error("E2EE_ORIGINAL_SOURCE_CLOSED")))}
        private fun <T:Closeable> retain(value:T):T= synchronized(children){try{current();children.add(value);value}catch(error:Throwable){value.close();throw error}}
        fun openStage(target:E2eeSourceStage.Target,stage:E2eeSourceStage.Reference):E2eeOriginalSource.Stage=retain(E2eeOriginalSource.open(records,original,roots(),signer,target,stage,::current))
        fun openLegacy(target:E2eeSourceStage.Target,paths:List<String>,legacy:E2eeLegacySnapshotStream.Reference,inventory:E2eePrivatePaths):E2eeOriginalSource.Legacy=
            retain(E2eeOriginalSource.openLegacy(records,original,roots(),signer,target,paths,legacy,inventory,::current))
        override fun close(){closed.set(true);material.set(null);val retained=synchronized(children){children.toList().also{children.clear()}};retained.forEach{it.close()}}
        override fun toString()="E2eeOriginalCustody.Reader([redacted])"
    }
}
