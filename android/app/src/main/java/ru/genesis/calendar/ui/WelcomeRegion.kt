package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.genesis.calendar.auth.WelcomeIpRegion
import ru.genesis.calendar.auth.requestWelcomeIpRegion

/** No persisted positive result: each foreground visit starts with unknown location. */
@Composable
internal fun rememberWelcomeIpRegion(enabled: Boolean,
    lookup: suspend () -> WelcomeIpRegion = { withContext(Dispatchers.IO) { requestWelcomeIpRegion() } }): WelcomeIpRegion {
    var region by remember { mutableStateOf(WelcomeIpRegion.UNKNOWN) }
    val owner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val currentLookup by rememberUpdatedState(lookup)
    DisposableEffect(owner, enabled) {
        var request: Job? = null
        fun suspendVisit() { request?.cancel(); region = WelcomeIpRegion.UNKNOWN }
        fun resumeVisit() {
            suspendVisit()
            if (enabled) request = scope.launch {
                region = try { currentLookup() }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { WelcomeIpRegion.UNKNOWN }
            }
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> resumeVisit()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> suspendVisit()
                else -> Unit
            }
        }
        owner.lifecycle.addObserver(observer)
        // addObserver synchronously delivers ON_RESUME for an already resumed
        // owner. An extra manual resume would launch and cancel a second lookup.
        onDispose { owner.lifecycle.removeObserver(observer); suspendVisit() }
    }
    return if (enabled) region else WelcomeIpRegion.UNKNOWN
}
