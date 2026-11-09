package ru.genesis.calendar.ui

import android.app.TimePickerDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace

internal val LocalEveningTheme = staticCompositionLocalOf { false }
internal val LocalDarkPalette = staticCompositionLocalOf { "green" }
internal val LocalPreserveCalendarColors = staticCompositionLocalOf { false }

internal data class AppearanceSettings(val mode: String = "scheduled", val lightAt: String = "07:00",
    val darkAt: String = "21:00") {
    fun isEvening(time: LocalTime, systemDark: Boolean): Boolean = when (mode) {
        "evening" -> true
        "system" -> systemDark
        "scheduled" -> {
            val light = LocalTime.parse(lightAt)
            val dark = LocalTime.parse(darkAt)
            if (dark < light) time >= dark && time < light else time >= dark || time < light
        }
        else -> false
    }
    fun json() = JSONObject().put("mode", mode).put("lightAt", lightAt).put("darkAt", darkAt)
    companion object {
        fun read(raw: String, accountTheme: String? = null): AppearanceSettings {
            val value = runCatching { JSONObject(raw).optJSONObject("nativeAppearance") }.getOrNull()
            fun time(key: String, fallback: String) = value?.optString(key)?.takeIf {
                it.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) } ?: fallback
            val light = time("lightAt", "07:00")
            val dark = time("darkAt", "21:00").takeUnless { it == light } ?: if (light == "21:00") "22:00" else "21:00"
            val savedMode = value?.optString("mode")?.takeIf { it in setOf("light", "evening", "system", "scheduled") }
            val accountMode = when (accountTheme) {
                "standart", "experimental" -> "light"
                "standart-dark", "experimental-dark" -> "evening"
                else -> null
            }
            return AppearanceSettings(if (savedMode in setOf("system", "scheduled")) savedMode!!
                else accountMode ?: savedMode ?: "scheduled", light, dark)
        }
    }
}

internal val evening = darkColorScheme(
    primary = Color(0xffe4c78c), onPrimary = Color(0xff12241c),
    primaryContainer = Color(0xff294435), onPrimaryContainer = Color(0xfff0eee7),
    secondary = Color(0xffacc7af), onSecondary = Color(0xff12241c),
    secondaryContainer = Color(0xff253e30), onSecondaryContainer = Color(0xffe1e8dc),
    background = Color(0xff0b1511), onBackground = Color(0xfff0eee7),
    surface = Color(0xff12241c), onSurface = Color(0xfff0eee7), onSurfaceVariant = Color(0xffafbeb2),
    surfaceVariant = Color(0xff20362b), surfaceContainerLowest = Color(0xff06130f),
    surfaceContainerLow = Color(0xff0e1c16), surfaceContainer = Color(0xff12241c),
    surfaceContainerHigh = Color(0xff193127), surfaceContainerHighest = Color(0xff203d30),
    outline = Color(0xff83988a), outlineVariant = Color(0xff344c3e),
    error = Color(0xffefb1a6), onError = Color(0xff33201d),
    errorContainer = Color(0xff4c3430), onErrorContainer = Color(0xfff4d4ce))

/** Shared Material roles follow the selected palette; custom surfaces keep their own tint. */
internal fun eveningPalette(palette: String): ColorScheme {
    val colors = when (palette) {
        "burgundy" -> listOf(0xff170a0e,0xff200f15,0xff2b151d,0xff3b1d29,0xff0e0508,0xff250e19,0xfff9edf0,0xffd0b1bc,0xfff2b4be,0xffe8a2b4,0xff704453)
        "blue" -> listOf(0xff080f1f,0xff0c182a,0xff13233a,0xff1b304d,0xff040a17,0xff0a1b34,0xffedf3fc,0xffb1c1da,0xffa8ceff,0xffa5c9ea,0xff456184)
        "violet" -> listOf(0xff10091b,0xff180f27,0xff241735,0xff322145,0xff090411,0xff1b0d2c,0xfff4edfc,0xffc5b5d6,0xffd8bbf5,0xffc4b0e3,0xff66517e)
        else -> return evening
    }.map { Color(it) }
    return evening.copy(background=colors[0], surface=colors[2], surfaceVariant=colors[3],
        surfaceContainerLowest=colors[4], surfaceContainerLow=colors[1], surfaceContainer=colors[2],
        surfaceContainerHigh=colors[3], surfaceContainerHighest=colors[3],
        onBackground=colors[6], onSurface=colors[6], onSurfaceVariant=colors[7],
        primary=colors[8], onPrimary=colors[4], primaryContainer=colors[3], onPrimaryContainer=colors[6],
        secondary=colors[9], onSecondary=colors[4], secondaryContainer=colors[5], onSecondaryContainer=colors[6],
        tertiary=colors[9], onTertiary=colors[4], tertiaryContainer=colors[5], onTertiaryContainer=colors[6],
        inverseSurface=colors[6], inverseOnSurface=colors[2], inversePrimary=colors[3], surfaceTint=colors[8],
        outline=colors[7], outlineVariant=colors[10])
}

