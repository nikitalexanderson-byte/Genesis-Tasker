package ru.genesis.calendar.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BoostyDonationDestinationTest {
    @Test fun onlyTheVerifiedDonationPathCanOpenWithoutPrivateAccountData() {
        val url="https://boosty.to/genesiscalendar/donate"
        assertEquals(url,boostyDonationUrl(url))
        for(value in listOf("http://boosty.to/genesiscalendar/donate","https://boosty.to.evil.invalid/genesiscalendar/donate",
            "https://user@boosty.to/genesiscalendar/donate","$url?email=private@example.invalid","$url#token",
            "https://boosty.to/app/offer/user","https://boosty.to/../donate"))
            assertTrue(runCatching{boostyDonationUrl(value)}.isFailure)
    }
}
