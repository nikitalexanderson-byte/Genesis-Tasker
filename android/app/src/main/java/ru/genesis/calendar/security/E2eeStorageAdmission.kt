package ru.genesis.calendar.security

import android.os.StatFs
import java.io.File
import java.nio.file.Files

/** Provider-wide capacity only. No content, original EOF, device trust,
 * identity, membership or recovery authority is granted by these numbers. */
internal object E2eeStorageAdmission {
    /** All provider writes share the same key-file/count admission lock. */
    val providerMutationLock=Any()
    class Usage(val records:Long,val keyRecords:Long,val usageBytes:Long,val quotaBytes:Long) {
        override fun toString()="E2eeStorageAdmission.Usage([redacted])"
    }
    class Budget(val maximumRecords:Long,val maximumKeyRecords:Long,val maximumUsageBytes:Long,val safetyBytes:Long)
    class Growth(val records:Long,val keyRecords:Long,val writeBytes:Long,val rewriteBytes:Long)
    class Admission(val records:Long,val keyRecords:Long,val peakBytes:Long)
    class WriteSize(val nextBytes:Long?,val previousBytes:Long?)
    class WriteGrowth(val added:Long,val removed:Long,val writeBytes:Long,val rewriteBytes:Long)
    private const val MAX=9007199254740991L
    val providerBudget=Budget(10000,1000,MAX,1024*1024)
    private fun valid(value:Long,minimum:Long=0){check(value in minimum..MAX){"E2EE_STORAGE_ADMISSION_INVALID"}}
    internal fun add(vararg values:Long):Long {
        var result=0L
        for(value in values){valid(value);check(value<=MAX-result){"E2EE_STORAGE_ADMISSION_INVALID"};result+=value}
        return result
    }
    /** Headroom is conservative, not an allocation guarantee. Concurrent
     * writers can exhaust quota; existing atomic storage refuses without
     * replacing previously accepted data. */
    fun admit(usage:Usage,growth:Growth,budget:Budget):Admission {
        listOf(usage.records,usage.keyRecords,usage.usageBytes,usage.quotaBytes,growth.records,growth.keyRecords,growth.writeBytes,growth.rewriteBytes).forEach{valid(it)}
        listOf(budget.maximumRecords,budget.maximumKeyRecords,budget.maximumUsageBytes,budget.safetyBytes).forEach{valid(it,1)}
        check(budget.maximumRecords<=10000&&budget.maximumKeyRecords<=1000){"E2EE_STORAGE_ADMISSION_INVALID"}
        val records=add(usage.records,growth.records);val keys=add(usage.keyRecords,growth.keyRecords)
        val peak=add(usage.usageBytes,growth.writeBytes,growth.rewriteBytes,budget.safetyBytes)
        check(records<=budget.maximumRecords&&keys<=budget.maximumKeyRecords&&peak<=budget.maximumUsageBytes&&peak<=usage.quotaBytes){"E2EE_STORAGE_CAPACITY"}
        return Admission(records,keys,peak)
    }
    /** Two prospective serialized copies plus old-row/page rewrite headroom.
     * The caller obtains previous sizes and deletion credits in the SAME CAS
     * transaction; no caller-supplied source total substitutes for actual rows. */
    fun writeGrowth(rows:List<WriteSize>):WriteGrowth {
        check(rows.size in 1..10000){"E2EE_STORAGE_ADMISSION_INVALID"}
        var added=0L;var removed=0L;var write=0L;var rewrite=0L
        for(row in rows){
            row.nextBytes?.let{valid(it,1)};row.previousBytes?.let{valid(it,1)}
            if(row.previousBytes==null&&row.nextBytes!=null)added++
            if(row.previousBytes!=null&&row.nextBytes==null)removed++
            write=add(write,row.nextBytes?:0,row.nextBytes?:0,8192)
            rewrite=add(rewrite,row.previousBytes?:0,8192)
        }
        return WriteGrowth(added,removed,write,rewrite)
    }
    fun rowBytes(key:String,serial:Long,envelope:String):Long {
        check(envelope.length<=8*1024*1024){"E2EE_STORAGE_USAGE_UNAVAILABLE"}
        val text="["+org.json.JSONObject.quote(key)+",{\"serial\":"+serial+",\"envelope\":"+envelope+"}]"
        return maxOf(text.length.toLong()*2,text.toByteArray(Charsets.UTF_8).size.toLong())
    }
    /** Shared metadata measurement. Missing DB is admitted ONLY for the first
     * encrypted key creation, when no DB companion or any device bundle exists.
     * Ordinary measurement/unlock always requires the actual database. */
    fun providerFiles(folder:File,records:Long,firstKeyProvision:Boolean=false):Usage {
        try{
            val base=folder.canonicalFile;val database=File(folder,"e2ee-records-v1.sqlite")
            fun length(file:File):Long {
                check(file.isFile&&file.canonicalFile.parentFile==base){"E2EE_STORAGE_USAGE_UNAVAILABLE"}
                return file.length().also{check(it in 0..MAX){"E2EE_STORAGE_USAGE_UNAVAILABLE"}}
            }
            val missing=!database.exists();check(!missing||firstKeyProvision){"E2EE_STORAGE_USAGE_UNAVAILABLE"}
            var bytes=if(missing)0L else length(database)
            for(suffix in listOf("-journal","-wal","-shm")){
                val file=File(folder,database.name+suffix)
                if(file.exists()){check(!missing){"E2EE_STORAGE_USAGE_UNAVAILABLE"};bytes=add(bytes,length(file))}
            }
            val names=mutableSetOf<String>();val pattern=Regex("(e2ee-(?:device|recovery)-[a-f0-9]{64}(?:-[a-f0-9-]{36})?|e2ee-original-custody-[a-f0-9]{64}-[a-f0-9-]{36})\\.vault(?:\\.(?:bak|new))?")
            Files.newDirectoryStream(folder.toPath(),"e2ee-*").use{files->for(path in files){
                val file=path.toFile();if(!file.name.startsWith("e2ee-device-")&&!file.name.startsWith("e2ee-recovery-")&&!file.name.startsWith("e2ee-original-custody-"))continue
                val match=pattern.matchEntire(file.name)?:error("E2EE_STORAGE_USAGE_UNAVAILABLE")
                names+=match.groupValues[1];check(names.size<=1000){"E2EE_STORAGE_CAPACITY"}
                bytes=add(bytes,length(file))
            }}
            check(!missing||records==0L&&names.isEmpty()){"E2EE_STORAGE_USAGE_UNAVAILABLE"};valid(records)
            return Usage(records,names.size.toLong(),bytes,add(bytes,StatFs(folder.absolutePath).availableBytes))
        }catch(error:Exception){throw IllegalStateException(if(error.message=="E2EE_STORAGE_CAPACITY")"E2EE_STORAGE_CAPACITY"else"E2EE_STORAGE_USAGE_UNAVAILABLE")}
    }
    /** Actual SQLite/owned encrypted-key-file provider. No alternate memory
     * store or arbitrary scope capability can impersonate the provider. */
    fun measure(device:UnlockedE2eeDevice,assertCurrent:()->Unit):Usage {
        assertCurrent();device.requireOpen();val usage=device.vault.providerUsage();assertCurrent();device.requireOpen();return usage
    }
}
