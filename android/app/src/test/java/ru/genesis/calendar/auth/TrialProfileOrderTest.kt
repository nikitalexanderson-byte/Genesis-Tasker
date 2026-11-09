package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class TrialProfileOrderTest {
    private val start = Instant.parse("2026-11-03T10:00:00Z")
    private val trial = TrialAccess("active", "premium", "Trial-Premium", start,
        start.plusSeconds(TrialAccess.DURATION_SECONDS), start, emptyList())

    @Test fun newerResponseInvalidatesOldReceiptAndRejectsLateOldProfile() {
        val order = TrialProfileOrder()
        val first = order.beginRequest(); val second = order.beginRequest()
        val old = requireNotNull(order.accept("a", first, start, trial))
        assertTrue(order.isCurrent(old))
        val paid = requireNotNull(order.accept("a", second, start, trial.copy(status = "expired")))
        assertFalse(order.isCurrent(old)); assertTrue(order.isCurrent(paid))
        assertNull(order.accept("a", first, start, trial))
    }

    @Test fun terminalWindowCannotReactivateEvenWithNewRequestNumber() {
        for (status in listOf("expired", "revoked")) {
            val order = TrialProfileOrder()
            assertNotNull(order.accept("a", order.beginRequest(), start, trial.copy(status = status)))
            assertNull(order.accept("a", order.beginRequest(), start, trial))
        }
    }

    @Test fun olderServerEvaluationIsRejectedAndDifferentAccountsAreIndependent() {
        val order = TrialProfileOrder()
        val accepted = requireNotNull(order.accept("a", order.beginRequest(), start.plusSeconds(2), trial))
        assertNull(order.accept("a", order.beginRequest(), start, trial))
        assertNull(order.accept("a", order.beginRequest(), null, null))
        val other = requireNotNull(order.accept("b", order.beginRequest(), start, trial))
        assertTrue(order.isCurrent(accepted)); assertTrue(order.isCurrent(other))
        order.invalidate()
        assertFalse(order.isCurrent(accepted)); assertFalse(order.isCurrent(other))
    }
}
