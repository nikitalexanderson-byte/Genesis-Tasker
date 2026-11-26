package ru.genesis.calendar.data

import org.json.JSONObject
import java.io.InputStream
import java.io.Reader
import java.security.MessageDigest
import java.util.Base64

/** Original provider bytes and descriptor, using the existing authenticated
 * UTF16 spill. This source-only stream is not a restore or upload capability.
 * Complete byte count, canonical Base64, SHA and frame footer/EOF are checked
 * before bytes() can return; closing a partial stream proves no completeness. */
internal class BackupStoredBinary private constructor(val id:String,val length:Int,private val expectedHash:String,private val value:BackupStoredValue,
    private val metadataReader:(String)->JSONObject) {
    // A bounded authenticated header read is not proof of a complete file.
    // Metadata text remains in spill rather than every old candidate's heap.
    val descriptor get()=java.io.BufferedReader(value.reader(),8192).use(::readDescriptor)
    fun open(assertCurrent:()->Unit={}):InputStream {
        assertCurrent();val source=java.io.BufferedReader(value.reader(),8192)
        fun exact(text:String){
            val buffer=CharArray(minOf(8192,text.length.coerceAtLeast(1)));var offset=0
            try{while(offset<text.length){val count=source.read(buffer,0,minOf(buffer.size,text.length-offset));check(count>0){"BACKUP_FILE_INTEGRITY"}
                for(index in 0 until count)check(buffer[index]==text[offset+index]){"BACKUP_FILE_INTEGRITY"};offset+=count}}
            finally{buffer.fill('\u0000')}
        }
        try{val metadata=metadata(readDescriptor(source),metadataReader);check(metadata.getString("id")==id&&metadata.getInt("length")==length&&metadata.getString("sha256")==expectedHash){"BACKUP_FILE_INTEGRITY"}}
        catch(error:Throwable){source.close();throw error}
        val encodedLength=(length+2)/3*4
        val ascii=object:InputStream(){
            private val padding=(3-length%3)%3
            private val buffer=CharArray(8192);private var at=0;private var count=0;private var loaded=0;private var produced=0;private var closed=false
            override fun read():Int {
                check(!closed){"BACKUP_FILE_INTEGRITY"}
                if(produced==encodedLength)return -1
                if(at==count){assertCurrent();count=source.read(buffer,0,minOf(buffer.size,encodedLength-loaded));check(count>0){"BACKUP_FILE_INTEGRITY"};loaded+=count;at=0}
                val char=buffer[at++];val position=produced++
                if(position>=encodedLength-padding)check(char=='='){"BACKUP_FILE_INTEGRITY"}else{
                    val digit=ALPHABET.indexOf(char);check(digit>=0){"BACKUP_FILE_INTEGRITY"}
                    if(padding==1&&position==encodedLength-2)check((digit and 3)==0){"BACKUP_FILE_INTEGRITY"}
                    if(padding==2&&position==encodedLength-3)check((digit and 15)==0){"BACKUP_FILE_INTEGRITY"}
                }
                return char.code
            }
            fun finish(){check(produced==encodedLength&&loaded==encodedLength&&at==count){"BACKUP_FILE_INTEGRITY"};exact("\"}");check(source.read()==-1){"BACKUP_FILE_INTEGRITY"};assertCurrent()}
            override fun close(){if(!closed){closed=true;buffer.fill('\u0000');source.close()}}
        }
        val decoded=Base64.getDecoder().wrap(ascii)
        return object:InputStream(){
            private val hash=MessageDigest.getInstance("SHA-256");private val single=ByteArray(1)
            private var total=0;private var verified=false;private var closed=false
            override fun read():Int {val count=read(single,0,1);return if(count<0)-1 else (single[0].toInt()and 255).also{single[0]=0}}
            override fun read(target:ByteArray,start:Int,count:Int):Int {
                check(!closed){"BACKUP_FILE_INTEGRITY"};require(start>=0&&count>=0&&start<=target.size-count)
                if(count==0)return 0;assertCurrent();if(verified)return -1
                if(total==length){
                    check(decoded.read()==-1){"BACKUP_FILE_INTEGRITY"};ascii.finish();check(hex(hash.digest())==expectedHash){"BACKUP_FILE_INTEGRITY"};verified=true;return -1
                }
                val size=decoded.read(target,start,minOf(count,length-total));check(size>0){"BACKUP_FILE_INTEGRITY"}
                hash.update(target,start,size);total+=size;assertCurrent();return size
            }
            override fun close(){if(!closed){closed=true;single.fill(0);decoded.close()}}
        }
    }
    fun bytes(assertCurrent:()->Unit={}):ByteArray {
        assertCurrent();val result=ByteArray(length)
        return try{open(assertCurrent).use{source->var offset=0;while(offset<result.size){val count=source.read(result,offset,result.size-offset);check(count>0){"BACKUP_FILE_INTEGRITY"};offset+=count};check(source.read()==-1){"BACKUP_FILE_INTEGRITY"}}
            assertCurrent();result
        }catch(error:Throwable){result.fill(0);throw error}
    }
    fun clear()=value.clear()
    override fun toString()="BackupStoredBinary([redacted])"
    companion object {
        private const val ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        private fun hex(bytes:ByteArray)=try{bytes.joinToString(""){"%02x".format(it)}}finally{bytes.fill(0)}
        private fun readDescriptor(source:Reader):String {
            fun exact(text:String){for(char in text)check(source.read()==char.code){"BACKUP_FILE_INTEGRITY"}}
            exact("{\"descriptor\":");val raw=StringBuilder();var depth=0;var quoted=false;var escaped=false;var started=false
            do{
                val code=source.read();check(code>=0&&raw.length<32768){"BACKUP_FILE_INTEGRITY"};val char=code.toChar()
                if(!started){check(char=='{'||char in " \t\r\n"){"BACKUP_FILE_INTEGRITY"};if(char=='{')started=true};raw.append(char)
                if(quoted){if(escaped)escaped=false else if(char=='\\')escaped=true else if(char=='"')quoted=false}
                else when(char){'"'->quoted=true;'{'->depth++;'}'->depth--}
            }while(!started||depth>0||quoted)
            while(true){val code=source.read();check(code>=0){"BACKUP_FILE_INTEGRITY"};if(code==','.code)break
                check(code.toChar() in " \t\r\n"&&raw.length<32768){"BACKUP_FILE_INTEGRITY"};raw.append(code.toChar())}
            exact("\"bytes\":\"");return raw.toString()
        }
        private fun metadata(raw:String,read:(String)->JSONObject):JSONObject {
            check(raw.length in 1..32768){"BACKUP_FILE_METADATA"}
            // The native producer has a fixed flat descriptor. Use the same
            // strict small-JSON reader as manifests, preserving original text
            // separately and refusing duplicate/escaped names or trailing data.
            val value=read(raw);check(value.keys().asSequence().toSet()==setOf("protocol","id","length","name","type","lastModified","declaredSize","sha256")){"BACKUP_FILE_METADATA"}
            fun integer(name:String):Long {val number=value.get(name);check(number is Number&&number.toDouble().isFinite()&&number.toLong() in -9007199254740991L..9007199254740991L&&number.toDouble()==number.toLong().toDouble()){"BACKUP_FILE_METADATA"};return number.toLong()}
            check(integer("protocol")==1L&&integer("length") in 0..GenesisBackupContainer.MAX_FILE.toLong()&&value.get("id") is String&&value.getString("id").matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"BACKUP_FILE_METADATA"}
            for((name,maximum) in listOf("name" to 4096,"type" to 1024))if(!value.isNull(name))check(value.get(name) is String&&value.getString(name).length<=maximum){"BACKUP_FILE_METADATA"}
            for(name in listOf("lastModified","declaredSize"))if(!value.isNull(name))integer(name)
            check(value.get("sha256") is String&&value.getString("sha256").matches(Regex("[a-f0-9]{64}"))){"BACKUP_FILE_INTEGRITY"}
            return value
        }
        fun store(spool:BackupFormSpool,view:String,binding:String,rawDescriptor:String,bytes:ByteArray,
            metadataReader:(String)->JSONObject=NativeBackupValueManifest::read,assertCurrent:()->Unit={}):BackupStoredBinary {
            assertCurrent();val metadata=metadata(rawDescriptor,metadataReader)
            check(metadata.getInt("length")==bytes.size&&hex(MessageDigest.getInstance("SHA-256").digest(bytes))==metadata.getString("sha256")){"BACKUP_FILE_INTEGRITY"}
            val transfer=BackupValueTransfer(spool,view,"$binding:file-v1",assertCurrent)
            val buffer=StringBuilder("{\"descriptor\":$rawDescriptor,\"bytes\":\"");var index=0;var stored:BackupStoredValue?=null
            fun drain(last:Boolean){
                while(buffer.length>BackupFormSpool.CHUNK||last&&buffer.isNotEmpty()){
                    assertCurrent();val size=minOf(buffer.length,BackupFormSpool.CHUNK);val end=last&&size==buffer.length
                    val accepted=transfer.append(metadata.getString("id"),index++,end,buffer.substring(0,size));buffer.delete(0,size)
                    if(accepted!=null){check(end&&stored==null){"BACKUP_TRANSFER_ORDER"};stored=accepted}
                }
            }
            try{
                var offset=0
                while(offset<bytes.size){assertCurrent();val end=minOf(offset+BackupImportFile.CHUNK,bytes.size);val part=bytes.copyOfRange(offset,end)
                    try{buffer.append(Base64.getEncoder().encodeToString(part))}finally{part.fill(0)};offset=end;drain(false)
                }
                buffer.append("\"}");drain(true);assertCurrent();return BackupStoredBinary(metadata.getString("id"),metadata.getInt("length"),metadata.getString("sha256"),requireNotNull(stored),metadataReader)
            }catch(error:Throwable){stored?.clear();throw error}
            finally{buffer.setLength(0);transfer.clear()}
        }
    }
}
