package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import android.content.res.AssetManager
import android.graphics.Bitmap
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.domain.solarLandscapePoint
import ru.genesis.calendar.domain.solarPosition

private data class CivilLandscapePlate(val width: Int = 1536, val height: Int = 1024,
    val horizonY: Float = .64f)
private data class CivilLandscapeSelection(val path: String, val plate: CivilLandscapePlate = CivilLandscapePlate())
private data class CivilLandscapeEntries(val base: Map<String, CivilLandscapeSelection>,
    val snowCover: Map<String, CivilLandscapeSelection>)

private data class CivilSkyStop(val altitude: Float, val top: Color, val bottom: Color)
private data class CivilLandscapePalette(val horizontalAmplitude: Float = .44f, val skyTop: Float = .08f,
    val nightBrightness: Float = .56f, val dayBrightness: Float = 1.04f,
    val nightSaturation: Float = .72f, val daySaturation: Float = 1f,
    val directionalShade: Float = .35f, val directionalLight: Float = .26f,
    val skyStops: List<CivilSkyStop> = listOf(
        CivilSkyStop(-18f, Color(0xff040b1c), Color(0xff17233c)),
        CivilSkyStop(-12f, Color(0xff0d1e3b), Color(0xff394560)),
        CivilSkyStop(-6f, Color(0xff364466), Color(0xffb17772)),
        CivilSkyStop(0f, Color(0xff5b7392), Color(0xffefb27a)),
        CivilSkyStop(12f, Color(0xff6a9fbd), Color(0xffdce3d7)),
        CivilSkyStop(35f, Color(0xff3c91bd), Color(0xffd7eaf0)),
        CivilSkyStop(80f, Color(0xff2e83b5), Color(0xffd1e8ef)),
    ))

private object CivilLandscapePaletteStore {
    @Volatile private var cached: CivilLandscapePalette? = null

    fun read(assets: AssetManager): CivilLandscapePalette = cached ?: run {
        val palette = runCatching {
            val data = assets.open("originals/catalogs/solar-landscape-palette.json")
                .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
            require(data.getInt("version") == 1)
            val projection = data.getJSONObject("projection"); val terrain = data.getJSONObject("terrain")
            fun number(row: JSONObject, key: String, minimum: Double, maximum: Double): Float =
                row.getDouble(key).also { require(it.isFinite() && it in minimum..maximum) }.toFloat()
            val rows = data.getJSONArray("skyStops")
            val stops = (0 until rows.length()).map { index ->
                val row = rows.getJSONObject(index)
                CivilSkyStop(number(row, "altitude", -90.0, 90.0),
                    Color(android.graphics.Color.parseColor(row.getString("top"))),
                    Color(android.graphics.Color.parseColor(row.getString("bottom"))))
            }
            require(stops.size >= 2 && stops.zipWithNext().all { (a, b) -> a.altitude < b.altitude })
            CivilLandscapePalette(number(projection, "horizontalAmplitude", .01, .5),
                number(projection, "skyTop", .01, .5),
                number(terrain, "nightBrightness", 0.0, 2.0), number(terrain, "dayBrightness", 0.0, 2.0),
                number(terrain, "nightSaturation", 0.0, 2.0), number(terrain, "daySaturation", 0.0, 2.0),
                number(terrain, "directionalShade", 0.0, 1.0), number(terrain, "directionalLight", 0.0, 1.0), stops)
        }.getOrDefault(CivilLandscapePalette())
        cached = palette
        palette
    }
}

@Composable private fun rememberCivilLandscapePalette(): CivilLandscapePalette {
    val assets = LocalContext.current.assets
    var palette by remember { mutableStateOf(CivilLandscapePalette()) }
    LaunchedEffect(assets) { palette = withContext(Dispatchers.IO) { CivilLandscapePaletteStore.read(assets) } }
    return palette
}

private object CivilLandscapeManifest {
    @Volatile private var entries: CivilLandscapeEntries? = null

