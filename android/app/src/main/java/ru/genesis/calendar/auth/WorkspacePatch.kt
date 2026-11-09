package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.HabitTimers
import ru.genesis.calendar.domain.habits.HabitLifecycle
import ru.genesis.calendar.data.HabitLifecycleCodec

/** Conservative three-way patch for the web's encrypted schema-16 workspace. */
internal object WorkspacePatch {
    class Conflict(val field: String, val preview: WorkspaceConflictPreview? = null) : Exception("Workspace changed concurrently: $field")
    enum class ConflictPolicy { STOP, KEEP_LOCAL, KEEP_REMOTE }
    data class Result(val document: JSONObject, val changed: Boolean)

    private val collectionIds = mapOf(
        "projects" to "id", "categories" to "id", "taskListLinks" to "taskListId", "taskLists" to "id",
        "habits" to "id", "habitCompletions" to "id", "habitMeasurements" to "id", "habitTimers" to "id", "habitHistory" to "id", "sleepPlans" to "id",
        "sleepEntries" to "id", "moodEntries" to "id", "dailyGoalRecords" to "date",
        "addictionTrackers" to "id", "addictionEntries" to "id",
        "quests" to "id", "achievementUnlocks" to "achievementId",
        "rewardTransactions" to "idempotencyKey", "streakFreezeTransactions" to "idempotencyKey",
    )
    private val kinds = mapOf(
        "workspace-structure" to listOf("projects", "categories", "taskListLinks", "taskLists"),
        "habits" to listOf("habits", "habitCompletions", "habitMeasurements", "habitTimers", "habitHistory", "dailyGoalRecords", "quests",
            "achievementUnlocks", "rewardTransactions", "streakFreezeTransactions", "userProgress",
            "habitSettings", "hiddenDefaultTemplates", "habitTimerEpoch"),
        "trackers" to listOf("sleepPlans", "sleepEntries", "moodEntries", "addictionTrackers", "addictionEntries"),
    )

    fun emptyDocument(): JSONObject = JSONObject().put("trackerSchemaVersion", 16)
        .put("projects", JSONArray()).put("categories", JSONArray()).put("taskListLinks", JSONArray()).put("taskLists", JSONArray())
        .put("habits", JSONArray()).put("habitCompletions", JSONArray()).put("habitMeasurements", JSONArray())
        .put("habitTimers", JSONArray())
        .put("habitHistory", JSONArray())
        .put("habitTimerEpoch", "")
        .put("sleepPlans", JSONArray()).put("sleepEntries", JSONArray()).put("moodEntries", JSONArray())
        .put("addictionTrackers", JSONArray()).put("addictionEntries", JSONArray())
        .put("analyticsSnapshots", JSONArray()).put("dailyGoalRecords", JSONArray())
        .put("quests", JSONArray()).put("achievementUnlocks", JSONArray())
        .put("rewardTransactions", JSONArray()).put("streakFreezeTransactions", JSONArray())
        .put("hiddenDefaultTemplates", JSONArray()).put("habitSettings", JSONObject())
        .put("userProgress", JSONObject().put("lifetimeXp", 0).put("laurelsBalance", 0)
            .put("currentRankId", JSONObject.NULL).put("hiddenHeroicPathRevealedAt", JSONObject.NULL)
            .put("currentStreak", 0).put("longestStreak", 0).put("lastQualifiedDate", JSONObject.NULL)
            .put("streakGoalMode", "rhythm").put("streakFreezeCount", 0).put("rhythmScore", 0)
            .put("updatedAt", ""))

