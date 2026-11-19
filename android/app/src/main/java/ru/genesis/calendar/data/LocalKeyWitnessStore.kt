package ru.genesis.calendar.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.channels.OverlappingFileLockException
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64

/** Read-only inventory for an installation predating key witnesses, including
 * restored app data without its old Android Keystore. Reads no private columns.
 * Unknown/corrupt/busy storage is an error, never permission to create a key. */
internal class LegacyLocalCipherInventory(private val database:File,private val preferences:File,private val fileStores:List<File>) {
    constructor(context:Context):this(context.getDatabasePath("genesis.db"),File(context.applicationInfo.dataDir,"shared_prefs"),
        listOf(File(context.filesDir,"shared-task-file-drafts"),File(context.noBackupFilesDir,"shared-data-import-v1")))
    private fun regular(file:File) {
        check(!Files.isSymbolicLink(file.toPath())){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
    }
    fun containsRetainedData():Boolean {
        try {
            regular(database)
            if(database.exists()) {
                check(database.isFile&&database.canRead()){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                if(database.length()==0L) {
                    if(listOf("-wal","-journal").any{File(database.path+it).exists()})error("LOCAL_KEY_STORAGE_UNAVAILABLE")
                } else SQLiteDatabase.openDatabase(database.path,null,SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    android.database.DatabaseErrorHandler { /* Retain corrupt bytes; never use Android's deleting default handler. */ }).use { db ->
                    db.rawQuery("PRAGMA busy_timeout=0",null).use{it.moveToFirst()}
                    val names=mutableSetOf<String>()
                    db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','documents','outbox')",null).use{rows->
                        while(rows.moveToNext())names+=rows.getString(0)
                    }
                    // A partial/unknown application database must not count as fresh.
                    check(names.containsAll(setOf("tasks","documents","outbox"))){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                    for(table in names)db.rawQuery("SELECT 1 FROM $table LIMIT 1",null).use{rows->if(rows.moveToFirst())return true}
                }
            } else if(listOf("-wal","-journal").any{File(database.path+it).exists()})error("LOCAL_KEY_STORAGE_UNAVAILABLE")
            regular(preferences)
            if(preferences.exists()) {
                check(preferences.isDirectory){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                val files=preferences.listFiles()?:error("LOCAL_KEY_STORAGE_UNAVAILABLE")
                check(files.size<=4096){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                for(file in files)if(file.name.endsWith(".xml")||file.name.endsWith(".xml.bak")) {
                    regular(file);check(file.isFile&&file.canRead()){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                    if(file.length()>16L*1024*1024)return true
                    val name=file.name.removeSuffix(".bak")
                    val privateFile=name=="genesis.native.auth.v1.xml"||name.startsWith("genesis.shared.")&&name.endsWith(".v1.xml")
                    file.inputStream().use{stream->
                        val parser=Xml.newPullParser();parser.setInput(stream,"UTF-8")
                        var depth=0;var events=0;var value:StringBuilder?=null;var rootSeen=false;var retained=false
                        while(parser.eventType!=XmlPullParser.END_DOCUMENT) {
                            check(++events<=100000){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                            when(parser.eventType) {
                                XmlPullParser.DOCDECL->error("LOCAL_KEY_STORAGE_UNAVAILABLE")
                                XmlPullParser.START_TAG->{
                                    depth++;check(depth<=8){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                                    check(value==null&&parser.name in setOf("map","string","int","long","float","boolean","set","null")){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                                    if(!rootSeen){check(parser.name=="map"&&depth==1){"LOCAL_KEY_STORAGE_UNAVAILABLE"};rootSeen=true}
                                    // Known private jars/journals remain evidence
                                    // even when their old ciphertext/type is corrupt.
                                    if(privateFile&&depth>1)retained=true
                                    if(parser.name=="string")value=StringBuilder()
                                }
                                XmlPullParser.END_TAG->{
                                    if(parser.name=="string"){val text=value?.toString()?:error("LOCAL_KEY_STORAGE_UNAVAILABLE");if(!retained&&isCiphertext(text))retained=true;value=null}
                                    depth--
                                }
                                XmlPullParser.TEXT,XmlPullParser.CDSECT,XmlPullParser.ENTITY_REF,XmlPullParser.IGNORABLE_WHITESPACE->{
                                    value?.append(parser.text?:error("LOCAL_KEY_STORAGE_UNAVAILABLE"))
                                    check((value?.length?:0)<=16*1024*1024){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                                }
                            }
                            parser.nextToken()
                        }
                        check(rootSeen&&depth==0&&value==null){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                        if(retained)return true
                    }
                }
            }
            for(directory in fileStores) {
                regular(directory);if(!directory.exists())continue
                check(directory.isDirectory){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
                val files=directory.listFiles()?:error("LOCAL_KEY_STORAGE_UNAVAILABLE")
                // These stores contain encrypted drafts/chunks, including an
                // interrupted .tmp/.bin. Do not open or delete them to test it.
                if(files.isNotEmpty())return true
            }
            return false
        } catch(error:Exception) {
            if(error is IllegalStateException&&error.message=="LOCAL_KEY_STORAGE_UNAVAILABLE")throw error
            throw IllegalStateException("LOCAL_KEY_STORAGE_UNAVAILABLE")
        }
    }
    private fun isCiphertext(value:String):Boolean {
        if(value.length<40||value.length%4!=0||!value.matches(Regex("[A-Za-z0-9+/]*={0,2}")))return false
        val bytes=try{Base64.getDecoder().decode(value)}catch(_:IllegalArgumentException){return false}
        return try{bytes.size>=28&&Base64.getEncoder().encodeToString(bytes)==value}finally{bytes.fill(0)}
    }
}

/** Technical, device-only durable evidence that an alias was used or old data
 * must be held after a failed inventory. Housekeeping cannot erase that denial.
 * A missing alias with this evidence can NEVER be regenerated. This file is not
 * a key backup, recovery grant or cryptographic proof against a rooted device. */
internal class LocalKeyWitnessStore(private val root:File,private val retainedLegacyData:()->Boolean,
    private val inspectLegacy:(String)->Boolean={it==LocalCipher.DEFAULT_ALIAS}) {
    constructor(context:Context):this(File(context.noBackupFilesDir.canonicalFile,"local-key-lifecycle-v1"),LegacyLocalCipherInventory(context)::containsRetainedData)
    private fun identity(alias:String):String {
        check(alias.isNotEmpty()&&alias.length<=256){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
        return MessageDigest.getInstance("SHA-256").digest(alias.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    private fun record(alias:String)=File(root,identity(alias)+".witness")
    private fun body(alias:String)="GENESIS-LOCAL-KEY-WITNESS\n1\n${identity(alias)}\n".toByteArray(Charsets.US_ASCII)
    private fun checkFile(file:File) {
        check(!Files.isSymbolicLink(root.toPath())&&!Files.isSymbolicLink(file.toPath())&&file.parentFile.canonicalFile==root.canonicalFile){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
    }
    fun wasUsed(alias:String):Boolean {
        val file=record(alias);checkFile(file)
        val present=file.exists()||File(file.path+".bak").exists()||File(file.path+".new").exists()
        if(!present)return false
        check(file.isFile&&file.length()<=128&&file.readBytes().contentEquals(body(alias))){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
        return true
    }
    fun requireFresh(alias:String) {
        check(!wasUsed(alias)){"LOCAL_ENCRYPTION_KEY_LOST"}
        val retained=try{inspectLegacy(alias)&&retainedLegacyData()}catch(error:Exception){
            remember(alias);throw error
        }
        if(retained){remember(alias);error("LOCAL_ENCRYPTION_KEY_LOST")}
    }
    fun remember(alias:String) {
        if(wasUsed(alias))return
        val file=record(alias);checkFile(file);val atomic=AtomicFile(file);var stream:FileOutputStream?=null
        try {
            stream=atomic.startWrite();stream.write(body(alias));stream.fd.sync();atomic.finishWrite(stream);stream=null
            check(wasUsed(alias)){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
        } catch(_:Exception) {
            stream?.let{atomic.failWrite(it)}
            throw IllegalStateException("LOCAL_KEY_STORAGE_UNAVAILABLE")
        }
    }
    fun <T> withCreationPermit(alias:String,operation:()->T):T {
        try {
            check(!Files.isSymbolicLink(root.toPath())){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
            check(root.isDirectory||root.mkdirs()){"LOCAL_KEY_STORAGE_UNAVAILABLE"}
            val file=File(root,identity(alias)+".lock");checkFile(file)
            return RandomAccessFile(file,"rw").use{handle->
                val lock=try{handle.channel.tryLock()}catch(_:OverlappingFileLockException){null}
                checkNotNull(lock){"LOCAL_KEY_OPERATION_BUSY"}
                lock.use{operation()}
            }
        }catch(error:IllegalStateException){throw error}
        catch(_:Exception){throw IllegalStateException("LOCAL_KEY_STORAGE_UNAVAILABLE")}
    }
    override fun toString()="LocalKeyWitnessStore([redacted])"
}
