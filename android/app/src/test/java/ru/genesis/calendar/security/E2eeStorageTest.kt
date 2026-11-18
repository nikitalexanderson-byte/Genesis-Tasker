package ru.genesis.calendar.security

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class E2eeStorageTest {
    private class Memory : E2eeRecordStorage {
        var rows=mutableMapOf<String,E2eeLocalRecord>()
        var beforeCommit:(()->Unit)?=null
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        @Synchronized override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit) {
            beforeCommit?.invoke();requireOpen();val next=rows.toMutableMap()
            for(change in changes){check(next[change.key]?.serial==change.expected){"E2EE_LOCAL_CONFLICT"};if(change.value==null)next.remove(change.key) else next[change.key]=change.value}
            requireOpen();rows=next
        }
    }
    private fun fixture():Pair<UnlockedE2eeVault,Memory> {
        val keys=E2eeKeys.generateDeviceKeys();val storage=Memory();val root=E2eeEnvelope.importRoot(E2eeKeys.freshSecret())
        val vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope("owner","device:one","device",1,1,1,"root-one",keys.signing.private,mapOf("root-one" to root)) {keys.signing.public})
        return vault to storage
    }
    private fun reject(message:String,action:()->Unit) {try{action()}catch(e:Exception){assertEquals(message,e.message);return};fail("Forbidden local operation accepted")}
    @Test fun encryptedCasBatchPreservesOriginalOnConflictAndLock() {
        val(vault,storage)=fixture();val canary="PRIVATE SYNTHETIC QUEUED DRAFT".toByteArray()
        vault.write(listOf(UnlockedE2eeVault.Write("draft","one",canary,null),UnlockedE2eeVault.Write("outbox","two",canary,null)))
        assertEquals(2,storage.rows.size);assertFalse(storage.rows.values.any{it.envelope.toJson().toString().contains("PRIVATE SYNTHETIC")})
        assertArrayEquals(canary,vault.read("draft","one")!!.bytes)
        reject("E2EE_LOCAL_CONFLICT"){vault.write(listOf(UnlockedE2eeVault.Write("draft","one",byteArrayOf(0),null)))}
        assertArrayEquals(canary,vault.read("draft","one")!!.bytes)
        vault.lock();reject("E2EE_UNLOCK_REQUIRED"){vault.read("draft","one")}
        assertEquals(2,storage.rows.size)
    }
    @Test fun lockWhileCommitQueuedInvalidatesCapabilityBeforePersistAndContinuation() {
        val(vault,storage)=fixture();val entered=CountDownLatch(1);val release=CountDownLatch(1);val result=AtomicReference<Throwable?>()
        storage.beforeCommit={entered.countDown();check(release.await(10,TimeUnit.SECONDS))}
        val thread=Thread {try{vault.write(listOf(UnlockedE2eeVault.Write("outbox","pending",byteArrayOf(1,2),null)))}catch(e:Throwable){result.set(e)}}
        thread.start();assertTrue(entered.await(10,TimeUnit.SECONDS));vault.lock();release.countDown();thread.join(10000)
        assertFalse(thread.isAlive);assertEquals("E2EE_UNLOCK_REQUIRED",result.get()?.message);assertTrue(storage.rows.isEmpty())
    }
    @Test fun ciphertextMovedToAnotherObjectCannotBeReadAsValidEmptyContent() {
        val(vault,storage)=fixture();vault.write(listOf(UnlockedE2eeVault.Write("diary","one",byteArrayOf(1),null)))
        val key=storage.rows.keys.single();storage.rows[key.replace("3:one","3:two")]=storage.rows.getValue(key)
        reject("E2EE_CORRUPT_LOCAL_RECORD"){vault.read("diary","two")}
    }
}
