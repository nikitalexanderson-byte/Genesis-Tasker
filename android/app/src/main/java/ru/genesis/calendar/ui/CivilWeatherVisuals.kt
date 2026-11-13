package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import android.content.res.AssetManager
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.domain.WeatherSnapshotV1
import java.time.Instant
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

/** Defaults mirror the shared JSON; the same packaged policy is read by both clients. */
internal data class CivilWeatherVisualPolicy(
    val groundDimming: Float = .24f, val cloudOpacity: Float = .76f, val transmissionPower: Float = 1.4f,
    val windVisibleFrom: Double = 3.0, val windStrongFrom: Double = 10.0,
    val pixelsPerMps: Float = 6f, val maxDriftPixels: Float = 140f,
    val rainLightBelow: Double = .5, val rainHeavyFrom: Double = 7.5,
    val snowLightBelow: Double = .3, val snowHeavyFrom: Double = 2.0,
    val lightParticles: Int = 18, val moderateParticles: Int = 36, val heavyParticles: Int = 60,
    val rainSeconds: Float = .85f, val snowSeconds: Float = 6f, val hailSeconds: Float = 1.2f,
    val fogBelowM: Double = 1000.0, val fogMaxOpacity: Float = .48f,
    val cloudSeconds: Float = 60f, val windSeconds: Float = 7f,
    val stormSeconds: Float = 18f, val stormGlowOpacity: Float = .08f,
)

@Composable
internal fun rememberCivilWeatherVisualPolicy(): CivilWeatherVisualPolicy {
    val assets = LocalContext.current.assets
    var policy by remember(assets) { mutableStateOf(CivilWeatherVisualPolicy()) }
    LaunchedEffect(assets) { policy = withContext(Dispatchers.IO) { readCivilWeatherVisualPolicy(assets) } }
    return policy
}

