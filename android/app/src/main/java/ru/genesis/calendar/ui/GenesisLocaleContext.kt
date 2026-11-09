package ru.genesis.calendar.ui

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration

/** Localize framework/Material resources while preserving the Activity in the wrapper chain. */
internal class GenesisLocaleContext(base: Context, configuration: Configuration) : ContextWrapper(base) {
    private val localized = base.createConfigurationContext(configuration)
    override fun getResources() = localized.resources
    override fun getAssets() = localized.assets
}
