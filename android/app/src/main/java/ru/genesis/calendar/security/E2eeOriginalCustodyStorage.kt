package ru.genesis.calendar.security

import android.content.Context
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest

internal interface E2eeOriginalCustodyStorage {
    fun get(owner:String,id:String,assertCurrent:()->Unit):JSONObject?
    fun describe(owner:String,id:String,assertCurrent:()->Unit):JSONObject?
    fun create(owner:String,artifact:JSONObject,assertCurrent:()->Unit,reference:JSONObject)
    fun list(owner:String,assertCurrent:()->Unit):List<String>
}
/** Create-only atomic file family, already encrypted for the OWNER recovery
 * secret. No Keystore/local-root dependency. Incomplete artifacts are retained,
 * never silently repaired/deleted. Explicit .new staging has identical refusal
 * semantics on API26/34, where Android AtomicFile implementations differ. */
internal class E2eeOriginalCustodyFiles(context:Context):E2eeOriginalCustodyStorage {
    private val app=context.applicationContext;private val folder=app.noBackupFilesDir
    private fun ownerHash(owner:String)=MessageDigest.getInstance("SHA-256").digest(E2eeKeys.technical(owner).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    private fun prefix(owner:String)="e2ee-original-custody-${ownerHash(owner)}-"
    private fun file(owner:String,id:String):File {E2eeOriginalCustody.validateId(owner,id);return File(folder,prefix(owner)+id.substringAfterLast(':')+".vault")}
    private fun variants(base:File)=listOf(base,File(base.path+".new"),File(base.path+".bak"))
    override fun create(owner:String,artifact:JSONObject,assertCurrent:()->Unit,reference:JSONObject)=synchronized(E2eeStorageAdmission.providerMutationLock){
        val captured=JSONObject(artifact.toString());val ref=E2eeOriginalCustody.reference(reference);val id=captured.getString("id");val base=file(owner,id)
        check(ref.get("id")==id&&ref.getJSONObject("original").get("ownerId")==owner){"E2EE_INVALID_ORIGINAL_CUSTODY"}
        val bytes=E2eeCommands.canonical(JSONObject().put("protocol",1).put("artifact",captured).put("reference",ref))
        try{
            assertCurrent();check(bytes.size in 1..131072){"E2EE_INVALID_ORIGINAL_CUSTODY"};check(variants(base).none{it.exists()}){"E2EE_DEVICE_ALREADY_EXISTS"}
            // Existing records are mandatory; recovery never creates an empty DB.
            val usage=E2eeSqliteStorage(app).use{it.providerUsage()};val growth=E2eeStorageAdmission.writeGrowth(listOf(E2eeStorageAdmission.WriteSize(bytes.size.toLong(),null)))
            E2eeStorageAdmission.admit(usage,E2eeStorageAdmission.Growth(0,1,growth.writeBytes,growth.rewriteBytes),E2eeStorageAdmission.providerBudget);assertCurrent()
            val staging=File(base.path+".new")
            // CREATE_NEW refuses even a pre-existing zero-length remnant. All
            // partials survive an IO/retirement failure, on every supported API.
            FileChannel.open(staging.toPath(),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE).use{channel->
                val buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining()){assertCurrent();channel.write(buffer)};channel.force(true);assertCurrent()
            }
            Files.move(staging.toPath(),base.toPath(),StandardCopyOption.ATOMIC_MOVE)
            val directory=Os.open(folder.absolutePath,OsConstants.O_RDONLY,0)
            try{Os.fsync(directory)}finally{Os.close(directory)}
            assertCurrent();check(base.isFile&&variants(base).drop(1).none{it.exists()}){"E2EE_ORIGINAL_CUSTODY_UNAVAILABLE"}
        }finally{bytes.fill(0)}
    }
    override fun get(owner:String,id:String,assertCurrent:()->Unit):JSONObject?=read(owner,id,assertCurrent)?.getJSONObject("artifact")
    override fun describe(owner:String,id:String,assertCurrent:()->Unit):JSONObject?=read(owner,id,assertCurrent)?.getJSONObject("reference")
    private fun read(owner:String,id:String,assertCurrent:()->Unit):JSONObject?=synchronized(E2eeStorageAdmission.providerMutationLock){
        assertCurrent();val base=file(owner,id);val remnants=variants(base).drop(1);check(remnants.none{it.exists()}){"E2EE_ORIGINAL_CUSTODY_UNAVAILABLE"}
        if(!base.exists())return@synchronized null
        check(base.isFile&&base.canonicalFile.parentFile==folder.canonicalFile&&base.length() in 1..131072){"E2EE_INVALID_ORIGINAL_CUSTODY"}
        val bytes=base.inputStream().use{input->
            val buffer=ByteArray(131073);var size=0
            try{while(size<buffer.size){val count=input.read(buffer,size,buffer.size-size);if(count<0)break;size+=count};check(size in 1..131072){"E2EE_INVALID_ORIGINAL_CUSTODY"};buffer.copyOf(size)}finally{buffer.fill(0)}
        }
        try{assertCurrent();val value=E2eeCommands.decodeCanonical(bytes,131072) as? JSONObject?:error("E2EE_INVALID_ORIGINAL_CUSTODY")
            E2eeKeys.exact(value,setOf("protocol","artifact","reference"));check(E2eeCommands.integer(value.get("protocol"))==1L){"E2EE_INVALID_ORIGINAL_CUSTODY"}
            val ref=E2eeOriginalCustody.reference(value.getJSONObject("reference"));check(ref.get("id")==id&&ref.getJSONObject("original").get("ownerId")==owner){"E2EE_INVALID_ORIGINAL_CUSTODY"};value.getJSONObject("artifact")
            assertCurrent();value
        }finally{bytes.fill(0)}
    }
    override fun list(owner:String,assertCurrent:()->Unit):List<String> = synchronized(E2eeStorageAdmission.providerMutationLock){
        assertCurrent();val prefix=prefix(owner);val ids=linkedSetOf<String>();val pattern=Regex(Regex.escape(prefix)+"([a-f0-9-]{36})\\.vault(?:\\.(?:bak|new))?")
        Files.newDirectoryStream(folder.toPath(),prefix+"*").use{files->for(path in files){assertCurrent();val file=path.toFile();val match=pattern.matchEntire(file.name)?:error("E2EE_INVALID_ORIGINAL_CUSTODY")
            check(file.isFile&&file.canonicalFile.parentFile==folder.canonicalFile){"E2EE_INVALID_ORIGINAL_CUSTODY"};val id=E2eeOriginalCustody.prefix(owner)+match.groupValues[1];E2eeOriginalCustody.validateId(owner,id)
            ids+=id;check(ids.size.toLong()<=E2eeStorageAdmission.providerBudget.maximumKeyRecords){"E2EE_STORAGE_CAPACITY"}
        }};assertCurrent();ids.sorted()
    }
    override fun toString()="E2eeOriginalCustodyFiles([ciphertext])"
}
