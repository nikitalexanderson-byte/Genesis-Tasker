package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.NativeActivityVisit

/** Execution borrows the current foreground visit and unlocked vault. Work is
 * cancelled on background; the durable normal request remains resumable. */
@Composable internal fun PrivateExecutionPump(controller:AuthController,owner:String,enabled:Boolean){
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(controller,owner,enabled,lifecycle){
        if(!enabled)return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED){
            while(isActive){
                try{withContext(NativeActivityVisit.requestContext()){controller.flushSharedOfflineTasks()}}
                catch(cancelled:CancellationException){throw cancelled}
                catch(_:Exception){/* Exact pending journals remain available in the normal operation UI. */}
                delay(30_000)
            }
        }
    }
}
