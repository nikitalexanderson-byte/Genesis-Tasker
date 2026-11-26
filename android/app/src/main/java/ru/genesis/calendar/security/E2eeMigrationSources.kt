package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream

/** Path inventory is packaged from the same JSON imported by the website. */
class E2eePrivatePaths(source: JSONObject) {
    class Path(val id: String, val scope: String, val domains: Set<String>)
    private val paths: List<Path>
    private val productDomains: Map<String,Set<String>>
    init {
        check(E2eeCommands.integer(source.get("version")) == 1L) { "E2EE_INVALID_COVERAGE_REGISTRY" }
        productDomains=setOf("personal","project","space").associateWith { kind ->
            val values=source.getJSONObject("remoteDomains").getJSONArray(kind)
            (0 until values.length()).map { values.getString(it).also { domain -> check(E2eeEnvelope.supportsDomain(domain)){"E2EE_INVALID_COVERAGE_REGISTRY"} } }.toSet()
        }
        val rows = source.getJSONArray("paths"); check(rows.length() in 1..128) { "E2EE_INVALID_COVERAGE_REGISTRY" }
        paths = (0 until rows.length()).map { index -> rows.getJSONObject(index).let { row ->
            val id = E2eeKeys.technical(row.getString("id")); val scope = row.getString("scope"); val domains = row.getJSONArray("domains")
            check(scope in setOf("personal", "project", "space") && domains.length() in 1..16) { "E2EE_INVALID_COVERAGE_REGISTRY" }
            val remote = productDomains.getValue(scope)
            val allowed = (0 until domains.length()).map { E2eeKeys.technical(domains.getString(it)) }.toSet()
            check(allowed.all { E2eeEnvelope.supportsDomain(it) && it in remote }) { "E2EE_INVALID_COVERAGE_REGISTRY" }
            Path(id, scope, allowed)
        } }
        check(paths.map { it.id }.toSet().size == paths.size && paths.map { it.scope }.toSet() == setOf("personal","project","space")) { "E2EE_INVALID_COVERAGE_REGISTRY" }
    }
    fun required(kind: String): List<Path> {
        require(kind in setOf("personal", "project", "space")) { "E2EE_INVALID_COVERAGE_REGISTRY" }
        return paths.filter { it.scope == kind }
    }
    /** Normal uploads include technical key-check documents as well as legacy
     * content categories. This is an allowlist, never a replay capability. */
    fun allowsProductDomain(kind:String,domain:String):Boolean {
        required(kind)
        return domain in productDomains.getValue(kind)
    }
    companion object {
        fun load(context: Context): E2eePrivatePaths = context.assets.open("private-paths-v1.json").use { input ->
            val bytes = input.readBytes(); check(bytes.size <= 256 * 1024) { "E2EE_INVALID_COVERAGE_REGISTRY" }
            E2eePrivatePaths(JSONObject(bytes.toString(Charsets.UTF_8)))
        }
    }
}

