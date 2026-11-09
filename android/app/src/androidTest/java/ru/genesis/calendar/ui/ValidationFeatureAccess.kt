package ru.genesis.calendar.ui

import ru.genesis.calendar.auth.FeatureAccess
import java.time.Instant

/** Explicit synthetic paid entitlement for portable-data UI fixtures; never used by the app. */
internal fun validationDataExchangeAccess() = FeatureAccess(enforcementEnabled = true,
    declaredPlan = "standart", effectivePlan = "standart", validUntil = Instant.parse("2100-01-01T00:00:00Z"),
    policyRevision = "synthetic-data-exchange-fixture", allowedFeatures = setOf("data-export"))
