package ru.genesis.calendar.data

import java.io.Reader

/** Native value framing. Wrapping one JSON value in the existing form format
 * reuses authenticated local frames and
 * restart locators. Original UTF16 JSON is never projected through JSONObject. */
internal class BackupStoredValue(private val form:BackupFormSpool.Form) {
    val characters=form.characters-PREFIX.length-SUFFIX.length
    init{check(characters>0){"BACKUP_FORM_INTEGRITY"}}
    fun reader():Reader {
        val source=form.reader()
        fun exact(text:String){
            val buffer=CharArray(text.length);var offset=0
            try{
                while(offset<buffer.size){val size=source.read(buffer,offset,buffer.size-offset);check(size>0){"BACKUP_FORM_INTEGRITY"};offset+=size}
                check(buffer.concatToString()==text){"BACKUP_FORM_INTEGRITY"}
            }finally{buffer.fill('\u0000')}
        }
        try{exact(PREFIX)}catch(error:Throwable){source.close();throw error}
        return object:Reader(){
            private var left=characters;private var finished=false;private var closed=false
            override fun read(target:CharArray,start:Int,length:Int):Int {
                check(!closed){"BACKUP_FORM_INTEGRITY"};require(start>=0&&length>=0&&start<=target.size-length)
                if(length==0)return 0
                if(left==0){
                    if(!finished){exact(SUFFIX);check(source.read()==-1){"BACKUP_FORM_INTEGRITY"};finished=true}
                    return -1
                }
                val count=source.read(target,start,minOf(length,left));check(count>0){"BACKUP_FORM_INTEGRITY"};left-=count;return count
            }
            override fun close(){if(!closed){closed=true;source.close()}}
        }
    }
    fun clear()=form.clear()
    override fun toString()="BackupStoredValue([redacted])"
    companion object {
        const val PREFIX="{\"protocol\":1,\"state\":{\"value\":"
        const val SUFFIX="},\"settled\":true,\"file\":null}"
        const val MAX=96*1024*1024
    }
}

/** A bounded re-framer, not a second whole-value StringBuilder. The input and
 * encrypted-spool boundaries differ by the small fixed wrapper. Prefix/suffix
 * code units have exactly the same authenticated lifetime as the value itself. */
internal class BackupValueTransfer(private val spool:BackupFormSpool,private val view:String,private val binding:String,private val assertCurrent:()->Unit={}) {
    private class Pending(val id:String) {
        var inputIndex=0;var outputIndex=0;var characters=0
        val buffer=StringBuilder(BackupStoredValue.PREFIX)
    }
    private var pending:Pending?=null
    @Synchronized fun append(id:String,index:Int,last:Boolean,text:String):BackupStoredValue? {
        check(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))&&index in 0..BackupStoredValue.MAX/BackupFormSpool.CHUNK&&
            text.length in 1..BackupFormSpool.CHUNK){"BACKUP_TRANSFER_INVALID"}
        if(index==0){check(pending?.id!=id){"BACKUP_TRANSFER_BUSY"};clear();pending=Pending(id)}
        val value=pending?:error("BACKUP_TRANSFER_ORDER")
        try{
            check(value.id==id&&value.inputIndex==index&&value.characters.toLong()+text.length<=BackupStoredValue.MAX&&
                (last||text.length==BackupFormSpool.CHUNK)){"BACKUP_TRANSFER_ORDER"}
            value.inputIndex++;value.characters+=text.length;value.buffer.append(text)
            if(last)value.buffer.append(BackupStoredValue.SUFFIX)
            var result:BackupStoredValue?=null
            while(value.buffer.length>BackupFormSpool.CHUNK||last&&value.buffer.isNotEmpty()){
                val count=minOf(value.buffer.length,BackupFormSpool.CHUNK);val end=last&&count==value.buffer.length
                val stored=spool.append(view,binding,id,value.outputIndex++,end,value.buffer.substring(0,count),assertCurrent)
                value.buffer.delete(0,count)
                if(stored!=null){check(end&&result==null){"BACKUP_TRANSFER_ORDER"};result=BackupStoredValue(stored)}
            }
            if(last){check(result!=null){"BACKUP_TRANSFER_ORDER"};pending=null}
            return result
        }catch(error:Throwable){clear();throw error}
    }
    @Synchronized fun clear(){pending?.buffer?.setLength(0);pending=null;spool.cancel(view)}
    override fun toString()="BackupValueTransfer([redacted])"
}