class E2eeMigrationContent(val domain: String, val objectId: String, val bytes: ByteArray,
    val filename: String = "", val mediaType: String = "application/json") {
    override fun toString() = "E2eeMigrationContent([redacted])"
}
class E2eePathReconciliation(val complete: Boolean, val content: List<E2eeMigrationContent>,val localContent:List<E2eeMigrationContent> = emptyList())
class E2eeMigrationReconciliation(val coverage: List<Pair<String, Boolean>>, val content: List<E2eeMigrationContent>,val localContent:List<E2eeMigrationContent> = emptyList())
class E2eeMigrationSourceContext(val ownerId: String, val scopeId: String, val migrationId: String, val fence: Long, val sourceHash: String, val generation: Long) {
    override fun toString() = "E2eeMigrationSourceContext([redacted])"
}
interface E2eeMigrationSource {
    val requiredCoverage: List<String>
    val allowedContentDomains: Set<String>
    fun assertBinding(owner: String, scope: String, kind: String)
    suspend fun captureLocal(): ByteArray
    suspend fun reconcile(snapshot: ByteArray, previousSnapshots: List<ByteArray>): E2eeMigrationReconciliation
    suspend fun reconcile(snapshot: ByteArray, previousSnapshots: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eeMigrationReconciliation = reconcile(snapshot,previousSnapshots)
}
interface E2eePrivatePathAdapter {
    val id: String
    /** Local-only capture; implementation must not drain queues, refresh or mutate sources. */
    suspend fun captureLocal(): ByteArray
    suspend fun reconcile(local: ByteArray, previous: List<ByteArray>): E2eePathReconciliation
    suspend fun reconcile(local: ByteArray, previous: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eePathReconciliation = reconcile(local,previous)
}
interface E2eePrivatePathStreamAdapter {
    val id:String
    /** Local-only original producer; return only after authenticated source EOF. */
    suspend fun captureLocal(output:OutputStream)
}

/** Missing/unmounted/locked categories block completeness, not silently vanish.
 * Actual feature adapters are required before this can drive a product cutover.
 */
class E2eeMigrationSources(private val ownerId: String, private val scopeId: String, private val kind: String, inventory: E2eePrivatePaths) : E2eeMigrationSource {
    private val paths = inventory.required(kind)
    override val requiredCoverage = paths.map { it.id }
    override val allowedContentDomains = paths.flatMap { it.domains }.toSet()
    private val adapters = mutableMapOf<String, E2eePrivatePathAdapter>()
    private val streamAdapters=mutableMapOf<String,E2eePrivatePathStreamAdapter>()
    private val stagedReconcilers=mutableMapOf<String,E2eeStagedPathReconciler>()
    init { E2eeKeys.technical(ownerId); E2eeKeys.technical(scopeId) }
    override fun assertBinding(owner: String, scope: String, kind: String) {
        check(owner == ownerId && scope == scopeId && kind == this.kind) { "E2EE_SCOPE_BINDING_MISMATCH" }
    }
    fun register(adapter: E2eePrivatePathAdapter) {
        check(adapter.id in requiredCoverage && !adapters.containsKey(adapter.id)) { "E2EE_INVALID_SOURCE_ADAPTER" }
        adapters[adapter.id] = adapter
    }
    internal fun registerIntegrated(adapter:E2eePrivatePathAdapter,assertCurrent:()->Unit,maximum:Int=E2eeFiles.MAX_FILE_BYTES){
        check(maximum in 1..E2eeFiles.MAX_FILE_BYTES&&!adapters.containsKey(adapter.id)&&!streamAdapters.containsKey(adapter.id)&&!stagedReconcilers.containsKey(adapter.id)){"E2EE_INVALID_SOURCE_ADAPTER"}
        register(adapter)
        registerStream(object:E2eePrivatePathStreamAdapter{override val id=adapter.id
            override suspend fun captureLocal(output:OutputStream){assertCurrent();val bytes=adapter.captureLocal()
                try{assertCurrent();check(bytes.size in 1..maximum){"E2EE_SNAPSHOT_TOO_LARGE"};var at=0
                    while(at<bytes.size){assertCurrent();val count=minOf(E2eeFiles.CHUNK_BYTES,bytes.size-at);output.write(bytes,at,count);at+=count;assertCurrent()}
                }finally{bytes.fill(0)}}})
        registerStagedReconciler(object:E2eeStagedPathReconciler{override val id=adapter.id
            override suspend fun reconcile(current:E2eeReconciliationPathInput,previous:List<E2eeReconciliationPathInput>,context:E2eeMigrationSourceContext,emit:suspend(E2eeContentPlan.Record)->Unit):Boolean {
                val buffers=mutableListOf<ByteArray>();var total=0L
                try{
                    for(source in listOf(current)+previous){val parts=mutableListOf<ByteArray>();var length=0
                        try{source.open().use{reader->val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
                            try{while(true){assertCurrent();val count=reader.input.read(buffer);if(count<0)break;check(count>0){"E2EE_INVALID_SOURCE_STREAM"};length+=count;total+=count
                                check(length<=maximum&&total<=BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"};parts+=buffer.copyOf(count)};reader.assertComplete()}
                            finally{buffer.fill(0)}}
                            val bytes=ByteArray(length);var at=0;for(part in parts){part.copyInto(bytes,at);at+=part.size};buffers+=bytes
                        }finally{parts.forEach{it.fill(0)}}
                    }
                    val result=adapter.reconcile(buffers[0],buffers.drop(1),context)
                    try{for((placement,rows)in listOf("remote" to result.content,"local" to result.localContent))for(row in rows){assertCurrent()
                        java.io.ByteArrayInputStream(row.bytes).use{stream->emit(E2eeContentPlan.Record(placement,row.domain,row.objectId,row.bytes.size,stream,row.filename,row.mediaType))};assertCurrent()};return result.complete
                    }finally{(result.content+result.localContent).forEach{it.bytes.fill(0)}}
                }finally{buffers.forEach{it.fill(0)}}
            }})
    }
    fun registerStream(adapter:E2eePrivatePathStreamAdapter) {
        check(adapter.id in requiredCoverage&&!streamAdapters.containsKey(adapter.id)){"E2EE_INVALID_SOURCE_ADAPTER"}
        streamAdapters[adapter.id]=adapter
    }
    internal fun registerStagedReconciler(adapter:E2eeStagedPathReconciler){
        check(adapter.id in requiredCoverage&&!stagedReconcilers.containsKey(adapter.id)){"E2EE_INVALID_SOURCE_ADAPTER"};stagedReconcilers[adapter.id]=adapter
    }
    /** Full preflight/callback capture before durable keys, capture or lease. */
    internal fun stagedReconciliation():E2eeStagedReconciliationPlan {
        val registered=paths.associate{path->val adapter=stagedReconcilers[path.id]?:error("E2EE_STAGED_RECONCILER_REQUIRED");val captured=adapter::reconcile
            path.id to object:E2eeStagedPathReconciler{override val id=path.id
                override suspend fun reconcile(current:E2eeReconciliationPathInput,previous:List<E2eeReconciliationPathInput>,context:E2eeMigrationSourceContext,emit:suspend(E2eeContentPlan.Record)->Unit)=captured(current,previous,context,emit)}}
        return E2eeStagedReconciliationPlan{input,context,emit,current->E2eeStagedReconciliation.run(ownerId,scopeId,kind,paths,registered,input,context,emit,current)}
    }
    internal suspend fun reconcileStaged(input:E2eeStagedSourceInput,context:E2eeMigrationSourceContext,emit:suspend(String,E2eeContentPlan.Record)->Unit,assertCurrent:()->Unit):List<Pair<String,Boolean>> =
        stagedReconciliation().run(input,context,emit,assertCurrent)
    /** Full preflight before keys/producers. Small compatibility readers have
     * explicit per-path bounds and are consumed one at a time. */
    fun stagedCapture(legacyLimits:Map<String,Int> = emptyMap()):E2eeStagedMigrationCapture {
        val producers=paths.associate{path->
            val stream=streamAdapters[path.id]
            val producer:suspend(OutputStream)->Unit=if(stream!=null){val capture=stream::captureLocal;{out->capture(out)}}else{
                val legacy=adapters[path.id]?:error("E2EE_SOURCE_ADAPTER_REQUIRED");val maximum=legacyLimits[path.id]?:error("E2EE_SOURCE_ADAPTER_REQUIRED")
                check(maximum in 1..E2eeFiles.MAX_FILE_BYTES){"E2EE_SOURCE_ADAPTER_REQUIRED"};val capture=legacy::captureLocal;
                {out:OutputStream->val value=capture();check(value.size in 1..maximum){"E2EE_SNAPSHOT_TOO_LARGE"};val bytes=value.copyOf()
                    try{var at=0;while(at<bytes.size){val count=minOf(E2eeFiles.CHUNK_BYTES,bytes.size-at);out.write(bytes,at,count);at+=count}}
                    finally{bytes.fill(0)}}
            }
            path.id to producer
        }
        return E2eeStagedMigrationCapture(E2eeSourceStage.Target(ownerId,scopeId,kind),requiredCoverage){id,out->(producers[id]?:error("E2EE_SOURCE_ADAPTER_REQUIRED"))(out)}
    }
    private fun all() = paths.map { path -> path to (adapters[path.id] ?: throw IllegalStateException("E2EE_SOURCE_ADAPTER_REQUIRED")) }
    override suspend fun captureLocal(): ByteArray {
        val all = all(); val captured = mutableListOf<ByteArray>(); var size = 0L
        try {
            val rows = JSONArray()
            for ((path, adapter) in all) {
                val source = adapter.captureLocal(); size += source.size
                check(source.isNotEmpty() && size <= E2eeFiles.MAX_FILE_BYTES) { "E2EE_SNAPSHOT_TOO_LARGE" }
                val bytes = source.copyOf(); captured += bytes
                rows.put(JSONObject().put("id", path.id).put("bytes", E2eeEnvelope.encode(bytes)))
            }
            val result = JSONObject().put("protocol", 1).put("ownerId", ownerId).put("scopeId", scopeId).put("paths", rows).toString().toByteArray()
            if (result.size > E2eeFiles.MAX_FILE_BYTES) { result.fill(0); error("E2EE_SNAPSHOT_TOO_LARGE") }; return result
        } finally { captured.forEach { it.fill(0) } }
    }
    private fun decode(bytes: ByteArray): Map<String, ByteArray> {
        check(bytes.size in 1..E2eeFiles.MAX_FILE_BYTES) { "E2EE_CORRUPT_SNAPSHOT" }
        val value = JSONObject(bytes.toString(Charsets.UTF_8)); E2eeKeys.exact(value, setOf("protocol", "ownerId", "scopeId", "paths"))
        val rows = value.getJSONArray("paths")
        check(E2eeCommands.integer(value.get("protocol")) == 1L && value.get("ownerId") == ownerId && value.get("scopeId") == scopeId && rows.length() == paths.size) { "E2EE_CORRUPT_SNAPSHOT" }
        val decoded = mutableMapOf<String, ByteArray>()
        try {
            for (index in 0 until rows.length()) {
                val row = rows.getJSONObject(index); E2eeKeys.exact(row, setOf("id", "bytes")); val id = row.getString("id")
                check(id in requiredCoverage && !decoded.containsKey(id)) { "E2EE_CORRUPT_SNAPSHOT" }
                decoded[id] = E2eeEnvelope.decode(row.getString("bytes"), 1, E2eeFiles.MAX_FILE_BYTES)
            }
            return decoded
        } catch (error: Exception) { decoded.values.forEach { it.fill(0) }; throw error }
    }
    companion object { const val BYTE_BUDGET = 512 * 1024 * 1024 }
    override suspend fun reconcile(snapshot: ByteArray, previousSnapshots: List<ByteArray>): E2eeMigrationReconciliation {
        return reconcile(snapshot,previousSnapshots,null)
    }
    override suspend fun reconcile(snapshot: ByteArray, previousSnapshots: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eeMigrationReconciliation {
        if(context != null) assertBinding(context.ownerId,context.scopeId,kind)
        check(previousSnapshots.size <= 32) { "E2EE_MIGRATION_HISTORY_LIMIT" }
        check(snapshot.size.toLong() + previousSnapshots.sumOf { it.size.toLong() } <= BYTE_BUDGET) { "E2EE_MIGRATION_HISTORY_LIMIT" }
        val all = all(); val decoded = mutableListOf<Map<String, ByteArray>>(); val content = mutableListOf<E2eeMigrationContent>();val localContent=mutableListOf<E2eeMigrationContent>()
        try {
            decoded += decode(snapshot); previousSnapshots.forEach { decoded += decode(it) }
            val coverage = mutableListOf<Pair<String, Boolean>>(); val seen = mutableSetOf<String>(); var contentBytes = 0L
            for ((path, adapter) in all) {
                val result = adapter.reconcile(decoded.first().getValue(path.id), decoded.drop(1).map { it.getValue(path.id) },context)
                coverage += path.id to result.complete
                for (item in result.content+result.localContent) {
                    E2eeKeys.technical(item.objectId)
                    check(item.domain in path.domains && seen.add(item.domain + "\u0000" + item.objectId) && content.size+localContent.size < 10000 && item.bytes.size <= E2eeFiles.MAX_FILE_BYTES) { "E2EE_INVALID_SOURCE_RESULT" }
                    contentBytes += item.bytes.size
                    check(contentBytes <= BYTE_BUDGET) { "E2EE_MIGRATION_TOO_LARGE" }
                }
                check(content.size+localContent.size+result.content.size+result.localContent.size <= 10000) { "E2EE_INVALID_SOURCE_RESULT" }
                for (item in result.content) content += E2eeMigrationContent(item.domain, item.objectId, item.bytes.copyOf(), item.filename, item.mediaType)
                for (item in result.localContent) localContent += E2eeMigrationContent(item.domain,item.objectId,item.bytes.copyOf(),item.filename,item.mediaType)
            }
            return E2eeMigrationReconciliation(coverage, content,localContent)
        } catch (error: Exception) { (content+localContent).forEach { it.bytes.fill(0) }; throw error }
        finally { decoded.forEach { paths -> paths.values.forEach { it.fill(0) } } }
    }
    override fun toString() = "E2eeMigrationSources([redacted])"
}
