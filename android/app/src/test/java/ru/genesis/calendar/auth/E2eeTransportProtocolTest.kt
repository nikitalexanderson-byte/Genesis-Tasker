package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class E2eeTransportProtocolTest {
    @Test fun onlyExplicitSessionBoundProtocolRoutesAreAllowed() {
        assertTrue(allowedAuthSessionRoute("GET", "/e2ee/v1/status"))
        for (path in listOf("bootstrap", "command", "read", "directory", "challenge", "source")) {
            assertTrue(allowedAuthSessionRoute("POST", "/e2ee/v1/$path"))
            assertFalse(allowedAuthSessionRoute("GET", "/e2ee/v1/$path"))
        }
        for (path in listOf("/e2ee/v1/raw-key", "/e2ee/v1/command?rawKey=bad", "/e2ee/v1/../workspace/key", "https://example.invalid/e2ee/v1/command"))
            assertFalse(allowedAuthSessionRoute("POST", path))
        assertFalse(allowedAuthSessionRoute("POST", "/e2ee/v1/status"))
    }
    @Test fun migrationAndCorruptionCodesSurviveTransportWithoutExposingServerDetails() {
        for (status in listOf(400, 401, 403, 404, 409, 422, 503))
            assertEquals("E2EE_MIGRATION_FENCED", E2eeTransportProtocol.errorCode(status, JSONObject().put("error", "E2EE_MIGRATION_FENCED")))
        for (code in listOf("SQL error with private details", "E2EE_BAD\nSECRET", "e2ee_invalid"))
            assertNull(E2eeTransportProtocol.errorCode(409, JSONObject().put("error", code)))
        assertNull(E2eeTransportProtocol.errorCode(200, JSONObject().put("error", "E2EE_BAD")))
    }
}
