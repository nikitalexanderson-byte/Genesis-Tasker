package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedProjectQuotaTest {
    @Test fun serverOwnerPoolControlsRootGrowthAndUnknownLegacyMetadataDefersToServer() {
        assertTrue(sharedRootProjectSlotAvailable(null))
        assertTrue(sharedRootProjectSlotAvailable(JSONObject()))
        assertTrue(sharedRootProjectSlotAvailable(JSONObject().put("ownerId", "inviter").put("remaining", 1)))
        assertFalse(sharedRootProjectSlotAvailable(JSONObject().put("ownerId", "inviter").put("remaining", 0)))
        assertFalse(sharedRootProjectSlotAvailable(JSONObject().put("remaining", -5)))
    }
}
