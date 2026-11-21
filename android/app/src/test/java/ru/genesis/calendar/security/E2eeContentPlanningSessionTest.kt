package ru.genesis.calendar.security

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class E2eeContentPlanningSessionTest {
    private fun session(write:(String,E2eeContentPlan.Record,()->Unit)->Unit={_,_,guard->guard()})=E2eeContentPlanningSession(
        E2eeStagedSourceInput(E2eeStagedHistory("synthetic",E2eeSourceStage.Target("owner","personal:owner","personal"),emptyList()){error("UNEXPECTED_SOURCE")},emptyList()),emptyList(),{},
        {_,_,_->error("E2EE_UNKNOWN_ORIGINAL")},write)
    private fun record()=E2eeContentPlan.Record("local","workspace","synthetic",0,byteArrayOf().inputStream())
    @Test fun caughtOutputAndOriginalFailuresStayStickyAndEscapedPortsAreRevoked()=runBlocking {
        for(role in listOf("read","write")){
            val failure=IllegalStateException("E2EE_SYNTHETIC_FAILURE");val f=session{_,_,_->throw failure}
            try{if(role=="read")f.withOriginal("unknown"){}else f.emit("personal.workspace",record());fail("Failure swallowed")}catch(_:IllegalStateException){/* Deliberately caught by consumer. */}
            try{f.finishInput();fail("Caught failure accepted")}catch(error:IllegalStateException){if(role=="write")assertSame(failure,error)else assertEquals("E2EE_UNKNOWN_ORIGINAL",error.message)}
            f.closeAndDrain();try{f.emit("personal.workspace",record());fail("Escaped output accepted")}catch(error:IllegalStateException){assertEquals("E2EE_CONTENT_SESSION_CLOSED",error.message)}
        }
    }
    @Test fun aConcurrentUnawaitedOutputIsRevokedAndDrainedBeforeClosingTheFence()=runBlocking {
        val started=CountDownLatch(1);val release=CountDownLatch(1);val finished=CountDownLatch(1)
        val f=session{_,_,guard->started.countDown();check(release.await(10,TimeUnit.SECONDS));guard()}
        val worker=Thread{try{f.emit("personal.workspace",record())}catch(_:IllegalStateException){/* Revoked loan. */}finally{finished.countDown()}}.apply{start()}
        check(started.await(10,TimeUnit.SECONDS))
        try{f.finishInput();fail("Unawaited output accepted")}catch(error:IllegalStateException){assertEquals("E2EE_CONTENT_SESSION_NOT_AWAITED",error.message)}
        val closing=async{f.closeAndDrain()};yield();assertFalse(closing.isCompleted);release.countDown();closing.await();check(finished.await(10,TimeUnit.SECONDS));worker.join()
    }
}