    fun plate(assets: AssetManager, path: String, snowCover: Boolean): CivilLandscapeSelection {
        val plates = entries ?: run {
            val loaded = runCatching {
                val manifest = assets.open("originals/solar-landscapes-v1/manifest.json")
                    .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
                require(manifest.getInt("version") == 1)
                fun read(rows: JSONObject?, snow: Boolean): Map<String, CivilLandscapeSelection> {
                    if (rows == null) return emptyMap()
                    return rows.keys().asSequence().mapNotNull { key ->
                        runCatching {
                            require(key.matches(Regex("(?:temperate|boreal|mediterranean|arid|tropical|southern)/(?:0[1-9]|1[0-2])\\.webp")))
                            val row = rows.getJSONObject(key)
                            val width = row.getInt("width"); val height = row.getInt("height")
                            val horizon = row.getDouble("horizonY")
                            require(width in 1..8192 && height in 1..8192 && horizon.isFinite() && horizon > .08 && horizon < 1.0)
                            val entryPath = if (snow) row.getString("path").also { require(it == "snow-cover/$key") } else key
                            key to CivilLandscapeSelection("solar-landscapes-v1/$entryPath", CivilLandscapePlate(width, height, horizon.toFloat()))
                        }.getOrNull()
                    }.toMap()
                }
                CivilLandscapeEntries(read(manifest.getJSONObject("entries"), false), read(manifest.optJSONObject("snowCoverEntries"), true))
            }.getOrDefault(CivilLandscapeEntries(emptyMap(), emptyMap()))
            entries = loaded
            loaded
        }
        val key = path.removePrefix("solar-landscapes-v1/")
        return (if (snowCover) plates.snowCover[key] else null) ?: plates.base[key] ?: CivilLandscapeSelection(path)
    }
}

@Composable
private fun rememberCivilLandscapePlate(path: String, snowCover: Boolean): CivilLandscapeSelection {
    val assets = LocalContext.current.assets
    var plate by remember(path, snowCover) { mutableStateOf(CivilLandscapeSelection(path)) }
    LaunchedEffect(path, snowCover, assets) {
        plate = withContext(Dispatchers.IO) { CivilLandscapeManifest.plate(assets, path, snowCover) }
    }
    return plate
}

@Composable
private fun rememberCivilTerrain(path: String, size: IntSize): Bitmap? {
    val assets = LocalContext.current.assets
    val width = ((size.width + 127) / 128) * 128
    val height = ((size.height + 127) / 128) * 128
    var bitmap by remember(path, width, height) {
        mutableStateOf(OriginalImageLoader.cached(path, width, height))
    }
    LaunchedEffect(path, width, height, assets) {
        if (width > 0 && height > 0 && bitmap == null) bitmap = withContext(Dispatchers.IO) {
            runCatching { OriginalImageLoader.load(assets, path, width, height) }.getOrNull()
        }
    }
    return bitmap
}

private fun civilLight(from: Float, to: Float, value: Float): Float {
    val fraction = ((value - from) / (to - from)).coerceIn(0f, 1f)
    return fraction * fraction * (3f - 2f * fraction)
}

private data class CivilNightStar(val x: Float, val y: Float, val radius: Float, val opacity: Float, val color: Color)

