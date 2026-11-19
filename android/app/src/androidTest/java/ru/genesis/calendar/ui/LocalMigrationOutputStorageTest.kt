package ru.genesis.calendar.ui

import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.security.*
import java.util.UUID

/** Real ciphertext SQLite and JCA storage; no account, network or transport port. */
class LocalMigrationOutputStorageTest {
    private class Rig:AutoCloseable {
        val app=ApplicationProvider.getApplicationContext<GenesisApplication>()
        val owner="local-output-${UUID.randomUUID()}";val scope="personal:$owner";val migration=UUID.randomUUID().toString()
        val secret=E2eeKeys.freshSecret();val keys=E2eeKeys.generateDeviceKeys();val root=E2eeEnvelope.importRoot(secret)
        var storage=E2eeSqliteStorage(app,allowCreate=true)
        fun context(rootKey:javax.crypto.SecretKey=root)=UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-root",keys.signing.private,mapOf("synthetic-root" to rootKey)){keys.signing.public}
        var vault=UnlockedE2eeVault(storage,context())
        init{check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))}
        fun save(payload:ByteArray):List<E2eeMigrationLocal.Entry> {
            val plan=E2eeMigrationLocal.plan(migration,listOf(E2eeMigrationContent("diary","local-private-note",payload,"Private local title.json")))
            val bytes=plan.entries.toString().toByteArray(Charsets.UTF_8)
            try{vault.write(plan.writes+UnlockedE2eeVault.Write("local-snapshot","local-manifest",bytes,null))}finally{bytes.fill(0);plan.writes.forEach{it.bytes.fill(0)}}
            return E2eeMigrationLocal.validate(plan.entries,migration,setOf("diary"))
        }
        fun saved():List<E2eeMigrationLocal.Entry> {
            val record=requireNotNull(vault.read("local-snapshot","local-manifest"))
            return try{E2eeMigrationLocal.validate(JSONArray(record.bytes.toString(Charsets.UTF_8)),migration,setOf("diary"))}finally{record.bytes.fill(0)}
        }
        override fun close(){vault.lock();storage.close();secret.fill(0)}
    }
    @Test fun actualSqliteKeepsPrivateManifestAndMultipartBytesEncryptedAcrossReopen(){
        val f=Rig();try{
            val payload=ByteArray(2*E2eeFiles.CHUNK_BYTES+17){(it%251).toByte()};val entries=f.save(payload);assertEquals(3,entries.single().parts)
            val key=UnlockedE2eeVault.recordKey(f.vault.requireOpen(),"local-snapshot","local-manifest")
            val envelope=requireNotNull(f.storage.get(key)).envelope.toJson().toString()
            assertFalse(envelope.contains("Private local title.json"));assertFalse(envelope.contains(entries.single().plaintextHash))
            f.vault.lock();f.storage.close();f.storage=E2eeSqliteStorage(f.app);f.vault=UnlockedE2eeVault(f.storage,f.context())
            val record=E2eeMigrationLocal.open(f.vault,f.saved().single())
            try{assertArrayEquals(payload,record.bytes);assertEquals("Private local title.json",record.filename)}finally{record.bytes.fill(0);payload.fill(0)}
        }finally{f.close()}
    }
    @Test fun missingLocalPartRemainsAnErrorAndDoesNotRewriteTheProtectedManifest(){
        val f=Rig();try{
            val entry=f.save("Synthetic device-only diary and draft".toByteArray()).single()
            val manifestKey=UnlockedE2eeVault.recordKey(f.vault.requireOpen(),"local-snapshot","local-manifest")
            val original=requireNotNull(f.storage.get(manifestKey)).envelope.toJson().toString()
            val part=UnlockedE2eeVault.recordKey(f.vault.requireOpen(),"local-snapshot","${entry.recordId}:0");val row=requireNotNull(f.storage.get(part))
            f.storage.commit(listOf(E2eeStorageChange(part,row.serial,null))){f.vault.requireOpen()}
            try{E2eeMigrationLocal.open(f.vault,f.saved().single());fail("Missing local content accepted")}catch(error:IllegalStateException){assertEquals("E2EE_CORRUPT_LOCAL_CONTENT",error.message)}
            assertEquals(original,requireNotNull(f.storage.get(manifestKey)).envelope.toJson().toString());assertNull(f.storage.get(part))
        }finally{f.close()}
    }
    @Test fun anUnavailableCorrectRootNeverRegeneratesAnEmptyLocalManifest(){
        val f=Rig();try{
            f.save("Synthetic retained private content".toByteArray());val key=UnlockedE2eeVault.recordKey(f.vault.requireOpen(),"local-snapshot","local-manifest")
            val original=requireNotNull(f.storage.get(key)).envelope.toJson().toString();val wrong=E2eeKeys.freshSecret()
            val locked=try{UnlockedE2eeVault(f.storage,f.context(E2eeEnvelope.importRoot(wrong)))}finally{wrong.fill(0)}
            try{assertTrue(runCatching{locked.read("local-snapshot","local-manifest")}.isFailure)}finally{locked.lock()}
            assertEquals(original,requireNotNull(f.storage.get(key)).envelope.toJson().toString())
            val recovered=E2eeMigrationLocal.open(f.vault,f.saved().single());try{assertEquals("Synthetic retained private content",recovered.bytes.toString(Charsets.UTF_8))}finally{recovered.bytes.fill(0)}
        }finally{f.close()}
    }
}
