package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean

/** Explicit foreground intake only. The transient picker request owns/cancels
 * this access; URI grants and plaintext are never spooled to disk. EOF, size and
 * current owner are checked before bytes reach the durable protected journal. */
internal class NativeUserFileInput(private val guard:()->Unit):AutoCloseable{
    class File(val name:String,val type:String,val bytes:ByteArray){override fun toString()="NativeUserFileInput.File([redacted])"}
    private val closed=AtomicBoolean();private val signal=CancellationSignal();private val resources=mutableSetOf<Closeable>();private val buffers=mutableSetOf<ByteArray>()
    fun current(){check(!closed.get()){"MESSAGING_FILE_SOURCE_CHANGED"};guard()}
    private fun <T:Closeable,R> tracked(resource:T,operation:(T)->R):R{
        synchronized(resources){if(closed.get()){resource.close();error("MESSAGING_FILE_SOURCE_CHANGED")};resources+=resource}
        try{current();return operation(resource).also{current()}}finally{synchronized(resources){resources.remove(resource)};runCatching{resource.close()}}
    }
    private fun held(bytes:ByteArray):ByteArray{synchronized(buffers){if(closed.get()){bytes.fill(0);error("MESSAGING_FILE_SOURCE_CHANGED")};buffers+=bytes};return bytes}
    private fun release(bytes:ByteArray){bytes.fill(0);synchronized(buffers){buffers.remove(bytes)}}
    fun read(context:Context,uri:Uri):File{
        current();check(uri.scheme=="content"&&uri.toString().length<=8192){"MESSAGING_FILE_SOURCE_CHANGED"};var name="file"
        context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null,signal)?.use{cursor->current();if(cursor.moveToFirst()){
            val nameColumn=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);if(nameColumn>=0&&!cursor.isNull(nameColumn))name=cursor.getString(nameColumn).take(255)
            val sizeColumn=cursor.getColumnIndex(OpenableColumns.SIZE);if(sizeColumn>=0&&!cursor.isNull(sizeColumn)){val size=cursor.getLong(sizeColumn);check(size==-1L||size in 0..MessagingCrypto.FILE_LIMIT.toLong()){"PRIVATE_FILE_TOO_LARGE"}}
        };current()}
        val type=(context.contentResolver.getType(uri)?:"application/octet-stream").take(128);current()
        val descriptor=context.contentResolver.openFileDescriptor(uri,"r",signal)?:error("FILE_READ_FAILED")
        return tracked(descriptor){fd->tracked(ParcelFileDescriptor.AutoCloseInputStream(fd)){input->
            val source=held(ByteArray(MessagingCrypto.FILE_LIMIT+1));try{var count=0;var eof=false
                while(count<source.size){current();val next=input.read(source,count,minOf(8192,source.size-count));current();if(next<0){eof=true;break};check(next>0){"FILE_READ_FAILED"};count+=next}
                check(eof&&count<=MessagingCrypto.FILE_LIMIT){"PRIVATE_FILE_TOO_LARGE"};val bytes=held(source.copyOf(count));try{current();File(name,type,bytes)}catch(reason:Throwable){release(bytes);throw reason}
            }finally{release(source)}
        }}
    }
    fun release(file:File){release(file.bytes)}
    override fun close(){if(closed.compareAndSet(false,true)){
        synchronized(buffers){buffers.forEach{it.fill(0)};buffers.clear()}
        try{signal.cancel()}finally{val opened=synchronized(resources){resources.toList().also{resources.clear()}};opened.forEach{runCatching{it.close()}}}
    }}
    override fun toString()="NativeUserFileInput([redacted])"
}
