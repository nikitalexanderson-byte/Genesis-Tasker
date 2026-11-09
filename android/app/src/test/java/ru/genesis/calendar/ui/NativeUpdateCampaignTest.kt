package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeUpdateCampaignTest {
    private fun payload() = JSONObject().put("id", "release-114").put("title", "New version")
        .put("description", "Install the update").put("imageUrl", "https://genesiscalendar.com/genesis-hero.png")
        .put("linkUrl", "https://genesiscalendar.com/api/android/download").put("repeatHours", 24)

    @Test fun updatePersistsThroughAdDismissalAndDisappearsWhenInstalled() {
        val ad = NativeAd.fromJson(payload().put("kind", "android-update").put("targetVersionCode", 114))
        assertTrue(ad.canShow(113, dismissed = true, lastShown = 100_000, now = 100_001))
        assertFalse(ad.canShow(114, dismissed = false, lastShown = 0, now = 100_001))
        assertFalse(ad.canShow(115, dismissed = false, lastShown = 0, now = 100_001))
    }

    @Test fun ordinaryAdvertisementsRetainFrequencyDismissalAndTheirOwnLink() {
        val ad = NativeAd.fromJson(payload().put("targetVersionCode", 114))
        assertFalse(ad.isUpdate)
        assertTrue(ad.canShow(113, false, 0, 100_001))
        assertFalse(ad.canShow(113, true, 0, 100_001))
        assertFalse(ad.canShow(113, false, 100_000, 100_001))
        assertTrue(ad.canShow(113, false, 100_000, 100_000 + 24 * 3_600_000L))
        assertEquals(ad.linkUrl, ad.destination(true))
    }

    @Test fun playUpdatesStayInPlayAndInvalidTargetsDoNotBecomePersistent() {
        val ad = NativeAd.fromJson(payload().put("kind", "android-update").put("targetVersionCode", 114))
        assertEquals("https://play.google.com/store/apps/details?id=ru.genesis.calendar", ad.destination(true))
        assertEquals(ad.linkUrl, ad.destination(false))
        assertFalse(NativeAd.fromJson(payload().put("kind", "android-update").put("targetVersionCode", 0)).isUpdate)
    }
}
