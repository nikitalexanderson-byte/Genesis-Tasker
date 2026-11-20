package ru.genesis.calendar.data

import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.Reader
import java.io.StringReader
import java.security.MessageDigest
import java.util.Base64

class BackupSourceJsonTest {
    private class Text(private val value:String,private val stride:Int):Reader(){
        var at=0;var maximumRead=0;var closed=false
        override fun read(target:CharArray,start:Int,length:Int):Int {
            check(!closed);maximumRead=maxOf(maximumRead,length);if(at==value.length)return -1
            val count=minOf(length,stride,value.length-at);value.toCharArray(target,start,at,at+count);at+=count;return count
        }
        override fun close(){closed=true}
    }
    private class Bytes(private val value:ByteArray,private val stride:Int):InputStream(){
        var at=0;var maximumRead=0;var closed=false;var eofReads=0
        override fun read():Int {val buffer=ByteArray(1);return if(read(buffer,0,1)<0)-1 else buffer[0].toInt()and 255}
        override fun read(target:ByteArray,start:Int,length:Int):Int {
            check(!closed);maximumRead=maxOf(maximumRead,length);if(at==value.size){eofReads++;return -1}
            val count=minOf(length,stride,value.size-at);value.copyInto(target,start,at,at+count);at+=count;return count
        }
        override fun close(){closed=true}
    }
    private class Output:ByteArrayOutputStream(){
        var maximumWrite=0;var closed=false
        override fun write(value:ByteArray,start:Int,count:Int){maximumWrite=maxOf(maximumWrite,count);super.write(value,start,count)}
        override fun close(){closed=true;super.close()}
        fun value()=JSONTokener(toString(Charsets.UTF_8.name())).nextValue() as String
    }
    @Test fun exactControlsBomPrivateJsonAndSurrogatesSurviveEveryReaderBoundary(){
        val raw="\uFEFF"+(0..31).map(Int::toChar).joinToString("")+"\"\\/</script> αβ\u2028\u2029"+"x".repeat(8191)+"\uD83D\uDE00\uD800z\uDFFF\uFEFF"
        for(stride in listOf(1,7,8192)){
            val source=Text(raw,stride);val out=Output();assertEquals(raw.length.toLong(),BackupSourceJson.quoted(source,out))
            assertEquals(raw,out.value());assertFalse(source.closed);assertFalse(out.closed)
            assertTrue(source.maximumRead<=8192);assertTrue(out.maximumWrite<=24576)
            assertTrue(out.toString(Charsets.UTF_8.name()).contains("\\ud800"));assertTrue(out.toString(Charsets.UTF_8.name()).contains("\\udfff"))
        }
        val out=Output();assertEquals(0L,BackupSourceJson.quoted("",out,maximumCharacters=0));assertEquals("",out.value())
    }
    @Test fun fortyMiBOfGeneratedTextUsesBoundedReadsAndWritesInsteadOfAnAggregateString(){
        val total=40*1024*1024;var left=total;var maximumRead=0;var maximumWrite=0;var written=0L
        val source=object:Reader(){
            override fun read(target:CharArray,start:Int,length:Int):Int {
                maximumRead=maxOf(maximumRead,length);if(left==0)return -1;val count=minOf(left,length);target.fill('x',start,start+count);left-=count;return count
            }
            override fun close()=error("Caller owns source")
        }
        val actual=MessageDigest.getInstance("SHA-256")
        val sink=object:OutputStream(){
            override fun write(value:Int){actual.update(value.toByte());written++}
            override fun write(value:ByteArray,start:Int,count:Int){maximumWrite=maxOf(maximumWrite,count);actual.update(value,start,count);written+=count}
            override fun close()=error("Caller owns output")
        }
        assertEquals(total.toLong(),BackupSourceJson.quoted(source,sink));assertEquals(total.toLong()+2,written)
        val expected=MessageDigest.getInstance("SHA-256");expected.update('"'.code.toByte());val block=ByteArray(8192){'x'.code.toByte()}
        repeat(total/block.size){expected.update(block)};expected.update('"'.code.toByte());block.fill(0)
        assertArrayEquals(expected.digest(),actual.digest());assertTrue(maximumRead<=8192);assertTrue(maximumWrite<=8192)
    }
    @Test fun platformBase64UrlRetainsArbitraryNonTextBytesAcrossShortReadsWithoutPadding(){
        for(size in listOf(0,1,2,3,65535,65536,65537))for(stride in listOf(1,5,65536)){
            val original=ByteArray(size){((it*37+131)and 255).toByte()};val source=Bytes(original,stride);val out=Output()
            assertEquals(size.toLong(),BackupSourceJson.binary(source,out,size.toLong()))
            assertEquals(Base64.getUrlEncoder().withoutPadding().encodeToString(original),out.value());assertArrayEquals(original,Base64.getUrlDecoder().decode(out.value()))
            assertTrue(source.eofReads>0);assertTrue(source.maximumRead<=65536);assertFalse(source.closed);assertFalse(out.closed);assertFalse(out.value().contains('='))
        }
        val out=Output();BackupSourceJson.binary(ByteArrayInputStream(byteArrayOf(0,-1,0xc3.toByte(),0x28)),out,4);assertEquals("AP_DKA",out.value())
        val other=Output();BackupSourceJson.binary(ByteArrayInputStream(byteArrayOf(0xfb.toByte(),-1)),other,2);assertEquals("-_8",other.value())
    }
    @Test fun reachingDeclaredByteCountStillRequiresTheAuthenticatedEofRead(){
        var eofAttempted=false;val out=Output()
        val source=object:InputStream(){
            private val bytes=ByteArrayInputStream(byteArrayOf(1,2,3,4))
            override fun read():Int=error("Bulk reads only")
            override fun read(target:ByteArray,start:Int,length:Int):Int {
                val count=bytes.read(target,start,length);if(count<0){eofAttempted=true;error("SYNTHETIC_TAG_FAILURE")};return count
            }
        }
        assertEquals("SYNTHETIC_TAG_FAILURE",assertThrows(Exception::class.java){BackupSourceJson.binary(source,out,4)}.message)
        assertTrue(eofAttempted);assertFalse(out.toString(Charsets.UTF_8.name()).endsWith('"'));assertFalse(out.closed)
    }
    @Test fun textFooterFailureNeverEmitsACompleteJsonString(){
        var reads=0;val out=Output()
        val source=object:Reader(){
            override fun read(target:CharArray,start:Int,length:Int):Int {if(++reads>1)error("SYNTHETIC_FOOTER_FAILURE");target.fill('x',start,start+length);return length}
            override fun close()=error("Caller owns source")
        }
        assertEquals("SYNTHETIC_FOOTER_FAILURE",assertThrows(Exception::class.java){BackupSourceJson.quoted(source,out)}.message)
        assertTrue(out.size()>0);assertFalse(out.toString(Charsets.UTF_8.name()).endsWith('"'));assertFalse(out.closed)
    }
    @Test fun zeroProgressLengthsAndBudgetsRefuseWithoutACompleteOrClosedOutput(){
        val noText=object:Reader(){override fun read(target:CharArray,start:Int,length:Int)=0;override fun close()=Unit}
        val noBytes=object:InputStream(){override fun read()=0;override fun read(target:ByteArray,start:Int,length:Int)=0}
        assertEquals("E2EE_SOURCE_READ_FAILED",assertThrows(Exception::class.java){BackupSourceJson.quoted(noText,Output())}.message)
        assertEquals("E2EE_SOURCE_READ_FAILED",assertThrows(Exception::class.java){BackupSourceJson.binary(noBytes,Output(),1)}.message)
        val text=Output();assertEquals("E2EE_SOURCE_TOO_LARGE",assertThrows(Exception::class.java){BackupSourceJson.quoted("five!",text,maximumCharacters=4)}.message)
        assertFalse(text.toString(Charsets.UTF_8.name()).endsWith("\"\""));assertFalse(text.closed)
        for(expected in listOf(3L,5L)){
            val out=Output();assertThrows(Exception::class.java){BackupSourceJson.binary(ByteArrayInputStream(byteArrayOf(1,2,3,4)),out,expected)}
            assertThrows(Exception::class.java){out.value()};assertFalse(out.closed)
        }
        assertEquals("E2EE_SOURCE_TOO_LARGE",assertThrows(Exception::class.java){BackupSourceJson.binary(ByteArrayInputStream(byteArrayOf()),Output(),2,maximumBytes=1)}.message)
    }
    @Test fun originalActorRetirementAndSinkFailureDoNotCloseOrMutateTheOriginalSource(){
        var live=true;val original="original private input".repeat(1000);val source=Text(original,7);val out=Output()
        assertEquals("E2EE_ACCOUNT_CHANGED",assertThrows(Exception::class.java){BackupSourceJson.quoted(source,out){if(source.at>14)live=false;check(live){"E2EE_ACCOUNT_CHANGED"}}}.message)
        assertFalse(source.closed);assertFalse(out.closed);assertTrue(source.at<original.length)
        val raw=byteArrayOf(0,-1,0xc3.toByte(),0x28);val binary=Bytes(raw,1);var binaryLive=true
        assertEquals("E2EE_ACCOUNT_CHANGED",assertThrows(Exception::class.java){BackupSourceJson.binary(binary,Output(),raw.size.toLong()){if(binary.at>1)binaryLive=false;check(binaryLive){"E2EE_ACCOUNT_CHANGED"}}}.message)
        assertArrayEquals(byteArrayOf(0,-1,0xc3.toByte(),0x28),raw);assertFalse(binary.closed)
        val faulty=object:OutputStream(){override fun write(value:Int)=error("SYNTHETIC_OUTPUT_FAILURE");override fun close()=error("Caller owns output")}
        val text=StringReader("untouched source")
        assertEquals("SYNTHETIC_OUTPUT_FAILURE",assertThrows(Exception::class.java){BackupSourceJson.quoted(text,faulty)}.message)
        text.reset();assertEquals("untouched source",text.readText());text.close()
    }
}
