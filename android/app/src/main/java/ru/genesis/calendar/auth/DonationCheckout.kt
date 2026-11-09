package ru.genesis.calendar.auth

import java.net.URI
import org.json.JSONObject

internal const val publicDonationUrl = "https://pay.cloudtips.ru/p/4d58d20a"

/** The only account information allowed outside GENESIS is the server's opaque invoice UUID. */
internal fun donationCheckoutUrl(response: JSONObject): String {
    val value = response.getString("url")
    val uri = URI(value)
    require(uri.scheme == "https" && uri.host == "pay.cloudtips.ru" && uri.rawAuthority == "pay.cloudtips.ru")
    require(uri.userInfo == null && uri.port == -1 && uri.rawFragment == null)
    require(uri.rawPath.matches(Regex("/p/[A-Za-z0-9-]{8,100}")))
    if (response.getBoolean("tracked")) {
        require(uri.rawQuery?.matches(Regex("invoiceid=[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) == true)
    } else require(uri.rawQuery == null)
    return value
}
