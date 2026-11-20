package ru.genesis.calendar.security

import java.io.Closeable
import java.io.InputStream
import java.security.PublicKey
import java.security.interfaces.ECPublicKey
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.SecretKey

/** Original coordinates/PUBLIC signer come from an authenticated recovery
 * handoff, never payload/server metadata. Roots are already independently
 * unwrapped. This component provides only bounded source reads; it does not
 * prove custody, enroll a device or authorize product restore/whole-scope EOF. */
object E2eeOriginalSource {
    data class Identity(val ownerId:String,val scopeId:String,val deviceId:String,val generation:Long,val cryptoEpoch:Long,val securityEpoch:Long)
    private fun invalid():Nothing=throw IllegalStateException("E2EE_INVALID_ORIGINAL_SOURCE")
    internal class Vault(storage:E2eeRecordStorage,val original:Identity,roots:Map<String,SecretKey>,private val signer:PublicKey,private val check:()->Unit):E2eeSourceReadVault {
        private val get=storage::get;private val list=storage::list
        private val material=AtomicReference<Map<String,SecretKey>?>(roots.toMap());private val closed=AtomicBoolean(false)
        init {
            listOf(original.ownerId,original.scopeId,original.deviceId).forEach(E2eeKeys::technical)
            val captured=requireNotNull(material.get())
            if(listOf(original.generation,original.cryptoEpoch,original.securityEpoch).any{it !in 1..9007199254740991L}||captured.size !in 1..64)invalid()
            captured.forEach{(id,key)->E2eeKeys.technical(id);if(key.algorithm!="AES")invalid()}
            if(signer !is ECPublicKey||signer.params.curve.field.fieldSize!=256)invalid()
            assertOpen()
        }
        override fun assertOpen(){check(!closed.get()){"E2EE_ORIGINAL_SOURCE_CLOSED"};check()}
        fun close(){closed.set(true);material.set(null)}
        override fun localIdentity():UnlockedE2eeVault.LocalIdentity {assertOpen();return UnlockedE2eeVault.LocalIdentity(original.ownerId,original.scopeId,original.deviceId)}
        override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {
            assertOpen();E2eeKeys.technical(objectId)
            check(domain=="local-snapshot"&&(objectId.startsWith("source-stage:")||objectId.startsWith("source-stage-catalog:"))){"E2EE_ORIGINAL_SOURCE_READ_FORBIDDEN"}
            val key=listOf(original.ownerId,original.scopeId,domain,objectId).joinToString(""){"${it.length}:$it"}
            val row=get(key);assertOpen();if(row==null)return null
            val ctx=row.envelope.context.toJson()
            check(row.serial in 1..9007199254740991L&&E2eeCommands.integer(ctx.get("revision"),1)==row.serial&&ctx.get("ownerId")==original.ownerId
                &&ctx.get("scopeId")==original.scopeId&&ctx.get("deviceId")==original.deviceId&&ctx.get("domain")==domain&&ctx.get("objectId")==objectId
                &&E2eeCommands.integer(ctx.get("schemaVersion"),1)==1L&&E2eeCommands.integer(ctx.get("dataGeneration"),1)==original.generation
                &&E2eeCommands.integer(ctx.get("cryptoEpoch"),1)<=original.cryptoEpoch&&E2eeCommands.integer(ctx.get("securityEpoch"),1)<=original.securityEpoch){"E2EE_CORRUPT_ORIGINAL_SOURCE"}
            val root=material.get()?.get(ctx.getString("keyId"))?:throw IllegalStateException(if(closed.get())"E2EE_ORIGINAL_SOURCE_CLOSED" else "E2EE_KEY_UNAVAILABLE")
            val bytes=E2eeEnvelope.open(root,signer,row.envelope.context,row.envelope)
            try{assertOpen();return UnlockedE2eeVault.Opened(row.serial,bytes)}catch(error:Exception){bytes.fill(0);throw error}
        }
        override fun listLocal(domain:String,objectPrefix:String):List<String> {
            assertOpen();check(domain=="local-snapshot"&&objectPrefix=="source-stage:"){"E2EE_ORIGINAL_SOURCE_READ_FORBIDDEN"}
            val prefix=listOf(original.ownerId,original.scopeId,domain).joinToString(""){"${it.length}:$it"};val keys=list(prefix);assertOpen()
            check(keys.size<=10000&&keys.toSet().size==keys.size){"E2EE_LOCAL_RECORD_LIMIT"}
            return keys.mapNotNull{key->
                check(key.startsWith(prefix)){"E2EE_CORRUPT_ORIGINAL_SOURCE"};val rest=key.substring(prefix.length);val colon=rest.indexOf(':')
                check(colon>0&&rest.substring(0,colon).matches(Regex("[1-9][0-9]{0,2}"))){"E2EE_CORRUPT_ORIGINAL_SOURCE"}
                val id=rest.substring(colon+1);E2eeKeys.technical(id);check(rest.substring(0,colon).toInt()==id.length){"E2EE_CORRUPT_ORIGINAL_SOURCE"}
                id.takeIf{it.startsWith(objectPrefix)}
            }
        }
        override fun toString()="OriginalSourceVault([redacted])"
    }
    fun open(storage:E2eeRecordStorage,original:Identity,roots:Map<String,SecretKey>,signer:PublicKey,target:E2eeSourceStage.Target,reference:E2eeSourceStage.Reference,assertCurrent:()->Unit):Stage {
        val vault=Vault(storage,original.copy(),roots,signer,assertCurrent)
        try{val opened=E2eeSourceStage.open(vault,target.copy(),reference.copy(),vault::assertOpen);vault.assertOpen();return Stage(vault,opened)}
        catch(error:Exception){vault.close();throw error}
    }
    class Stage internal constructor(private val vault:Vault,private val opened:E2eeSourceStage.Opened):Closeable {
        private val active=mutableMapOf<String,SourceInput>()
        val paths:List<String> get(){vault.assertOpen();return opened.paths.toList()}
        fun openPath(path:String):SourceInput {
            vault.assertOpen();return synchronized(active){vault.assertOpen();check(path !in active){"E2EE_ORIGINAL_SOURCE_PATH_BUSY"}
                SourceInput(vault,opened.openPath(path)){input->synchronized(active){if(active[path]===input)active.remove(path)}}.also{active[path]=it}}
        }
        override fun close(){
            // Revocation is visible before waiting for any in-flight IO monitor.
            vault.close();val readers=synchronized(active){active.values.toList().also{active.clear()}};readers.forEach{it.close()}
        }
        override fun toString()="E2eeOriginalSource.Stage([redacted])"
    }
    class SourceInput internal constructor(private val vault:Vault,private val source:E2eeSourceStage.SourceInput,private val release:(SourceInput)->Unit):InputStream() {
        private var complete=false;private var closed=false;private var failed=false
        override fun read():Int {val one=ByteArray(1);try{return if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
        @Synchronized override fun read(output:ByteArray,offset:Int,length:Int):Int {
            vault.assertOpen();check(!closed&&!failed){"E2EE_ORIGINAL_SOURCE_PATH_CLOSED"};var count=0
            try{count=source.read(output,offset,length);vault.assertOpen();if(count<0){source.assertComplete();complete=true;release(this)};return count}
            catch(error:Exception){if(count>0)output.fill(0,offset,offset+count);failed=true;source.close();release(this);throw error}
        }
        @Synchronized fun assertComplete(){vault.assertOpen();check(complete&&!failed){"E2EE_SOURCE_STAGE_EOF_REQUIRED"}}
        @Synchronized override fun close(){if(!closed){closed=true;source.close();release(this)}}
        override fun toString()="E2eeOriginalSource.SourceInput([redacted])"
    }
}
