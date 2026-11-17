package ru.genesis.calendar.auth

/** Narrow consumer discount routes; no access to the private cash partner program. */
internal fun allowedReferralRoute(method: String, path: String): Boolean =
    method == "GET" && path in setOf("/referrals/me", "/referrals/invitation") ||
    method == "POST" && path in setOf("/referrals/code", "/referrals/redeem", "/referrals/invitation")
