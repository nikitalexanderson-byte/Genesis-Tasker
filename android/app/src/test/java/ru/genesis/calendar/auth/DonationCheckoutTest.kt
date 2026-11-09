package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DonationCheckoutTest {
    private val invoice = "12345678-1234-4123-8123-123456789abc"
    private fun response(url: String, tracked: Boolean = true) = JSONObject().put("url", url).put("tracked", tracked)

    @Test fun permitsOnlyTheServerInvoiceOrTheExplicitUnconfiguredPublicPage() {
        val tracked = "$publicDonationUrl?invoiceid=$invoice"
        assertEquals(tracked, donationCheckoutUrl(response(tracked)))
        assertEquals(publicDonationUrl, donationCheckoutUrl(response(publicDonationUrl, false)))
    }

    @Test fun rejectsRedirectsCredentialsPortsFragmentsAndAccountIdentifiers() {
        for (url in listOf(
            "http://pay.cloudtips.ru/p/4d58d20a?invoiceid=$invoice",
            "https://pay.cloudtips.ru.example.com/p/4d58d20a?invoiceid=$invoice",
            "https://user@pay.cloudtips.ru/p/4d58d20a?invoiceid=$invoice",
            "https://pay.cloudtips.ru:443/p/4d58d20a?invoiceid=$invoice",
            "$publicDonationUrl?invoiceid=$invoice#fragment",
            "$publicDonationUrl/other?invoiceid=$invoice",
            "$publicDonationUrl?invoiceid=$invoice&email=private@example.com",
            "$publicDonationUrl?email=private@example.com",
            "$publicDonationUrl?invoiceid=account-identifier",
            "$publicDonationUrl?invoiceid=$invoice&invoiceid=$invoice",
        )) assertTrue("Rejected external checkout URL", runCatching { donationCheckoutUrl(response(url)) }.isFailure)
        assertTrue(runCatching { donationCheckoutUrl(response(publicDonationUrl)) }.isFailure)
        assertTrue(runCatching { donationCheckoutUrl(response("$publicDonationUrl?invoiceid=$invoice", false)) }.isFailure)
    }
}
