package ru.genesis.calendar.ui

import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import org.junit.Assert.*
import org.junit.Test

class PlayUpdateAvailabilityTest {
    @Test fun noStoreUpdateCannotLockAnOlderPlayClient() {
        assertFalse(shouldOfferPlayUpdate(UpdateAvailability.UPDATE_NOT_AVAILABLE,InstallStatus.UNKNOWN,true))
        assertFalse(shouldOfferPlayUpdate(UpdateAvailability.UPDATE_AVAILABLE,InstallStatus.UNKNOWN,false))
        assertTrue(shouldOfferPlayUpdate(UpdateAvailability.UPDATE_AVAILABLE,InstallStatus.UNKNOWN,true))
        assertTrue(shouldOfferPlayUpdate(UpdateAvailability.UPDATE_NOT_AVAILABLE,InstallStatus.DOWNLOADED,false))
    }
    @Test fun releaseAheadOfPlayDoesNotRequireAlreadyPublishedPlay76ToUpdate() {
        val body="""{"versionCode":80,"versionName":"2.8.0","minimumSupportedVersionCode":76,"sha256":"${"a".repeat(64)}"}"""
        assertFalse(newerAndroidRelease(body,76)!!.required)
        assertTrue(newerAndroidRelease(body,75)!!.required)
    }
}
