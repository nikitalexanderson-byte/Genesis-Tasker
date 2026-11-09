package ru.genesis.calendar.auth

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.*
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun allowedBillingRoute(method:String,path:String):Boolean = when {
    path.matches(Regex("/billing/modeling/catalog\\?client=(android|android-play)")) -> method == "GET"
    path == "/billing/modeling/orders" -> method == "POST"
    path.matches(Regex("/billing/modeling/(?:orders|results)/[a-f0-9-]{36}")) -> method == "GET"
    path.matches(Regex("/billing/modeling/orders/[a-f0-9-]{36}/verify")) -> method == "POST"
    method=="GET" -> path.matches(Regex("/billing/catalog\\?client=(android|android-play)")) || path.matches(Regex("/billing/orders/[a-f0-9-]{36}")) ||
        path.matches(Regex("/billing/quote\\?offerId=(?:standart|premium|business|premium4life)(?::|%3[Aa])(?:0|1|12)&client=(android|android-play)(?:&provider=(?:google-play|yookassa|lemon-squeezy))?"))
    method=="POST" -> path in setOf("/billing/orders","/billing/trial","/billing/restore","/billing/play-testing/challenge","/billing/play-testing/claim") || path.matches(Regex("/billing/orders/[a-f0-9-]{36}/verify"))
    else -> false
}

private suspend fun <T> Task<T>.awaitPlay():T=suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { if(continuation.isActive)continuation.resume(it) }
    addOnFailureListener { if(continuation.isActive)continuation.resumeWithException(it) }
    addOnCanceledListener { continuation.cancel() }
}

/** A store label, local preference or installer name never grants an entitlement. */
internal suspend fun claimPlayTestingAccess(context:Context,controller:AuthController):Boolean {
    if(!BuildConfig.PLAY_DISTRIBUTION)return false
    val challenge=controller.billing("POST","/billing/play-testing/challenge",JSONObject().put("versionCode",BuildConfig.VERSION_CODE))
    val manager=IntegrityManagerFactory.createStandard(context.applicationContext)
    val provider=manager.prepareIntegrityToken(StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
        .setCloudProjectNumber(challenge.getLong("cloudProjectNumber")).build()).awaitPlay()
    val token=provider.request(StandardIntegrityManager.StandardIntegrityTokenRequest.builder().setRequestHash(challenge.getString("requestHash")).build()).awaitPlay()
    val result=controller.billing("POST","/billing/play-testing/claim",JSONObject().put("challengeId",challenge.getString("id")).put("integrityToken",token.token()))
    return result.optString("plan")=="premium4life"
}

/** Play owns the purchase UI. Only server verification can unlock the account. */
internal class GenesisPlayBilling(context:Context,private val controller:AuthController,private val scope:CoroutineScope,
    private val changed:()->Unit,private val failed:()->Unit):AutoCloseable {
    private val client=BillingClient.newBuilder(context.applicationContext)
        .setListener { result,purchases ->
            if(result.responseCode==BillingClient.BillingResponseCode.OK) purchases.orEmpty().forEach { purchase ->
                if(purchase.purchaseState==Purchase.PurchaseState.PURCHASED) scope.launch { verify(purchase) }
            } else if(result.responseCode!=BillingClient.BillingResponseCode.USER_CANCELED) failed()
        }.enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()).enableAutoServiceReconnection().build()
    private suspend fun connect() {
        if(client.isReady)return
        suspendCancellableCoroutine<Unit> { continuation -> client.startConnection(object:BillingClientStateListener {
            override fun onBillingSetupFinished(result:BillingResult) {if(continuation.isActive) {
                if(result.responseCode==BillingClient.BillingResponseCode.OK)continuation.resume(Unit) else continuation.resumeWithException(IllegalStateException("BILLING_NOT_AVAILABLE"))
            }}
            override fun onBillingServiceDisconnected() { if(continuation.isActive)continuation.resumeWithException(IllegalStateException("BILLING_NOT_AVAILABLE")) }
        }) }
    }
    private suspend fun verify(purchase:Purchase) {
        try {
            val profile=purchase.accountIdentifiers?.obfuscatedProfileId ?: throw IllegalStateException("BILLING_ACCOUNT_REQUIRED")
            controller.billing("POST","/billing/restore",JSONObject().put("profileHash",profile).put("purchaseToken",purchase.purchaseToken))
            changed()
        } catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){failed()}
    }
    suspend fun restore() {
        connect()
        val purchases=suspendCancellableCoroutine<List<Purchase>> { continuation -> client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result,purchases ->
            if(continuation.isActive)if(result.responseCode==BillingClient.BillingResponseCode.OK)continuation.resume(purchases) else continuation.resumeWithException(IllegalStateException("BILLING_NOT_AVAILABLE"))
        } }
        for(purchase in purchases)if(purchase.purchaseState==Purchase.PurchaseState.PURCHASED)verify(purchase)
    }
    suspend fun purchase(activity:Activity,order:JSONObject) {
        connect()
        val details=suspendCancellableCoroutine<ProductDetails> { continuation -> client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(QueryProductDetailsParams.Product.newBuilder().setProductId(order.getString("productId")).setProductType(BillingClient.ProductType.INAPP).build())).build()) { result,products ->
            if(continuation.isActive) {val found=products.productDetailsList.firstOrNull();if(result.responseCode==BillingClient.BillingResponseCode.OK&&found!=null)continuation.resume(found) else continuation.resumeWithException(IllegalStateException("BILLING_PRODUCT_UNAVAILABLE"))}
        } }
        val offer=details.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: throw IllegalStateException("BILLING_PRODUCT_UNAVAILABLE")
        val offerToken=requireNotNull(offer.offerToken){"BILLING_PRODUCT_UNAVAILABLE"}
        val params=BillingFlowParams.newBuilder().setObfuscatedAccountId(order.getString("obfuscatedAccountId")).setObfuscatedProfileId(order.getString("obfuscatedProfileId"))
            .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).setOfferToken(offerToken).build())).build()
        check(client.launchBillingFlow(activity,params).responseCode==BillingClient.BillingResponseCode.OK){"BILLING_NOT_AVAILABLE"}
    }
    override fun close(){client.endConnection()}
}