    fun apply(base: JSONObject, local: JSONObject, remote: JSONObject, dirtyKinds: Set<String>,
        remoteVersion: Long, timestamp: String, deviceId: String,
        conflictPolicy: ConflictPolicy = ConflictPolicy.STOP, conflicts: MutableList<WorkspaceConflictField>? = null): Result {
        require(base.optInt("trackerSchemaVersion") == 16 && remote.optInt("trackerSchemaVersion") == 16)
        require(remoteVersion >= 0 && deviceId.isNotBlank())
        val sameGeneration=ru.genesis.calendar.data.HabitTimerCodec.epoch(local, "habitTimerEpoch")==ru.genesis.calendar.data.HabitTimerCodec.epoch(remote, "habitTimerEpoch")
        val output = JSONObject(remote.toString())
        val metadata = JSONObject(output.optJSONObject("syncMetadata")?.toString() ?: "{}")
        metadata.put("schemaVersion", 1)
        val entities = JSONObject(metadata.optJSONObject("entities")?.toString() ?: "{}")
        val fields = JSONObject(metadata.optJSONObject("fields")?.toString() ?: "{}")
        val tombstones = JSONArray(metadata.optJSONArray("tombstones")?.toString() ?: "[]")
        var changed = false
        for (key in dirtyKinds.flatMap { kinds[it] ?: error("Unknown workspace outbox kind: $it") }.distinct()) {
            if (key == "habitTimerEpoch") {
                val epoch = maxOf(ru.genesis.calendar.data.HabitTimerCodec.epoch(local, key), ru.genesis.calendar.data.HabitTimerCodec.epoch(output, key))
                if (epoch != output.optString(key)) {
                    output.put(key, epoch); fields.put(key, nextRevision(fields.optJSONObject(key), remoteVersion, timestamp, deviceId)); changed = true
                }
                continue
            }
            if (key in collectionIds) {
                val idField = collectionIds.getValue(key)
                val baseRows = indexed(base.optJSONArray(key) ?: JSONArray(), idField, key)
                // Older encrypted workspaces have no taskLists field. Absence means
                // unchanged, while an explicit empty array means the user removed lists.
                val localRows = indexed(local.optJSONArray(key) ?: base.optJSONArray(key) ?: JSONArray(), idField, key)
                val remoteRows = indexed(output.optJSONArray(key) ?: JSONArray(), idField, key)
                val result = LinkedHashMap(remoteRows)
                val revisions = JSONObject(entities.optJSONObject(key)?.toString() ?: "{}")
                for (id in (baseRows.keys + localRows.keys).distinct()) {
                    val old = baseRows[id]
                    val edited = localRows[id]
                    if (sameKnown(old, edited)) continue
                    val current = remoteRows[id]
                    if(key in setOf("habitMeasurements", "habitTimers", "habitHistory") && edited != null && current != null)
                        require(same(edited,current)) { when(key) { "habitTimers" -> "HABIT_TIMER_ID_CONFLICT"; "habitHistory" -> "HABIT_HISTORY_ID_CONFLICT"; else -> "HABIT_MEASUREMENT_ID_CONFLICT" } }
                    val merged = when {
                        key=="habitCompletions" && id.startsWith("habit-completion:") && edited!=null && current!=null -> {
                            val localQuality=edited.opt("qualityValue");val remoteQuality=current.opt("qualityValue")
                            val localConfirmed=edited.optString("qualityConfirmedAt").let { it.isNotBlank() && it!="null" }
                            val remoteConfirmed=current.optString("qualityConfirmedAt").let { it.isNotBlank() && it!="null" }
                            if(localConfirmed && remoteConfirmed && !same(localQuality,remoteQuality) && conflictPolicy==ConflictPolicy.STOP)
                                recordConflict("$key/$id/qualityValue", old?.opt("qualityValue"), localQuality, remoteQuality, edited, conflicts)
                            JSONObject(edited.toString()).put("xpAwarded",if(sameGeneration) maxOf(edited.optInt("xpAwarded"),current.optInt("xpAwarded")) else edited.optInt("xpAwarded")).apply {
                                if(remoteConfirmed && (!localConfirmed || conflictPolicy==ConflictPolicy.KEEP_REMOTE)) {
                                    put("qualityValue",remoteQuality);put("qualityConfirmedAt",current.opt("qualityConfirmedAt"))
                                }
                            }
                        }
                        edited == null -> {
                            if (current != null && !same(current, old) && conflictPolicy == ConflictPolicy.STOP)
                                recordConflict("$key/$id", old, edited, current, old, conflicts)
                            if (current != null && !same(current, old) && conflictPolicy == ConflictPolicy.KEEP_REMOTE)
                                current else null
                        }
                        old == null -> {
                            if (current != null && !same(current, edited) && conflictPolicy == ConflictPolicy.STOP)
                                recordConflict("$key/$id", old, edited, current, edited, conflicts)
                            if (current != null && !same(current, edited) && conflictPolicy == ConflictPolicy.KEEP_REMOTE)
                                current else JSONObject(edited.toString())
                        }
                        current == null -> {
                            if (conflictPolicy == ConflictPolicy.STOP) recordConflict("$key/$id", old, edited, current, edited, conflicts)
                            if (conflictPolicy == ConflictPolicy.KEEP_LOCAL) JSONObject(edited.toString()) else null
                        }
                        else -> patchObject(old, edited, current, "$key/$id", conflictPolicy, sameGeneration, conflicts)
                    }
                    if (merged == null) result.remove(id) else result[id] = merged
                    if (!same(current, merged)) changed = true
                    if (same(current, merged)) continue
                    val revision = nextRevision(revisions.optJSONObject(id), remoteVersion, timestamp, deviceId)
                    if (merged == null) {
                        revisions.remove(id)
                        tombstones.put(JSONObject(revision.toString()).put("collection", key).put("id", id))
                    } else revisions.put(id, revision)
                }
                output.put(key, JSONArray(result.values.toList()))
                entities.put(key, revisions)
            } else {
                val old = base.opt(key)
                val edited = local.opt(key)
                if (sameKnown(old, edited)) continue
                val current = output.opt(key)
                val merged = if (old is JSONObject && edited is JSONObject && current is JSONObject)
                    patchObject(old, edited, current, key, conflictPolicy,sameGeneration,conflicts)
                else {
                    if (!same(old, current) && !same(edited, current) && conflictPolicy == ConflictPolicy.STOP)
                        recordConflict(key, old, edited, current, edited as? JSONObject, conflicts)
                    if (!same(old, current) && !same(edited, current) && conflictPolicy == ConflictPolicy.KEEP_REMOTE)
                        current else edited
                }
                if (merged == null) output.remove(key) else output.put(key, merged)
                if (!same(current, merged)) changed = true
                if (!same(current, merged)) fields.put(key, nextRevision(fields.optJSONObject(key), remoteVersion, timestamp, deviceId))
            }
        }
        if(sameGeneration) {
            val progress=output.optJSONObject("userProgress")
            val leftProgress=local.optJSONObject("userProgress"); val rightProgress=remote.optJSONObject("userProgress")
            if(progress!=null && (leftProgress?.has("grossLifetimeXp")==true || rightProgress?.has("grossLifetimeXp")==true)) {
                val gross=maxOf(leftProgress?.optInt("grossLifetimeXp",leftProgress.optInt("lifetimeXp")) ?: 0,
                    rightProgress?.optInt("grossLifetimeXp",rightProgress.optInt("lifetimeXp")) ?: 0)
                val debt=maxOf(leftProgress?.optInt("forfeitedHabitXp") ?: 0,rightProgress?.optInt("forfeitedHabitXp") ?: 0)
                if(progress.optInt("grossLifetimeXp")!=gross || progress.optInt("forfeitedHabitXp")!=debt) changed=true
                progress.put("grossLifetimeXp",gross).put("forfeitedHabitXp",debt)
            }
            val xp=maxOf(local.optJSONObject("userProgress")?.optInt("lifetimeXp") ?: 0,remote.optJSONObject("userProgress")?.optInt("lifetimeXp") ?: 0)
            if(progress!=null && progress.optInt("lifetimeXp")<xp) {
                progress.put("lifetimeXp",xp);changed=true;fields.put("userProgress",nextRevision(fields.optJSONObject("userProgress"),remoteVersion,timestamp,deviceId))
            }
        }
        val epoch = ru.genesis.calendar.data.HabitTimerCodec.epoch(output, "habitTimerEpoch")
        val history = output.optJSONArray("habitHistory") ?: JSONArray()
        val lifecycleHabits=output.optJSONArray("habits") ?: JSONArray()
        val markedEpoch = HabitTimers.workspaceEpoch(epoch, (0 until history.length()).any { history.getJSONObject(it).getString("epoch") == epoch },
            (0 until lifecycleHabits.length()).any { (lifecycleHabits.getJSONObject(it).optJSONArray("lifecycleHistory")?.length() ?: 0)>0 }
                || (0 until history.length()).any { history.getJSONObject(it).optString("source")=="decision" }
                || output.optJSONArray("habitCompletions")?.let { rows -> (0 until rows.length()).any { !rows.getJSONObject(it).isNull("skippedAt") } }==true)
        if(output.optString("habitTimerEpoch") != markedEpoch) {
            output.put("habitTimerEpoch", markedEpoch); fields.put("habitTimerEpoch",nextRevision(fields.optJSONObject("habitTimerEpoch"),remoteVersion,timestamp,deviceId));changed=true
        }
        if (changed) output.put("syncMetadata", metadata.put("entities", entities)
            .put("fields", fields).put("tombstones", tombstones))
        return Result(output, changed)
    }

