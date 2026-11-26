package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class E2eeLegacyTransportPolicyTest {
    private fun root() = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .first { File(it,"contracts/e2ee/legacy-transport-v1.json").isFile }
    @Test fun sharedVectorsKeepPrivateContentSeparateFromIdentityBillingAndSignedMigration() {
        val root=root();val policy=E2eeLegacyTransportPolicy(JSONObject(File(root,"contracts/e2ee/legacy-transport-v1.json").readText()))
        val cases=JSONObject(File(root,"tests/fixtures/e2ee/legacy-transport-v1.json").readText()).getJSONArray("cases")
        for(index in 0 until cases.length()) {
            val row=cases.getJSONObject(index)
            assertEquals("case $index: ${row.getString("method")} ${row.getString("path")}",row.getBoolean("protected"),
                policy.protected(row.getString("method"),row.getString("path"),row.optJSONObject("body")))
        }
    }
}
