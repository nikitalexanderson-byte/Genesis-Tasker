package ru.genesis.calendar.data

import ru.genesis.calendar.data.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.CachedAccountEntry
import ru.genesis.calendar.security.EmergencyArchive
import java.time.Instant

/** Offline capture only. An unrecognized cell is preserved as ciphertext, never silently dropped. */
internal suspend fun emergencySnapshot(app: GenesisApplication, key: String): String {
    val scope=app.workspaceScope
    val owner=CachedAccountEntry(app).read(scope)?.identity?.uid
    val cipher=LocalCipher()
    val snapshot=app.database.withTransaction {
        val dao=app.database.dao()
        val documents=JSONArray()
        val unavailable=JSONArray()
        for(row in dao.backupDocuments(scope)) {
            if(row.kind=="account-entry")continue // Cached billing/identity is not recovery authority.
            val context=when {
                row.kind.startsWith("messaging-v1/") && owner!=null -> "$scope/messaging-v1:$owner:${row.kind.removePrefix("messaging-v1/")}"
                row.kind=="assistant-plan-v1" || row.kind=="admin-ad-draft-v1" -> "$scope/${row.kind}/$owner"
                row.kind=="aurora-account-key" -> "$scope/aurora/$owner/account-key"
                row.kind.startsWith("aurora-") -> "$scope/aurora/$owner/${row.kind}"
                else -> "$scope/${row.kind}"
            }
            val plain=runCatching { cipher.decrypt(row.encrypted,context) }.getOrNull()
            if(plain==null)unavailable.put(row.kind)
            documents.put(JSONObject().put("kind",row.kind).put("revision",row.revision)
                .put("encoding",if(plain==null)"device-ciphertext" else "plaintext-inside-archive").put("value",plain?:row.encrypted))
        }
        // Diary cache is chunked before storage and must be decrypted after assembly.
        if(owner!=null)runCatching { DiaryRoomStore(app.database,scope).read()?.let {
            documents.put(JSONObject().put("kind","portable-diary-v1").put("encoding","plaintext-inside-archive")
                .put("value",DiaryKeystoreCipher(scope,owner).decrypt(it)))
        } }.onFailure { unavailable.put("portable-diary-v1") }
        val tasks=JSONArray(dao.backupTasks(scope).map {
            val plain=runCatching { cipher.decrypt(it.encrypted,"$scope/${it.id}") }.getOrNull()
            if(plain==null)unavailable.put("task:${it.id}")
            JSONObject().put("id",it.id).put("revision",it.revision).put("done",it.done).put("deleted",it.deleted)
                .put("encoding",if(plain==null)"device-ciphertext" else "plaintext-inside-archive").put("value",plain?:it.encrypted)
        })
        JSONObject().put("format","genesis-local-rescue-v1").put("scope",scope).put("capturedAt",Instant.now().toString())
            .put("coverage","device-only").put("deviceDependentCells",unavailable).put("documents",documents)
            .put("preferences",LocalPreferences(app,scope).backupRaw())
            .put("tasks",tasks)
            .put("outbox",JSONArray(dao.outbox(scope).map { JSONObject().put("entityId",it.entityId).put("revision",it.revision)
                .put("operationId",it.operationId).put("state",it.state) }))
            .put("reminders",JSONArray(dao.reminders(scope).map { JSONObject().put("id",it.id).put("taskId",it.taskId)
                .put("occurrenceId",it.occurrenceId).put("revision",it.revision).put("at",it.at).put("state",it.state)
                .put("deliveredAt",it.deliveredAt?:JSONObject.NULL) }))
    }
    check(app.workspaceScope==scope)
    val plain=snapshot.toString()
    val encrypted=EmergencyArchive.seal(plain,key)
    check(EmergencyArchive.open(encrypted,key)==plain)
    return encrypted
}
