package ru.genesis.calendar.security

import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.security.MessageDigest

/** Actual provider metadata and filesystem space. No other namespace's body
 * or private key is decrypted by measurement. Only the QA package is used. */
@RunWith(AndroidJUnit4::class)
class E2eeStorageAdmissionDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.also{check(BuildConfig.DEBUG&&it.packageName=="ru.genesis.calendar.qa1103.debug")}
        val folder=File(app.noBackupFilesDir,"synthetic-capacity-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext()=this;override fun getNoBackupFilesDir()=folder}
        private val kits=(1..2).map{E2eeKeys.createRecoveryKit("capacity-$it-${UUID.randomUUID()}")}
        val first=UnlockedE2eeDevice.provision(context,kits[0].kit.getString("ownerId"),kits[0].secret,kits[0].kit)
        val second=UnlockedE2eeDevice.provision(context,kits[1].kit.getString("ownerId"),kits[1].secret,kits[1].kit)
        init{
            first.vault.write(listOf(UnlockedE2eeVault.Write("draft","first-only","SYNTHETIC-FIRST-PRIVATE".toByteArray(),null),
                UnlockedE2eeVault.Write("local-snapshot","source-owned","SYNTHETIC-FIRST-SOURCE".toByteArray(),null)))
            second.vault.write(listOf(UnlockedE2eeVault.Write("outbox","second-only","SYNTHETIC-SECOND-PRIVATE".toByteArray(),null)))
        }
        fun snapshot():List<String>{val store=E2eeSqliteStorage(context);return try{store.list("").sorted().map{key->val row=requireNotNull(store.get(key));"$key:${row.serial}:${row.envelope.toJson()}"}}finally{store.close()}}
        fun budget(records:Long=10000,keys:Long=1000)=E2eeStorageAdmission.Budget(records,keys,9007199254740991L,1)
        override fun close(){first.lock();second.lock();kits.forEach{it.secret.fill(0)};check(folder.deleteRecursively())}
    }
    private fun refused(code:String,operation:()->Unit){try{operation();fail("Unsafe capacity grant accepted")}catch(error:Exception){assertEquals(code,error.message)}}
    @Test fun allAccountsSourcesQueuesAndKeysCountWithoutCrossNamespaceReadAuthority(){
        Rig().use{f->val before=f.snapshot();val usage=E2eeStorageAdmission.measure(f.first){}
            assertEquals(3L,usage.records);assertEquals(2L,usage.keyRecords);assertTrue(usage.usageBytes>0);assertTrue(usage.quotaBytes>=usage.usageBytes)
            assertNull(f.first.vault.read("outbox","second-only"));assertEquals(before,f.snapshot());assertFalse(before.joinToString().contains("SYNTHETIC-SECOND-PRIVATE"))
            refused("E2EE_STORAGE_CAPACITY"){E2eeStorageAdmission.admit(usage,E2eeStorageAdmission.Growth(1,0,1,1),f.budget(records=3))}
            refused("E2EE_STORAGE_CAPACITY"){E2eeStorageAdmission.admit(usage,E2eeStorageAdmission.Growth(0,1,1,1),f.budget(keys=2))}
            assertEquals(before,f.snapshot())
        }
    }
    @Test fun encryptedAtomicBackupAddsPhysicalBytesWithoutInventingAnotherOwnerOrMutatingIt(){
        Rig().use{f->val before=f.snapshot();val original=f.folder.listFiles()!!.first{it.name.matches(Regex("e2ee-device-[a-f0-9]{64}\\.vault"))}
            val backup=File(f.folder,original.name+".bak");val initial=E2eeStorageAdmission.measure(f.first){};original.copyTo(backup)
            try{val after=E2eeStorageAdmission.measure(f.first){};assertEquals(initial.records,after.records);assertEquals(initial.keyRecords,after.keyRecords);assertEquals(initial.usageBytes+original.length(),after.usageBytes);assertEquals(before,f.snapshot())}
            finally{check(backup.delete())}
        }
    }
    @Test fun unknownKeyFileRoleAndMissingDatabaseCannotBecomeEmptyUsage(){
        for(mode in listOf("unknown-key-role","missing-database"))Rig().use{f->val before=f.snapshot()
            val malformed=File(f.folder,"e2ee-device-unknown.vault");val database=File(f.folder,"e2ee-records-v1.sqlite");val retained=File(f.folder,"synthetic-held.sqlite")
            if(mode=="unknown-key-role")malformed.writeText("SYNTHETIC INVALID ROLE")else check(database.renameTo(retained))
            try{refused("E2EE_STORAGE_USAGE_UNAVAILABLE"){E2eeStorageAdmission.measure(f.first){}}}
            finally{if(mode=="unknown-key-role")check(malformed.delete())else check(retained.renameTo(database))}
            assertEquals(before,f.snapshot())
        }
    }
    @Test fun retiredOperationOrLockedDeviceCannotReturnAStorageMeasurement(){
        Rig().use{f->val before=f.snapshot();var guards=0
            refused("E2EE_ACCOUNT_CHANGED"){E2eeStorageAdmission.measure(f.first){guards++;check(guards<2){"E2EE_ACCOUNT_CHANGED"}}}
            assertEquals(2,guards);assertEquals(before,f.snapshot());f.first.lock()
            refused("E2EE_UNLOCK_REQUIRED"){E2eeStorageAdmission.measure(f.first){}}
            assertEquals(before,f.snapshot())
        }
    }
    @Test fun concurrentVaultWritersCannotBothConsumeTheFinalProviderRecordSlot(){
        Rig().use{f->
            val limit=E2eeStorageAdmission.providerBudget.maximumRecords
            E2eeSqliteStorage(f.context).use{store->
                val row=requireNotNull(store.get(store.list("").first()))
                // Existing ciphertext count fixture, as in the browser IDB
                // harness. It grants no decrypt/read authority for these keys.
                SQLiteDatabase.openDatabase(File(f.folder,"e2ee-records-v1.sqlite").absolutePath,null,SQLiteDatabase.OPEN_READWRITE).use{db->
                    db.beginTransaction()
                    try{db.compileStatement("INSERT INTO records VALUES(?,?,?)").use{insert->
                        val envelope=row.envelope.toJson().toString()
                        for(index in 3L until limit-1){insert.bindString(1,"synthetic-other-namespace:$index");insert.bindLong(2,row.serial);insert.bindString(3,envelope);insert.executeInsert();insert.clearBindings()}
                    };db.setTransactionSuccessful()}finally{db.endTransaction()}
                }
                assertEquals(limit-1,store.providerUsage().records)
            }
            val executor=Executors.newFixedThreadPool(2);val start=CountDownLatch(1)
            try{
                val attempts=listOf(f.first,f.second).mapIndexed{index,device->executor.submit(Callable{
                    start.await()
                    try{device.vault.write(listOf(UnlockedE2eeVault.Write("draft","last-row-$index","SYNTHETIC LAST RECORD".toByteArray(),null)));"PASS"}
                    catch(error:Exception){error.message}
                })}
                start.countDown();val outcomes=attempts.map{it.get()}
                assertEquals(1,outcomes.count{it=="PASS"});assertEquals(1,outcomes.count{it=="E2EE_STORAGE_CAPACITY"})
                E2eeSqliteStorage(f.context).use{assertEquals(limit,it.providerUsage().records)}
                assertNotNull(f.first.vault.read("draft","first-only"));assertNotNull(f.second.vault.read("outbox","second-only"))
            }finally{executor.shutdownNow()}
        }
    }
    @Test fun concurrentProtectedKeyCreatesCannotExceedGlobalBundleCount(){
        Rig().use{f->
            val limit=E2eeStorageAdmission.providerBudget.maximumKeyRecords
            val source=f.folder.listFiles()!!.first{it.name.matches(Regex("e2ee-device-[a-f0-9]{64}\\.vault"))}
            for(index in 2L until limit-1)source.copyTo(File(f.folder,"e2ee-device-${index.toString(16).padStart(64,'0')}.vault"))
            assertEquals(limit-1,E2eeStorageAdmission.measure(f.first){}.keyRecords)
            val kits=(1..2).map{E2eeKeys.createRecoveryKit("last-capacity-owner-$it-${UUID.randomUUID()}")}
            val executor=Executors.newFixedThreadPool(2);val start=CountDownLatch(1)
            try{
                val attempts=kits.map{kit->executor.submit(Callable{
                    start.await()
                    try{UnlockedE2eeDevice.provision(f.context,kit.kit.getString("ownerId"),kit.secret,kit.kit).also{it.lock()};"PASS"}
                    catch(error:Exception){error.message}
                })}
                start.countDown();val outcomes=attempts.map{it.get()}
                assertEquals(1,outcomes.count{it=="PASS"});assertEquals(1,outcomes.count{it=="E2EE_STORAGE_CAPACITY"})
                assertEquals(limit,E2eeStorageAdmission.measure(f.first){}.keyRecords)
            }finally{executor.shutdownNow();kits.forEach{it.secret.fill(0)}}
        }
    }
    @Test fun providerMetadataFailureBlocksAnActualVaultWriteAndPreservesOriginals(){
        Rig().use{f->val before=f.snapshot();val malformed=File(f.folder,"e2ee-device-unknown.vault");malformed.writeText("SYNTHETIC INVALID ROLE")
            try{refused("E2EE_STORAGE_USAGE_UNAVAILABLE"){f.first.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","prospective-source",ByteArray(65536),null)))}}
            finally{check(malformed.delete())}
            assertEquals(before,f.snapshot());assertNull(f.first.vault.read("local-snapshot","prospective-source"))
        }
    }
    @Test fun partialFirstKeyBundleCannotBeReplacedByFreshProvisioning(){
        Rig().use{f->val kit=E2eeKeys.createRecoveryKit("partial-key-owner-${UUID.randomUUID()}")
            val hash=MessageDigest.getInstance("SHA-256").digest(kit.kit.getString("ownerId").toByteArray()).joinToString(""){"%02x".format(it)}
            val partial=File(f.folder,"e2ee-device-$hash.vault.new");partial.writeBytes(byteArrayOf(1,2,3));val before=f.snapshot()
            try{refused("E2EE_DEVICE_ALREADY_EXISTS"){UnlockedE2eeDevice.provision(f.context,kit.kit.getString("ownerId"),kit.secret,kit.kit)}
                assertArrayEquals(byteArrayOf(1,2,3),partial.readBytes());assertEquals(before,f.snapshot())
            }finally{kit.secret.fill(0);check(partial.delete())}
        }
    }
}
