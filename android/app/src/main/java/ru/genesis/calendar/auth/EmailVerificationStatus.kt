package ru.genesis.calendar.auth

import org.json.JSONObject

data class EmailVerificationStatus(val required: Boolean = false, val confirmed: Boolean = false,
    val hasRequest: Boolean = false, val retryAfter: Int = 0, val reminderDue: Boolean = true,
    val dismissedUntil: String? = null, val deadlineAt: String? = null) {
    init { require(retryAfter in 0..60 && !(required && confirmed)) }
    fun toJson(): JSONObject = JSONObject().put("required",required).put("confirmed",confirmed)
        .put("hasRequest",hasRequest).put("retryAfter",retryAfter).put("reminderDue",reminderDue)
        .put("dismissedUntil",dismissedUntil?:JSONObject.NULL).put("deadlineAt",deadlineAt?:JSONObject.NULL)
    companion object {
        fun fromJson(value: JSONObject?): EmailVerificationStatus {
            if(value==null)return EmailVerificationStatus()
            require(listOf("required","confirmed","hasRequest").all { value.get(it) is Boolean })
            require(value.get("retryAfter") is Int)
            return EmailVerificationStatus(value.getBoolean("required"),value.getBoolean("confirmed"),
                value.getBoolean("hasRequest"),value.getInt("retryAfter"),value.optBoolean("reminderDue",true),
                value.optString("dismissedUntil").takeUnless{it.isBlank()||it=="null"},value.optString("deadlineAt").takeUnless{it.isBlank()||it=="null"})
        }
    }
}
