package ru.genesis.calendar.auth

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import ru.genesis.calendar.data.LocalCipher
import java.io.*
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** Only encrypted chunks reach disk; references and authenticated footers bind the exact source bytes. */
internal interface DataImportSources {
    fun store(account: String, space: String, project: String, name: String, open: () -> InputStream, current: () -> Unit): JSONObject
    fun read(account: String, space: String, project: String, reference: JSONObject, current: () -> Unit): String
    fun prune(account: String, space: String, project: String, keep: Set<String>, current: () -> Unit) = Unit
}

internal class DataImportBlobStore(context: Context) : DataImportSources {
    private val root = File(context.noBackupFilesDir, "shared-data-import-v1")
    private val cipher = LocalCipher()
    private fun scope(account: String, space: String, project: String): String {
        require(account.isNotBlank() && PlanningLifecycle.id(space) && PlanningLifecycle.id(project))
        return "import-v1:${account.length}:$account:$space:$project"
    }
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun folder(aad: String) = File(root, digest(aad.toByteArray(Charsets.UTF_8)))
    private fun file(aad: String, id: String): File {
        require(PlanningLifecycle.id(id)) { "DATA_SOURCE_INVALID" }
        return File(folder(aad), "$id.bin")
    }
    private fun record(out: DataOutputStream, value: String) {
        val bytes = value.toByteArray(Charsets.US_ASCII)
        require(bytes.size in 1..131_072) { "DATA_SOURCE_INVALID" }
        out.writeInt(bytes.size); out.write(bytes)
    }
    private fun record(input: DataInputStream): String {
        val length = input.readInt(); require(length in 1..131_072) { "DATA_SOURCE_INVALID" }
        return ByteArray(length).also(input::readFully).toString(Charsets.US_ASCII)
    }
    override fun store(account: String, space: String, project: String, name: String, open: () -> InputStream, current: () -> Unit): JSONObject {
        current()
        val aad = scope(account, space, project); val directory = folder(aad)
        require(directory.isDirectory || directory.mkdirs()) { "DATA_SOURCE_STORAGE" }
        // Quota failures preserve all current sources and commands; nothing is evicted to make room.
        val used = directory.listFiles()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L
        require(used <= 512L * 1024 * 1024 - 2L * DataExportProtocol.FILE_LIMIT - 1_048_576) { "DATA_SOURCE_QUOTA" }
        val id = UUID.randomUUID().toString(); val atomic = AtomicFile(file(aad, id))
        val stream = atomic.startWrite(); val output = DataOutputStream(stream)
        val hash = MessageDigest.getInstance("SHA-256")
        val pending = ByteArray(8192); var pendingSize = 0; var bytes = 0L; var chunks = 0
        fun flushChunk() {
            if (pendingSize == 0) return
            current()
            val encoded = Base64.getEncoder().encodeToString(pending.copyOf(pendingSize))
            record(output, cipher.encrypt(encoded, "$aad:$id:chunk:${chunks++}")); pendingSize = 0
        }
        fun accept(buffer: ByteArray, offset: Int, length: Int) {
            current(); bytes += length
            if (bytes > DataExportProtocol.FILE_LIMIT) throw AuthApiError("DATA_FILE_TOO_LARGE")
            hash.update(buffer, offset, length)
            var at = offset; var left = length
            while (left > 0) {
                val count = minOf(left, pending.size - pendingSize)
                buffer.copyInto(pending, pendingSize, at, at + count); pendingSize += count; at += count; left -= count
                if (pendingSize == pending.size) flushChunk()
            }
        }
        try {
            output.writeInt(0x47444931)
            open().use { source ->
                val recording = object : FilterInputStream(source) {
                    override fun read(buffer: ByteArray, off: Int, len: Int): Int = `in`.read(buffer, off, len).also { if (it > 0) accept(buffer, off, it) }
                    override fun read(): Int = `in`.read().also { if (it >= 0) accept(byteArrayOf(it.toByte()), 0, 1) }
                }
                val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                InputStreamReader(recording, decoder).use { reader ->
                    val buffer = CharArray(4096)
                    while (true) {
                        val count = reader.read(buffer); if (count < 0) break
                        current(); require((0 until count).all { buffer[it].code >= 32 || buffer[it] in "\n\r\t" }) { "DATA_SOURCE_INVALID" }
                    }
                }
            }
            if (bytes == 0L) throw AuthApiError("DATA_EMPTY")
            flushChunk()
            val sha = hash.digest().joinToString("") { "%02x".format(it) }
            val footer = JSONObject().put("id", id).put("bytes", bytes).put("sha256", sha).put("chunks", chunks)
            output.writeInt(0); record(output, cipher.encrypt(footer.toString(), "$aad:$id:footer")); output.flush()
            current(); atomic.finishWrite(stream)
            return JSONObject().put("id", id).put("bytes", bytes).put("sha256", sha)
                .put("name", name.filter { !it.isISOControl() }.take(200).ifBlank { "import" })
        } catch (failure: Throwable) { atomic.failWrite(stream); throw failure }
    }
    override fun read(account: String, space: String, project: String, reference: JSONObject, current: () -> Unit): String {
        val ref = DataImportProtocol.source(reference); val aad = scope(account, space, project); val id = ref.getString("id")
        val selected = file(aad, id)
        require(selected.length() in 1..(2L * DataExportProtocol.FILE_LIMIT + 1_048_576)) { "DATA_SOURCE_INVALID" }
        val output = ByteArrayOutputStream(minOf(ref.getInt("bytes"), 65_536)); val hash = MessageDigest.getInstance("SHA-256")
        var chunks = 0
        AtomicFile(selected).openRead().use { raw ->
            DataInputStream(raw.buffered()).use { input ->
                require(input.readInt() == 0x47444931) { "DATA_SOURCE_INVALID" }
                while (true) {
                    current()
                    val length = input.readInt()
                    if (length == 0) break
                    require(length in 1..131_072 && chunks < (DataExportProtocol.FILE_LIMIT + 8191) / 8192) { "DATA_SOURCE_INVALID" }
                    val encrypted = ByteArray(length).also(input::readFully).toString(Charsets.US_ASCII)
                    val bytes = Base64.getDecoder().decode(cipher.decrypt(encrypted, "$aad:$id:chunk:${chunks++}"))
                    require(bytes.size in 1..8192 && output.size().toLong() + bytes.size <= ref.getInt("bytes")) { "DATA_SOURCE_INVALID" }
                    hash.update(bytes); output.write(bytes)
                }
                val footer = JSONObject(cipher.decrypt(record(input), "$aad:$id:footer"))
                val sha = hash.digest().joinToString("") { "%02x".format(it) }
                require(footer.keys().asSequence().toSet() == setOf("id", "bytes", "sha256", "chunks") &&
                    footer.getString("id") == id && footer.getInt("bytes") == output.size() && footer.getInt("chunks") == chunks &&
                    output.size() == ref.getInt("bytes") && footer.getString("sha256") == sha && ref.getString("sha256") == sha && input.read() == -1) { "DATA_SOURCE_INVALID" }
            }
        }
        current()
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString()
    }
    override fun prune(account: String, space: String, project: String, keep: Set<String>, current: () -> Unit) {
        val directory = folder(scope(account, space, project)); current()
        directory.listFiles()?.forEach { candidate ->
            val id = candidate.name.removeSuffix(".bin")
            if (candidate.name == "$id.bin" && PlanningLifecycle.id(id) && id !in keep && candidate.canonicalFile.parentFile == directory.canonicalFile) {
                current(); candidate.delete()
            }
        }
    }
}
