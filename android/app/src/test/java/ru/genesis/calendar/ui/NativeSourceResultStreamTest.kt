package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.security.*
import java.security.MessageDigest

class NativeSourceResultStreamTest {
    private fun part(bytes:ByteArray,index:Int=0,sequence:Int=0,placement:String="remote",id:String="one"):JSONObject {
        val offset=index*E2eeFiles.CHUNK_BYTES;val end=minOf(offset+E2eeFiles.CHUNK_BYTES,bytes.size)
        return JSONObject().put("protocol",1).put("sequence",sequence).put("placement",placement).put("domain","mindmap").put("objectId",id).put("filename","").put("mediaType","application/json")
            .put("size",bytes.size).put("index",index).put("last",end==bytes.size).put("hash",E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
            .put("bytes",if(offset==end)"" else E2eeEnvelope.encode(bytes.copyOfRange(offset,end)))
    }
    private fun stream()=NativeSourceResultStream{domain,id->domain=="mindmap"&&id in setOf("one","two","empty")}
    private fun rejects(action:()->Unit){try{action();fail("Expected bounded stream refusal")}catch(error:Exception){assertTrue(error.message?.startsWith("E2EE_")==true)}}
    @Test fun exactOrderedChunksAndPlacementsBecomeOneImmutableResultWithNoPartialFinish(){
        val input=ByteArray(E2eeFiles.CHUNK_BYTES*2+19){(it%251).toByte()};val local="Synthetic private device work".toByteArray();val f=stream()
        for(index in 0..2)f.part(part(input,index));f.part(part(local,sequence=1,placement="local",id="two"));var result:E2eePathReconciliation?=null
        f.finish(true,1,1){result=it;true};f.clear();assertArrayEquals(input,result!!.content.single().bytes);assertArrayEquals(local,result!!.localContent.single().bytes)
    }
    @Test fun duplicateFinishOrLatePartCannotWipeContentAlreadyHandedToTheCoordinator(){
        val input="Immutable published content".toByteArray();val f=stream();f.part(part(input));var result:E2eePathReconciliation?=null
        f.finish(true,1,0){result=it;true};rejects{f.finish(true,1,0){false}};rejects{f.part(part(input))};f.clear();assertArrayEquals(input,result!!.content.single().bytes)
    }
    @Test fun refusedPublicationAndThrownAccountChecksWipeTheCapturedOutputBuffers(){
        for(throws in listOf(false,true)){
            val f=stream();val input=ByteArray(61){42};f.part(part(input));var captured:E2eePathReconciliation?=null
            rejects{f.finish(true,1,0){captured=it;if(throws)error("E2EE_ACCOUNT_CHANGED") else false}}
            assertArrayEquals(ByteArray(61),requireNotNull(captured).content.single().bytes);assertTrue(input.all{it==42.toByte()});rejects{f.part(part(input))}
        }
    }
    @Test fun gapsInterleavingFalseEndsDuplicateIdsAndMissingPartsNeverBecomeCompleteContent(){
        val input=ByteArray(E2eeFiles.CHUNK_BYTES+3){17}
        for(change in listOf<(JSONObject)->Unit>({it.put("index",1)},{it.put("last",true)},{it.put("sequence",1)},{it.put("domain","billing")},{it.put("filename",7)},{it.put("extra",true)})){
            val f=stream();rejects{f.part(part(input).also(change))};rejects{f.finish(true,0,0){true}}
        }
        val incomplete=stream();incomplete.part(part(input));rejects{incomplete.finish(true,1,0){true}}
        val interleaved=stream();interleaved.part(part(input));rejects{interleaved.part(part(byteArrayOf(1),sequence=1,id="two"))}
        val duplicate=stream();duplicate.part(part(byteArrayOf(1)));rejects{duplicate.part(part(byteArrayOf(2),sequence=1))}
    }
    @Test fun alteredBytesChecksumMetadataAndOversizedClaimsRefuseWithoutChangingTheOldSource(){
        val input=ByteArray(E2eeFiles.CHUNK_BYTES+2){21};val before=input.copyOf()
        val f=stream();f.part(part(input));val changed=part(input,1);changed.put("bytes",E2eeEnvelope.encode(byteArrayOf(5,6)));rejects{f.part(changed)};assertArrayEquals(before,input)
        val metadata=stream();metadata.part(part(input));rejects{metadata.part(part(input,1).put("placement","local"))}
        val tooBig=stream();rejects{tooBig.part(part(byteArrayOf(1)).put("size",E2eeFiles.MAX_FILE_BYTES.toLong()+1))}
    }
    @Test fun exactEmptyFileIsOneAuthenticatedPartAndCountMismatchRefuses(){
        val f=stream();f.part(part(byteArrayOf(),id="empty"));var result:E2eePathReconciliation?=null;f.finish(true,1,0){result=it;true};assertEquals(0,result!!.content.single().bytes.size)
        val wrong=stream();wrong.part(part(byteArrayOf(1)));rejects{wrong.finish(true,0,1){true}}
    }
    @Test fun categoryPlacementRulesRejectLocalHistoryBeforeAnyRemoteResultCanPublish(){
        val input="old private action".toByteArray();val f=NativeSourceResultStream(acceptsPlacement={placement,_,id->placement=="local"&&id=="one"},accepts={domain,id->domain=="mindmap"&&id=="one"})
        rejects{f.part(part(input,placement="remote"))};rejects{f.finish(true,1,0){true}}
        val g=NativeSourceResultStream(acceptsPlacement={placement,_,_->placement=="local"},accepts={_,_->true});g.part(part(input,placement="local"));var result:E2eePathReconciliation?=null
        g.finish(true,0,1){result=it;true};assertArrayEquals(input,result!!.localContent.single().bytes)
    }
}