    fun localDocument(base: JSONObject, structure: JSONObject?, habits: JSONObject?, trackers: JSONObject?): JSONObject {
        val output = JSONObject(base.toString())
        structure?.let { part -> listOf("projects", "categories", "taskListLinks", "taskLists").forEach { output.put(it, part.getJSONArray(it)) } }
        habits?.let { part ->
            mapOf("habits" to "habits", "completions" to "habitCompletions", "measurements" to "habitMeasurements", "timers" to "habitTimers", "history" to "habitHistory", "goals" to "dailyGoalRecords",
                "rewards" to "rewardTransactions", "achievementUnlocks" to "achievementUnlocks",
                "streakFreezeTransactions" to "streakFreezeTransactions", "quests" to "quests",
                "progress" to "userProgress", "settings" to "habitSettings",
                "hiddenDefaultTemplates" to "hiddenDefaultTemplates", "timerEpoch" to "habitTimerEpoch").forEach { (source, target) ->
                    if(part.has(source)) output.put(target, part.get(source)) }
        }
        trackers?.let { part -> listOf("sleepPlans", "sleepEntries", "moodEntries").forEach { output.put(it, part.getJSONArray(it)) } }
        trackers?.let { part -> listOf("addictionTrackers", "addictionEntries").forEach { if (part.has(it)) output.put(it, part.getJSONArray(it)) } }
        return output
    }

