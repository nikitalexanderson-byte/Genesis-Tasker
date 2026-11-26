package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.util.Base64

class E2eeNativeMindmapsSourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        val key=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(key)
        var live=true;var available=true;var captured=false;var reads=0;var pending:Long?=null
        var rows=listOf(DocumentRecord(account,"mindmaps","exact-old-maps",1),DocumentRecord(account,"mindmap-view:map","exact-old-view",1),
            DocumentRecord(account,"mindmap-conversion","exact-old-conversion",0),DocumentRecord(account,"aurora-account-key","exact-old-key-wrapper",1))
        val plains=mutableMapOf("exact-old-maps" to "[]","exact-old-view" to "{\"mode\":\"map\",\"zoom\":1}","exact-old-conversion" to "{\"title\":\"Unsent task\"}")
        val response=JSONObject().put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",7).put("sourceHash",lease.sourceHash)
            .put("legacyGeneration",0).put("maps",JSONArray()).put("versions",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,_->
            assertFalse(local.toString().contains(encoded));assertTrue(remote.getJSONObject("legacyKey").isNull("key"));assertEquals(3,local.getJSONArray("caches").length())
            E2eePathReconciliation(true,emptyList(),listOf(E2eeMigrationContent("mindmap","personal-mindmap-local-work-v1","private-local".toByteArray())))
        }
        val source by lazy{E2eeNativeMindmapsSource("owner",lease.scopeId,captureRows={E2eeMindmapsRows(rows,0,pending,null)},decrypt={row->
            check(available){"KEYSTORE_INVALIDATED"};if(row.kind=="aurora-account-key")encoded else requireNotNull(plains[row.encrypted])},assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},
            legacyMindmaps={assertTrue(captured);reads++;JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{assertCurrent();assertFalse(previous.any{it.toString().contains(encoded)});return engine(local,remote,openLegacy)}})}
        suspend fun capture()=source.captureLocal().also{captured=true}
        suspend fun run(previous:List<ByteArray> = emptyList())=source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code:String,action:suspend ()->Unit){try{action();fail("Expected $code")}catch(error:Exception){assertTrue(error.message?.contains(code)==true)}}
    private fun sealed(f:Rig):WorkspaceCipher.Envelope {
        val value=WorkspaceCipher.encrypt("{\"id\":\"map\",\"title\":\"Original private map\"}".toByteArray(),f.key,"genesis-mindmap-v1:owner:map:map".toByteArray())
        f.response.getJSONArray("maps").put(JSONObject().put("id","map").put("iv",value.iv).put("ciphertext",value.ciphertext));return value
    }
    @Test fun exactMapsViewsConversionsAndLocalWorkAreCapturedBeforeIOWithNoOldKeyBridge()=runBlocking{
        val f=Rig();val before=f.rows.toList();val captured=f.capture();assertEquals(0,f.reads);assertTrue(captured.toString(Charsets.UTF_8).contains("exact-old-key-wrapper"));assertTrue(captured.toString(Charsets.UTF_8).contains(f.encoded))
        val result=f.source.reconcile(captured,emptyList(),lease);assertTrue(result.complete);assertTrue(result.content.isEmpty());assertEquals("private-local",result.localContent.single().bytes.toString(Charsets.UTF_8));assertEquals(before,f.rows)
    }
    @Test fun unknownForeignLostAndChangedLocalSourcesNeverBecomeAnEmptyMigration()=runBlocking{
        val unknown=Rig();unknown.rows=unknown.rows+DocumentRecord(account,"mindmaps/future","retain",1);rejects("FORMAT_UNSUPPORTED"){unknown.capture()};assertEquals(0,unknown.reads)
        val foreign=Rig();foreign.rows=foreign.rows.map{it.copy(scope=CloudAccountSnapshot.scopeFor("foreign"))};rejects("SCOPE_BINDING_MISMATCH"){foreign.capture()}
        val lost=Rig();lost.available=false;rejects("KEYSTORE_INVALIDATED"){lost.capture()};assertEquals(0,lost.reads)
        val changed=Rig();val old=changed.capture();changed.plains["exact-old-view"]="{\"mode\":\"structure\",\"zoom\":1}";rejects("HISTORY_REVIEW_REQUIRED"){changed.run(listOf(old))};assertEquals(0,changed.reads)
        val pending=Rig();pending.pending=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
    }
    @Test fun legacyOpeningCapabilityAcceptsOnlyItsExactRetainedMapAndPurpose()=runBlocking{
        val f=Rig();val old=sealed(f);f.engine={_,_,open->assertTrue((open(JSONObject().put("iv",old.iv).put("ciphertext",old.ciphertext),"map:map") as String).contains("Original private map"));E2eePathReconciliation(true,emptyList())};assertTrue(f.run().complete)
        val other=Rig();val known=sealed(other);other.engine={_,_,open->open(JSONObject().put("iv",known.iv).put("ciphertext",known.ciphertext),"map:foreign");error("Unexpected opening")};rejects("SOURCE_INVALID"){other.run()}
    }
    @Test fun protectedCaptureRetainsTheIndependentOldKeyAcrossLaterKeystoreLossWithoutAnyKeyBridge()=runBlocking{
        val f=Rig();val packet=sealed(f);f.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        val saved=f.capture();val previous=JSONObject(saved.toString(Charsets.UTF_8));previous.getJSONArray("documents").getJSONObject(0).remove("plain")
        f.available=false;f.key.fill(0)
        f.engine={local,remote,open->assertFalse(local.toString().contains(f.encoded));assertTrue(remote.getJSONObject("legacyKey").isNull("key"))
            assertTrue((open(JSONObject().put("iv",packet.iv).put("ciphertext",packet.ciphertext),"map:map") as String).contains("Original private map"));E2eePathReconciliation(true,emptyList())}
        assertTrue(f.source.reconcile(saved,listOf(saved,previous.toString().toByteArray()),lease).complete);assertEquals(1,f.reads)
    }
    @Test fun olderCapturesStillRequireTheirRealKeyAndMalformedRetainedKeysRefuseBeforeAnySourceRead()=runBlocking{
        val older=Rig();val old=JSONObject(older.capture().toString(Charsets.UTF_8));old.getJSONArray("documents").getJSONObject(0).remove("plain")
        assertTrue(older.source.reconcile(old.toString().toByteArray(),emptyList(),lease).complete)
        older.available=false;rejects("KEYSTORE_INVALIDATED"){older.source.reconcile(old.toString().toByteArray(),emptyList(),lease)}
        for(bad in listOf<Any>("invalid",17)){
            val f=Rig();val saved=JSONObject(f.capture().toString(Charsets.UTF_8));saved.getJSONArray("documents").getJSONObject(0).put("plain",bad)
            rejects(if(bad is String)"LEGACY_KEY_UNAVAILABLE" else "SOURCE_INVALID"){f.source.reconcile(saved.toString().toByteArray(),emptyList(),lease)};assertEquals(0,f.reads)
        }
        val changed=Rig();val current=changed.capture();val ancestor=JSONObject(current.toString(Charsets.UTF_8))
        ancestor.getJSONArray("documents").getJSONObject(0).put("plain",Base64.getEncoder().encodeToString(ByteArray(32){23}))
        rejects("HISTORY_REVIEW_REQUIRED"){changed.source.reconcile(current,listOf(ancestor.toString().toByteArray()),lease)};assertEquals(0,changed.reads)
    }
    @Test fun missingIndependentOldKeyDoesNotOpenRetainedCiphertextAndLateAccountSwitchWipesBothOutputPlacements()=runBlocking{
        val missing=Rig();val old=sealed(missing);missing.rows=missing.rows.filterNot{it.kind=="aurora-account-key"};missing.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        missing.engine={_,_,open->open(JSONObject().put("iv",old.iv).put("ciphertext",old.ciphertext),"map:map");error("Unexpected opening")};rejects("LEGACY_KEY_UNAVAILABLE"){missing.run()}
        val f=Rig();val remote=byteArrayOf(1,2);val local=byteArrayOf(3,4);val before=f.rows
        f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("mindmap","remote",remote)),listOf(E2eeMigrationContent("mindmap","local",local)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(2),remote);assertArrayEquals(ByteArray(2),local);assertEquals(before,f.rows)
    }
}
