package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

class BackupJsonWireTest {
    private fun decode(bytes:ByteArray)=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    @Test fun providerMetadataAndRawJsonKeepTheirExactUtf16UnitsAcrossTheActualUtf8Boundary(){
        for(value in listOf("bad\uD800name","\uFEFFlow\uDFFF","α😀\u0000","\\uD800","x".repeat(8184)+"\uD800😀\uDFFF")){
            val original=JSONObject().put("name",value).put("rawForm",JSONObject.quote(value)).toString();val bytes=backupJsonUtf8(original)
            try{val read=JSONObject(decode(bytes));assertEquals(value,read.getString("name"));assertEquals(JSONObject.quote(value),read.getString("rawForm"))}
            finally{bytes.fill(0)}
        }
    }
    @Test fun boundsAreAppliedToExactEscapedWireBytesAndNeverReturnATruncatedResult(){
        val raw="{\"name\":\"\uD800\"}";val exact=backupJsonUtf8(raw)
        try{assertEquals("{\"name\":\"\\ud800\"}",decode(exact));assertArrayEquals(exact,backupJsonUtf8(raw,exact.size))
            assertThrows(IllegalStateException::class.java){backupJsonUtf8(raw,exact.size-1)}
        }finally{exact.fill(0)}
    }
}
