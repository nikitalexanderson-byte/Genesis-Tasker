package ru.genesis.calendar.data

import java.io.InputStream
import java.io.OutputStream
import java.io.Reader

/** Source-only output. No sink is flushed/closed and no partial output is
 * snapshot authority. The caller must supply encrypted quarantine staging. */
internal class BackupSourceSink(private val output:OutputStream,private val assertCurrent:()->Unit) {
    fun checkCurrent()=assertCurrent()
    fun syntax(value:String){
        check(value.length<=8192&&value.all{it.code<128}){"E2EE_ARCHIVE_SOURCE_INVALID"}
        val bytes=value.toByteArray(Charsets.US_ASCII)
        try{assertCurrent();output.write(bytes);assertCurrent()}finally{bytes.fill(0)}
    }
    fun quoted(value:String,maximum:Int=BackupStoredValue.MAX)=BackupSourceJson.quoted(value,output,maximum,assertCurrent)
    fun quoted(value:Reader,maximum:Int=BackupStoredValue.MAX)=BackupSourceJson.quoted(value,output,maximum,assertCurrent)
    fun binary(value:InputStream,length:Long)=BackupSourceJson.binary(value,output,length,assertCurrent=assertCurrent)
    fun guarded(guard:()->Unit)=BackupSourceSink(output){assertCurrent();guard()}
}

/** An immutable reference catalog captured under the inventory monitor. Bulk
 * original-reader IO happens only after that monitor is released. This covers
 * this process's retained views, NOT all archives/process remnants/old keys. */
internal class BackupInventorySource(private val owner:String,private val epoch:Long,private val views:List<View>,private val assertCurrent:()->Unit) {
    internal class View(val id:String,val mounted:Boolean,val form:BackupFormSpool.Form?,val values:((BackupSourceSink)->Unit)?,val files:List<(BackupSourceSink)->Unit>) {
        override fun toString()="BackupInventorySource.View([redacted])"
    }
    fun writeTo(output:OutputStream){
        val sink=BackupSourceSink(output,assertCurrent)
        sink.syntax("{\"protocol\":3,\"ownerId\":");sink.quoted(owner);sink.syntax(",\"sessionEpoch\":$epoch,\"views\":[")
        for((index,row)in views.withIndex()){
            if(index>0)sink.syntax(",")
            sink.syntax("{\"id\":");sink.quoted(row.id);sink.syntax(",\"source\":\"backup-panel\",\"mounted\":${row.mounted},\"rawForm\":")
            if(row.form==null)sink.syntax("null")else row.form.reader().use{sink.quoted(it)}
            sink.syntax(",\"valueForm\":");if(row.values==null)sink.syntax("null")else row.values.invoke(sink)
            sink.syntax(",\"files\":[");for((fileIndex,file)in row.files.withIndex()){if(fileIndex>0)sink.syntax(",");file(sink)};sink.syntax("]}")
        }
        sink.syntax("]}");assertCurrent()
    }
    override fun toString()="BackupInventorySource([redacted])"
}
