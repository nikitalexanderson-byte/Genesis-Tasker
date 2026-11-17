package ru.genesis.calendar.auth

/** Narrow consumer discount routes; no access to the private cash partner program. */
internal fun allowedReferralRoute(method: String, path: String): Boolean =
    method == "GET" && path in setOf("/referrals/me", "/referrals/invitation") ||
    method == "POST" && path in setOf("/referrals/code", "/referrals/redeem", "/referrals/invitation")

internal fun referralAccessError(status: Int, code: String): AuthApiError? = when {
    status == 403 && code in setOf("REFERRAL_PRIMARY_GOOGLE_REQUIRED", "REFERRAL_STANDARD_REQUIRED") -> AuthApiError(code)
    status == 409 && code == "REFERRAL_PRIVATE_PARTNER_PROGRAM" -> AuthApiError(code)
    else -> null
}

internal fun referralErrorKey(error: Exception): String = when ((error as? AuthApiError)?.code) {
    "REFERRAL_PRIMARY_GOOGLE_REQUIRED" -> "primaryRequired"
    "REFERRAL_STANDARD_REQUIRED" -> "standardRequired"
    "REFERRAL_PRIVATE_PARTNER_PROGRAM" -> "privateProgram"
    else -> "error"
}