/** Daylight companions share the account's palette, with dark ink and softly tinted surfaces. */
internal fun daylightPalette(palette: String): ColorScheme {
    val colors = when (palette) {
        "burgundy" -> listOf(0xfff4e9ec,0xfffff9fb,0xfff8eff3,0xffefdee5,0xffe8d4dd,0xff35212a,0xff735560,0xff8b344f,0xffedd1db,0xff532135,0xff89364f,0xfff0dce3,0xff5b273d,0xff8b6c78,0xffc7aab5)
        "blue" -> listOf(0xffe9eff7,0xfff9fbff,0xfff0f5fc,0xffe0e9f5,0xffd4e0ef,0xff182b43,0xff50657e,0xff2d5889,0xffc7d9ee,0xff193c63,0xff385c88,0xffdbe6f4,0xff244365,0xff6b7f98,0xffa9bdd5)
        "violet" -> listOf(0xffefeaf5,0xfffcf9ff,0xfff5effa,0xffe8dff1,0xffdfd3eb,0xff30223e,0xff6b577e,0xff6a4684,0xffdeceec,0xff402955,0xff70518b,0xffe9dff2,0xff4c345f,0xff81708e,0xffbcabca)
        else -> return standart
    }.map { Color(it) }
    return standart.copy(background=colors[0], surface=colors[1], surfaceContainerLowest=colors[1],
        surfaceContainerLow=colors[2], surfaceContainer=colors[2], surfaceContainerHigh=colors[3],
        surfaceContainerHighest=colors[4], surfaceVariant=colors[3],
        onBackground=colors[5], onSurface=colors[5], onSurfaceVariant=colors[6],
        primary=colors[7], onPrimary=colors[1], primaryContainer=colors[8], onPrimaryContainer=colors[9],
        secondary=colors[10], onSecondary=colors[1], secondaryContainer=colors[11], onSecondaryContainer=colors[12],
        tertiary=colors[10], onTertiary=colors[1], tertiaryContainer=colors[11], onTertiaryContainer=colors[12],
        outline=colors[13], outlineVariant=colors[14], surfaceTint=colors[7],
        inverseSurface=colors[5], inverseOnSurface=colors[1], inversePrimary=colors[8])
}

@Composable internal fun rememberEveningTheme(settings: AppearanceSettings): Boolean {
    val deviceDark = isSystemInDarkTheme()
    val time by produceState(LocalTime.now()) {
        while (true) { value = LocalTime.now(); delay(15_000) }
    }
    return settings.isEvening(time, deviceDark)
}

/** Retain warm/cool distinctions while tinting legacy surfaces toward the active palette. */
internal fun stoicheionDarkReversedColor(palette: String): Color = when (palette) {
    "burgundy" -> Color(0xff3a0b18)
    "blue" -> Color(0xff662b35)
    "violet" -> Color(0xff682d3f)
    else -> Color(0xff38201f)
}

internal fun eveningSurfaceTone(color: Color, base: Color = evening.surface,
    preserveDarkSurfaces: Boolean = true): Color {
    if (color == Color.Unspecified || color.alpha < .4f) return color
    val luminance = color.luminance()
    if (preserveDarkSurfaces && luminance < .035f) return color
    val amount = if (luminance > .5f) .10f else .20f
    return Color(base.red * (1 - amount) + color.red * amount,
        base.green * (1 - amount) + color.green * amount,
        base.blue * (1 - amount) + color.blue * amount, color.alpha)
}

