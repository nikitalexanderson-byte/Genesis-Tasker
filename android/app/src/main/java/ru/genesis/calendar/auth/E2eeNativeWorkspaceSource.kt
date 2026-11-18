package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

/** Captured together under Room's transaction; no queue acknowledgement or codec
 * projection belongs in this read. These objects must never be logged. */
internal class E2eeWorkspaceRows(val documents: List<DocumentRecord>, val outbox: List<OutboxRecord>, val legacyGeneration: Long = 0, val pendingGeneration: Long? = null) {
    override fun toString() = "E2eeWorkspaceRows([redacted])"
}
internal class E2eeWorkspaceReview(val preview: WorkspaceConflictPreview) {
    override fun toString() = "E2eeWorkspaceReview([redacted])"
}
internal class E2eeWorkspaceDecision(val fingerprint: String, val policy: WorkspacePatch.ConflictPolicy) {
    override fun toString() = "E2eeWorkspaceDecision([redacted])"
}

/** Real native personal.workspace adapter. Enrollment/product writer routing and
 * the persistent repository fence must be supplied before this can be activated. */
internal class E2eeNativeWorkspaceSource(
    private val ownerId: String, private val scopeId: String,
    private val captureRows: suspend () -> E2eeWorkspaceRows,
    private val decrypt: (DocumentRecord) -> String,
    private val assertCurrent: () -> Unit,
    private val legacyWorkspace: suspend (E2eeMigrationSourceContext) -> JSONObject,
    private val review: (suspend (E2eeWorkspaceReview) -> E2eeWorkspaceDecision)? = null,
) : E2eePrivatePathAdapter {
    override val id = "personal.workspace"
    private val accountScope = CloudAccountSnapshot.scopeFor(ownerId)
    private val kinds = mapOf("workspace-structure" to "structure", "habits" to "habits", "trackers" to "trackers")
    private val documentKinds = kinds.values.toSet() + "cloud-base"
    private val maximum = 16 * 1024 * 1024
    init { E2eeKeys.technical(ownerId); E2eeKeys.technical(scopeId) }
    private fun bytes(value: JSONObject) = value.toString().toByteArray(Charsets.UTF_8)
    private fun same(a: Any?, b: Any?) = workspaceConflictJson(a) == workspaceConflictJson(b)
    private fun checkBinding(context: E2eeMigrationSourceContext?) {
        assertCurrent(); check(context != null && context.ownerId == ownerId && context.scopeId == scopeId) { "E2EE_SCOPE_BINDING_MISMATCH" }
    }
    private suspend fun <T> parseSafely(operation: suspend () -> T): T = try { operation() }
        catch(_: JSONException) { error("E2EE_WORKSPACE_SOURCE_INVALID") }
        catch(_: java.nio.charset.CharacterCodingException) { error("E2EE_WORKSPACE_SOURCE_INVALID") }
        catch(_: java.time.DateTimeException) { error("E2EE_WORKSPACE_SOURCE_INVALID") }
    override suspend fun captureLocal(): ByteArray = parseSafely { captureChecked() }
    private suspend fun captureChecked(): ByteArray {
        assertCurrent(); val captured = captureRows(); assertCurrent()
        val docs = captured.documents.filter { it.kind in documentKinds }.sortedBy { it.kind }
        val outbox = captured.outbox.filter { it.entityId in kinds }.sortedBy { it.entityId }
        check(docs.map { it.kind }.toSet().size == docs.size && outbox.map { it.entityId }.toSet().size == outbox.size) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        val rows = JSONArray()
        for (row in docs) {
            check(row.scope == accountScope && row.revision >= 0) { "E2EE_SCOPE_BINDING_MISMATCH" }
            // A missing/invalidated Keystore key is a hard failure. No empty
            // document or newly generated replacement key can escape this call.
            val plain = decrypt(row); assertCurrent(); val parsed = JSONObject(plain)
            rows.put(JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",parsed))
        }
        val pending = JSONArray(outbox.map { row ->
            check(row.scope == accountScope && row.revision >= 0 && row.operationId.isNotBlank()) { "E2EE_SCOPE_BINDING_MISMATCH" }
            JSONObject().put("entityId",row.entityId).put("revision",row.revision).put("operationId",row.operationId).put("state",row.state)
        })
        val result = bytes(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("accountScope",accountScope)
            .put("legacyGeneration",captured.legacyGeneration).put("pendingGeneration",captured.pendingGeneration ?: JSONObject.NULL)
            .put("capturedAt",Instant.now().toString()).put("documents",rows).put("outbox",pending))
        assertCurrent(); if(result.size > maximum) { result.fill(0); error("E2EE_SNAPSHOT_TOO_LARGE") }; return result
    }
    private fun snapshot(bytes: ByteArray): JSONObject {
        check(bytes.size in 1..maximum) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        val value = JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","accountScope","legacyGeneration","pendingGeneration","capturedAt","documents","outbox"))
        check(E2eeCommands.integer(value.get("protocol")) == 1L && value.get("ownerId") == ownerId && value.get("scopeId") == scopeId && value.get("accountScope") == accountScope) { "E2EE_SCOPE_BINDING_MISMATCH" }
        Instant.parse(value.getString("capturedAt")); val docs = value.getJSONArray("documents"); val pending = value.getJSONArray("outbox")
        E2eeCommands.integer(value.get("legacyGeneration"));check(value.isNull("pendingGeneration")) { "E2EE_WORKSPACE_GENERATION_REVIEW_REQUIRED" }
        check(docs.length() <= 4 && pending.length() <= 3) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        val seen = mutableSetOf<String>()
        for(index in 0 until docs.length()) {
            val row=docs.getJSONObject(index); E2eeKeys.exact(row,setOf("kind","revision","encrypted","plain"))
            check(row.getString("kind") in documentKinds && seen.add(row.getString("kind"))) { "E2EE_WORKSPACE_SOURCE_INVALID" }
            E2eeCommands.integer(row.get("revision")); row.getString("encrypted"); row.getJSONObject("plain")
        }
        seen.clear()
        for(index in 0 until pending.length()) {
            val row=pending.getJSONObject(index); E2eeKeys.exact(row,setOf("entityId","revision","operationId","state"))
            check(row.getString("entityId") in kinds && seen.add(row.getString("entityId")) && row.getString("operationId").isNotBlank()) { "E2EE_WORKSPACE_SOURCE_INVALID" }
            E2eeCommands.integer(row.get("revision")); check(row.getString("state") == "local") { "E2EE_WORKSPACE_QUEUE_REVIEW_REQUIRED" }
        }
        return value
    }
    override suspend fun reconcile(local: ByteArray, previous: List<ByteArray>): E2eePathReconciliation = error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local: ByteArray, previous: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eePathReconciliation = parseSafely { reconcileChecked(local,previous,context) }
    private suspend fun reconcileChecked(local: ByteArray, previous: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eePathReconciliation {
        checkBinding(context); val lease=requireNotNull(context); val captured=snapshot(local)
        for(old in previous.map(::snapshot))check(same(old.get("documents"),captured.get("documents")) && same(old.get("outbox"),captured.get("outbox")) && old.get("legacyGeneration") == captured.get("legacyGeneration")) { "E2EE_WORKSPACE_HISTORY_REVIEW_REQUIRED" }
        val remote=legacyWorkspace(lease); assertCurrent()
        check(bytes(remote).size <= maximum) { "E2EE_SOURCE_TOO_LARGE" }
        E2eeKeys.exact(remote,setOf("protocol","ownerId","scopeId","migrationId","fence","sourceHash","legacyGeneration","checkpointHash","directoryRevision","workspace","projects","categories"))
        check(E2eeCommands.integer(remote.get("protocol")) == 1L && remote.get("ownerId") == ownerId && remote.get("scopeId") == scopeId
            && remote.get("migrationId") == lease.migrationId && E2eeCommands.integer(remote.get("fence"),1) == lease.fence && remote.get("sourceHash") == lease.sourceHash) { "E2EE_SCOPE_BINDING_MISMATCH" }
        E2eeCommands.integer(remote.get("legacyGeneration")); E2eeCommands.integer(remote.get("directoryRevision"),1); E2eeEnvelope.decode(remote.getString("checkpointHash"),32)
        check(E2eeCommands.integer(remote.get("legacyGeneration")) == E2eeCommands.integer(captured.get("legacyGeneration"))
            && lease.generation > E2eeCommands.integer(remote.get("legacyGeneration"))) { "E2EE_WORKSPACE_GENERATION_REVIEW_REQUIRED" }
        val workspace=remote.getJSONObject("workspace"); E2eeKeys.exact(workspace,setOf("keyMode","key","envelope"))
        val mode=workspace.getString("keyMode"); check(mode in setOf("account","client","empty")) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        check(mode == "account" || workspace.isNull("key")) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        check(mode != "empty" || workspace.isNull("envelope")) { "E2EE_LEGACY_KEY_UNAVAILABLE" }
        val relational=relational(remote.getJSONArray("projects"),remote.getJSONArray("categories"))
        var remoteVersion=0L
        val remoteDocument=if(workspace.isNull("envelope")) {
            if(mode == "account")legacyKey(workspace).fill(0)
            relational
        } else {
            check(mode == "account" && !workspace.isNull("key")) { "E2EE_LEGACY_KEY_UNAVAILABLE" }
            val key=legacyKey(workspace)
            try {
                val envelope=workspace.getJSONObject("envelope"); remoteVersion=E2eeCommands.integer(envelope.get("version"))
                check(envelope.getString("ciphertext").length <= 12*1024*1024 && envelope.getString("iv").length == 16) { "E2EE_WORKSPACE_SOURCE_INVALID" }
                check(!envelope.has("minimumWriterProtocol") || E2eeCommands.integer(envelope.get("minimumWriterProtocol"),1) <= 9) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }
                val plain=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(envelope.getString("ciphertext"),envelope.getString("iv")),key)
                try { JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(plain)).toString()) } finally { plain.fill(0) }
            } finally { key.fill(0) }
        }
        validate(remoteDocument)
        val docs=captured.getJSONArray("documents").let { rows -> (0 until rows.length()).associate { rows.getJSONObject(it).let { row -> row.getString("kind") to row } } }
        val pending=captured.getJSONArray("outbox").let { rows -> (0 until rows.length()).associate { rows.getJSONObject(it).let { row -> row.getString("entityId") to row } } }
        check(docs["cloud-base"] == null || remoteVersion >= E2eeCommands.integer(docs.getValue("cloud-base").get("revision"))) { "E2EE_WORKSPACE_REMOTE_ROLLBACK" }
        val base=docs["cloud-base"]?.getJSONObject("plain") ?: WorkspacePatch.emptyDocument(); validate(base)
        fun fragment(kind: String): JSONObject? = docs[kind]?.getJSONObject("plain")?.also { validateFragment(kind,it) }
        val current=WorkspacePatch.localDocument(base,fragment("structure"),fragment("habits"),fragment("trackers")); validate(current)
        // A tombstone unknown to this local base is not a new offline creation.
        // WorkspacePatch's old-null branch is intentionally insufficient here.
        // Keep both sources for a dedicated identity/history review.
        val tombstones=remoteDocument.optJSONObject("syncMetadata")?.optJSONArray("tombstones") ?: JSONArray()
        for(index in 0 until tombstones.length()) {
            val row=tombstones.getJSONObject(index);val name=row.getString("collection");val deleted=row.getString("id")
            val owned=when(name) { "projects","categories","taskListLinks","taskLists" -> "workspace-structure"; "sleepPlans","sleepEntries","moodEntries","addictionTrackers","addictionEntries" -> "trackers"; else -> "habits" }
            if(owned in pending) {
                fun has(document: JSONObject): Boolean = document.optJSONArray(name)?.let { rows -> (0 until rows.length()).any { entityId(name,rows.getJSONObject(it)) == deleted } } == true
                check(!has(current) || has(base)) { "E2EE_WORKSPACE_TOMBSTONE_REVIEW_REQUIRED" }
            }
        }
        for((outbox,kind) in kinds) {
            val row=docs[kind]; val queued=pending[outbox]
            if(queued != null)check(row != null && E2eeCommands.integer(row.get("revision")) == E2eeCommands.integer(queued.get("revision"))) { "E2EE_WORKSPACE_QUEUE_REVIEW_REQUIRED" }
            else if(row != null) {
                val inspected=WorkspacePatch.apply(base,current,base,setOf(outbox),remoteVersion,captured.getString("capturedAt"),"android-migration")
                check(!inspected.changed) { "E2EE_WORKSPACE_LOCAL_WORK_REVIEW_REQUIRED" }
            }
        }
        val conflicts=mutableListOf<WorkspaceConflictField>()
        var merged=WorkspacePatch.apply(base,current,remoteDocument,pending.keys,remoteVersion,captured.getString("capturedAt"),"android-migration",WorkspacePatch.ConflictPolicy.STOP,conflicts).document
        if(conflicts.isNotEmpty()) {
            val preview=WorkspaceConflictPreview.create(conflicts); val choice=review?.invoke(E2eeWorkspaceReview(preview)) ?: error("E2EE_WORKSPACE_CONFLICT_REVIEW_REQUIRED")
            assertCurrent(); check(choice.fingerprint == preview.fingerprint && choice.policy != WorkspacePatch.ConflictPolicy.STOP) { "E2EE_WORKSPACE_CONFLICT_REVIEW_REQUIRED" }
            merged=WorkspacePatch.apply(base,current,remoteDocument,pending.keys,remoteVersion,captured.getString("capturedAt"),"android-migration",choice.policy).document
        }
        canonicalAchievementMetadata(merged,listOf(base,current,remoteDocument));validate(merged); assertCurrent()
        val history=JSONObject().put("protocol",1).put("projects",remote.getJSONArray("projects")).put("categories",remote.getJSONArray("categories"))
        return E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-workspace-v1",bytes(merged)),
            E2eeMigrationContent("workspace","personal-workspace-legacy-relational-v1",bytes(history))))
    }
    private val collections=setOf("projects","categories","taskListLinks","taskLists","habits","habitCompletions","habitMeasurements","habitTimers","habitHistory",
        "sleepPlans","sleepEntries","moodEntries","addictionTrackers","addictionEntries","analyticsSnapshots","dailyGoalRecords","quests","achievementUnlocks","rewardTransactions","streakFreezeTransactions")
    private val fields=setOf("trackerSchemaVersion","userProgress","habitSettings","hiddenDefaultTemplates","habitTimerEpoch","syncMetadata")
    private fun legacyKey(workspace: JSONObject): ByteArray {
        check(!workspace.isNull("key") && workspace.getString("key").length == 44) { "E2EE_LEGACY_KEY_UNAVAILABLE" }
        val raw=workspace.getString("key");val key=WorkspaceCipher.decodeKey(raw)
        if(Base64.getEncoder().encodeToString(key) != raw) { key.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE") };return key
    }
    private fun validate(value: JSONObject) {
        check(value.keys().asSequence().all { it in collections || it in fields }) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }
        if(value.has("trackerSchemaVersion"))check(E2eeCommands.integer(value.get("trackerSchemaVersion"),1) == 16L) { "E2EE_WORKSPACE_LEGACY_TRACKER_REVIEW_REQUIRED" }
        else check(collections.filterNot { it in setOf("projects","categories","taskListLinks","taskLists") }.none(value::has)) { "E2EE_WORKSPACE_LEGACY_TRACKER_REVIEW_REQUIRED" }
        // WorkspacePatch requires an explicit recognized schema. This addition
        // only labels a pre-tracker projects/categories document; it drops nothing.
        if(!value.has("trackerSchemaVersion"))value.put("trackerSchemaVersion",16)
        for(name in collections)if(value.has(name)) {
            val rows=value.getJSONArray(name); check(rows.length() <= 10000) { "E2EE_WORKSPACE_SOURCE_INVALID" }; val seen=mutableSetOf<String>()
            for(index in 0 until rows.length()) {
                val row=rows.getJSONObject(index)
                if(name == "achievementUnlocks" && !row.has("id")) {
                    check(row.has("achievementId") && row.has("unlockedAt")) { "E2EE_WORKSPACE_SOURCE_INVALID" }
                    row.put("id","achievement:${row.getString("achievementId")}")
                }
                val id=entityId(name,row); validId(id);check(seen.add(id)) { "E2EE_WORKSPACE_SOURCE_INVALID" }
            }
        }
        if(value.has("syncMetadata"))validateMetadata(value.getJSONObject("syncMetadata"))
        fun events(name: String,normalize: (JSONArray) -> JSONArray) {
            val rows=value.optJSONArray(name) ?: return
            for(index in 0 until rows.length()) {
                val original=JSONArray().put(rows.getJSONObject(index))
                val projected=try{normalize(original)}catch(_: Exception){error("E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED")}
                check(includesOriginal(original,projected)) { "E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED" }
            }
        }
        events("habitMeasurements") { ru.genesis.calendar.data.HabitDocument.migrationEventProjection("measurement",it) }
        events("habitTimers") { ru.genesis.calendar.data.HabitTimerCodec.encode(ru.genesis.calendar.data.HabitTimerCodec.decode(it)) }
        events("habitHistory") { ru.genesis.calendar.domain.habits.HabitHistoryCodec.encode(ru.genesis.calendar.domain.habits.HabitHistoryCodec.decode(it,it.getJSONObject(0).getString("epoch"))) }
        for(index in 0 until (value.optJSONArray("habits")?.length() ?: 0)) {
            val habit=value.getJSONArray("habits").getJSONObject(index)
            if(habit.has("lifecycleHistory")) {
                val original=habit.getJSONArray("lifecycleHistory")
                val projected=ru.genesis.calendar.data.HabitLifecycleCodec.encode(ru.genesis.calendar.data.HabitLifecycleCodec.decode(original))
                check(includesOriginal(original,projected)) { "E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED" }
            }
            if(habit.has("ruleHistory")) {
                val original=habit.getJSONArray("ruleHistory")
                val projected=try { ru.genesis.calendar.data.HabitDocument.migrationEventProjection("rule",original) } catch(_: Exception) { error("E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED") }
                check(includesOriginal(original,projected)) { "E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED" }
            }
        }
    }
    private fun entityId(name: String,row: JSONObject): String = row.getString(when(name) {
        "taskListLinks" -> "taskListId"; "dailyGoalRecords" -> "date"; "rewardTransactions","streakFreezeTransactions" -> if(row.has("idempotencyKey") && row.getString("idempotencyKey").isNotEmpty())"idempotencyKey" else "id"; else -> "id" })
    private fun validId(value: String) { check(value.isNotBlank() && value !in setOf("__proto__","prototype","constructor")) { "E2EE_WORKSPACE_SOURCE_INVALID" } }
    private fun validateRevision(row: JSONObject) {
        E2eeKeys.exact(row,setOf("version","updatedAt","deviceId"));E2eeCommands.integer(row.get("version"),1);Instant.parse(row.getString("updatedAt"))
        check(row.getString("deviceId").isNotBlank() && row.getString("deviceId").length <= 100) { "E2EE_WORKSPACE_SOURCE_INVALID" }
    }
    private fun validateMetadata(meta: JSONObject) {
        E2eeKeys.exact(meta,setOf("schemaVersion","entities","fields","tombstones"));check(E2eeCommands.integer(meta.get("schemaVersion"),1) == 1L) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }
        val entities=meta.getJSONObject("entities"); for(name in entities.keys().asSequence().toList()) {
            check(name in collections) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }; val rows=entities.getJSONObject(name)
            for(id in rows.keys().asSequence().toList()) { validId(id); validateRevision(rows.getJSONObject(id)) }
        }
        val clocks=meta.getJSONObject("fields");for(name in clocks.keys().asSequence().toList()) { check(name in fields && name != "syncMetadata") { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" };validateRevision(clocks.getJSONObject(name)) }
        val tombstones=meta.getJSONArray("tombstones");for(index in 0 until tombstones.length()) {
            val row=tombstones.getJSONObject(index);E2eeKeys.exact(row,setOf("collection","id","version","updatedAt","deviceId"))
            check(row.getString("collection") in collections) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" };validId(row.getString("id"))
            validateRevision(JSONObject().put("version",row.get("version")).put("updatedAt",row.get("updatedAt")).put("deviceId",row.get("deviceId")))
        }
    }
    private fun includesOriginal(original: Any?,projected: Any?): Boolean = when(original) {
        is JSONObject -> projected is JSONObject && original.keys().asSequence().all { projected.has(it) && includesOriginal(original.get(it),projected.get(it)) }
        is JSONArray -> projected is JSONArray && original.length() == projected.length() && (0 until original.length()).all { includesOriginal(original.get(it),projected.get(it)) }
        else -> same(original,projected)
    }
    private fun canonicalAchievementMetadata(value: JSONObject,sources: List<JSONObject>) {
        val meta=value.optJSONObject("syncMetadata") ?: return
        val mapping=mutableMapOf<String,String>()
        for(document in sources+value) {
            val rows=document.optJSONArray("achievementUnlocks") ?: continue
            for(index in 0 until rows.length()) {
                val row=rows.getJSONObject(index); mapping[row.getString("achievementId")]=row.getString("id")
            }
        }
        val clocks=meta.getJSONObject("entities").optJSONObject("achievementUnlocks")
        if(clocks != null)for(old in clocks.keys().asSequence().toList()) {
            val canonical=mapping[old] ?: continue;if(old == canonical)continue
            val previous=clocks.optJSONObject(canonical);val next=clocks.getJSONObject(old)
            fun newer(a: JSONObject,b: JSONObject): Boolean {
                val version=E2eeCommands.integer(a.get("version")).compareTo(E2eeCommands.integer(b.get("version")))
                if(version != 0)return version>0
                val time=a.getString("updatedAt").compareTo(b.getString("updatedAt"));return if(time != 0)time>0 else a.getString("deviceId")>b.getString("deviceId")
            }
            if(previous == null || newer(next,previous))clocks.put(canonical,next);clocks.remove(old)
        }
        val tombstones=meta.getJSONArray("tombstones")
        for(index in 0 until tombstones.length()) {
            val row=tombstones.getJSONObject(index)
            if(row.getString("collection") == "achievementUnlocks")mapping[row.getString("id")]?.let { row.put("id",it) }
        }
    }
    private fun validateFragment(kind: String, value: JSONObject) {
        val allowed=when(kind) {
            "structure" -> setOf("projects","categories","taskListLinks","taskLists")
            "habits" -> setOf("localSchema","habits","completions","measurements","timers","history","timerEpoch","goals","rewards","achievementUnlocks","streakFreezeTransactions","quests","progress","settings","hiddenDefaultTemplates")
            "trackers" -> setOf("localSchema","sleepPlans","sleepEntries","moodEntries","addictionTrackers","addictionEntries")
            else -> error("E2EE_WORKSPACE_FORMAT_UNSUPPORTED")
        }
        check(value.keys().asSequence().all { it in allowed }) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }
        if(kind != "structure")check(E2eeCommands.integer(value.get("localSchema"),1) == 1L) { "E2EE_WORKSPACE_FORMAT_UNSUPPORTED" }
    }
    private fun relational(projects: JSONArray, categories: JSONArray): JSONObject {
        check(projects.length()+categories.length() <= 10000) { "E2EE_WORKSPACE_SOURCE_INVALID" }
        val rows=JSONArray(); val cats=JSONArray()
        for(index in 0 until projects.length()) {
            val row=projects.getJSONObject(index); E2eeKeys.exact(row,setOf("id","parent_id","category_id","title","description","tags_json","status","position","created_at","updated_at"))
            rows.put(JSONObject().put("id",row.getString("id")).put("parentId",row.get("parent_id")).put("categoryId",row.get("category_id")).put("title",row.getString("title"))
                .put("description",row.getString("description")).put("tags",JSONArray(row.getString("tags_json"))).put("status",row.getString("status")).put("position",row.get("position"))
                .put("createdAt",row.getString("created_at")).put("updatedAt",row.getString("updated_at")))
        }
        for(index in 0 until categories.length()) {
            val row=categories.getJSONObject(index); E2eeKeys.exact(row,setOf("id","name","color","position","created_at","updated_at"))
            cats.put(JSONObject().put("id",row.getString("id")).put("name",row.getString("name")).put("color",row.getString("color")).put("position",row.get("position"))
                .put("createdAt",row.getString("created_at")).put("updatedAt",row.getString("updated_at")))
        }
        val projectIds=(0 until rows.length()).map { rows.getJSONObject(it).getString("id") }.toSet()
        val categoryIds=(0 until cats.length()).map { cats.getJSONObject(it).getString("id") }.toSet()
        for(index in 0 until rows.length()) {
            val row=rows.getJSONObject(index); val tags=row.getJSONArray("tags")
            check((0 until tags.length()).all { tags.get(it) is String }) { "E2EE_WORKSPACE_SOURCE_INVALID" }
            check((row.isNull("parentId") || row.getString("parentId") in projectIds) && (row.isNull("categoryId") || row.getString("categoryId") in categoryIds)) { "E2EE_WORKSPACE_RELATIONAL_REVIEW_REQUIRED" }
        }
        return JSONObject().put("projects",rows).put("categories",cats)
    }
    override fun toString() = "E2eeNativeWorkspaceSource([redacted])"
}
