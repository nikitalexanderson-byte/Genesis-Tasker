package ru.genesis.calendar.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.security.E2eePathReconciliation
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Exercises the actual native bridge's response boundary with an immediate
 * Javascript-style next request. No application vault or authentication input. */
class NativeSourceBridgePressureTest {
    private fun request()=JSONObject().put("job","owned-pressure").put("id",UUID.randomUUID().toString()).put("kind","open")
        .put("envelope",JSONObject().put("iv","synthetic").put("ciphertext","synthetic")).put("purpose","synthetic-source").toString()

    @Test fun anAcknowledgementCanImmediatelyAdmitTheNextBoundedRequest()=runBlocking {
        val operations=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val active=AtomicBoolean(true);val result=CompletableDeferred<E2eePathReconciliation>();val finished=CompletableDeferred<Unit>()
        var calls=0;lateinit var bridge:AuroraSourceBridge
        bridge=AuroraSourceBridge("owned-pressure",PersonalSourceKind.MINDMAPS,active,operations,result,AtomicReference(null),{},
            {_,_->JSONObject().put("synthetic",true)},null,{_,_->
                calls++
                if(calls<8)bridge.postMessage(request())else finished.complete(Unit)
            })
        try{
            bridge.postMessage(request());withTimeout(10000){finished.await()}
            assertEquals(8,calls);assertFalse("Acknowledged requests are no longer in flight",result.isCompleted)
        }finally{active.set(false);operations.cancel();bridge.clear()}
    }

    @Test fun aThirdUnacknowledgedRequestStillRefusesTheEntireBridge()=runBlocking {
        val operations=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val active=AtomicBoolean(true);val result=CompletableDeferred<E2eePathReconciliation>();val pending=CompletableDeferred<Unit>()
        val bridge=AuroraSourceBridge("owned-pressure",PersonalSourceKind.MINDMAPS,active,operations,result,AtomicReference(null),{},
            {_,_->pending.await();JSONObject().put("synthetic",true)},null,{_,_->fail("Unfinished source returned a response")})
        try{
            repeat(3){bridge.postMessage(request())}
            try{withTimeout(10000){result.await()};fail("Unbounded pending requests accepted")}
            catch(error:IllegalStateException){assertEquals("E2EE_AURORA_BRIDGE_INVALID",error.message)}
        }finally{active.set(false);operations.cancel();bridge.clear()}
    }
}