@Composable internal fun eveningSurface(color: Color): Color {
    if (LocalPreserveCalendarColors.current || color == Color.Unspecified || color.alpha < .4f) return color
    val scheme = MaterialTheme.colorScheme
    if (!LocalEveningTheme.current) {
        if (setOf(scheme.background,scheme.surface,scheme.surfaceVariant,scheme.surfaceContainerLowest,
            scheme.surfaceContainerLow,scheme.surfaceContainer,scheme.surfaceContainerHigh,scheme.surfaceContainerHighest,
            scheme.primary,scheme.primaryContainer,scheme.secondary,scheme.secondaryContainer,scheme.tertiary,
            scheme.tertiaryContainer,scheme.error,scheme.errorContainer,scheme.inverseSurface)
            .any { it.copy(alpha=1f)==color.copy(alpha=1f) }) return color
        val tone=when {color.luminance()<.10f->scheme.primaryContainer
            color.luminance()<.45f->scheme.secondaryContainer
            else->scheme.surfaceContainerLow}
        return tone.copy(alpha=color.alpha)
    }
    val selection = genesisSelectionColors(scheme, true)
    return if (color in setOf(scheme.background, scheme.surface, scheme.surfaceContainerLowest,
        scheme.surfaceContainerLow, scheme.surfaceContainer, scheme.surfaceContainerHigh,
        scheme.surfaceContainerHighest, scheme.primaryContainer, scheme.secondaryContainer,
        scheme.errorContainer, scheme.primary, scheme.secondary, selection.container, selection.disabledContainer,
        stoicheionDarkReversedColor(LocalDarkPalette.current))) color else eveningSurfaceTone(color, scheme.surface,
            preserveDarkSurfaces = LocalDarkPalette.current == "green")
}

@Composable internal fun eveningInk(color: Color): Color {
    if (LocalPreserveCalendarColors.current || color == Color.Unspecified) return color
    val scheme = MaterialTheme.colorScheme
    if (!LocalEveningTheme.current && color.luminance() > .45f && LocalContentColor.current.luminance() < .45f)
        return scheme.onSurfaceVariant.copy(alpha=color.alpha)
    if (setOf(scheme.onPrimary, scheme.onSecondary, scheme.onSurface, scheme.onBackground,
        scheme.onSurfaceVariant, scheme.onPrimaryContainer, scheme.onSecondaryContainer,
        scheme.onTertiary, scheme.onTertiaryContainer, scheme.tertiary,
        scheme.primary, scheme.secondary, scheme.error, scheme.onError, scheme.onErrorContainer)
        .any { it.copy(alpha = 1f) == color.copy(alpha = 1f) }) return color
    if (!LocalEveningTheme.current) {
        val ink=if(color.red>color.blue*1.2f&&color.green>color.blue*1.1f) scheme.primary
            else if(color.luminance()>.45f) scheme.onSurfaceVariant else scheme.onSurface
        return ink.copy(alpha=color.alpha)
    }
    if (color.luminance() > .45f) return Color(color.red * .80f, color.green * .80f, color.blue * .80f, color.alpha)
    val tint = scheme.onSurfaceVariant
    return Color(tint.red * .8f + color.red * .2f, tint.green * .8f + color.green * .2f,
        tint.blue * .8f + color.blue * .2f, color.alpha)
}

/** Resolve foreground together with a remapped surface, retaining solid accent buttons. */
@Composable internal fun paletteSurfaceInk(background: Color, original: Color): Color {
    val ink=eveningInk(original)
    if (LocalEveningTheme.current || LocalPreserveCalendarColors.current || ink==Color.Unspecified) return ink
    val rendered=background.compositeOver(MaterialTheme.colorScheme.surface)
    val contrast=(maxOf(rendered.luminance(),ink.luminance())+.05f)/(minOf(rendered.luminance(),ink.luminance())+.05f)
    return if(contrast>=4.5f) ink else (if(rendered.luminance()>.179f) MaterialTheme.colorScheme.onSurface
        else MaterialTheme.colorScheme.onPrimary).copy(alpha=original.alpha)
}

