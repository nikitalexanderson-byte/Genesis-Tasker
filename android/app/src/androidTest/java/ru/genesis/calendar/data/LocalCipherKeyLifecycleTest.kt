package ru.genesis.calendar.data

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.security.KeyStore
import java.util.UUID

/** Only unique synthetic fixture roots and aliases are removed. The actual app
 * database, default Keystore alias, auth jar and user settings are never changed. */
class LocalCipherKeyLifecycleTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val alias="genesis.qa.key-lifecycle.${UUID.randomUUID()}"
        val directory=File(app.noBackupFilesDir.canonicalFile,"qa-local-key-${UUID.randomUUID()}")
        val database=File(directory,"genesis.db");val preferences=File(directory,"shared_prefs")
        val drafts=File(directory,"drafts");val imports=File(directory,"imports");val witnessDirectory=File(directory,"witness")
        val inventory=LegacyLocalCipherInventory(database,preferences,listOf(drafts,imports))
        val witnesses=LocalKeyWitnessStore(witnessDirectory,inventory::containsRetainedData){true}
        val cipher=LocalCipher(alias,witnesses)
        init{check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));check(directory.mkdir())}
        fun exists()=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(alias)
        fun eraseAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        fun eraseWitnessForLegacyFixture(){
            check(witnessDirectory.canonicalFile.parentFile==directory.canonicalFile);check(witnessDirectory.deleteRecursively())
        }
        fun createDatabase():SQLiteDatabase=SQLiteDatabase.openOrCreateDatabase(database,null).also{db->
            db.execSQL("CREATE TABLE tasks(id TEXT,encrypted TEXT)");db.execSQL("CREATE TABLE documents(kind TEXT,encrypted TEXT)");db.execSQL("CREATE TABLE outbox(id TEXT)")
        }
        override fun close(){
            eraseAlias();check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("qa-local-key-"));check(directory.deleteRecursively())
        }
    }
    private fun rejects(code:String,action:()->Unit){try{action();fail("Expected $code")}catch(error:IllegalStateException){assertEquals(code,error.message)}}
    @Test fun initialEncryptionDurablyWitnessesAliasAndLostKeyCannotBeRegeneratedEvenBeforeAnyRead(){
        val f=Rig();try{
            val original=f.cipher.encrypt("Synthetic retained private content","synthetic-purpose");assertEquals("Synthetic retained private content",f.cipher.decrypt(original,"synthetic-purpose"))
            assertTrue(f.witnesses.wasUsed(f.alias));f.eraseAlias();rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("New attempted replacement","other-purpose")}
            assertFalse(f.exists());assertTrue(f.witnesses.wasUsed(f.alias));assertTrue(runCatching{f.cipher.decrypt(original,"synthetic-purpose")}.isFailure)
        }finally{f.close()}
    }
    @Test fun upgradeWithAnExistingKeyCanReadWithoutMutationAndWitnessBeforeTheNextWrite(){
        val f=Rig();try{
            val old=f.cipher.encrypt("Synthetic pre-upgrade ciphertext","legacy");f.eraseWitnessForLegacyFixture();assertFalse(f.witnessDirectory.exists())
            assertEquals("Synthetic pre-upgrade ciphertext",f.cipher.decrypt(old,"legacy"));assertFalse(f.witnessDirectory.exists())
            val next=f.cipher.encrypt("Synthetic post-upgrade ciphertext","next");assertTrue(f.witnesses.wasUsed(f.alias))
            assertEquals("Synthetic pre-upgrade ciphertext",f.cipher.decrypt(old,"legacy"));assertEquals("Synthetic post-upgrade ciphertext",f.cipher.decrypt(next,"next"))
        }finally{f.close()}
    }
    @Test fun oldDatabaseWithoutWitnessOrKeystoreBlocksFreshEncryptionAcrossAllRetainedTables(){
        for(table in listOf("tasks","documents","outbox")){
            val f=Rig();try{
                f.createDatabase().use{db->if(table=="outbox")db.execSQL("INSERT INTO outbox VALUES('synthetic-unacknowledged')")else db.execSQL("INSERT INTO $table VALUES('synthetic-id','retained-ciphertext')")}
                val before=f.database.readBytes();rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Attempted replacement","new")};assertFalse(f.exists());assertArrayEquals(before,f.database.readBytes())
            }finally{f.close()}
        }
    }
    @Test fun restoredEncryptedPreferencesIncludingCdataAndInterruptedBackupsNeverCountAsAnEmptyInstallation(){
        for(kind in listOf("regular","cdata","backup")){
            val f=Rig();try{
                val encrypted=f.cipher.encrypt("Synthetic retained session or planning draft","legacy");f.eraseWitnessForLegacyFixture();f.eraseAlias();check(f.preferences.mkdir())
                val value=if(kind=="cdata")"<![CDATA[${encrypted.take(13)}]]><![CDATA[${encrypted.drop(13)}]]>" else encrypted
                val file=File(f.preferences,if(kind=="backup")"genesis.shared.planning.v1.xml.bak" else "genesis.native.auth.v1.xml")
                file.writeText("<?xml version='1.0' encoding='utf-8'?><map><string name='private-draft'>$value</string></map>")
                val before=file.readBytes();rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Attempted new session","new")};assertFalse(f.exists());assertArrayEquals(before,file.readBytes())
            }finally{f.close()}
        }
    }
    @Test fun retainedFileDraftOrImportChunkBlocksKeyCreationWithoutOpeningOrRemovingIt(){
        for(isImport in listOf(false,true)){
            val f=Rig();try{
                val store=if(isImport)f.imports else f.drafts;check(store.mkdir());val file=File(store,"synthetic-pending.tmp");file.writeBytes(byteArrayOf(3,9,5,7));val before=file.readBytes()
                rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Attempted replacement","new")};assertFalse(f.exists());assertArrayEquals(before,file.readBytes())
            }finally{f.close()}
        }
    }
    @Test fun restoredBackupFormLocatorsBlockReplacementThroughTheActualContextInventory(){
        val f=Rig();try{
            val files=File(f.directory,"files").apply{mkdir()};val noBackup=File(f.directory,"no_backup").apply{mkdir()}
            val context=object:android.content.ContextWrapper(f.app){
                override fun getDatabasePath(name:String)=f.database
                override fun getFilesDir()=files
                override fun getNoBackupFilesDir()=noBackup
                override fun getApplicationInfo()=android.content.pm.ApplicationInfo().apply{dataDir=f.directory.path}
            }
            val directory=File(noBackup,"backup-forms-v1/${UUID.randomUUID()}");check(directory.mkdirs())
            val locator=File(directory,"${UUID.randomUUID()}.ref");locator.writeBytes(byteArrayOf(3,7,9,5));val original=locator.readBytes()
            val inventory=LegacyLocalCipherInventory(context);assertTrue(inventory.containsRetainedData())
            val witnesses=LocalKeyWitnessStore(f.witnessDirectory,inventory::containsRetainedData){true}
            rejects("LOCAL_ENCRYPTION_KEY_LOST"){LocalCipher(f.alias,witnesses).encrypt("Attempted new form","new")}
            assertFalse(f.exists());assertArrayEquals(original,locator.readBytes());assertTrue(witnesses.wasUsed(f.alias))
        }finally{f.close()}
    }
    @Test fun aFreshEmptyDatabaseAndTechnicalPreferencesAllowFirstEncryption(){
        val f=Rig();try{
            f.createDatabase().close();check(f.preferences.mkdir());File(f.preferences,"genesis.settings.xml").writeText("<map><string name='language'>en</string><boolean name='dark' value='true'/></map>")
            assertFalse(f.inventory.containsRetainedData());val encrypted=f.cipher.encrypt("Synthetic first record","new");assertEquals("Synthetic first record",f.cipher.decrypt(encrypted,"new"));assertTrue(f.witnesses.wasUsed(f.alias))
        }finally{f.close()}
    }
    @Test fun startupPreparationAllowsTheFirstWriteInsideAnExclusiveRollbackJournalTransaction(){
        val f=Rig();try{
            f.cipher.prepare();assertTrue(f.witnesses.wasUsed(f.alias))
            f.createDatabase().use{db->db.execSQL("BEGIN EXCLUSIVE");try{
                val value=f.cipher.encrypt("Synthetic first committed task","first-task")
                db.execSQL("INSERT INTO tasks VALUES(?,?)",arrayOf("first-task",value));assertEquals("Synthetic first committed task",f.cipher.decrypt(value,"first-task"))
            }finally{db.execSQL("ROLLBACK")}}
        }finally{f.close()}
    }
    @Test fun malformedOrUnknownPreferenceXmlCannotAuthorizeAnEmptyReplacement(){
        for(raw in listOf("<wrong/>","<map><unknown/></map>","<map><string name='x'>unfinished","<!DOCTYPE map [<!ENTITY x 'hidden'>]><map/>")){
            val f=Rig();try{check(f.preferences.mkdir());val file=File(f.preferences,"genesis.native.auth.v1.xml");file.writeText(raw)
                rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){f.cipher.encrypt("Attempt","new")};assertFalse(f.exists());assertEquals(raw,file.readText())
            }finally{f.close()}
        }
    }
    @Test fun corruptPrivatePreferenceValuesOrTypesStillBlockAReplacementKey(){
        for(name in listOf("genesis.native.auth.v1.xml","genesis.shared.planning.v1.xml.bak"))for(entry in listOf("<string name='private'>damaged ciphertext!</string>","<boolean name='private' value='true'/>")){
            val f=Rig();try{check(f.preferences.mkdir());val file=File(f.preferences,name);file.writeText("<map>$entry</map>");val before=file.readBytes()
                rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Attempted empty replacement","new")};assertFalse(f.exists());assertArrayEquals(before,file.readBytes())
            }finally{f.close()}
        }
    }
    @Test fun observedLegacyDataKeepsADurableDenialEvenAfterAnotherCleanupEmptiesItsCache(){
        val f=Rig();try{
            f.createDatabase().use{it.execSQL("INSERT INTO tasks VALUES('synthetic','retained-ciphertext')")}
            rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Attempt","new")};assertTrue(f.witnesses.wasUsed(f.alias));assertFalse(f.exists())
            SQLiteDatabase.openDatabase(f.database.path,null,SQLiteDatabase.OPEN_READWRITE).use{it.execSQL("DELETE FROM tasks")}
            assertFalse(f.inventory.containsRetainedData());rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Still must not replace","new")};assertFalse(f.exists())
        }finally{f.close()}
    }
    @Test fun anInventoryErrorStaysHeldAfterAPlatformPreferenceReaderReplacesItsCorruptXml(){
        val f=Rig();try{
            check(f.preferences.mkdir());val file=File(f.preferences,"genesis.native.auth.v1.xml");file.writeText("<map><unknown/></map>")
            rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){f.cipher.encrypt("Attempt","new")};assertTrue(f.witnesses.wasUsed(f.alias));assertFalse(f.exists())
            file.writeText("<map/>");assertFalse(f.inventory.containsRetainedData());rejects("LOCAL_ENCRYPTION_KEY_LOST"){f.cipher.encrypt("Still must not replace","new")};assertFalse(f.exists())
        }finally{f.close()}
    }
    @Test fun corruptUnknownAndBusyDatabasesNeverAuthorizeAReplacementKey(){
        val corrupt=Rig();try{corrupt.database.writeBytes(ByteArray(128){7});val before=corrupt.database.readBytes();rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){corrupt.cipher.encrypt("Attempt","new")};assertFalse(corrupt.exists());assertArrayEquals(before,corrupt.database.readBytes())}finally{corrupt.close()}
        val unknown=Rig();try{SQLiteDatabase.openOrCreateDatabase(unknown.database,null).close();rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){unknown.cipher.encrypt("Attempt","new")};assertFalse(unknown.exists())}finally{unknown.close()}
        val busy=Rig();try{busy.createDatabase().use{db->db.execSQL("BEGIN EXCLUSIVE");try{rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){busy.cipher.encrypt("Attempt","new")};assertFalse(busy.exists())}finally{db.execSQL("ROLLBACK")}}}finally{busy.close()}
    }
    @Test fun malformedWitnessAndAConcurrentCreationPermitRefuseWithoutReplacingAnyKey(){
        val f=Rig();try{
            val old=f.cipher.encrypt("Synthetic decryptable retained bytes","legacy");val marker=requireNotNull(f.witnessDirectory.listFiles()).single{it.name.endsWith(".witness")};marker.writeText("damaged marker")
            rejects("LOCAL_KEY_STORAGE_UNAVAILABLE"){f.cipher.encrypt("Attempt","new")};assertEquals("damaged marker",marker.readText());assertEquals("Synthetic decryptable retained bytes",f.cipher.decrypt(old,"legacy"))
        }finally{f.close()}
        val racing=Rig();try{racing.witnesses.withCreationPermit(racing.alias){rejects("LOCAL_KEY_OPERATION_BUSY"){racing.cipher.encrypt("Attempt","new")};assertFalse(racing.exists())}
            assertEquals("After release",racing.cipher.decrypt(racing.cipher.encrypt("After release","new"),"new"))
        }finally{racing.close()}
    }
    @Test fun readOfAMissingOldAliasNeverCreatesAWitnessOrAKey(){
        val f=Rig();try{val encoded=java.util.Base64.getEncoder().encodeToString(ByteArray(28));assertTrue(runCatching{f.cipher.decrypt(encoded,"old")}.isFailure);assertFalse(f.exists());assertFalse(f.witnessDirectory.exists())}finally{f.close()}
    }
}
