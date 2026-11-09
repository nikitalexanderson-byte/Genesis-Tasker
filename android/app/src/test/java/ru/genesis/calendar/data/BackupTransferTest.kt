package ru.genesis.calendar.data
import org.junit.Assert.*
import org.junit.Test

class BackupTransferTest {
    private val a="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    private val b="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    @Test fun orderedUnicodeChunksRoundTrip(){
        val transfer=BackupTransfer(maximum=32,chunk=4)
        assertNull(transfer.append(a,0,false,"αβ🙂"))
        assertEquals("αβ🙂日本",transfer.append(a,1,true,"日本"))
    }
    @Test fun interleavedTransfersRemainIndependent(){
        val transfer=BackupTransfer(maximum=12,chunk=4)
        assertNull(transfer.append(a,0,false,"aaaa"));assertNull(transfer.append(b,0,false,"bbbb"))
        assertEquals("aaaacc",transfer.append(a,1,true,"cc"));assertEquals("bbbbdd",transfer.append(b,1,true,"dd"))
    }
    @Test fun rejectsGapsOverflowAndDuplicateStarts(){
        val transfer=BackupTransfer(maximum=8,chunk=4)
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,Int.MAX_VALUE,true,"x")}
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,1,true,"x")}
        assertNull(transfer.append(a,0,false,"1234"))
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,0,false,"1234")}
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,2,true,"x")}
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,1,true,"56789")}
        assertEquals("12345678",transfer.append(a,1,true,"5678"))
    }
    @Test fun closingRetiresPartialTransfers(){
        val transfer=BackupTransfer(maximum=8,chunk=4);transfer.append(a,0,false,"1234");transfer.clear()
        assertThrows(IllegalArgumentException::class.java){transfer.append(a,1,true,"56")}
    }
}