private fun readCivilWeatherVisualPolicy(assets: AssetManager): CivilWeatherVisualPolicy = runCatching {
    val data = assets.open("originals/catalogs/weather-visuals-v1.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
    require(data.getInt("version") == 1)
    val cloud = data.getJSONObject("cloud"); val wind = data.getJSONObject("wind")
    val precipitation = data.getJSONObject("precipitation"); val particles = precipitation.getJSONObject("particles")
    val fog = data.getJSONObject("fog"); val motion = data.getJSONObject("motion")
    fun number(row: JSONObject, key: String, minimum: Double = 0.0, maximum: Double = 1_000.0): Double =
        row.getDouble(key).also { require(it.isFinite() && it in minimum..maximum) }
    CivilWeatherVisualPolicy(number(cloud, "groundDimming", maximum = 1.0).toFloat(), number(cloud, "opacity", maximum = 1.0).toFloat(),
        number(cloud, "transmissionPower", .1, 10.0).toFloat(), number(wind, "visibleFromMps"), number(wind, "strongFromMps"),
        number(wind, "pixelsPerMps").toFloat(), number(wind, "maxDriftPixels").toFloat(),
        number(precipitation, "rainLightBelowMmH"), number(precipitation, "rainHeavyFromMmH"),
        number(precipitation, "snowLightBelowMmH"), number(precipitation, "snowHeavyFromMmH"),
        number(particles, "light", maximum = 100.0).toInt(), number(particles, "moderate", maximum = 100.0).toInt(),
        number(particles, "heavy", maximum = 100.0).toInt(),
        number(precipitation, "rainSeconds", .1).toFloat(), number(precipitation, "snowSeconds", .1).toFloat(),
        number(precipitation, "hailSeconds", .1).toFloat(), number(fog, "visibleBelowM", .1, 100_000.0),
        number(fog, "maxOpacity", maximum = 1.0).toFloat(), number(motion, "cloudSeconds", 1.0).toFloat(),
        number(motion, "windSeconds", 1.0).toFloat(), number(motion, "stormSeconds", 10.0).toFloat(),
        number(motion, "stormGlowOpacity", maximum = .08).toFloat())
}.getOrDefault(CivilWeatherVisualPolicy())

internal data class CivilWeatherEffects(
    val fresh: Boolean = false, val precipitation: String = "none", val particles: Int = 0,
    val cloudCover: Float = 0f, val sunTransmission: Float = 1f, val groundDimming: Float = 0f,
    val fogOpacity: Float = 0f, val windVisible: Boolean = false, val windStrong: Boolean = false,
    val drift: Float = 0f, val storm: Boolean = false, val blizzard: Boolean = false, val snowCover: Boolean = false,
)

internal fun civilWeatherEffects(weather: WeatherSnapshotV1?, now: Instant, policy: CivilWeatherVisualPolicy): CivilWeatherEffects {
    val current = weather?.takeIf { it.isFresh(now) }?.current ?: return CivilWeatherEffects()
    val rate = current.precipitationRateMmH ?: current.precipitation1hMm
    val precipitation = current.precipitationKind.takeIf {
        it !in setOf("none", "unknown") && rate != null && rate > 0.0 && current.intensity != "none"
    } ?: "none"
    val snow = precipitation in setOf("snow", "sleet")
    val fallbackCloud = when (current.condition) { "cloudy" -> .9; "partly-cloudy" -> .45; else -> 0.0 }
    val cloudCover = ((current.cloudCoverPercent ?: fallbackCloud * 100.0) / 100.0).coerceIn(0.0, 1.0).toFloat()
    val wind = maxOf(current.windSpeedMps ?: 0.0, current.windGustMps ?: 0.0)
    val hemisphere = if ((weather?.location?.latitude ?: 0.0) < 0.0) -1 else 1
    val drift = current.windDirectionDeg?.let {
        sin(it * PI / 180.0) * hemisphere * minOf(policy.maxDriftPixels.toDouble(), wind * policy.pixelsPerMps)
    }?.toFloat() ?: 0f
    val visibility = current.visibilityM
    val fog = if (current.condition == "fog" || visibility != null && visibility < policy.fogBelowM)
        maxOf(if (current.condition == "fog") .3 else 0.0,
            if (visibility == null) .5 else 1.0 - (visibility / policy.fogBelowM).coerceIn(0.0, 1.0)) else 0.0
    val lightThreshold = if (snow) policy.snowLightBelow else policy.rainLightBelow
    val heavyThreshold = if (snow) policy.snowHeavyFrom else policy.rainHeavyFrom
    val particles = when {
        precipitation == "none" -> 0
        current.intensity == "heavy" -> policy.heavyParticles
        current.intensity == "moderate" -> policy.moderateParticles
        current.intensity == "light" -> policy.lightParticles
        rate?.let { it >= heavyThreshold } == true -> policy.heavyParticles
        precipitation == "drizzle" || rate?.let { it < lightThreshold } == true -> policy.lightParticles
        else -> policy.moderateParticles
    }
    return CivilWeatherEffects(true, precipitation, particles, cloudCover,
        1f - cloudCover.pow(policy.transmissionPower), cloudCover * policy.groundDimming,
        (fog * policy.fogMaxOpacity).toFloat(), wind >= policy.windVisibleFrom, wind >= policy.windStrongFrom,
        drift, current.storm == true || current.thunderstorm == true,
        current.blizzard == true && snow && precipitation != "none", (current.snowDepthCm ?: 0.0) > 0.0)
}

/** One atmospheric draw layer. It never synthesizes precipitation from temperature or calendar month. */
@Composable
internal fun CivilWeatherOverlay(effects: CivilWeatherEffects, policy: CivilWeatherVisualPolicy,
    horizonY: Float, daylight: Float, modifier: Modifier = Modifier, skyOnly: Boolean = false) {
    if (!effects.fresh) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val seconds = remember { mutableFloatStateOf(0f) }
    val motion = ValueAnimator.areAnimatorsEnabled()
    val moving = motion && (effects.cloudCover > 0f || effects.particles > 0 || effects.windVisible || effects.fogOpacity > 0f || effects.storm)
    LaunchedEffect(lifecycle, moving) {
        if (!moving) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var previous = 0L
            while (isActive) withFrameNanos { frame ->
                if (previous != 0L) seconds.floatValue += ((frame - previous) / 1_000_000_000.0).toFloat().coerceAtMost(.1f)
                previous = frame
            }
        }
    }
    Canvas(modifier.testTag(if (skyOnly) "civil-weather-clouds" else "civil-weather-effects")) {
        val elapsed = seconds.floatValue
        fun fraction(value: Float): Float = value - kotlin.math.floor(value)
        val drift = effects.drift.dp.toPx()
        if (skyOnly && effects.cloudCover > 0f) clipRect(bottom = size.height * horizonY) {
            val cloudColor = lerp(Color(0xff17263c), Color(0xffd4dee8), daylight)
                .copy(alpha = effects.cloudCover * policy.cloudOpacity)
            repeat(5) { index ->
                val travel = fraction(index * .271f + elapsed / policy.cloudSeconds)
                val x = ((if (effects.drift < 0) 1f - travel else travel) * 1.8f - .4f) * size.width
                val y = (.02f + index % 3 * .105f) * size.height
                // Overlapping soft volumes give the clouds depth without obscuring the terrain.
                repeat(3) { lobe ->
                    val center = Offset(x + (lobe - 1) * size.width * .13f, y + (lobe % 2) * size.height * .035f)
                    drawOval(Brush.radialGradient(listOf(cloudColor.copy(alpha = cloudColor.alpha * .72f),
                        cloudColor.copy(alpha = cloudColor.alpha * .3f), Color.Transparent),
                        center = center, radius = size.width * .29f),
                        topLeft = Offset(center.x - size.width * .3f, center.y - size.height * .085f),
                        size = Size(size.width * .6f, size.height * .19f))
                }
            }
        }
        if (skyOnly) return@Canvas
        if (effects.fogOpacity > 0f) {
            val fogY = size.height * horizonY
            drawRect(Brush.verticalGradient(listOf(Color.Transparent,
                Color(0xffd9e3e5).copy(alpha = effects.fogOpacity), Color.Transparent),
                startY = fogY - size.height * .18f, endY = fogY + size.height * .25f))
        }
        // Wind is seen in drifting atmosphere and in the trajectory of precipitation.
        if (effects.windVisible) repeat(if (effects.windStrong) 4 else 2) { index ->
            val progress = fraction(index * .173f + elapsed / policy.windSeconds)
            val x = (if (drift < 0) 1f - progress else progress) * size.width * 1.7f - size.width * .35f
            val y = size.height * (horizonY + index * .07f) + sin(elapsed * .35f + index) * 4.dp.toPx()
            val radius = size.width * .2f
            val alpha = sin(progress * PI.toFloat()).coerceAtLeast(0f) * (if (effects.windStrong) .09f else .045f)
            drawOval(Brush.radialGradient(listOf(Color(0xffd9e5eb).copy(alpha = alpha), Color.Transparent),
                center = Offset(x, y), radius = radius),
                topLeft = Offset(x - radius, y - 8.dp.toPx()), size = Size(radius * 2, 16.dp.toPx()))
        }
        repeat(effects.particles) { index ->
            val snow = effects.precipitation == "snow" || effects.precipitation == "sleet" && index % 2 == 0
            val hail = effects.precipitation == "hail"
            val depth = (index % 5) / 4f
            val period = (when { snow -> policy.snowSeconds; hail -> policy.hailSeconds; else -> policy.rainSeconds }) * (1.35f - depth * .55f)
            val progress = fraction(index * .367f + elapsed / period)
            val seededX = fraction(index * .618034f)
            val sway = if (snow) sin(elapsed * .7f + index) * 12.dp.toPx() else 0f
            val x = fraction(seededX + (progress * drift + sway) / size.width) * size.width
            val y = progress * (size.height + 20.dp.toPx()) - 10.dp.toPx()
            val color = Color(0xffe8f4fa).copy(alpha = .16f + depth * .38f)
            when {
                snow || hail -> {
                    val radius = (if (hail) .7f + depth * .5f else .6f + depth * 1.1f).dp.toPx()
                    drawCircle(Brush.radialGradient(listOf(color, color.copy(alpha = color.alpha * .6f), Color.Transparent),
                        center = Offset(x, y), radius = radius * 1.6f), radius * 1.6f, Offset(x, y))
                }
                else -> {
                    val length = (if (effects.precipitation == "drizzle") 2f + depth * 2f else 4f + depth * 6f).dp.toPx()
                    val start = Offset(x, y)
                    val end = Offset(x + drift / size.height * length, y + length)
                    drawLine(Brush.linearGradient(listOf(Color.Transparent, color), start, end), start, end,
                        strokeWidth = (.55f + depth * .55f).dp.toPx(), cap = StrokeCap.Round)
                }
            }
        }
        if (effects.blizzard) drawRect(Color(0xffe2edf2).copy(alpha = .1f))
        // Explicit storms use a slow, low-opacity glow, with no lightning flashes.
        if (effects.storm && motion) drawRect(Color(0xffd9dfea).copy(alpha =
            ((sin(elapsed / policy.stormSeconds * (2 * PI).toFloat()) + 1f) * .5f * policy.stormGlowOpacity)))
    }
}
