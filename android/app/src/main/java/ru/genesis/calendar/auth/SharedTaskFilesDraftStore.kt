package ru.genesis.calendar.auth

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.LocalCipher
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.AtomicMoveNotSupportedException
import java.util.concurrent.ConcurrentHashMap

/** Account/task-bound encrypted local drafts. Large bytes never enter an Activity saved-state Bundle. */
internal class SharedTaskFilesDraftStore(context: Context, account: String, project: String, task: String) {
    private val scope = "genesis-task-file-draft-v1:$account:$project:$task"
    private val directory = File(context.filesDir, "shared-task-file-drafts")
    private val name = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray()).joinToString("") { "%02x".format(it) }
    private val file = File(directory, "$name.dat")
    private val cipher = LocalCipher()
    private val lock = locks.getOrPut(name) { Any() }
    class Draft(val files: List<SharedTaskFileDraft>, val removed: Set<String>, val revision: Long)
    fun read(): Draft? = synchronized(lock) {
        if (!file.exists()) return@synchronized null
        require(file.length() in 1..23_000_000L) { "INVALID_TASK_FILES" }
        val value = JSONObject(cipher.decrypt(file.readText(), scope))
        val source = value.getJSONArray("files"); require(source.length() <= 5)
        var remaining = SharedTaskFilesProtocol.limit
        val files = (0 until source.length()).map { index -> val row = source.getJSONObject(index)
            val encoded = row.getString("data"); require(encoded.length <= 13_981_120)
            val bytes = Base64.getDecoder().decode(encoded)
            SharedTaskFilesProtocol.read(row.getString("name"), bytes.inputStream(), remaining).also { remaining -= it.bytes.size }
        }
        val removed = value.getJSONArray("removed"); require(removed.length() <= 5)
        Draft(files, (0 until removed.length()).map { SharedTaskLifecycleProtocol.id(removed.getString(it)) }.toSet(), value.getLong("revision"))
    }
    fun write(drafts: List<SharedTaskFileDraft>, removed: Set<String>, revision: Long) = synchronized(lock) {
        if (drafts.isEmpty() && removed.isEmpty()) { clear(); return@synchronized }
        require(drafts.size <= 5 && drafts.sumOf { it.bytes.size.toLong() } <= SharedTaskFilesProtocol.limit && removed.size <= 5 && revision >= 1)
        val body = JSONObject().put("files", JSONArray(drafts.map { JSONObject().put("name", SharedTaskFilesProtocol.filename(it.name))
            .put("data", Base64.getEncoder().encodeToString(it.bytes)) })).put("removed", JSONArray(removed.sorted())).put("revision", revision)
        directory.mkdirs()
        val temporary = File(directory, "$name.tmp")
        temporary.writeText(cipher.encrypt(body.toString(), scope))
        try { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
        catch (_: AtomicMoveNotSupportedException) { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING) }
    }
    fun clear() = synchronized(lock) { if (file.exists()) check(file.delete()) { "FILE_DRAFT_WRITE_FAILED" } }
    companion object { private val locks = ConcurrentHashMap<String, Any>() }
}
