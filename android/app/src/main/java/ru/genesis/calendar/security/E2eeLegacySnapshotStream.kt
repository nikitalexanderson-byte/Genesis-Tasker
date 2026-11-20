package ru.genesis.calendar.security

import java.io.InputStream
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean

/** Old states1/2 JSON/Base64 path wrappers. No rewrite of their original hash,
 * source mutation, signing identity, restoration or migration authority. */
internal object E2eeLegacySnapshotStream {
    data class Reference(val migrationId:String,val snapshotSize:Int,val snapshotParts:Int,val snapshotHash:String)
    class Options(val vault:E2eeSourceReadVault,val target:E2eeSourceStage.Target,val paths:List<String>,val reference:Reference,val inventory:E2eePrivatePaths,val assertCurrent:()->Unit) {
        override fun toString()="E2eeLegacySnapshotStream.Options([redacted])"
    }
    private data class Path(val id:String,val size:Int)
    private class Summary {var rows:List<Path>?=null}
    private fun invalid():Nothing=error("E2EE_CORRUPT_LEGACY_SNAPSHOT")
    private fun ended():Nothing=error("E2EE_LEGACY_SNAPSHOT_CLOSED")
    private const val ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    private val VALUES=IntArray(128){ALPHABET.indexOf(it.toChar())}
    private fun space(code:Int)=code==32||code==9||code==10||code==13
    private class Context(input:Options,val current:()->Unit,val watch:((()->Unit))->(()->Unit)) {
        val read=input.vault::read;val list=input.vault::listLocal;val target=input.target.copy();val paths=input.paths.toList();val reference=input.reference.copy()
        fun inventory(){current();val prefix="${reference.migrationId}:source:";val actual=list("local-snapshot",prefix);current();val expected=(0 until reference.snapshotParts).map{prefix+it}.toSet();if(actual.size!=expected.size||actual.any{it !in expected})invalid()}
    }
    private class Cursor(val context:Context) {
        @Volatile private var buffer=ByteArray(0);private var position=0;private var part=0;private val closed=AtomicBoolean(false);private var done=false
        private val digest=MessageDigest.getInstance("SHA-256")
        private fun fill():Boolean {
            context.current();if(closed.get())ended();if(position<buffer.size)return true;buffer.fill(0);buffer=ByteArray(0);position=0
            val reference=context.reference;if(part>=reference.snapshotParts)return false
            val row=context.read("local-snapshot","${reference.migrationId}:source:$part")?:invalid();buffer=row.bytes;context.current();if(closed.get())ended()
            if(row.serial!=1L||row.bytes.size!=minOf(E2eeFiles.CHUNK_BYTES,reference.snapshotSize-part*E2eeFiles.CHUNK_BYTES))invalid();digest.update(row.bytes);part++;return true
        }
        fun peek()=if(fill())buffer[position].toInt()and 255 else -1
        fun take():Int {if(!fill())invalid();return buffer[position++].toInt()and 255}
        fun spaces(){while(fill()){while(position<buffer.size&&space(buffer[position].toInt()and 255))position++;if(position<buffer.size)return}}
        fun expect(code:Int){spaces();if(take()!=code)invalid()}
        fun escape():Int {
            return when(val code=take()) {34,92,47->code;98->8;102->12;110->10;114->13;116->9;117->{var value=0;repeat(4){val digit=take();val hex=when(digit){in 48..57->digit-48;in 65..70->digit-55;in 97..102->digit-87;else->invalid()};value=value*16+hex};value};else->invalid()}
        }
        fun string():String {
            expect(34);val value=StringBuilder();repeat(4096){var code=take();if(code==34)return value.toString();if(code==92)code=escape()else if(code<32||code>127)invalid();value.append(code.toChar());if(value.length>128)invalid()};invalid()
        }
        fun one(){spaces();val raw=StringBuilder();while(true){val code=peek();if(code<0||space(code)||code==44||code==125)break;if(raw.length>=64||code>127)invalid();raw.append(take().toChar())}
            if(!Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?").matches(raw)||raw.toString().toDoubleOrNull()!=1.0)invalid()}
        fun finish(){spaces();if(peek()!=-1||part!=context.reference.snapshotParts||done)invalid();val bytes=digest.digest();done=true;try{if(E2eeEnvelope.encode(bytes)!=context.reference.snapshotHash)invalid()}finally{bytes.fill(0)};context.inventory();context.current()}
        fun abort(){closed.set(true);buffer.fill(0)}
        fun release(){abort();digest.reset()}
    }
    private suspend fun SequenceScope<ByteArray>.binary(cursor:Cursor,emit:Boolean):Int {
        cursor.expect(34);var output=if(emit)ByteArray(E2eeFiles.CHUNK_BYTES)else ByteArray(0);var written=0;var size=0;var bits=0;var value=0;var chars=0
        try{
            while(true){var code=cursor.take();if(code==34)break;if(code==92)code=cursor.escape();val digit=if(code in VALUES.indices)VALUES[code]else -1;if(digit<0)invalid()
                chars++;value=((value shl 6)or digit)and 0xffffff;bits+=6
                if(bits>=8){bits-=8;val byte=(value ushr bits)and 255;if(++size>E2eeFiles.MAX_FILE_BYTES)invalid()
                    if(emit){output[written++]=byte.toByte();if(written==output.size){try{yield(output);cursor.context.current()}finally{output.fill(0)};output=ByteArray(E2eeFiles.CHUNK_BYTES);written=0}}
                }
            }
            if(chars==0||chars%4==1||bits!=0&&value and((1 shl bits)-1)!=0)invalid()
            if(emit&&written>0){val last=output.copyOf(written);try{yield(last);cursor.context.current()}finally{last.fill(0)}};return size
        }finally{output.fill(0)}
    }
    private suspend fun SequenceScope<ByteArray>.paths(cursor:Cursor,context:Context,selected:Int?):List<Path> {
        cursor.expect(91);val rows=mutableListOf<Path>();val seen=mutableSetOf<String>()
        while(true){if(rows.size>=context.paths.size)invalid();cursor.expect(123);var id:String?=null;var size:Int?=null;val fields=mutableSetOf<String>()
            while(true){val name=cursor.string();if(name !in setOf("id","bytes")||!fields.add(name))invalid();cursor.expect(58);if(name=="id")id=E2eeKeys.technical(cursor.string())else size=binary(cursor,rows.size==selected)
                cursor.spaces();val separator=cursor.take();if(separator==125)break;if(separator!=44)invalid()}
            if(fields.size!=2||id==null||size==null||size<1||id !in context.paths||!seen.add(id))invalid();rows+=Path(id,size)
            cursor.spaces();val separator=cursor.take();if(separator==93)break;if(separator!=44)invalid()
        }
        if(rows.size!=context.paths.size)invalid();return rows
    }
    private fun scan(context:Context,selected:Int?,summary:Summary)=sequence {
        val cursor=Cursor(context);val unwatch=context.watch(cursor::abort)
        try{
            context.inventory();if(cursor.peek()==239)for(expected in listOf(239,187,191))if(cursor.take()!=expected)invalid()
            cursor.expect(123);val fields=mutableSetOf<String>();var rows:List<Path>?=null;var owner:String?=null;var scope:String?=null
            while(true){val name=cursor.string();if(name !in setOf("protocol","ownerId","scopeId","paths")||!fields.add(name))invalid();cursor.expect(58)
                when(name){"protocol"->cursor.one();"ownerId"->owner=cursor.string();"scopeId"->scope=cursor.string();else->rows=paths(cursor,context,selected)}
                cursor.spaces();val separator=cursor.take();if(separator==125)break;if(separator!=44)invalid()
            }
            if(fields.size!=4||rows==null||owner!=context.target.ownerId||scope!=context.target.scopeId)invalid();cursor.finish();summary.rows=rows
        }finally{cursor.release();unwatch()}
    }
    class Handle private constructor(private val options:Options) {
        private val closed=AtomicBoolean(false);private val gate=Any();private val closers=mutableSetOf<()->Unit>();@Volatile private var active:SourceInput?=null
        private val current:()->Unit={if(closed.get())ended();options.assertCurrent();options.vault.assertOpen()}
        private fun watch(close:()->Unit):()->Unit {synchronized(gate){current();closers+=close};return{synchronized(gate){closers-=close};Unit}}
        private fun closeCursors(){val all=synchronized(gate){closers.toList().also{closers.clear()}};all.forEach{it()}}
        private val context=Context(options,current,::watch);private val rows:List<Path>
        val reference=options.reference.copy();val paths:List<String> =Collections.unmodifiableList(options.paths.toList())
        init{val summary=Summary();val iterator=scan(context,null,summary).iterator();while(iterator.hasNext()){iterator.next().fill(0);invalid()};rows=summary.rows?:invalid();current()}
        fun close(){closed.set(true);active?.abort();closeCursors()}
        fun openPath(id:String):SourceInput=synchronized(gate){current();val index=rows.indexOfFirst{it.id==id};check(index>=0){"E2EE_LEGACY_SNAPSHOT_PATH"};check(active==null){"E2EE_LEGACY_SNAPSHOT_BUSY"}
            SourceInput(index).also{active=it}}
        inner class SourceInput internal constructor(index:Int):InputStream() {
            private val revoked=AtomicBoolean(false);private var complete=false;@Volatile private var buffer=ByteArray(0);private var at=0;@Volatile private var reading=false
            private val ownedGate=Any();private val owned=mutableMapOf<()->Unit,()->Unit>()
            private fun live(){current();if(revoked.get())ended()}
            private fun watchOwned(close:()->Unit):()->Unit {
                val unwatch=watch(close);synchronized(ownedGate){if(revoked.get()){unwatch();close();ended()};owned[close]=unwatch}
                return{synchronized(ownedGate){owned.remove(close)};unwatch()}
            }
            private fun closeOwned(){val all=synchronized(ownedGate){owned.toList().also{owned.clear()}};for((close,unwatch)in all){unwatch();close()}}
            private val summary=Summary();private val local=Context(options,::live,::watchOwned);private val iterator=scan(local,index,summary).iterator()
            private fun release(){buffer.fill(0);synchronized(gate){if(active===this)active=null}}
            internal fun abort(){revoked.set(true);buffer.fill(0);closeOwned()}
            override fun close(){abort();if(!reading)release()}
            override fun read():Int {val one=ByteArray(1);try{return if(read(one,0,1)<0)-1 else one[0].toInt()and 255}finally{one.fill(0)}}
            @Synchronized override fun read(out:ByteArray,offset:Int,length:Int):Int {
                require(offset>=0&&length>=0&&offset<=out.size-length);var count=0;reading=true
                try{
                    live();if(length==0)return 0
                    if(at==buffer.size){buffer.fill(0);if(!iterator.hasNext()){if(summary.rows==null)invalid();live();complete=true;release();return -1};buffer=iterator.next();at=0;live()}
                    count=minOf(length,buffer.size-at);buffer.copyInto(out,offset,at,at+count);at+=count;live();return count
                }catch(error:Throwable){out.fill(0,offset,offset+count);abort();throw error}
                finally{reading=false;if(revoked.get())release()}
            }
            fun assertComplete(){live();check(complete){"E2EE_SOURCE_STAGE_EOF_REQUIRED"}}
        }
        companion object {fun create(options:Options)=Handle(options)}
    }
    fun open(input:Options):Handle {
        val reference=input.reference.copy();E2eeKeys.technical(reference.migrationId);E2eeEnvelope.decode(reference.snapshotHash,32)
        check(reference.snapshotSize in 1..E2eeFiles.MAX_FILE_BYTES&&reference.snapshotParts==(reference.snapshotSize+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES){"E2EE_CORRUPT_LEGACY_SNAPSHOT"}
        E2eeKeys.technical(input.target.ownerId);E2eeKeys.technical(input.target.scopeId);check(input.target.kind in setOf("personal","project","space")&&input.paths==input.inventory.required(input.target.kind).map{it.id}){"E2EE_SOURCE_ADAPTER_REQUIRED"}
        return Handle.create(Options(input.vault,input.target.copy(),input.paths.toList(),reference,input.inventory,input.assertCurrent))
    }
}
