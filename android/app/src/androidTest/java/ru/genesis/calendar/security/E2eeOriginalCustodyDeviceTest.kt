package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID

/** Actual provider/Keystore, isolated synthetic owners/directories only.
 * This proves owner custody of staged originals, not complete product recovery. */
class E2eeOriginalCustodyDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val base=File(app.noBackupFilesDir,"original-custody-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val oldFolder=File(base,"old").apply{check(mkdir())};val newFolder=File(base,"new").apply{check(mkdir())}
        fun context(folder:File):Context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=folder}
        val oldContext=context(oldFolder);val newContext=context(newFolder);val owner="qa-custody-${UUID.randomUUID()}";val recovery=E2eeKeys.createRecoveryKit(owner)
        val ownerHash=MessageDigest.getInstance("SHA-256").digest(owner.toByteArray()).joinToString(""){"%02x".format(it)};val alias="genesis.e2ee.device.v1.$ownerHash"
        val old=UnlockedE2eeDevice.provision(oldContext,owner,recovery.secret,recovery.kit);var fresh:UnlockedE2eeDevice?=null
        val target=E2eeSourceStage.Target("other-project-owner","project:owner-custody","project");var live=true;val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        init{check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))}
        fun stage(size:Int):E2eeSourceStage.Reference {
            val stage=E2eeSourceStage.create(E2eeSourceStage.Options(old.vault,target,listOf("project.content"),E2eeSourceStage.Capacity(4L*1024*1024,32),old::ensureDurableKeys,current,{}))
            stage.capturePath("project.content"){out->val bytes=ByteArray(65536);try{var at=0;while(at<size){val count=minOf(bytes.size,size-at);for(i in 0 until count)bytes[i]=((at+i)%251).toByte();out.write(bytes,0,count);at+=count}}finally{bytes.fill(0)}}
            return stage.finish()
        }
        fun preserve():JSONObject=old.preserveOriginalSources(recovery.secret,recovery.kit,current)
        fun loseOldAndProvisionFresh(){
            old.lock();val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};check(store.containsAlias(alias));store.deleteEntry(alias);check(!store.containsAlias(alias))
            for(file in oldFolder.listFiles().orEmpty().filter{it.name=="e2ee-records-v1.sqlite"||it.name.startsWith("e2ee-original-custody-")}){
                check(file.canonicalFile.parentFile==oldFolder.canonicalFile);file.copyTo(File(newFolder,file.name),overwrite=false)
            }
            check(newFolder.listFiles().orEmpty().none{it.name.startsWith("e2ee-device-")});fresh=UnlockedE2eeDevice.provision(newContext,owner,recovery.secret,recovery.kit)
        }
        override fun close(){old.lock();fresh?.lock();recovery.secret.fill(0);val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};if(store.containsAlias(alias))store.deleteEntry(alias)
            check(base.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&base.name.startsWith("original-custody-synthetic-"));check(base.deleteRecursively())}
    }
    private fun snapshot(storage:E2eeRecordStorage):String {
        val rows=JSONArray();for(key in storage.list("")){val row=requireNotNull(storage.get(key));rows.put(JSONObject().put("key",key).put("serial",row.serial).put("envelope",row.envelope.toJson()))};return E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(E2eeCommands.canonical(rows)))
    }
    private fun consume(reader:E2eeOriginalCustody.Reader,target:E2eeSourceStage.Target,reference:E2eeSourceStage.Reference,size:Int){
        reader.openStage(target,reference).use{stage->stage.openPath("project.content").use{input->val bytes=ByteArray(65536);var at=0
            try{while(true){val count=input.read(bytes);if(count<0)break;for(i in 0 until count)check(bytes[i]==((at+i)%251).toByte());at+=count;bytes.fill(0)};input.assertComplete();assertEquals(size,at)}finally{bytes.fill(0)}
        }}
    }
    @Test fun actualColdRecoverySurvivesOriginalAliasLossAndFreshIdentityWithoutOldPrivateKeys(){
        Rig().use{f->
            val stage=f.stage(2*1024*1024+17);val original=f.old.deviceId;val reference=f.preserve()
            E2eeSqliteStorage(f.oldContext).use{db->assertEquals(2L,db.providerUsage().keyRecords)}
            f.loseOldAndProvisionFresh();assertNotEquals(original,requireNotNull(f.fresh).deviceId)
            E2eeSqliteStorage(f.newContext).use{db->val before=snapshot(db)
                val files=E2eeOriginalCustodyFiles(f.newContext);val id=files.list(f.owner,f.current).single();assertEquals(reference.getString("id"),id)
                E2eeOriginalCustody.recoverById(files,f.owner,f.recovery.kit.getJSONObject("authority"),f.recovery.kit,f.recovery.secret,id,db,f.current).use{reader->consume(reader,f.target,stage,2*1024*1024+17)}
                assertEquals(before,snapshot(db));assertEquals(2L,db.providerUsage().keyRecords)
            }
        }
    }
    @Test fun sameOwnerProjectKitEitherChangedPrimaryKeyAndWrongSecretNeverOpenOriginalBodies(){
        Rig().use{f->val stage=f.stage(3);val reference=f.preserve();val other=E2eeKeys.createRecoveryKit(f.owner)
            E2eeSqliteStorage(f.oldContext).use{db->val before=snapshot(db);val files=E2eeOriginalCustodyFiles(f.oldContext)
                assertThrows(Exception::class.java){E2eeOriginalCustody.recover(files,f.owner,f.recovery.kit.getJSONObject("authority"),f.recovery.kit,E2eeKeys.freshSecret(),reference,db,f.current)}
                for(field in listOf("signingKey","receivingKey")){val pin=JSONObject(f.recovery.kit.getJSONObject("authority").toString()).put(field,other.kit.getJSONObject("authority").get(field))
                    assertThrows(Exception::class.java){E2eeOriginalCustody.recover(files,f.owner,pin,f.recovery.kit,f.recovery.secret,reference,db,f.current)}}
                assertThrows(Exception::class.java){E2eeOriginalCustody.recover(files,f.owner,other.kit.getJSONObject("authority"),other.kit,other.secret,reference,db,f.current)}
                E2eeOriginalCustody.recover(files,f.owner,f.recovery.kit.getJSONObject("authority"),f.recovery.kit,f.recovery.secret,reference,db,f.current).use{consume(it,f.target,stage,3)};assertEquals(before,snapshot(db))
            };other.secret.fill(0)
        }
    }
    @Test fun partialArtifactsAreCountedPreservedAndRefusedWithoutAtomicFileReadRepair(){
        Rig().use{f->f.stage(3);val reference=f.preserve();val id=reference.getString("id");val files=E2eeOriginalCustodyFiles(f.oldContext);val artifact=requireNotNull(files.get(f.owner,id,f.current))
            val base=f.oldFolder.listFiles().orEmpty().single{it.name.startsWith("e2ee-original-custody-")};val partial=File(base.path+".new");partial.writeBytes(byteArrayOf(9,8,7))
            assertThrows(Exception::class.java){files.get(f.owner,id,f.current)};assertThrows(Exception::class.java){files.create(f.owner,artifact,f.current,reference)}
            assertArrayEquals(byteArrayOf(9,8,7),partial.readBytes());E2eeSqliteStorage(f.oldContext).use{assertEquals(2L,it.providerUsage().keyRecords)}
            val malformed=File(f.oldFolder,"e2ee-original-custody-malformed.new").apply{writeBytes(byteArrayOf(1))}
            E2eeSqliteStorage(f.oldContext).use{assertThrows(Exception::class.java){it.providerUsage()}};assertTrue(malformed.exists());assertTrue(base.exists());assertTrue(partial.exists())
        }
    }
    @Test fun actualKeyRecordLimitRefusesBeforeNewArtifactAndRetainsEveryCiphertext(){
        Rig().use{f->f.stage(3);f.preserve();val seeded=ArrayList<File>()
            try{
                val maximum = E2eeStorageAdmission.providerBudget.maximumKeyRecords
                repeat(Math.toIntExact(maximum - 2)) {
                    seeded += File(f.oldFolder,"e2ee-original-custody-${f.ownerHash}-${UUID.randomUUID()}.vault").apply { writeBytes(byteArrayOf(1)) }
                }
                E2eeSqliteStorage(f.oldContext).use { db ->
                    assertEquals(maximum,db.providerUsage().keyRecords)
                    val before = snapshot(db)
                    val names = f.oldFolder.listFiles().orEmpty().map { it.name }.toSet()
                    assertEquals("E2EE_STORAGE_CAPACITY",assertThrows(Exception::class.java){f.preserve()}.message)
                    assertEquals(names,f.oldFolder.listFiles().orEmpty().map { it.name }.toSet())
                    assertEquals(before,snapshot(db))
                    assertEquals(Math.toIntExact(maximum - 1),E2eeOriginalCustodyFiles(f.oldContext).list(f.owner,f.current).size)
                }
            }finally{seeded.forEach{check(it.canonicalFile.parentFile==f.oldFolder.canonicalFile);check(it.delete())}}
        }
    }
    @Test fun retirementDuringActualAtomicWriteRetainsPartialWithoutReturningPortableReceipt(){
        Rig().use{f->f.stage(3);f.preserve();val oldNames=f.oldFolder.listFiles().orEmpty().map{it.name}.toSet()
            E2eeSqliteStorage(f.oldContext).use{db->val before=snapshot(db)
                val error=assertThrows(Exception::class.java){f.old.preserveOriginalSources(f.recovery.secret,f.recovery.kit){if(f.oldFolder.listFiles().orEmpty().any{it.name.endsWith(".new")&&it.length()>0})error("E2EE_ACCOUNT_CHANGED")}}
                assertEquals("E2EE_ACCOUNT_CHANGED",error.message);val partial=f.oldFolder.listFiles().orEmpty().single{it.name !in oldNames};assertTrue(partial.name.endsWith(".new"));assertTrue(partial.length()>0)
                val files=E2eeOriginalCustodyFiles(f.oldContext);val ids=files.list(f.owner,f.current);assertEquals(2,ids.size);val id=E2eeOriginalCustody.prefix(f.owner)+partial.name.removePrefix("e2ee-original-custody-${f.ownerHash}-").removeSuffix(".vault.new")
                assertThrows(Exception::class.java){files.get(f.owner,id,f.current)};assertTrue(partial.exists());assertEquals(before,snapshot(db));assertEquals(3L,db.providerUsage().keyRecords)
            }
        }
    }
    @Test fun actualOwnerArtifactExportsPublicOnlyInteropAndMissingDatabaseNeverCreatesAnEmptyStore(){
        Rig().use{f->val stage=f.stage(3);val reference=f.preserve();val artifact=requireNotNull(E2eeOriginalCustodyFiles(f.oldContext).get(f.owner,reference.getString("id"),f.current))
            val payload=E2eeKeys.openBundle(f.owner,E2eeOriginalCustody.PURPOSE,f.recovery.secret,artifact.getJSONObject("bundle"));try{assertEquals(setOf("protocol","root","certificate"),JSONObject(payload.toString(Charsets.UTF_8)).keys().asSequence().toSet())}finally{payload.fill(0)}
            E2eeSqliteStorage(f.oldContext).use{db->val rows=JSONArray();for(key in db.list("")){val row=requireNotNull(db.get(key));rows.put(JSONObject().put("key",key).put("serial",row.serial).put("envelope",row.envelope.toJson()))}
                val vector=JSONObject().put("synthetic",true).put("warning","PUBLIC TEST RECOVERY MATERIAL; NEVER USE FOR USER DATA").put("producer","JCA API${android.os.Build.VERSION.SDK_INT} original custody v1")
                    .put("ownerId",f.owner).put("primaryPin",f.recovery.kit.getJSONObject("authority")).put("recoveryKit",f.recovery.kit).put("secret",E2eeEnvelope.encode(f.recovery.secret)).put("artifact",artifact).put("reference",reference)
                    .put("target",JSONObject().put("ownerId",f.target.ownerId).put("scopeId",f.target.scopeId).put("kind",f.target.kind)).put("stageReference",JSONObject().put("stageId",stage.stageId).put("manifestHash",stage.manifestHash))
                    .put("paths",JSONArray().put(JSONObject().put("id","project.content").put("plaintext",E2eeEnvelope.encode(byteArrayOf(0,1,2))))).put("records",rows)
                File(f.app.getExternalFilesDir(null),"original-custody336-native-vector.json").outputStream().use{out->out.write(vector.toString().toByteArray());out.fd.sync()}
            }
            f.old.lock();val database=File(f.newFolder,"e2ee-records-v1.sqlite");assertFalse(database.exists())
            assertEquals("E2EE_STORAGE_MISSING",assertThrows(Exception::class.java){E2eeOriginalCustodyFiles(f.newContext).create(f.owner,artifact,f.current,reference)}.message)
            assertFalse(database.exists());assertTrue(File(f.oldFolder,"e2ee-records-v1.sqlite").exists())
        }
    }
}
