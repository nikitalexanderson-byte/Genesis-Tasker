package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import ru.genesis.calendar.BuildConfig
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Initialized before workers, repositories or activity content. No account session is needed. */
internal object UpdateGate {
    private val mutable = MutableStateFlow(false)
    val blocked = mutable.asStateFlow()
    private var preferences: android.content.SharedPreferences? = null
    private var candidate: Pair<UpdatePolicy, String>? = null
    private var floor: UpdatePolicy? = null
    private var sequence = 0L
    private val channel get() = if (BuildConfig.PLAY_DISTRIBUTION) "play" else "site"
    @Synchronized fun initialize(context: Context) {
        if (preferences != null) return
        val store = context.getSharedPreferences("genesis.security.update-policy.v1", Context.MODE_PRIVATE)
        preferences = store
        // Corrupt persisted activation fails closed. It must not enable old writers after a crash.
        val activated = store.getString("activated", null)
        floor = activated?.let { runCatching { UpdatePolicy.verify(it, channel) }.getOrNull() }
        mutable.value = activated != null && (floor == null || updateFloorBlocked(floor, BuildConfig.VERSION_CODE, UpdatePolicy.CRYPTO_PROTOCOL))
        store.getString("candidate", null)?.let { raw ->
            runCatching { UpdatePolicy.verify(raw, channel) }.getOrNull()?.let { candidate = it to raw; sequence = it.sequence }
        }
        sequence = maxOf(sequence, floor?.sequence ?: 0)
    }
    fun requireOpen() {
        if (mutable.value) throw kotlinx.coroutines.CancellationException("SECURITY_UPDATE_REQUIRED")
    }
    fun minimumVersion(): Int = synchronized(this) { floor?.minimumVersion ?: candidate?.first?.minimumVersion ?: Int.MAX_VALUE }
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL("https://genesiscalendar.com/android-security-policy.json").openConnection() as HttpsURLConnection
            val raw = try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10000; connection.readTimeout = 10000; connection.useCaches = false
                connection.setRequestProperty("Cache-Control", "no-cache, no-store")
                check(connection.responseCode == 200)
                connection.inputStream.use { input ->
                    val bytes = ByteArray(8193); var size = 0
                    while (size < bytes.size) { val read = input.read(bytes,size,bytes.size-size); if (read < 0) break; size += read }
                    require(size <= 8192); String(bytes,0,size,Charsets.UTF_8)
                }
            } finally { connection.disconnect() }
            val policy = UpdatePolicy.verify(raw,channel)
            synchronized(this@UpdateGate) {
                val now = System.currentTimeMillis()/1000
                require(policy.sequence >= sequence && now in policy.issuedAt..policy.expiresAt)
                if (policy.sequence == sequence) require(candidate?.second == raw || preferences?.getString("activated",null) == raw)
                check(requireNotNull(preferences).edit().putString("candidate",raw).commit())
                candidate = policy to raw; sequence = policy.sequence
            }
        }.isSuccess
    }
    /** Called only with Play AppUpdateInfo or the current HTTPS site manifest, never the policy's assertion. */
    @Synchronized fun observeAvailable(version: Int) {
        val (policy, raw) = candidate ?: return
        if (!policy.mayActivate(System.currentTimeMillis()/1000,version,BuildConfig.VERSION_CODE,UpdatePolicy.CRYPTO_PROTOCOL)) return
        val previous = floor
        if (previous != null && (policy.minimumVersion < previous.minimumVersion || policy.minimumCrypto < previous.minimumCrypto)) return
        // Block in memory before persistence; a failed disk write cannot expose the current process.
        mutable.value = true
        check(requireNotNull(preferences).edit().putString("activated",raw).commit())
        floor = policy
    }
}
