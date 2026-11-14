package ru.genesis.calendar.ui

import android.app.Activity
import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import ru.genesis.calendar.R

internal object GenesisBrandIcon {
    val palettes = listOf("green", "blue", "burgundy", "violet")
    fun palette(value: String) = value.takeIf { it in palettes } ?: "green"
    fun alias(value: String, dark: Boolean): String = "ru.genesis.calendar.Launcher" +
        palette(value).replaceFirstChar { it.uppercase() } + if (dark) "Dark" else "Light"

    @DrawableRes fun drawable(value: String, dark: Boolean): Int = when (palette(value) to dark) {
        "blue" to false -> R.drawable.genesis_brand_blue_light
        "blue" to true -> R.drawable.genesis_brand_blue_dark
        "burgundy" to false -> R.drawable.genesis_brand_burgundy_light
        "burgundy" to true -> R.drawable.genesis_brand_burgundy_dark
        "violet" to false -> R.drawable.genesis_brand_violet_light
        "violet" to true -> R.drawable.genesis_brand_violet_dark
        "green" to true -> R.drawable.genesis_brand_green_dark
        else -> R.drawable.genesis_brand_green_light
    }

    /** MainActivity stays enabled for notifications, updates and existing explicit shortcuts. */
    fun updateLauncher(context: Context, value: String, dark: Boolean) {
        val manager = context.packageManager
        val desired = alias(value, dark)
        val names = palettes.flatMap { p -> listOf(alias(p, false), alias(p, true)) }
        // Enable first: older Android versions cannot atomically switch alias settings.
        for (name in listOf(desired) + names.filter { it != desired }) {
            val component = ComponentName(context.packageName, name)
            val state = if (name == desired) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            if (manager.getComponentEnabledSetting(component) != state)
                manager.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
        }
    }

    @Suppress("DEPRECATION")
    fun updateTask(activity: Activity, value: String, dark: Boolean) {
        val image = activity.getDrawable(drawable(value, dark)) ?: return
        val bitmap = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
        image.setBounds(0, 0, 192, 192); image.draw(Canvas(bitmap))
        activity.setTaskDescription(ActivityManager.TaskDescription(activity.getString(R.string.app_name), bitmap))
    }
}

@Composable internal fun GenesisIdentityImage(modifier: Modifier = Modifier) {
    Image(painterResource(GenesisBrandIcon.drawable(LocalDarkPalette.current, LocalEveningTheme.current)), "GENESIS", modifier)
}