@Composable private fun rememberCivilNightStars(): List<CivilNightStar> {
    val assets = LocalContext.current.assets
    return remember(assets) {
        val catalog = assets.open("originals/catalogs/solar-night-stars.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()) }
        val colors = catalog.getJSONArray("colors")
        val stars = catalog.getJSONArray("stars")
        List(stars.length()) { index ->
            val star = stars.getJSONArray(index)
            CivilNightStar(star.getDouble(0).toFloat(), star.getDouble(1).toFloat(),
                star.getDouble(2).toFloat(), star.getDouble(3).toFloat(),
                Color(android.graphics.Color.parseColor(colors.getString(star.getInt(4)))))
        }
    }
}

private fun civilColorMix(from: Color, to: Color, fraction: Float): Color = Color(
    red = from.red + (to.red - from.red) * fraction,
    green = from.green + (to.green - from.green) * fraction,
    blue = from.blue + (to.blue - from.blue) * fraction,
    alpha = from.alpha + (to.alpha - from.alpha) * fraction)

private fun CivilLandscapePalette.sky(altitude: Float): Pair<Color, Color> {
    val upper = skyStops.indexOfFirst { it.altitude >= altitude }
    if (upper == 0) return skyStops.first().let { it.top to it.bottom }
    if (upper < 0) return skyStops.last().let { it.top to it.bottom }
    val from = skyStops[upper - 1]; val to = skyStops[upper]
    val fraction = (altitude - from.altitude) / (to.altitude - from.altitude)
    return civilColorMix(from.top, to.top, fraction) to civilColorMix(from.bottom, to.bottom, fraction)
}

/** Current device civil day; landscape region can be explicitly selected independently of solar place. */
@Composable
internal fun CivilTodayHero(location: SolarLocation, calendar: GenesisCalendar, regionZone: ZoneId,
    weatherController: ru.genesis.calendar.auth.AuthController? = null, use24Hour: Boolean = true,
    onChooseCity: () -> Unit = {}) {
    val language = LocalGenesisLanguage.current
    val locale = remember(language) { Locale.forLanguageTag(language) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var now by remember { mutableStateOf(Instant.now()) }
    val clockNow by rememberCivilDeviceNow()
    val today = clockNow.atZone(calendar.zoneId).toLocalDate()
    val weather = rememberCivilWeather(weatherController, location)
    val weatherPolicy = rememberCivilWeatherVisualPolicy()
    val weatherEffects = civilWeatherEffects(weather.snapshot, clockNow, weatherPolicy)
    val position = remember(now, location) { solarPosition(now, location) }
    val basePath = solarLandscapeArtPath(today.monthValue - 1, regionZone)
    val selection = rememberCivilLandscapePlate(basePath, weatherEffects.snowCover)
    val path = selection.path
    val plate = selection.plate
    val palette = rememberCivilLandscapePalette()
    val stars = rememberCivilNightStars()
    val point = solarLandscapePoint(position, location.latitude, plate.horizonY.toDouble(),
        palette.horizontalAmplitude.toDouble(), palette.skyTop.toDouble())
    val sunX = remember { Animatable(point.x.toFloat()) }
    val sunY = remember { Animatable(point.y.toFloat()) }
    LaunchedEffect(lifecycle, location, path, plate.horizonY, palette.horizontalAmplitude, palette.skyTop) {
        fun pointAt(instant: Instant) = solarLandscapePoint(solarPosition(instant, location),
            location.latitude, plate.horizonY.toDouble(), palette.horizontalAmplitude.toDouble(), palette.skyTop.toDouble())
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            // Re-enter at the actual instant; do not animate across a background gap or place change.
            val resumedAt = Instant.now()
            now = resumedAt
            val resumed = pointAt(resumedAt)
            sunX.snapTo(resumed.x.toFloat()); sunY.snapTo(resumed.y.toFloat())
            while (isActive) {
                val tick = Instant.now()
                now = tick
                if (ValueAnimator.areAnimatorsEnabled()) {
                    // Interpolate toward the next ephemeris sample throughout the 30-second interval.
                    val next = pointAt(tick.plusSeconds(30))
                    coroutineScope {
                        launch { sunX.animateTo(next.x.toFloat(), tween(30_000, easing = LinearEasing)) }
                        launch { sunY.animateTo(next.y.toFloat(), tween(30_000, easing = LinearEasing)) }
                    }
                } else {
                    val current = pointAt(tick)
                    sunX.snapTo(current.x.toFloat()); sunY.snapTo(current.y.toFloat())
                    delay(30_000)
                }
            }
        }
    }
    val motion = if (ValueAnimator.areAnimatorsEnabled()) tween<Float>(1200) else snap<Float>()
    val altitude by animateFloatAsState(position.altitudeDeg.toFloat(), motion, label = "civil-solar-light")
    var renderSize by remember { mutableStateOf(IntSize.Zero) }
    val terrain = rememberCivilTerrain(path, renderSize)
    val daylight = civilLight(-12f, 8f, altitude)
    val directLight = civilLight(0f, 30f, altitude) * weatherEffects.sunTransmission
    val warmth = civilLight(-12f, -2f, altitude) * (1f - civilLight(8f, 28f, altitude)) * (1f - weatherEffects.cloudCover * .7f)
    val (skyTop, skyHorizon) = palette.sky(altitude)
    val brightness = (palette.nightBrightness + (palette.dayBrightness - palette.nightBrightness) * daylight) *
        (1f - weatherEffects.groundDimming * daylight)
    val saturation = palette.nightSaturation + (palette.daySaturation - palette.nightSaturation) * daylight
    val terrainFilter = remember(brightness, saturation) {
        val inverse = 1f - saturation
        val red = inverse * .213f; val green = inverse * .715f; val blue = inverse * .072f
        ColorFilter.colorMatrix(ColorMatrix(floatArrayOf(
            (red + saturation) * brightness, green * brightness, blue * brightness, 0f, 0f,
            red * brightness, (green + saturation) * brightness, blue * brightness, 0f, 0f,
            red * brightness, green * brightness, (blue + saturation) * brightness, 0f, 0f,
            0f, 0f, 0f, 1f, 0f)))
    }
    Box(Modifier.fillMaxWidth().clip(AffairsLayout.shape).onSizeChanged { renderSize = it }
        .testTag("civil-today-hero")) {
        Canvas(Modifier.matchParentSize().testTag("civil-today-sky")) {
            drawRect(Brush.verticalGradient(listOf(skyTop, skyHorizon),
                startY = 0f, endY = size.height * plate.horizonY))
            val night = (1f - civilLight(-18f, -6f, altitude)) * (1f - weatherEffects.cloudCover)
            if (night > 0f) {
                val scale = maxOf(size.width / 1600f, size.height / 720f)
                val left = (size.width - 1600f * scale) / 2f
                stars.forEach { star ->
                    val center = Offset(left + star.x * scale, star.y * scale)
                    val horizonFade = 1f - civilLight(.25f, plate.horizonY, center.y / size.height)
                    val opacity = star.opacity * night * horizonFade
                    if (opacity > 0f && center.x in 0f..size.width && center.y in 0f..size.height) {
                        if (star.radius > 1.7f) drawCircle(star.color.copy(alpha = opacity * .08f), star.radius * scale * 3f, center)
                        drawCircle(star.color.copy(alpha = opacity), star.radius * scale, center)
                    }
                }
            }
            if (position.sunVisible) {
                // Projection coordinates belong to this viewport; cover cropping affects terrain only.
                val center = Offset(sunX.value * size.width, sunY.value * size.height)
                val radius = minOf(size.width, size.height) * .037f
                val glowRadius = radius * 4.5f
                drawCircle(Brush.radialGradient(listOf(Color(0x66ffe3ac), Color.Transparent),
                    center = center, radius = glowRadius), glowRadius, center, alpha = weatherEffects.sunTransmission)
                drawCircle(civilColorMix(Color(0xffffbd73), Color(0xfffff3c9), civilLight(0f, 22f, altitude)), radius, center,
                    alpha = weatherEffects.sunTransmission)
                drawCircle(Color(0xfffff7dc), radius * .68f, center, alpha = weatherEffects.sunTransmission)
            }
        }
        CivilWeatherOverlay(weatherEffects, weatherPolicy, plate.horizonY, daylight, Modifier.matchParentSize(), skyOnly = true)
        terrain?.let { bitmap ->
            // SrcAtop confines directional relighting to terrain alpha; the sky stays independent.
            Box(Modifier.matchParentSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithCache {
                    val lightSource = Offset(sunX.value * size.width, sunY.value * size.height)
                    val light = civilColorMix(Color.White, Color(0xffffd7a0), warmth)
                        .copy(alpha = directLight * palette.directionalLight)
                    val relight = Brush.linearGradient(listOf(light, Color.Transparent),
                        start = lightSource, end = Offset(size.width - lightSource.x, size.height))
                    val side = (sunX.value - .5f) / palette.horizontalAmplitude
                    val shade = Brush.horizontalGradient(listOf(
                        Color(0xff081226).copy(alpha = maxOf(0f, side) * directLight * palette.directionalShade),
                        Color.Transparent,
                        Color(0xff081226).copy(alpha = maxOf(0f, -side) * directLight * palette.directionalShade)))
                    onDrawWithContent {
                        drawContent()
                        drawRect(relight, blendMode = BlendMode.SrcAtop)
                        drawRect(shade, blendMode = BlendMode.SrcAtop)
                    }
                }.testTag("civil-today-terrain")) {
                Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize(),
                    alignment = BiasAlignment(0f, plate.horizonY * 2f - 1f),
                    contentScale = ContentScale.Crop, colorFilter = terrainFilter)
            }
        }
        CivilWeatherOverlay(weatherEffects, weatherPolicy, plate.horizonY, daylight, Modifier.matchParentSize())
        Column(Modifier.fillMaxWidth()) {
            androidx.compose.material3.Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape,
                color = Color.Transparent,
                contentColor = if (altitude < 0f) Color(0xfff9f2e2) else Color(0xff102b2c)) {
                Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val ink = LocalContentColor.current
                    CivilTodayWeather(weather, clockNow, onChooseCity, solar = {
                        SunriseSunsetLine(today, location, calendar, accent = ink, textColor = ink, preserveInk = true)
                        val source = location.placeName?.takeIf(String::isNotBlank)
                            ?: location.timeZoneId ?: calendar.zoneId.id
                        Text((if (location.approximate) "≈ " else "") + source,
                            style = MaterialTheme.typography.labelSmall, color = ink,
                            translate = false, adjustInk = false)
                        if (location.approximate && location.timeZoneId == null) Text(
                            "Приблизительный расчёт по часовому поясу устройства",
                            style = MaterialTheme.typography.labelSmall, color = ink, adjustInk = false)
                    }) {
                        Text(today.format(DateTimeFormatter.ofPattern("EEEE", locale)).replaceFirstChar { it.titlecase(locale) },
                            style = MaterialTheme.typography.headlineSmall, color = ink, adjustInk = false,
                            translate = false)
                        Text(today.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)),
                            Modifier.testTag("today-civil-date"), style = MaterialTheme.typography.bodyMedium,
                            color = ink, adjustInk = false, translate = false)
                        Text(clockNow.atZone(calendar.zoneId).format(DateTimeFormatter.ofPattern(
                            if (use24Hour) "HH:mm:ss" else "h:mm:ss a", locale)),
                            Modifier.testTag("today-civil-clock"), style = MaterialTheme.typography.titleLarge,
                            color = ink, adjustInk = false, translate = false)
                    }
                }
            }
        }
    }
}
