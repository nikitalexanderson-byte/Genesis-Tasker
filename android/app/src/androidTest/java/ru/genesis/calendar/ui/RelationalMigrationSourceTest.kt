package ru.genesis.calendar.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.E2eeNativeRelationalSource
import ru.genesis.calendar.security.*
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Real packaged, network-disabled WebView reconciliation and native encrypted
 * readback for every remaining declared path. Transport rows are synthetic;
 * normal shared UI, signed server capture and membership are separate checks. */
@RunWith(AndroidJUnit4::class)
class RelationalMigrationSourceTest {
    private fun sameJson(a:Any,b:Any):Boolean=when {
        a is JSONObject&&b is JSONObject->{val keys=a.keys().asSequence().toSet();keys==b.keys().asSequence().toSet()&&keys.all{sameJson(a.get(it),b.get(it))}}
        a is JSONArray&&b is JSONArray->a.length()==b.length()&&(0 until a.length()).all{sameJson(a.get(it),b.get(it))}
        a is Number&&b is Number->a.toString().toBigDecimal().compareTo(b.toString().toBigDecimal())==0
        else->a==b
    }
    private val app get()=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private val catalogue get()=E2eePrivatePathCatalogue(app)
    private fun paths():List<Pair<String,String>> {
        check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        val rows=app.assets.open("private-path-sources-v1.json").bufferedReader().use{JSONObject(it.readText())}.getJSONArray("paths")
        return (0 until rows.length()).map{rows.getJSONObject(it).let{row->row.getString("scope") to row.getString("id")}}
    }
    private class Transport(val frame:(String,String,Long,Long)->JSONObject):E2eeLegacyReadTransport {
        private fun unexpected():Nothing=error("SYNTHETIC_UNEXPECTED_READ")
        override suspend fun legacyPrivatePathFragment(context:E2eeMigrationSourceContext,pathId:String,table:String,offset:Long,byteOffset:Long)=frame(pathId,table,offset,byteOffset)
        override suspend fun legacyWorkspace(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyAurora(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyStoicheion(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyAdvice(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyTasks(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyDiary(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyMindmaps(context:E2eeMigrationSourceContext)=unexpected()
        override suspend fun legacyMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=unexpected()
        override suspend fun legacyPhysisPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=unexpected()
        override suspend fun legacyRemindersPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=unexpected()
        override suspend fun legacyArchiveFragment(context:E2eeMigrationSourceContext,table:String,offset:Long,byteOffset:Long)=unexpected()
        override suspend fun legacySharedMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=unexpected()
    }
    private inner class Rig(val kind:String,val path:String) {
        val owner="relational-${UUID.randomUUID()}";val scope="$kind:$owner";val resource="$kind-resource"
        val live=AtomicBoolean(true);var reads=0;var corrupt=false
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val tables=catalogue.tables(kind,path);val expected=linkedMapOf<String,JSONObject>();val rows=linkedMapOf<String,ByteArray>()
        val file="SYNTHETIC EXACT PRIVATE FILE".toByteArray()
        init {
            for(table in tables){
                val original=JSONObject();for(column in catalogue.columns(table))original.put(column,if(column.endsWith("_json")||column in setOf("payload","content"))"{}" else "retained:$column")
                val content=JSONObject(original.toString()).put("id","row-$table")
                if(table in setOf("shared_mindmaps","shared_mindmap_versions")){
                    val project=if(kind=="project")resource else JSONObject.NULL
                    content.put("project_id",project).put("content",JSONObject().put("projectId",project).put("title","Private native map").toString())
                }
                if(path=="project.files"){
                    content.remove("ciphertext");content.remove("filename_ciphertext")
                    content.put("file",JSONObject().put("encoding","base64url").put("bytes",E2eeEnvelope.encode(file)).put("length",file.size)
                        .put("sha256",E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(file))).put("filename","Private source.txt").put("mediaType","text/plain"))
                }
                expected[table]=JSONObject(content.toString())
                rows[table]=JSONObject().put("original",original).put("content",content).put("execution","history-only").toString().toByteArray()
            }
        }
        fun current(){check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        val inventory=JSONObject().put("platform","android").put("inventoryVersion",1)
            .put("entries",JSONArray().put(JSONObject().put("store","SharedPreferences").put("key","closed-editor").put("raw","ORIGINAL OPAQUE CIPHERTEXT")
                .put("content",JSONObject().put("rawDocument","{\"text\":\"Retained native draft\"}").put("execution","history-only")).put("spaceId",if(kind=="space")resource else JSONObject.NULL).put("projectId",if(kind=="project")resource else JSONObject.NULL)))
            .put("editors",JSONArray().put(JSONObject().put("text","Mounted native draft")))
        val transport=Transport{actualPath,table,offset,byteOffset->
            current();check(actualPath==path&&offset==0L&&byteOffset==0L);reads++
            val bytes=requireNotNull(rows[table]);val totals=JSONObject();tables.forEach{totals.put(it,1)}
            JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("kind",kind).put("resourceId",resource).put("pathId",path)
                .put("migrationId",lease.migrationId).put("fence",lease.fence).put("sourceHash",lease.sourceHash).put("checkpointHash",lease.sourceHash).put("directoryRevision",1)
                .put("table",table).put("offset",0).put("byteOffset",0).put("totals",totals).put("rowBytes",bytes.size)
                .put("rowHash",E2eeEnvelope.encode(if(corrupt)ByteArray(32)else MessageDigest.getInstance("SHA-256").digest(bytes)))
                .put("chunk",E2eeEnvelope.encode(bytes)).put("nextByteOffset",JSONObject.NULL).put("nextOffset",JSONObject.NULL)
        }
        val source get()=E2eeNativeRelationalSource(owner,scope,kind,resource,path,tables,{JSONObject(inventory.toString())},::current,transport,NativeRelationalSourceRuntime(app))
    }
    @Test fun allDeclaredRelationalAdaptersPreserveTablesFilesAndNativeEditorsThroughNewEncryption()=runBlocking {
        val paths=paths();assertEquals(setOf("personal.local-work","project.content","project.files","project.mindmaps","project.automation","project.history","project.local-work","space.content","space.mindmaps","space.local-work"),paths.map{it.second}.toSet())
        for((kind,path)in paths){
            val f=Rig(kind,path);app.activateAccount(f.owner)
            val captured=f.source.captureLocal();val original=captured.copyOf();assertEquals(0,f.reads)
            var result:E2eePathReconciliation?=null
            try {
                result=withTimeout(60000){f.source.reconcile(captured,emptyList(),f.lease)}
                assertTrue(path,result.complete);assertEquals(path,f.tables.size,f.reads);assertArrayEquals(original,captured)
                val raw=E2eeKeys.freshSecret();val root=E2eeEnvelope.importRoot(raw);raw.fill(0);val keys=E2eeKeys.generateDeviceKeys()
                val storage=E2eeSqliteStorage(app,allowCreate=true)
                val binding=UnlockedE2eeVault.Scope(f.owner,f.scope,"synthetic-native-device",2,1,1,"fresh-relational-root",keys.signing.private,mapOf("fresh-relational-root" to root)){keys.signing.public}
                val first=UnlockedE2eeVault(storage,binding)
                try {
                    first.write((result.content+result.localContent).map{UnlockedE2eeVault.Write(it.domain,it.objectId,it.bytes,null)});first.lock()
                    val cold=UnlockedE2eeVault(storage,binding)
                    try {
                        for(table in f.tables){
                            val record=requireNotNull((result.content+result.localContent).find{it.objectId=="private-table:$path:$table"})
                            val opened=requireNotNull(cold.read(record.domain,record.objectId))
                            try {
                                val row=JSONObject(opened.bytes.toString(Charsets.UTF_8)).getJSONArray("rows").getJSONObject(0)
                                if(path=="project.files"){
                                    val attachment=requireNotNull(cold.read("attachment",row.getJSONObject("file").getString("objectId")))
                                    try{assertArrayEquals(f.file,attachment.bytes)}finally{attachment.bytes.fill(0)}
                                }else assertTrue("Private content changed in $path/$table",sameJson(f.expected.getValue(table),row))
                            }finally{opened.bytes.fill(0)}
                        }
                        val history=result.localContent.map{JSONObject(it.bytes.toString(Charsets.UTF_8))}.first{it.optString("format")=="genesis-private-local-work-v1"}
                        assertEquals("history-only",history.getString("execution"));assertTrue(history.toString().contains("Retained native draft"))
                        assertFalse(history.toString().contains("ORIGINAL OPAQUE CIPHERTEXT"))
                    }finally{cold.lock()}
                }finally{first.lock();storage.close()}
            }finally{result?.let{(it.content+it.localContent).forEach{row->row.bytes.fill(0)}};captured.fill(0);original.fill(0);f.live.set(false);app.activateAccount(null)}
        }
    }
    @Test fun nativeFramingRejectsCorruptionAndRetirementWithoutChangingOriginalCapture()=runBlocking {
        val f=Rig("personal","personal.local-work");val captured=f.source.captureLocal();val original=captured.copyOf()
        try {
            f.corrupt=true
            try{f.source.reconcile(captured,emptyList(),f.lease);fail("Corrupt native fragment accepted")}catch(error:Exception){assertEquals("E2EE_PRIVATE_PATH_TRANSPORT_INVALID",error.message)}
            assertArrayEquals(original,captured);f.live.set(false)
            try{f.source.reconcile(captured,emptyList(),f.lease);fail("Retired native source accepted")}catch(error:Exception){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
            assertArrayEquals(original,captured)
        }finally{captured.fill(0);original.fill(0)}
    }
}
