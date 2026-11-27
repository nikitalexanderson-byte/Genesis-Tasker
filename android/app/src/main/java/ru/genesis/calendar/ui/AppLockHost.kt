package ru.genesis.calendar.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import java.util.UUID

internal val LocalAppLockHost = staticCompositionLocalOf<AppLockHost?> { null }

internal enum class AppLockAction { ENABLE, DISABLE, UNLOCK }

/** A successful screen unlock belongs to this activity instance. Only the opt-in survives a cold start. */
internal class AppLockHost(private val activity: ComponentActivity, saved: Bundle?) {
    private val settings = activity.getSharedPreferences("genesis.app-lock", Context.MODE_PRIVATE)
    var enabled by mutableStateOf(settings.getBoolean("enabled", false))
        private set
    var canMountWorkspace by mutableStateOf(!enabled)
        private set
    var saveFailed by mutableStateOf(false)
        private set
    private var unlocked = !enabled
    private var requestId: String? = saved?.getString("appLock.request")
    private var action = saved?.getString("appLock.action")?.let { value ->
        AppLockAction.entries.find { it.name == value }
    }
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val requested = action
        val accepted = result.resultCode == Activity.RESULT_OK && requestId != null &&
            result.data?.getStringExtra("request") == requestId && deviceScreenLockAvailable(activity)
        action = null
        requestId = null
        if (accepted && requested != null) {
            if (requested != AppLockAction.UNLOCK) {
                val next = requested == AppLockAction.ENABLE
                val previous = enabled
                saveFailed = !settings.edit().putBoolean("enabled", next).commit()
                if (saveFailed) settings.edit().putBoolean("enabled", previous).commit()
                enabled = if (saveFailed) previous else next
            }
            unlocked = true
            canMountWorkspace = true
        }
        protectWindow()
    }

    init { protectWindow() }

    private fun protectWindow() {
        if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        // Android requires a visible activity window for onResume to complete. Conceal its
        // content while the opaque authentication activity is above it, retaining editor state.
        activity.findViewById<View>(android.R.id.content)?.visibility =
            if (enabled && !unlocked) View.INVISIBLE else View.VISIBLE
    }

    fun onResume() {
        val stored = settings.getBoolean("enabled", false)
        if (stored != enabled) {
            enabled = stored
            unlocked = !stored
            if (!stored) canMountWorkspace = true
        }
        protectWindow()
        if (enabled && !unlocked && action == null) request(AppLockAction.UNLOCK)
    }

    fun onStop() {
        if (enabled && !activity.isChangingConfigurations) {
            unlocked = false
            protectWindow()
        }
    }

    fun saveState(out: Bundle) {
        out.putString("appLock.request", requestId)
        out.putString("appLock.action", action?.name)
    }

    fun changeSetting(language: String, dark: Boolean) {
        if (action != null) return
        settings.edit().putString("language", language).putBoolean("dark", dark).apply()
        request(if (enabled) AppLockAction.DISABLE else AppLockAction.ENABLE)
    }

    fun lockNow() {
        if (!enabled || action != null) return
        unlocked = false
        protectWindow()
        request(AppLockAction.UNLOCK)
    }

    fun updateAppearance(language: String, dark: Boolean) {
        if (enabled && (settings.getString("language", null) != language || settings.getBoolean("dark", !dark) != dark))
            settings.edit().putString("language", language).putBoolean("dark", dark).apply()
    }

    private fun request(next: AppLockAction) {
        saveFailed = false
        val nonce = UUID.randomUUID().toString()
        requestId = nonce
        action = next
        val intent = Intent(activity, AppLockActivity::class.java)
            .putExtra("action", next.name).putExtra("request", nonce)
            .putExtra("language", settings.getString("language", null))
        if (settings.contains("dark")) intent.putExtra("dark", settings.getBoolean("dark", false))
        launcher.launch(intent)
    }
}