    private fun indexed(rows: JSONArray, idField: String, key: String): LinkedHashMap<String, JSONObject> {
        val result = linkedMapOf<String, JSONObject>()
        for (index in 0 until rows.length()) {
            val item = rows.getJSONObject(index)
            val id = item.optString(idField).ifBlank {
                if (idField == "idempotencyKey") item.optString("id") else ""
            }
            require(id.isNotBlank() && result.put(id, item) == null) { "Invalid $key identifier" }
        }
        return result
    }

    private fun patchObject(base: JSONObject, local: JSONObject, remote: JSONObject, path: String,
        conflictPolicy: ConflictPolicy, sameGeneration: Boolean = true, conflicts: MutableList<WorkspaceConflictField>? = null): JSONObject {
        val output = JSONObject(remote.toString())
        // Native codecs intentionally omit web-only properties; omission is never a deletion.
        for (key in local.keys().asSequence().toList()) {
            val old = base.opt(key)
            val edited = local.opt(key)
            if (sameKnown(old, edited)) continue
            val current = remote.opt(key)
            // Two devices may recalculate an identical goal/progress independently.
            // Its clock is not an author edit and must not block the entire outbox.
            val projectionClock = key == "updatedAt" && (path == "userProgress" || path.startsWith("dailyGoalRecords/"))
            val merged = if(path=="userProgress" && key in setOf("lifetimeXp","grossLifetimeXp","forfeitedHabitXp") && sameGeneration && edited is Number && current is Number) {
                maxOf(edited.toInt(),current.toInt())
            } else if (key == "lifecycleHistory" && edited is JSONArray) {
                HabitLifecycleCodec.encode(HabitLifecycle.merge(HabitLifecycleCodec.decode(edited),
                    HabitLifecycleCodec.decode(current as? JSONArray ?: JSONArray())))
            } else if (projectionClock && edited is String && current is String) {
                listOf(edited, current).maxByOrNull { value ->
                    runCatching { java.time.Instant.parse(value) }.getOrDefault(java.time.Instant.MIN)
                }
            } else if (key == "ruleHistory" && edited is JSONArray && current is JSONArray) {
                val versions = linkedMapOf<String, JSONObject>()
                listOf(current, edited).forEach { rows -> for(index in 0 until rows.length()) {
                    val rule = rows.getJSONObject(index)
                    val id = rule.getString("id")
                    val prior = versions[id]
                    require(prior == null || same(prior,rule)) { "HABIT_RULE_ID_CONFLICT" }
                    versions[id] = rule
                } }
                JSONArray(versions.values.sortedWith(compareBy<JSONObject> { it.getString("effectiveDate") }
                    .thenBy { it.getString("recordedAt") }.thenBy { it.getString("id") }))
            } else if (old is JSONObject && edited is JSONObject && current is JSONObject)
                patchObject(old, edited, current, "$path/$key", conflictPolicy,sameGeneration,conflicts)
            else {
                if (!same(old, current) && !same(edited, current) && conflictPolicy == ConflictPolicy.STOP)
                    recordConflict("$path/$key", old, edited, current, local, conflicts)
                if (!same(old, current) && !same(edited, current) && conflictPolicy == ConflictPolicy.KEEP_REMOTE)
                    current else edited
            }
            if (merged == null) output.remove(key) else output.put(key, merged)
        }
        if(output.has("lifecycleHistory") && output.has("active") && output.has("id")) {
            val state=HabitLifecycle.state(output.getString("id"),output.getBoolean("active"),HabitLifecycleCodec.decode(output.getJSONArray("lifecycleHistory")))
            output.put("active",state.status=="active" && !state.conflict)
        }
        return output
    }

