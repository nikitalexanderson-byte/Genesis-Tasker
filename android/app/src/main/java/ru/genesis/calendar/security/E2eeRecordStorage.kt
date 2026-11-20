package ru.genesis.calendar.security

import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.security.PrivateKey
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.SecretKey

class E2eeLocalRecord(val serial: Long, val envelope: E2eeEnvelope.Envelope) {
    override fun toString() = "E2eeLocalRecord([ciphertext])"
}
class E2eeStorageChange(val key: String, val expected: Long?, val value: E2eeLocalRecord?)
interface E2eeRecordStorage {
    fun get(key: String): E2eeLocalRecord?
    fun list(prefix: String): List<String>
    /** All CAS checks and writes share one durable transaction. Guard may abort it. */
    fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit)
}

/** Separate ciphertext-only database. A missing/corrupt database is never silently
 * replaced during unlock, background work or recovery of an existing device. */
class E2eeSqliteStorage(context: Context, allowCreate: Boolean = false) : E2eeRecordStorage, Closeable {
    private val database: SQLiteDatabase
    companion object { private val openLock = Any() }
    init {
        database = synchronized(openLock) {
            val file = File(context.applicationContext.noBackupFilesDir, "e2ee-records-v1.sqlite")
            val existed = file.exists()
            if (!existed && !allowCreate) throw IllegalStateException("E2EE_STORAGE_MISSING")
            val handler = DatabaseErrorHandler { db ->
                try { db.close() } catch (_: Exception) { }
                throw IllegalStateException("E2EE_CORRUPT_LOCAL_DATABASE")
            }
            val flags = SQLiteDatabase.OPEN_READWRITE or if (existed) 0 else SQLiteDatabase.CREATE_IF_NECESSARY
            val db = SQLiteDatabase.openDatabase(file.absolutePath, null, flags, handler)
            try {
                db.execSQL("PRAGMA synchronous=FULL")
                db.rawQuery("PRAGMA journal_mode=DELETE", null).use { it.moveToFirst() }
                if (!existed) {
                    db.beginTransaction()
                    try {
                        db.execSQL("CREATE TABLE records(record_key TEXT PRIMARY KEY, serial INTEGER NOT NULL CHECK(serial>0), envelope TEXT NOT NULL) WITHOUT ROWID")
                        db.version = 1
                        db.setTransactionSuccessful()
                    } finally { db.endTransaction() }
                }
                check(db.version == 1) { "E2EE_CORRUPT_LOCAL_DATABASE" }
                db.rawQuery("SELECT record_key,serial,envelope FROM records LIMIT 0", null).close()
                db
            } catch (_: Exception) { db.close(); throw IllegalStateException("E2EE_STORAGE_UNAVAILABLE") }
        }
    }
    @Synchronized override fun get(key: String): E2eeLocalRecord? = database.rawQuery(
        "SELECT serial,envelope FROM records WHERE record_key=?", arrayOf(key)).use { cursor ->
        if (!cursor.moveToFirst()) null else E2eeLocalRecord(cursor.getLong(0), E2eeEnvelope.Envelope.fromJson(JSONObject(cursor.getString(1))))
    }
    @Synchronized override fun list(prefix: String): List<String> = database.rawQuery(
        "SELECT record_key FROM records WHERE substr(record_key,1,?)=? ORDER BY record_key LIMIT 10001", arrayOf(prefix.length.toString(),prefix)).use { cursor ->
        buildList { while (cursor.moveToNext()) { check(size < 10000) { "E2EE_LOCAL_RECORD_LIMIT" }; add(cursor.getString(0)) } }
    }
    @Synchronized override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
        require(changes.size in 1..10000 && changes.map { it.key }.toSet().size == changes.size) { "E2EE_INVALID_LOCAL_BATCH" }
        requireOpen(); database.beginTransaction()
        try {
            for (change in changes) {
                requireOpen()
                val current = database.rawQuery("SELECT serial FROM records WHERE record_key=?", arrayOf(change.key)).use { if(it.moveToFirst())it.getLong(0) else null }
                check(current == change.expected) { "E2EE_LOCAL_CONFLICT" }
                if(change.value==null)database.execSQL("DELETE FROM records WHERE record_key=?",arrayOf(change.key))
                else database.execSQL("INSERT OR REPLACE INTO records VALUES(?,?,?)",arrayOf<Any>(change.key,change.value.serial,change.value.envelope.toJson().toString()))
            }
            requireOpen();database.setTransactionSuccessful()
        } finally { database.endTransaction() }
        requireOpen()
    }
    @Synchronized override fun close() = database.close()
}

