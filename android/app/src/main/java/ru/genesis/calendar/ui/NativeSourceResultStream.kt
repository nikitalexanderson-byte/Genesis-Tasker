package ru.genesis.calendar.ui

import org.json.JSONObject
import ru.genesis.calendar.security.*
import java.security.MessageDigest

/** In-process bridge framing only. Hashes stay local; upload crypto remains the
 * existing signed file protocol. No incomplete/failed transfer becomes content. */
internal class NativeSourceResultStream(private val accepts:(String,String)->Boolean) {
    private data class Pending(val sequence:Long,val placement:String,val domain:String,val id:String,val filename:String,val mediaType:String,
        val hash:String,val expected:ByteArray,val bytes:ByteArray,val digest:MessageDigest,var next:Int=0){
        override fun toString()="Pending([redacted])"
    }
    private val remote=mutableListOf<E2eeMigrationContent>();private val local=mutableListOf<E2eeMigrationContent>()
    private val seen=mutableSetOf<String>();private var pending:Pending?=null;private var size=0L;private var closed=false;private var transferred=false
    @Synchronized fun part(value:JSONObject){
        try{append(value)}catch(error:Throwable){clearLocked();throw error}
    }
    private fun append(value:JSONObject){
        check(!closed){"E2EE_SOURCE_STREAM_CLOSED"}
        E2eeKeys.exact(value,setOf("protocol","sequence","placement","domain","objectId","filename","mediaType","size","index","last","hash","bytes"))
        check(E2eeCommands.integer(value.get("protocol"))==1L){"E2EE_SOURCE_STREAM_INVALID"}
        val sequence=E2eeCommands.integer(value.get("sequence"));val declared=E2eeCommands.integer(value.get("size"));val index=E2eeCommands.integer(value.get("index"))
        val domain=value.getString("domain");val id=E2eeKeys.technical(value.getString("objectId"));val placement=value.getString("placement")
        check(placement in setOf("remote","local")&&accepts(domain,id)&&declared<=E2eeFiles.MAX_FILE_BYTES&&value.get("last") is Boolean
            &&value.get("filename") is String&&value.get("mediaType") is String&&value.get("bytes") is String){"E2EE_SOURCE_STREAM_INVALID"}
        val filename=value.getString("filename");val mediaType=value.getString("mediaType");val hash=value.getString("hash")
        check(filename.length<=512&&mediaType.length<=128&&sequence==remote.size.toLong()+local.size&&sequence<10000){"E2EE_SOURCE_STREAM_INVALID"}
        val expected=E2eeEnvelope.decode(hash,32)
        try{
            if(pending==null){
                check(index==0L&&seen.add("$domain\u0000$id")){"E2EE_SOURCE_STREAM_INVALID"};size+=declared;check(size<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_TOO_LARGE"}
                pending=Pending(sequence,placement,domain,id,filename,mediaType,hash,expected.copyOf(),ByteArray(declared.toInt()),MessageDigest.getInstance("SHA-256"))
            }
            val row=requireNotNull(pending)
            check(row.sequence==sequence&&row.placement==placement&&row.domain==domain&&row.id==id&&row.filename==filename&&row.mediaType==mediaType&&row.hash==hash
                &&row.bytes.size.toLong()==declared&&index==row.next.toLong()){"E2EE_SOURCE_STREAM_INVALID"}
            val offset=index*E2eeFiles.CHUNK_BYTES;check(offset<=declared){"E2EE_SOURCE_STREAM_INVALID"};val length=minOf(E2eeFiles.CHUNK_BYTES.toLong(),declared-offset).toInt()
            val encoded=value.getString("bytes");val bytes=if(length==0){check(encoded.isEmpty()){"E2EE_SOURCE_STREAM_INVALID"};byteArrayOf()}else E2eeEnvelope.decode(encoded,1,E2eeFiles.CHUNK_BYTES)
            try{
                check(bytes.size==length&&value.getBoolean("last")== (offset+length==declared)){"E2EE_SOURCE_STREAM_INVALID"}
                bytes.copyInto(row.bytes,offset.toInt());row.digest.update(bytes);row.next++
                if(value.getBoolean("last")){
                    val actual=row.digest.digest();try{check(MessageDigest.isEqual(row.expected,actual)){"E2EE_SOURCE_STREAM_INVALID"}}finally{actual.fill(0);row.expected.fill(0)}
                    val content=E2eeMigrationContent(domain,id,row.bytes,filename,mediaType);(if(placement=="remote")remote else local).add(content);pending=null
                }
            }finally{bytes.fill(0)}
        }finally{expected.fill(0)}
    }
    /** Publisher atomically wins the native outcome while this monitor protects
     * clear() from wiping buffers already handed to the coordinator. */
    @Synchronized fun finish(complete:Boolean,remoteCount:Long,localCount:Long,publish:(E2eePathReconciliation)->Boolean){
        check(!closed){"E2EE_SOURCE_STREAM_CLOSED"}
        try{
            check(pending==null&&remoteCount==remote.size.toLong()&&localCount==local.size.toLong()&&remote.size+local.size in 1..10000){"E2EE_SOURCE_STREAM_INVALID"}
            val value=E2eePathReconciliation(complete,remote.toList(),local.toList());closed=true;transferred=true
            if(!publish(value)){transferred=false;clearLocked();error("E2EE_SOURCE_STREAM_CLOSED")}
        }catch(error:Throwable){transferred=false;clearLocked();throw error}
    }
    @Synchronized fun clear(){clearLocked()}
    private fun clearLocked(){
        closed=true;pending?.let{it.bytes.fill(0);it.expected.fill(0)};pending=null
        if(!transferred)(remote+local).forEach{it.bytes.fill(0)};remote.clear();local.clear();seen.clear()
    }
    override fun toString()="NativeSourceResultStream([redacted])"
}
