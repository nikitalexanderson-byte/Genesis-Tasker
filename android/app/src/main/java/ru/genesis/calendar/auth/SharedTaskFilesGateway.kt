package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.util.Base64

interface SharedTaskFilesGateway {
    /** Implement with the native authenticated session. Never open the metadata URL in a browser. */
    suspend fun sharedTaskFile(task: String, file: String): ByteArray = throw UnsupportedOperationException("sharedTaskFile")
    suspend fun saveSharedTaskFiles(project: String, task: String, command: JSONObject): JSONObject = throw UnsupportedOperationException("saveSharedTaskFiles")
}

internal class SharedTaskFileDraft(val name: String, val bytes: ByteArray) {
    override fun toString() = "SharedTaskFileDraft([redacted])"
}

internal object SharedTaskFilesProtocol {
    const val limit = 10 * 1024 * 1024
    private val extensions = setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv")
    fun filename(value: String): String = value.trim().also {
        require(it.isNotBlank() && it.codePointCount(0, it.length) <= 180 && it.none { c -> c < ' ' || c == '\u007f' || c == '/' || c == '\\' }) { "INVALID_TASK_FILENAME" }
        require(it.substringAfterLast('.', "").lowercase() in extensions) { "UNSUPPORTED_TASK_FILE" }
    }
    fun read(name: String, stream: InputStream, remaining: Int): SharedTaskFileDraft {
        val clean = filename(name); require(remaining in 1..limit) { "TASK_FILES_TOO_LARGE" }
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) { val count = stream.read(buffer); if (count < 0) break
            require(output.size() + count <= remaining) { "TASK_FILES_TOO_LARGE" }; output.write(buffer, 0, count)
        }
        require(output.size() > 0) { "INVALID_TASK_FILE" }
        return SharedTaskFileDraft(clean, output.toByteArray())
    }
    fun attachments(task: JSONObject): List<JSONObject> {
        val source = task.optJSONArray("attachments") ?: JSONArray()
        require(source.length() <= 5) { "INVALID_TASK_FILES" }
        return (0 until source.length()).map { index -> source.getJSONObject(index).also {
            SharedTaskLifecycleProtocol.id(it.getString("id")); filename(it.getString("name"))
            require(it.getLong("size") in 1..limit.toLong()) { "INVALID_TASK_FILES" }
            require(it.getString("url") == "/api/shared/tasks/${task.getString("id")}/attachments/${it.getString("id")}") { "INVALID_TASK_FILE_URL" }
        } }
    }
    fun command(task: JSONObject, drafts: List<SharedTaskFileDraft>, removed: Set<String>): JSONObject {
        SharedTaskLifecycleProtocol.task(task)
        val existing = attachments(task)
        require(removed.all { id -> existing.any { it.getString("id") == id } }) { "INVALID_TASK_FILE_REMOVAL" }
        val remaining = existing.filterNot { it.getString("id") in removed }
        require(remaining.size + drafts.size <= 5) { "TOO_MANY_TASK_FILES" }
        require(remaining.sumOf { it.getLong("size") } + drafts.sumOf { it.bytes.size.toLong() } <= limit) { "TASK_FILES_TOO_LARGE" }
        return JSONObject().put("expectedRevision", task.getLong("revision"))
            .put("removeAttachmentIds", JSONArray(removed.sorted())).put("attachments", JSONArray(drafts.map {
                require(it.bytes.isNotEmpty()); JSONObject().put("name", filename(it.name))
                    .put("data", "data:application/octet-stream;base64," + Base64.getEncoder().encodeToString(it.bytes))
            }))
    }
}
