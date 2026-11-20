package ru.genesis.calendar.data

import java.io.FilterOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.Reader
import java.io.StringReader
import java.util.Base64

/** Bounded source-wire encoding only. The caller owns its reader/output and
 * must quarantine partial output until the COMPLETE source authenticates and
 * commits. This is neither a JSON parser nor snapshot/restore authority. */
internal object BackupSourceJson {
    private const val HEX="0123456789abcdef"
    private const val BLOCK=8192
    fun quoted(value:String,output:OutputStream,maximumCharacters:Int=BackupStoredValue.MAX,assertCurrent:()->Unit={}):Long=
        StringReader(value).use{quoted(it,output,maximumCharacters,assertCurrent)}

    /** Preserve original UTF16 units, even across reader/block boundaries.
     * Escaping every surrogate avoids a charset encoder's replacement fallback.
     * All private raw JSON is a quoted source STRING, never raw object syntax. */
    fun quoted(source:Reader,output:OutputStream,maximumCharacters:Int=BackupStoredValue.MAX,assertCurrent:()->Unit={}):Long {
        require(maximumCharacters>=0){"E2EE_SOURCE_TOO_LARGE"}
        val input=CharArray(BLOCK);val text=StringBuilder(BLOCK);var characters=0L
        fun flush(){
            if(text.isEmpty())return
            val bytes=text.toString().toByteArray(Charsets.UTF_8)
            try{assertCurrent();output.write(bytes);assertCurrent()}finally{bytes.fill(0);text.setLength(0)}
        }
        fun append(char:Char){
            when(char){
                '"'->text.append("\\\"");'\\'->text.append("\\\\")
                '\b'->text.append("\\b");'\u000c'->text.append("\\f");'\n'->text.append("\\n");'\r'->text.append("\\r");'\t'->text.append("\\t")
                else->if(char.code<32||char.isSurrogate()){
                    text.append("\\u").append(HEX[char.code ushr 12]).append(HEX[char.code ushr 8 and 15])
                        .append(HEX[char.code ushr 4 and 15]).append(HEX[char.code and 15])
                }else text.append(char)
            }
            if(text.length>=BLOCK-6)flush()
        }
        try{
            assertCurrent();text.append('"')
            while(true){
                assertCurrent();val count=source.read(input);assertCurrent()
                if(count==-1)break
                check(count in 1..input.size){"E2EE_SOURCE_READ_FAILED"}
                check(characters+count<=maximumCharacters){"E2EE_SOURCE_TOO_LARGE"};characters+=count
                for(index in 0 until count)append(input[index]);input.fill('\u0000',0,count)
            }
            // Reaching actual EOF also lets authenticated source readers verify
            // their footer. A declared length alone must not close this string.
            assertCurrent();text.append('"');flush();return characters
        }finally{input.fill('\u0000');text.setLength(0)}
    }

    /** Platform RFC4648 Base64URL, no padding, no full byte/string aggregate.
     * Always read EOF even when expectedLength is reached: a source AEAD reader
     * may authenticate its final tag/footer only on the following read. */
    fun binary(source:InputStream,output:OutputStream,expectedLength:Long,maximumBytes:Long=GenesisBackupContainer.MAX_FILE.toLong(),assertCurrent:()->Unit={}):Long {
        require(maximumBytes>=0&&expectedLength in 0..maximumBytes){"E2EE_SOURCE_TOO_LARGE"}
        val buffer=ByteArray(65536);var length=0L
        val target=object:FilterOutputStream(output){
            override fun write(value:Int){assertCurrent();out.write(value);assertCurrent()}
            override fun write(value:ByteArray,start:Int,count:Int){assertCurrent();out.write(value,start,count);assertCurrent()}
            // Encoder.close finishes its own remainder, not the caller's sink.
            // Do not flush/close a quarantined stage or publish its manifest.
            override fun close()=Unit
        }
        try{
            assertCurrent();output.write('"'.code);assertCurrent()
            Base64.getUrlEncoder().withoutPadding().wrap(target).use{encoded->
                while(true){
                    assertCurrent();val count=source.read(buffer);assertCurrent()
                    if(count==-1)break
                    check(count in 1..buffer.size){"E2EE_SOURCE_READ_FAILED"}
                    check(length+count<=expectedLength&&length+count<=maximumBytes){"E2EE_SOURCE_TOO_LARGE"}
                    encoded.write(buffer,0,count);length+=count;buffer.fill(0,0,count)
                }
                check(length==expectedLength){"E2EE_SOURCE_READ_FAILED"}
            }
            assertCurrent();output.write('"'.code);assertCurrent();return length
        }finally{buffer.fill(0)}
    }
}
