package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.domain.WeatherRequestV1
import ru.genesis.calendar.domain.WeatherSnapshotV1
import java.time.Duration
import java.time.Instant

internal data class CivilWeatherState(val enabled: Boolean = false, val requiresLocation: Boolean = false,
    val snapshot: WeatherSnapshotV1? = null, val failed: Boolean = false)

@Composable
internal fun rememberCivilDeviceNow(): State<Instant> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    return produceState(Instant.now(), lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                value = Instant.now()
                delay(1_000L - System.currentTimeMillis().mod(1_000L))
            }
        }
    }
}

/** Provenance comes from saved city/IP records, never from an astronomy time-zone fallback. */
private fun civilWeatherRequest(location: SolarLocation, selected: SolarLocation?, network: SolarLocation?): WeatherRequestV1? {
    fun matches(candidate: SolarLocation?): Boolean = candidate != null &&
        candidate.latitude == location.latitude && candidate.longitude == location.longitude &&
        candidate.timeZoneId == location.timeZoneId && candidate.approximate == location.approximate
    return when {
        matches(selected) -> WeatherRequestV1(location.latitude, location.longitude, "selected-city")
        selected == null && matches(network) -> WeatherRequestV1(location.latitude, location.longitude, "network")
        else -> null
    }
}

@Composable
internal fun rememberCivilWeather(controller: AuthController?, location: SolarLocation): CivilWeatherState {
    val context = LocalContext.current
    val preferences = remember(context) { SolarPlaceStore.preferences(context) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val auth = controller?.state?.collectAsStateWithLifecycle()?.value
    val uid = auth?.user?.uid
    val currentUid = LocalGenesisUserId.current
    val enabled = controller != null && uid != null && uid == currentUid && auth?.ready == true && !auth.requiresSignIn
    val request = remember(location, preferences) {
        civilWeatherRequest(location, SolarPlaceStore.readSelected(preferences), SolarPlaceStore.readAutomatic(preferences))
    }
    var snapshot by remember(controller, uid, request) { mutableStateOf<WeatherSnapshotV1?>(null) }
    var failed by remember(controller, uid, request) { mutableStateOf(false) }
    var nextAttempt by remember(controller, uid, request) { mutableStateOf(Instant.EPOCH) }

    LaunchedEffect(controller, uid, request, enabled, lifecycle) {
        if (!enabled || controller == null || uid == null || request == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                val now = Instant.now()
                if (!now.isBefore(nextAttempt)) {
                    try {
                        val received = controller.weather(uid, request)
                        snapshot = received
                        failed = false
                        val fetchedAt = Instant.now()
                        val minimum = fetchedAt.plusSeconds(300)
                        nextAttempt = (received.nextReadAt() ?: fetchedAt.plusSeconds(3_600)).coerceAtLeast(minimum)
                    } catch (cancelled: CancellationException) {
                        currentCoroutineContext().ensureActive()
                        // A concurrent session generation may supersede an otherwise active screen.
                        // Discard that response and retry against the current authenticated generation.
                        nextAttempt = Instant.now().plusSeconds(2)
                    } catch (_: Exception) {
                        failed = true
                        snapshot = snapshot?.let { previous ->
                            if (previous.isFresh(now)) previous else previous.copy(
                                status = if (previous.displayCurrent(now) != null) "stale" else "unavailable", reason = "network-error")
                        }
                        nextAttempt = Instant.now().plusSeconds(300)
                    }
                }
                // A resume re-enters this loop, but respects the account/location-specific server deadline.
                delay(Duration.between(Instant.now(), nextAttempt).toMillis().coerceIn(1_000L, 60_000L))
            }
        }
    }
    return CivilWeatherState(enabled, enabled && request == null, snapshot.takeIf { enabled }, failed)
}
