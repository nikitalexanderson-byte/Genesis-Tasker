package ru.genesis.calendar.auth

/** Platform HTTP entity bytes before UTF8/JSON, not TLS/compressed packets.
 * Implementations must durably acknowledge production originals; a memory
 * fixture is only a lifecycle/ordering proof and grants no custody. */
internal interface E2eeHttpBodyObservation {
    class Response(val path: String, val status: Int, val contentType: String?, val contentLength: String?) {
        override fun toString() = "E2eeHttpBodyObservation.Response([redacted])"
    }
    fun begin(response: Response)
    /** Bounded borrowed copy, wiped on return; cannot mutate parser input. */
    fun append(bytes: ByteArray)
    fun finish()
    /** Idempotent live revocation only. Never delete a durable partial attempt. */
    fun close()
}
internal interface E2eeHttpObservation : E2eeHttpBodyObservation {
    class Request(val path: String, val method: String, val body: String?) {
        override fun toString() = "E2eeHttpObservation.Request([redacted])"
    }
    /** Against the exact immutable transmitted snapshot BEFORE connection. */
    fun prepare(request: Request)
}