@Composable internal fun AppearancePanel(app: GenesisApplication, workspace: LocalHabitWorkspace,
    use24: Boolean, accountTheme: String? = null, onManualTheme: (String) -> Unit = {},
    darkPalette: String = "green", onPalette: (String) -> Unit = {},
    extra: @Composable ColumnScope.() -> Unit = {}) {
    val appearance = AppearanceSettings.read(workspace.settings.rawJson, accountTheme)
    val scope = rememberCoroutineScope()
    val repository = remember(app, app.workspaceScope) { HabitsRepository(app) }
    val context = LocalContext.current
    val paletteLanguage = LocalGenesisLanguage.current
    val paletteCopy = remember(context, paletteLanguage) { context.assets.open("originals/i18n/dark-palette-copy.json")
        .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()).getJSONObject(paletteLanguage) } }
    val timeDialogTheme = if(LocalEveningTheme.current) android.R.style.Theme_DeviceDefault_Dialog else
        android.R.style.Theme_DeviceDefault_Light_Dialog
    val dialogFrame = genesisNativeDialogFrame()
    var error by remember { mutableStateOf<String?>(null) }
    fun save(next: AppearanceSettings) {
        scope.launch {
            runCatching { repository.updateAppearance(next.json()) }
                .onSuccess {
                    error = null
                    if (next.mode in setOf("light", "evening"))
                        onManualTheme(if (next.mode == "evening") "standart-dark" else "standart")
                }.onFailure { error = "Не удалось сохранить тему. Повторите попытку." }
        }
    }
    fun chooseTime(light: Boolean) {
        val current = LocalTime.parse(if (light) appearance.lightAt else appearance.darkAt)
        TimePickerDialog(context, timeDialogTheme, { _, hour, minute ->
            val value = "%02d:%02d".format(hour, minute)
            val next = if (light) appearance.copy(lightAt = value) else appearance.copy(darkAt = value)
            if (next.lightAt == next.darkAt) error = "Выберите разное время для светлой и тёмной схемы."
            else save(next)
        }, current.hour, current.minute, use24).also { it.show(); dialogFrame(it) }
    }
    Column(Modifier.fillMaxWidth().testTag("appearance-settings"),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SettingsPreferenceCard("Цветовая схема", Modifier.testTag("appearance-color-settings"),
                description = paletteCopy.getString("description")) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).selectableGroup(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("light" to "Светлая", "evening" to "Тёмная", "system" to "Устройство").forEach { (mode, label) ->
                    val chosen = appearance.mode == mode
                    OutlinedButton(onClick = { save(appearance.copy(mode = mode)) },
                        modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp)
                            .testTag("appearance-$mode").semantics { selected = chosen },
                        shape = AffairsLayout.controlShape,
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 10.dp),
                        selected = chosen, colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (chosen) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                            contentColor = if (chosen) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface),
                        border = BorderStroke(1.dp, if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) {
                        Text(label, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center, maxLines = 1)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Менять по времени устройства", Modifier.weight(1f).padding(top = 12.dp))
                Switch(appearance.mode == "scheduled", { save(appearance.copy(mode = if (it) "scheduled" else "light")) },
                    modifier = Modifier.testTag("appearance-scheduled"))
            }
            if (appearance.mode == "scheduled") {
                OutlinedButton({ chooseTime(true) }, Modifier.fillMaxWidth().testTag("appearance-light-time")) {
                    Text("Светлая схема с ${timeLabel(appearance.lightAt, use24)}") }
                OutlinedButton({ chooseTime(false) }, Modifier.fillMaxWidth().testTag("appearance-dark-time")) {
                    Text("Тёмная схема с ${timeLabel(appearance.darkAt, use24)}") }
                Text("Используются часы и часовой пояс смартфона.", style = MaterialTheme.typography.bodySmall)
            }
            run {
                val copy = paletteCopy
                val permitted = LocalFeatureAccess.current.allows("dark-palettes")
                val effective = darkPalette.takeIf { permitted } ?: "green"
                var expanded by remember { mutableStateOf(false) }
                Text(copy.getString("label"), style=MaterialTheme.typography.labelLarge)
                Box {
                    OutlinedButton({ expanded=true }, Modifier.fillMaxWidth().testTag("appearance-palette")) {
                        Text(copy.getString(if(effective=="blue"&&!LocalEveningTheme.current) "blueLight" else effective), Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
                    }
                    DropdownMenu(expanded, { expanded=false }) {
                        listOf("green","burgundy","blue","violet").forEach { palette ->
                            DropdownMenuItem(text={ Text(copy.getString(if(palette=="blue"&&!LocalEveningTheme.current) "blueLight" else palette)) }, enabled=palette=="green" || permitted,
                                onClick={ expanded=false; onPalette(palette) })
                        }
                    }
                }
                if (!permitted) Text(copy.getString("premium"), style=MaterialTheme.typography.bodySmall)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
            extra()
    }
}
