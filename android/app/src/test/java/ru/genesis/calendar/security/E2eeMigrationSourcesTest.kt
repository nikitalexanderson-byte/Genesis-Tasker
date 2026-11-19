package ru.genesis.calendar.security

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class E2eeMigrationSourcesTest {
    private val inventory by lazy {
        val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
            .map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile}
        E2eePrivatePaths(JSONObject(file.readText()))
    }
    private class Fixture(val sources:E2eeMigrationSources,val live:ByteArray,val calls:MutableList<String>)
    private fun fixture(kind:String="personal",duplicate:Boolean=false,incomplete:Boolean=false,alias:Boolean=false):Fixture {
        val sources=E2eeMigrationSources("owner","$kind:one",kind,inventory);val live="ORIGINAL LOCAL DATA".toByteArray();val calls=mutableListOf<String>()
        for(path in inventory.required(kind))sources.register(object:E2eePrivatePathAdapter{
            override val id=path.id
            override suspend fun captureLocal():ByteArray {calls+="capture:$id";return live}
            override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation {
                calls+="$id:${local.toString(Charsets.UTF_8)}:${previous.joinToString{it.toString(Charsets.UTF_8)}}"
                return E2eePathReconciliation(!incomplete,listOf(E2eeMigrationContent(path.domains.first(),if(duplicate)"same" else id,
                    if(alias)local else "private:$id".toByteArray())))
            }
        })
        return Fixture(sources,live,calls)
    }
    private suspend fun reject(code:String,action:suspend()->Unit){try{action()}catch(error:Exception){assertEquals(code,error.message);return};fail("Incomplete migration source accepted")}
    @Test fun missingUnmountedAdaptersBlockBeforeFirstCapture()=runBlocking {
        val sources=E2eeMigrationSources("owner","personal:one","personal",inventory);var calls=0
        sources.register(object:E2eePrivatePathAdapter{
            override val id=inventory.required("personal").first().id
            override suspend fun captureLocal():ByteArray{calls++;return byteArrayOf(1)}
            override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>)=error("No network allowed")
        })
        reject("E2EE_SOURCE_ADAPTER_REQUIRED"){sources.captureLocal()};assertEquals(0,calls)
    }
    @Test fun priorSnapshotsReachEveryAdapterWithoutMutatingLiveSource()=runBlocking {
        val f=fixture();val first=f.sources.captureLocal();val second=f.sources.captureLocal();assertEquals("ORIGINAL LOCAL DATA",f.live.toString(Charsets.UTF_8))
        val result=f.sources.reconcile(second,listOf(first));assertTrue(result.coverage.all{it.second})
        assertEquals(inventory.required("personal").size,f.calls.count{it.contains(":ORIGINAL LOCAL DATA:ORIGINAL LOCAL DATA")})
        assertTrue(result.content.all{it.bytes.toString(Charsets.UTF_8).startsWith("private:")})
    }
    @Test fun foreignOwnerMissingPathsAndDuplicateOutputAreRejected()=runBlocking {
        val f=fixture("project");val snapshot=f.sources.captureLocal();val parsed=JSONObject(snapshot.toString(Charsets.UTF_8)).put("ownerId","foreign")
        reject("E2EE_CORRUPT_SNAPSHOT"){f.sources.reconcile(parsed.toString().toByteArray(),emptyList())}
        parsed.put("ownerId","owner");parsed.getJSONArray("paths").remove(0)
        reject("E2EE_CORRUPT_SNAPSHOT"){f.sources.reconcile(parsed.toString().toByteArray(),emptyList())}
        val duplicate=fixture(duplicate=true);reject("E2EE_INVALID_SOURCE_RESULT"){duplicate.sources.reconcile(duplicate.sources.captureLocal(),emptyList())}
    }
    @Test fun incompletePathCannotBecomeCompleteAndOutputOwnsItsBytes()=runBlocking {
        val f=fixture("space",incomplete=true,alias=true);val result=f.sources.reconcile(f.sources.captureLocal(),emptyList())
        assertTrue(result.coverage.none{it.second});assertTrue(result.content.all{it.bytes.toString(Charsets.UTF_8)=="ORIGINAL LOCAL DATA"})
    }
    @Test fun aggregateInputAndAmplifiedOutputHavePreCopyBudgets()=runBlocking {
        val f=fixture("space");val snapshot=f.sources.captureLocal();val large=ByteArray(64*1024*1024)
        reject("E2EE_MIGRATION_HISTORY_LIMIT"){f.sources.reconcile(snapshot,listOf(large,large))}
        val sources=E2eeMigrationSources("owner","space:one","space",inventory);val content=ByteArray(4*1024*1024)
        for((index,path) in inventory.required("space").withIndex())sources.register(object:E2eePrivatePathAdapter{
            override val id=path.id
            override suspend fun captureLocal()="source".toByteArray()
            override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>)=E2eePathReconciliation(true,
                if(index==0)(0..32).map{E2eeMigrationContent(path.domains.first(),"object-$it",content)} else emptyList())
        })
        reject("E2EE_MIGRATION_TOO_LARGE"){sources.reconcile(sources.captureLocal(),emptyList())}
    }
    @Test fun bindingAndSharedLocalWorkKeepCoverageAndCryptoDomainsSeparate()=runBlocking {
        val f=fixture("project");f.sources.assertBinding("owner","project:one","project")
        reject("E2EE_SCOPE_BINDING_MISMATCH"){f.sources.assertBinding("owner","project:other","project")}
        assertTrue("project.local-work" in f.sources.requiredCoverage)
        assertTrue("shared-project" in f.sources.allowedContentDomains)
        val result=f.sources.reconcile(f.sources.captureLocal(),emptyList())
        assertTrue(result.content.none{it.domain in setOf("draft","outbox","local-snapshot")})
    }
    @Test fun localOnlyOutputNeverEntersRemoteListAndDuplicatePlacementIsRejected()=runBlocking{
        for(duplicate in listOf(false,true)){
            val sources=E2eeMigrationSources("owner","personal:one","personal",inventory)
            for(path in inventory.required("personal"))sources.register(object:E2eePrivatePathAdapter{
                override val id=path.id
                override suspend fun captureLocal()="Exact source".toByteArray()
                override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation {
                    val row=E2eeMigrationContent(path.domains.first(),path.id,"private:${path.id}".toByteArray())
                    return E2eePathReconciliation(true,if(path.id=="personal.diary"&&!duplicate)emptyList()else listOf(row),if(path.id=="personal.diary")listOf(row)else emptyList())
                }
            })
            val snapshot=sources.captureLocal()
            if(duplicate){reject("E2EE_INVALID_SOURCE_RESULT"){sources.reconcile(snapshot,emptyList())};continue}
            val result=sources.reconcile(snapshot,emptyList());assertEquals(1,result.localContent.size);assertEquals("private:personal.diary",result.localContent.single().bytes.toString(Charsets.UTF_8))
            assertTrue(result.content.none{it.objectId=="personal.diary"});assertEquals(inventory.required("personal").size,result.coverage.size)
        }
    }
}