/** Memory capability with the same record/context/CAS format as the web vault. */
class UnlockedE2eeVault(private val storage: E2eeRecordStorage, value: Scope) : E2eeSourceReadVault {
    class Scope(val ownerId:String,val scopeId:String,val deviceId:String,val generation:Long,val cryptoEpoch:Long,val securityEpoch:Long,
        val keyId:String,val signingKey:PrivateKey,val roots:Map<String,SecretKey>,val trustedSigner:(String)->PublicKey?)
    class Write(val domain:String,val objectId:String,val bytes:ByteArray,val expected:Long?)
    class Opened(val serial:Long,val bytes:ByteArray) { override fun toString()="UnlockedE2eeVault.Opened([redacted])" }
    private val scope = AtomicReference<Scope?>(value)
    private val lifecycle = AtomicLong(0)
    fun requireOpen():Scope = scope.get() ?: throw IllegalStateException("E2EE_UNLOCK_REQUIRED")
    override fun assertOpen() { requireOpen() }
    fun lock() { lifecycle.incrementAndGet();scope.set(null) }
    data class LocalIdentity(val ownerId: String, val scopeId: String, val deviceId: String)
    override fun localIdentity(): LocalIdentity = requireOpen().let { LocalIdentity(it.ownerId, it.scopeId, it.deviceId) }
    /** Technical discovery only. Invalid framing never becomes an empty store. */
    override fun listLocal(domain: String, objectPrefix: String): List<String> {
        E2eeKeys.technical(objectPrefix);return localIds(domain){it.startsWith(objectPrefix)}
    }
    /** Dedicated locator role; the public read-only source interfaces retain
     * their narrow prefix rules and do not gain a general empty-prefix read. */
    internal fun listMigrationOriginalParts():List<String> = localIds("local-snapshot"){it.contains(":source:")||it.endsWith(":source")}
    internal fun listMigrationHistoryCopies():List<String> = localIds("local-snapshot"){it.endsWith(":archive")||it.contains(":archive:")||it.endsWith(":cancel")||it.contains(":cancel:")}
    private fun localIds(domain:String,include:(String)->Boolean):List<String> {
        E2eeKeys.technical(domain)
        val captured = lifecycle.get(); val current = requireOpen()
        val prefix = listOf(current.ownerId, current.scopeId, domain).joinToString("") { E2eeKeys.technical(it); "${it.length}:$it" }
        val keys = storage.list(prefix); alive(captured)
        check(keys.size <= 10000 && keys.toSet().size == keys.size) { "E2EE_LOCAL_RECORD_LIMIT" }
        return keys.mapNotNull { key ->
            check(key.startsWith(prefix)) { "E2EE_CORRUPT_LOCAL_RECORD" }
            val rest = key.substring(prefix.length); val colon = rest.indexOf(':')
            check(colon > 0 && rest.substring(0, colon).matches(Regex("[1-9][0-9]{0,2}"))) { "E2EE_CORRUPT_LOCAL_RECORD" }
            val id = rest.substring(colon + 1); E2eeKeys.technical(id)
            check(rest.substring(0, colon).toInt() == id.length) { "E2EE_CORRUPT_LOCAL_RECORD" }
            id.takeIf(include)
        }
    }
    private fun alive(captured:Long) { check(lifecycle.get()==captured && scope.get()!=null) { "E2EE_UNLOCK_REQUIRED" } }
    companion object {
        fun recordKey(scope:Scope,domain:String,objectId:String):String = listOf(scope.ownerId,scope.scopeId,domain,objectId)
            .joinToString("") { E2eeKeys.technical(it); "${it.length}:$it" }
    }
    override fun read(domain:String,objectId:String):Opened? {
        val captured=lifecycle.get();val current=requireOpen()
        val record=storage.get(recordKey(current,domain,objectId));alive(captured);if(record==null)return null
        val ctx=record.envelope.context.toJson()
        check(record.serial>0 && E2eeCommands.integer(ctx.get("revision"),1)==record.serial && ctx.get("ownerId")==current.ownerId
            &&ctx.get("scopeId")==current.scopeId&&ctx.get("domain")==domain&&ctx.get("objectId")==objectId
            &&E2eeCommands.integer(ctx.get("dataGeneration"),1)==current.generation
            &&E2eeCommands.integer(ctx.get("cryptoEpoch"),1)<=current.cryptoEpoch&&E2eeCommands.integer(ctx.get("securityEpoch"),1)<=current.securityEpoch) { "E2EE_CORRUPT_LOCAL_RECORD" }
        val root=current.roots[ctx.getString("keyId")]?:throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
        val signer=current.trustedSigner(ctx.getString("deviceId"))?:throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
        val bytes=E2eeEnvelope.open(root,signer,record.envelope.context,record.envelope)
        try { alive(captured);return Opened(record.serial,bytes) }catch(error:Exception){bytes.fill(0);throw error}
    }
    fun write(changes:List<Write>) {
        val captured=lifecycle.get();val current=requireOpen();val root=current.roots[current.keyId]?:throw IllegalStateException("E2EE_KEY_UNAVAILABLE")
        require(changes.size in 1..10000 && changes.all {it.expected==null||it.expected in 1..9007199254740990L}) { "E2EE_INVALID_LOCAL_BATCH" }
        val copies=changes.map { Write(it.domain,it.objectId,it.bytes.copyOf(),it.expected) }
        try {
            val sealed=copies.map { change ->
                val serial=(change.expected?:0)+1
                val ctx=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE)
                    .put("ownerId",current.ownerId).put("scopeId",current.scopeId).put("domain",change.domain).put("objectId",change.objectId)
                    .put("schemaVersion",1).put("dataGeneration",current.generation).put("writerProtocol",9).put("cryptoEpoch",current.cryptoEpoch)
                    .put("securityEpoch",current.securityEpoch).put("revision",serial).put("keyId",current.keyId).put("deviceId",current.deviceId).put("operationId",UUID.randomUUID().toString()))
                E2eeStorageChange(recordKey(current,change.domain,change.objectId),change.expected,E2eeLocalRecord(serial,E2eeEnvelope.seal(root,current.signingKey,ctx,change.bytes)))
            }
            alive(captured);storage.commit(sealed) {alive(captured)};alive(captured)
        } finally {copies.forEach {it.bytes.fill(0)}}
    }
}
