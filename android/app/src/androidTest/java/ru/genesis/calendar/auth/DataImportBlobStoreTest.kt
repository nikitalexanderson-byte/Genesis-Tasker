package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.CancellationException

class DataImportBlobStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val account = "import-blob-qa-${UUID.randomUUID()}"
    private val space = UUID.randomUUID().toString(); private val project = UUID.randomUUID().toString()
    private val store = DataImportBlobStore(context)
    private fun sourceFile(id: String) = File(context.noBackupFilesDir, "shared-data-import-v1").walkTopDown().first { it.name == "$id.bin" }
    @Test fun encryptedSourceSurvivesANewStoreAndIsBoundToItsAccountAndScope() {
        val source = "\uFEFFНазвание,Описание\r\n\"Привычка 😀\",\"первая\nвторая\"\r\n"
        try {
            val ref = store.store(account, space, project, "source.csv", { source.byteInputStream() }) {}
            assertEquals(source, DataImportBlobStore(context).read(account, space, project, ref) {})
            assertEquals(source.toByteArray(Charsets.UTF_8).size, ref.getInt("bytes"))
            assertFalse(sourceFile(ref.getString("id")).readBytes().toString(Charsets.UTF_8).contains("Привычка"))
            assertThrows(Exception::class.java) { store.read("another-account", space, project, ref) {} }
            assertThrows(Exception::class.java) { store.read(account, UUID.randomUUID().toString(), project, ref) {} }
            assertEquals(source, store.read(account, space, project, ref) {})
        } finally { store.prune(account, space, project, emptySet()) {} }
    }
    @Test fun aDamagedOrTruncatedAuthenticatedFooterNeverReturnsAFile() {
        try {
            val ref = store.store(account, space, project, "source.json", { "{\"title\":\"Synthetic\"}".byteInputStream() }) {}
            val file = sourceFile(ref.getString("id")); val original = file.readBytes()
            val changed = original.copyOf(); changed[changed.lastIndex] = (changed.last().toInt() xor 1).toByte(); file.writeBytes(changed)
            assertThrows(Exception::class.java) { store.read(account, space, project, ref) {} }
            file.writeBytes(original.copyOf(original.size - 4))
            assertThrows(Exception::class.java) { store.read(account, space, project, ref) {} }
        } finally { store.prune(account, space, project, emptySet()) {} }
    }
    @Test fun invalidUtf8AndCancellationDoNotReplaceAnExistingSource() {
        try {
            val ref = store.store(account, space, project, "kept.csv", { "title\r\nKeep me 😀".byteInputStream() }) {}
            assertThrows(Exception::class.java) { store.store(account, space, project, "invalid.csv", { byteArrayOf(0xC3.toByte(), 0x28).inputStream() }) {} }
            var calls = 0
            assertThrows(CancellationException::class.java) { store.store(account, space, project, "cancelled.csv", { "x".repeat(50_000).byteInputStream() }) { if (++calls > 3) throw CancellationException() } }
            assertEquals("title\r\nKeep me 😀", store.read(account, space, project, ref) {})
            val wrongHash = org.json.JSONObject(ref.toString()).put("sha256", "0".repeat(64))
            assertThrows(Exception::class.java) { store.read(account, space, project, wrongHash) {} }
        } finally { store.prune(account, space, project, emptySet()) {} }
    }
    @Test fun exactTwentyMiBUtf8SourceAndOversizeBoundary() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("genesisImportLargeBlob") == "true")
        fun repeated(size: Int): InputStream = object : InputStream() {
            val pattern = byteArrayOf(0xF0.toByte(), 0x9F.toByte(), 0x98.toByte(), 0x80.toByte()); var offset = 0
            override fun read(): Int = if (offset == size) -1 else pattern[offset++ % 4].toInt() and 255
            override fun read(buffer: ByteArray, off: Int, len: Int): Int {
                if (offset == size) return -1
                val count = minOf(len, size - offset); for (index in 0 until count) buffer[off + index] = pattern[(offset + index) % 4]
                offset += count; return count
            }
        }
        try {
            val ref = store.store(account, space, project, "maximum.json", { repeated(DataExportProtocol.FILE_LIMIT) }) {}
            assertEquals(DataExportProtocol.FILE_LIMIT, ref.getInt("bytes"))
            val decoded = DataImportBlobStore(context).read(account, space, project, ref) {}
            assertEquals(DataExportProtocol.FILE_LIMIT / 2, decoded.length); assertTrue(decoded.startsWith("😀") && decoded.endsWith("😀"))
            assertTrue(DataExportProtocol.utf8Within(decoded, DataExportProtocol.FILE_LIMIT))
            val failure = assertThrows(AuthApiError::class.java) { store.store(account, space, project, "oversized.json", { repeated(DataExportProtocol.FILE_LIMIT + 1) }) {} }
            assertEquals("DATA_FILE_TOO_LARGE", failure.code)
        } finally { store.prune(account, space, project, emptySet()) {} }
    }
}