    private fun nextRevision(previous: JSONObject?, remoteVersion: Long, timestamp: String, deviceId: String) =
        JSONObject().put("version", maxOf((previous?.optLong("version") ?: 0) + 1, remoteVersion + 1))
            .put("updatedAt", timestamp).put("deviceId", deviceId)

    private fun recordConflict(path: String, base: Any?, local: Any?, remote: Any?, row: JSONObject?,
        conflicts: MutableList<WorkspaceConflictField>?) {
        if (conflicts == null) throw Conflict(path)
        val title = row?.optString("title")?.takeIf { it.isNotBlank() }
            ?: row?.optString("date")?.takeIf { it.isNotBlank() }
        conflicts += WorkspaceConflictField(path, title, workspaceConflictJson(base), workspaceConflictJson(local), workspaceConflictJson(remote))
    }

    private fun same(a: Any?, b: Any?): Boolean = canonical(a) == canonical(b)
    private fun sameKnown(old: Any?, edited: Any?): Boolean {
        if (old is JSONObject && edited is JSONObject)
            return edited.keys().asSequence().all { key -> sameKnown(old.opt(key), edited.opt(key)) }
        return same(old, edited)
    }
    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().filterNot { it == "syncState" || it == "syncMetadata" }
            .sorted().joinToString(prefix = "{", postfix = "}") { JSONObject.quote(it) + ":" + canonical(value.opt(it)) }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.opt(it)) }
        is String -> JSONObject.quote(value)
        is Number -> JSONObject.numberToString(value)
        else -> value.toString()
    }
}
