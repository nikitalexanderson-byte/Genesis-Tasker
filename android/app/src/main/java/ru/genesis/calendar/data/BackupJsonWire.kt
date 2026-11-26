package ru.genesis.calendar.data

import java.io.ByteArrayOutputStream

/** JSONObject preserves Java UTF16 strings, but UTF8's default replacement
 * would silently turn an unpaired provider surrogate into '?'. Escape every
 * surrogate code unit in JSON text before encoding; the receiver recovers the
 * exact original units. This is a wire codec, never a JSON authority/parser. */
internal fun backupJsonUtf8(json:String,maximum:Int=48*1024*1024):ByteArray {
    class Output:ByteArrayOutputStream(minOf(8192,maximum.coerceAtLeast(1))) {fun wipe(){buf.fill(0);reset()}}
    check(maximum>=0){"E2EE_SOURCE_TOO_LARGE"}
    val output=Output();val block=StringBuilder(8192)
    fun flush(){
        if(block.isEmpty())return
        val bytes=block.toString().toByteArray(Charsets.UTF_8)
        try{check(output.size().toLong()+bytes.size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};output.write(bytes)}finally{bytes.fill(0);block.setLength(0)}
    }
    val hex="0123456789abcdef"
    return try{
        for(char in json){
            if(char.isSurrogate())block.append("\\u").append(hex[char.code ushr 12]).append(hex[char.code ushr 8 and 15]).append(hex[char.code ushr 4 and 15]).append(hex[char.code and 15])
            else block.append(char)
            if(block.length>=8186)flush()
        }
        flush();output.toByteArray()
    }finally{block.setLength(0);output.wipe();output.close()}
}
