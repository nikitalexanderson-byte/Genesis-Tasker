package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class NativeActivityVisitTest {
    @Test fun onlyAResumedActivityHasOneStableOpaqueVisit() {
        NativeActivityVisit.onPause()
        assertEquals(mapOf("X-Genesis-Foreground" to "0"), NativeActivityVisit.headers())
        try {
            NativeActivityVisit.onResume()
            val first = NativeActivityVisit.headers()
            assertEquals("1", first["X-Genesis-Foreground"])
            assertEquals(first["X-Genesis-Visit"], UUID.fromString(first["X-Genesis-Visit"]).toString())
            assertEquals(first, NativeActivityVisit.headers())
            NativeActivityVisit.onPause()
            assertEquals(mapOf("X-Genesis-Foreground" to "0"), NativeActivityVisit.headers())
            NativeActivityVisit.onResume()
            assertNotEquals(first["X-Genesis-Visit"], NativeActivityVisit.headers()["X-Genesis-Visit"])
        } finally { NativeActivityVisit.onPause() }
    }

    @Test fun backgroundWorkCannotReuseAVisibleActivityVisitAcrossDispatchers() = runBlocking {
        NativeActivityVisit.onResume()
        try {
            val foreground = NativeActivityVisit.headers()
            withContext(Dispatchers.Default + NativeActivityVisit.requestContext(true)) {
                assertEquals(mapOf("X-Genesis-Foreground" to "0"), NativeActivityVisit.headers())
                withContext(Dispatchers.IO) {
                    assertEquals(mapOf("X-Genesis-Foreground" to "0"), NativeActivityVisit.headers())
                }
            }
            assertEquals(foreground, NativeActivityVisit.headers())
        } finally { NativeActivityVisit.onPause() }
    }
}
