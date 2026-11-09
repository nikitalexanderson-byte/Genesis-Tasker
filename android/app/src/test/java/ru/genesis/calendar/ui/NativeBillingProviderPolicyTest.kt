package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeBillingProviderPolicyTest {
    @Test fun upgradeMarkHasTwelveRaysAndTheSharedWebGeometry() {
        val vertices = nativeUpgradeStarVertices()
        assertEquals(24, vertices.size)
        assertEquals(16f, vertices.first().first, .00001f)
        assertEquals(4f, vertices.first().second, .00001f)
        vertices.forEachIndexed { index, (x, y) ->
            assertEquals(if (index % 2 == 0) 12.0 else 7.0,
                Math.hypot((x - 16f).toDouble(), (y - 16f).toDouble()), .00001)
        }
    }

    @Test fun comparisonShowsIncludedAndExcludedFeaturesInEveryPlan() {
        val policy = JSONObject(java.io.File("../../server/resources/feature-access-policy.json").readText())
        val copy = JSONObject(java.io.File("../../app/billing-feature-copy.json").readText()).getJSONObject("en")
        for (plan in nativeBillingPlans) {
            val rows = nativeBillingPlanFeatureRows(policy, plan, "en", copy)
            assertEquals("calendar-sync", rows.first().feature)
            assertEquals("physis", rows.last().feature)
            assertEquals(1, rows.count { it.feature == "calendar-sync" })
            fun allowed(feature: String) = rows.single { it.feature == feature }.included
            assertTrue(allowed("calendar-sync")); assertTrue(allowed("stoicheion")); assertTrue(allowed("stoicheion-letters"))
            assertEquals(plan != "free", allowed("habit-timer"))
            assertEquals(plan != "free", allowed("stoicheion-timeline"))
            assertEquals(plan in listOf("premium","business","premium4life"), allowed("stoicheion-spread"))
            assertEquals(plan in listOf("premium","business","premium4life"), allowed("future-modeling"))
            assertEquals(plan in listOf("business","premium4life"), allowed("shared-projects"))
            assertEquals(plan == "premium4life", allowed("physis"))
            assertFalse(rows.any { it.feature in setOf("assistant","advice-settings","theokyklos-olympians") })
            assertFalse(rows.any { it.label.contains("Aurora") || it.label.contains("Aphorisms") })
        }
        assertEquals("Elite", nativePlanName("premium4life"))
        assertTrue(nativeBillingPlanFeatureRows(null, "free", "en", copy).isEmpty())
    }

    @Test fun settlementStatesNeverClaimPaymentSuccessFromARedirect() {
        assertNull(nativeBillingSettlementCopyKey(null))
        assertEquals("paymentPending",nativeBillingSettlementCopyKey(JSONObject().put("status","pending")))
        assertEquals("paymentPaid",nativeBillingSettlementCopyKey(JSONObject().put("status","paid")))
        assertEquals("settlementVerifying",nativeBillingSettlementCopyKey(JSONObject().put("status","payment-verifying")))
        assertEquals("settlementRefundPending",nativeBillingSettlementCopyKey(JSONObject("""{"status":"settlement-required","settlement":{"status":"refund-pending"}}""")))
        assertEquals("settlementFailed",nativeBillingSettlementCopyKey(JSONObject("""{"status":"settlement-required","settlement":{"status":"failed"}}""")))
        assertEquals("settlementRefunded",nativeBillingSettlementCopyKey(JSONObject("""{"status":"refunded","settlement":{"status":"refunded"}}""")))
    }
    @Test fun terminalOrdersRefreshAuthoritativeAccessAndSettlementOverridesPaidReceipts() {
        for (status in listOf("paid", "cancelled", "failed", "refunded", "unknown")) {
            assertFalse(status, nativeBillingShouldPoll(JSONObject().put("status", status)))
        }
        for (status in listOf("pending", "payment-verifying", "settlement-required")) {
            assertTrue(status, nativeBillingShouldPoll(JSONObject().put("status", status)))
        }
        for (status in listOf("verifying", "refund-required", "refund-pending", "cancelled", "failed", "refunded", "unknown")) {
            val order = JSONObject().put("status", "paid").put("settlement", JSONObject().put("status", status))
            assertNotEquals("paymentPaid", nativeBillingSettlementCopyKey(order))
            assertEquals(status, status in listOf("verifying", "refund-required", "refund-pending"), nativeBillingShouldPoll(order))
        }
    }
    @Test fun fixedUsdMatrixMatchesApiOffersAndEliteUsesOneLifetimeOfferInBothTabs() {
        val definition = JSONObject(java.io.File("../../server/resources/billing-catalog.json").readText())
        val foreign = definition.getJSONObject("foreignPricing")
        assertEquals("fixed", foreign.getString("pricingModel"))
        assertFalse(foreign.has("rate"))
        val expected = mapOf("standart" to listOf(400L,4000L), "premium" to listOf(700L,7000L), "business" to listOf(1000L,10000L))
        val rub = mapOf("standart" to listOf(33300L,333000L), "premium" to listOf(55500L,555000L), "business" to listOf(77700L,777000L))
        val offers = org.json.JSONArray()
        for ((plan, prices) in expected) for ((index, months) in listOf(1,12).withIndex()) {
            assertEquals(prices[index], foreign.getJSONObject("prices").getJSONObject(plan).getLong(months.toString()))
            assertEquals(rub.getValue(plan)[index], nativePlanListAmount(plan, months))
            offers.put(JSONObject().put("id", "$plan:$months").put("plan", plan).put("periodMonths", months)
                .put("pricesByProvider", JSONObject().put("lemon-squeezy", JSONObject().put("amountMinor", prices[index]).put("currency", "USD"))))
        }
        assertEquals(16000L, foreign.getLong("lifetimeAmountMinor"))
        offers.put(JSONObject().put("id", "premium4life:0").put("plan", "premium4life").put("periodMonths", 0)
            .put("pricesByProvider", JSONObject().put("lemon-squeezy", JSONObject().put("amountMinor", 16000L).put("currency", "USD"))))
        val api = JSONObject().put("offers", offers)
        for ((plan, prices) in expected) for ((index, months) in listOf(1,12).withIndex()) {
            assertEquals(prices[index] to "USD", nativeBillingProviderPrice(nativeBillingOffer(api, plan, months), "lemon-squeezy"))
        }
        for (months in listOf(1,12)) {
            assertEquals(16000L to "USD", nativeBillingProviderPrice(nativeBillingOffer(api, "premium4life", months), "lemon-squeezy"))
            assertEquals(1290000L, nativePlanListAmount("premium4life", months))
        }
        assertNull(nativeBillingOffer(api, "premium", 6))
    }
    @Test fun moneyUsesLocaleDecimalSeparatorsWithoutRoundingAnAuthoritativePrice() {
        assertEquals("4 USD", nativeBillingMoney(400L,"en","USD"))
        assertEquals("160 USD", nativeBillingMoney(16000L,"ru","USD"))
        assertEquals("4.13 USD", nativeBillingMoney(413L,"en","USD"))
        assertEquals("4,13 USD", nativeBillingMoney(413L,"ru","USD"))
        assertEquals("4,13 USD", nativeBillingMoney(413L,"fr","USD"))
        assertEquals("333 ₽", nativeBillingMoney(33300L,"ru","RUB"))
    }
    private fun offer() = JSONObject("""{"id":"premium:1","plan":"premium","periodMonths":1,"amountMinor":55500,"currency":"RUB","pricesByProvider":{"yookassa":{"amountMinor":55500,"currency":"RUB"},"google-play":{"amountMinor":55500,"currency":"RUB"},"lemon-squeezy":{"amountMinor":700,"currency":"USD"}}}""")
    private fun catalog(preferred: String) = JSONObject("""{"routing":{"preferredProvider":"$preferred"},"providers":[{"id":"google-play","reason":"client-unavailable"},{"id":"lemon-squeezy","reason":"not-configured"},{"id":"yookassa","reason":"not-configured"}]}""")
    @Test fun providerPricesNeverTreatRublesAsDollarsOrInventMissingForeignPrice() {
        val value = offer()
        assertEquals(55500L to "RUB", nativeBillingProviderPrice(value,"yookassa"))
        assertEquals(700L to "USD", nativeBillingProviderPrice(value,"lemon-squeezy"))
        value.getJSONObject("pricesByProvider").getJSONObject("lemon-squeezy").put("currency","RUB")
        assertNull(nativeBillingProviderPrice(value,"lemon-squeezy"))
        value.getJSONObject("pricesByProvider").remove("lemon-squeezy")
        assertNull(nativeBillingProviderPrice(value,"lemon-squeezy"))
        value.getJSONObject("pricesByProvider").getJSONObject("yookassa").put("amountMinor",555.5)
        assertNull(nativeBillingProviderPrice(value,"yookassa"))
    }
    @Test fun routingSortsEligibleChoicesAndPlayNeverShowsExternalBilling() {
        assertEquals(listOf("yookassa","lemon-squeezy"),nativeBillingProviderChoices(catalog("yookassa"),offer(),false))
        assertEquals(listOf("lemon-squeezy","yookassa"),nativeBillingProviderChoices(catalog("lemon-squeezy"),offer(),false))
        val play = catalog("lemon-squeezy"); play.getJSONArray("providers").getJSONObject(0).put("reason","not-configured")
        assertEquals(listOf("google-play"),nativeBillingProviderChoices(play,offer(),true))
    }
    @Test fun quoteAmountsAreIntegerAndPendingAuthorizationKeepsItsOriginalPrice() {
        val value = offer().put("amountMinor",700).put("currency","USD")
        fun quote() = JSONObject("""{"offerId":"premium:1","plan":"premium","periodMonths":1,"amountMinor":700,"listAmountMinor":700,"creditMinor":0,"currency":"USD","availableProviders":["lemon-squeezy"]}""")
        assertEquals("USD",NativeBillingQuote.read(quote(),value).currency)
        assertTrue(runCatching { NativeBillingQuote.read(quote().put("amountMinor",700.5),value) }.isFailure)
        assertTrue(runCatching { NativeBillingQuote.read(quote().put("creditMinor",1),value) }.isFailure)
        val pending = quote().put("pendingOrderId","synthetic-order").put("amountMinor",650).put("listAmountMinor",650)
        assertEquals(650L,NativeBillingQuote.read(pending,value).amount)
        assertTrue(runCatching { NativeBillingQuote.read(quote().put("currency","RUB"),value) }.isFailure)
    }
}
