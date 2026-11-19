package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.util.Base64

class E2eeNativeDiarySourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        val key=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(key)
        var live=true;var available=true;var captured=false;var reads=0;var pending:Long?=null
        var rows=listOf(DocumentRecord(account,"diary-v1","exact-old-cache",1),DocumentRecord(account,"aurora-account-key","exact-old-key-wrapper",1))
        val plains=mutableMapOf("exact-old-cache" to "{\"records\":[],\"drafts\":[]}")
        val response=JSONObject().put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",7)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("notes",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,_->
            assertFalse(local.toString().contains(encoded));assertTrue(remote.getJSONObject("legacyKey").isNull("key"));assertEquals("exact-old-cache",local.getJSONArray("documents").getJSONObject(1).getString("encrypted"))
            E2eePathReconciliation(true,emptyList(),listOf(E2eeMigrationContent("diary","personal-diary-local-history-v1","private-local".toByteArray())))
        }
        val source by lazy{E2eeNativeDiarySource("owner",lease.scopeId,captureRows={E2eeDiaryRows(rows,0,pending,null)},decryptCache={check(available){"KEYSTORE_INVALIDATED"};requireNotNull(plains[it])},
            decryptAccountKey={check(available){"KEYSTORE_INVALIDATED"};encoded},assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},legacyDiary={assertTrue(captured);reads++;JSONObject(response.toString())},
            reconciler=object:E2eePersonalSourceReconciler{override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{assertCurrent();return engine(local,remote,openLegacy)}})}
        suspend fun capture()=source.captureLocal().also{captured=true}
        suspend fun run(previous:List<ByteArray> = emptyList())=source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code:String,action:suspend ()->Unit){try{action();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected redacted class ${error.javaClass.simpleName}",error.message?.contains(code)==true)}}
    @Test fun exactCacheAndLocalOutputStayDeviceOnlyBeforeNetworkAndKeysNeverReachSharedEngine()=runBlocking{
        val f=Rig();val before=f.rows.toList();val captured=f.capture();assertEquals(0,f.reads);assertTrue(captured.toString(Charsets.UTF_8).contains("exact-old-key-wrapper"));assertFalse(captured.toString(Charsets.UTF_8).contains(f.encoded))
        val result=f.source.reconcile(captured,emptyList(),lease);assertTrue(result.complete);assertTrue(result.content.isEmpty());assertEquals("private-local",result.localContent.single().bytes.toString(Charsets.UTF_8));assertEquals(before,f.rows)
    }
    @Test fun currentAndDanglingCompleteChunksAreCapturedAndMissingOrUnknownChunksRefuseBeforeIO()=runBlocking{
        val f=Rig();val generation="11111111-1111-4111-8111-111111111111";val other="22222222-2222-4222-8222-222222222222"
        f.rows=listOf(DocumentRecord(account,"diary-v1","genesis-diary-chunks-v1:[\"$generation\",2,15]",1),DocumentRecord(account,"diary-v1/$generation/0","exact-old-",1),
            DocumentRecord(account,"diary-v1/$generation/1","cache",1),DocumentRecord(account,"diary-v1/$other/0","retained",1))
        // exact-old-cache is 15 ASCII characters.
        f.plains["retained"]="{\"records\":[],\"drafts\":[]}"
        val snapshot=JSONObject(f.capture().toString(Charsets.UTF_8));assertEquals(3,snapshot.getJSONArray("caches").length());assertEquals(0,f.reads)
        f.rows=f.rows.filterNot{it.kind.endsWith("/0")};rejects("NATIVE_HISTORY_REVIEW_REQUIRED"){f.capture()};assertEquals(0,f.reads)
        val unknown=Rig();unknown.rows=unknown.rows+DocumentRecord(account,"diary-v1-future","retained",1);rejects("FORMAT_UNSUPPORTED"){unknown.capture()}
    }
    @Test fun missingKeystoreForeignRowsAndChangedPreviousAttemptsNeverCreateAnEmptyReplacement()=runBlocking{
        val f=Rig();f.available=false;val before=f.rows;rejects("KEYSTORE_INVALIDATED"){f.capture()};assertEquals(0,f.reads);assertEquals(before,f.rows)
        val foreign=Rig();foreign.rows=foreign.rows.map{it.copy(scope=CloudAccountSnapshot.scopeFor("foreign"))};rejects("SCOPE_BINDING_MISMATCH"){foreign.capture()}
        val changed=Rig();val old=changed.capture();changed.plains["exact-old-cache"]="{\"records\":[1],\"drafts\":[]}";rejects("HISTORY_REVIEW_REQUIRED"){changed.run(listOf(old))};assertEquals(0,changed.reads)
        val pending=Rig();pending.pending=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
    }
    private fun addNote(f:Rig):WorkspaceCipher.Envelope {
        val value=WorkspaceCipher.encrypt("{\"id\":\"note\",\"body\":\"Private exact old content\"}".toByteArray(),f.key,"genesis-mindmap-v1:owner:diary-note:v1:note".toByteArray())
        f.response.getJSONArray("notes").put(JSONObject().put("id","note").put("iv",value.iv).put("ciphertext",value.ciphertext));return value
    }
    @Test fun oldKeyOpensOnlyAnExactCapturedNoteWithItsExactPurposeAndNeverAForeignOrArbitraryEnvelope()=runBlocking{
        val f=Rig();val sealed=addNote(f);f.engine={_,_,open->val raw=open(JSONObject().put("iv",sealed.iv).put("ciphertext",sealed.ciphertext),"diary-note:v1:note") as String;assertTrue(raw.contains("Private exact old content"));E2eePathReconciliation(true,emptyList())};assertTrue(f.run().complete)
        val bad=Rig();val known=addNote(bad);bad.engine={_,_,open->open(JSONObject().put("iv",known.iv).put("ciphertext",known.ciphertext),"diary-note:v1:other");error("Unexpected acceptance")};rejects("SOURCE_INVALID"){bad.run()}
    }
    @Test fun missingHistoricalKeyAndLateAccountChangesPreserveSourcesAndWipeBothOutputPlacements()=runBlocking{
        val missing=Rig();val sealed=addNote(missing);missing.rows=missing.rows.filterNot{it.kind=="aurora-account-key"};missing.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        missing.engine={_,_,open->open(JSONObject().put("iv",sealed.iv).put("ciphertext",sealed.ciphertext),"diary-note:v1:note");error("Unexpected acceptance")};rejects("LEGACY_KEY_UNAVAILABLE"){missing.run()}
        val f=Rig();val cloud=byteArrayOf(1,2);val local=byteArrayOf(3,4);val before=f.rows
        f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("diary","cloud",cloud)),listOf(E2eeMigrationContent("diary","local",local)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(2),cloud);assertArrayEquals(ByteArray(2),local);assertEquals(before,f.rows)
    }
}
