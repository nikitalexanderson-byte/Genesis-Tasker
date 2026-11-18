package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.ui.AuroraWebOrigin

class AuroraProtocolTest {
    @Test fun independentRoutesAreNarrowAndPartOfTheActualTransportGuard() {
        for(method in listOf("GET","PUT")) {
            assertTrue(AuroraProtocol.allowedRoute(method,"/aurora-workspace"))
            assertTrue(allowedAuthSessionRoute(method,"/aurora-workspace"))
        }
        assertTrue(allowedAuthSessionRoute("POST","/aurora-results"))
        for(path in listOf("/aurora-workspace/other","/aurora-results/other","/workspace","/admin/users"))
            assertFalse(AuroraProtocol.allowedRoute("PUT",path))
        assertFalse(AuroraProtocol.allowedRoute("DELETE","/aurora-workspace"))
        assertFalse(AuroraProtocol.allowedBilling("GET","/billing/catalog?client=android"))
        assertTrue(AuroraProtocol.allowedBilling("GET","/billing/modeling/catalog?client=android"))
        assertFalse(AuroraProtocol.allowedBilling("GET","/billing/modeling/catalog?client=web"))
    }
    @Test fun aadAndCacheCannotAccessOtherPersonalDocumentsOrOwners() {
        assertTrue(AuroraProtocol.allowedScope("aurora-workspace:v1"))
        assertFalse(AuroraProtocol.allowedScope("map:other"))
        assertEquals("aurora-pending",AuroraProtocol.cacheKind("owner","genesis-aurora-workspace-v1:owner:pending"))
        val suffix="pending:writer:91a29251-bf3e-48df-9ba2-8dbfe162ea91:12:pending"
        assertEquals("aurora-$suffix",AuroraProtocol.cacheKind("owner","genesis-aurora-workspace-v1:owner:$suffix"))
        assertEquals("genesis-aurora-workspace-v1:owner:$suffix",AuroraProtocol.cacheKey("owner","aurora-$suffix"))
        assertNull(AuroraProtocol.cacheKey("owner","aurora-account-key"))
        for(invalid in listOf("pending:writer:other:1:pending",suffix.replace(":12:",":0:"),suffix.replace(":12:",":9007199254740992:"),"pending:../key"))
            assertThrows(IllegalArgumentException::class.java){AuroraProtocol.cacheKind("owner","genesis-aurora-workspace-v1:owner:$invalid")}
        for(key in listOf("genesis-aurora-workspace-v1:another:pending","genesis-aurora-workspace-v1:owner:../config","auth-token"))
            assertThrows(IllegalArgumentException::class.java){AuroraProtocol.cacheKind("owner",key)}
    }
    @Test fun onlyBundledAssetsAreReadableAndCheckoutNeverNavigatesThePrivilegedView() {
        assertEquals("aurora/index.html",AuroraWebOrigin.assetPath(AuroraWebOrigin.ENTRY))
        assertEquals("originals/stoicheion-cards/alpha.webp",AuroraWebOrigin.assetPath("https://appassets.androidplatform.net/stoicheion-cards/alpha.webp"))
        for(url in listOf("file:///etc/passwd","https://evil.invalid/aurora/index.html","https://appassets.androidplatform.net/aurora/../config.php","https://appassets.androidplatform.net/aurora/%2e%2e/config.php","https://appassets.androidplatform.net@evil.invalid/aurora/index.html"))assertNull(AuroraWebOrigin.assetPath(url))
        assertTrue(AuroraWebOrigin.checkout("https://yoomoney.ru/checkout/payments/v2/contract"))
        for(url in listOf("javascript:alert(1)","http://yoomoney.ru/pay","https://yoomoney.ru.evil.invalid/pay","https://user@yoomoney.ru/pay","https://yoomoney.ru:444/pay"))assertFalse(AuroraWebOrigin.checkout(url))
    }
}
