package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.OutputStream
import java.io.Reader
import java.security.MessageDigest

/** Source-wire codec only. No vault/HTTP/restore capability; all output is a
 * uniquely named synthetic QA artifact or a streaming digest, never user data. */
class NativeBackupSourceJsonTest {
    @Test fun platformJsonAndBinaryCodecsKeepOriginalUnitsAndStreamFortyMiBWithBoundedBuffers(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val raw="\uFEFF \n{\"private\":{\"duplicate\":1,\"duplicate\":2},\"note\":\"literal\uD800unit α\uD83D\uDE00\"}\r\n"
        val binary=byteArrayOf(0,-1,0xc3.toByte(),0x28)
        val target=File(context.getExternalFilesDir(null),"backup336-source-wire-input.json")
        target.outputStream().use{output->
            fun syntax(text:String)=output.write(text.toByteArray(Charsets.US_ASCII))
            syntax("{\"protocol\":1,\"synthetic\":true,\"raw\":")
            BackupSourceJson.quoted(raw,output)
            syntax(",\"units\":[");raw.forEachIndexed{index,char->if(index>0)syntax(",");syntax(char.code.toString())};syntax("]")
            syntax(",\"binary\":");BackupSourceJson.binary(ByteArrayInputStream(binary),output,binary.size.toLong());syntax("}")
        }
        val read=JSONObject(target.readText(Charsets.UTF_8));assertEquals(raw,read.getString("raw"));assertEquals("AP_DKA",read.getString("binary"))
        val total=40*1024*1024;var left=total;var maximumRead=0;var maximumWrite=0;var written=0L
        val source=object:Reader(){
            override fun read(target:CharArray,start:Int,length:Int):Int {
                maximumRead=maxOf(maximumRead,length);if(left==0)return -1;val count=minOf(left,length);target.fill('x',start,start+count);left-=count;return count
            }
            override fun close()=error("Caller owns source")
        }
        val hash=MessageDigest.getInstance("SHA-256")
        val output=object:OutputStream(){
            override fun write(value:Int){hash.update(value.toByte());written++}
            override fun write(value:ByteArray,start:Int,count:Int){maximumWrite=maxOf(maximumWrite,count);hash.update(value,start,count);written+=count}
            override fun close()=error("Caller owns output")
        }
        val started=android.os.SystemClock.elapsedRealtime();var checks=0
        assertEquals(total.toLong(),BackupSourceJson.quoted(source,output){checks++})
        assertEquals(total.toLong()+2,written);assertTrue(maximumRead<=8192);assertTrue(maximumWrite<=8192);assertTrue(checks>total/8192)
        File(context.getExternalFilesDir(null),"backup336-source-wire-large-proof.json").writeText(JSONObject().put("synthetic",true).put("characters",total)
            .put("bytes",written).put("sha256",hash.digest().joinToString(""){"%02x".format(it)}).put("maximumRead",maximumRead).put("maximumWrite",maximumWrite)
            .put("currentChecks",checks).put("maxHeap",Runtime.getRuntime().maxMemory()).put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started).toString(2))
        binary.fill(0)
    }
}
