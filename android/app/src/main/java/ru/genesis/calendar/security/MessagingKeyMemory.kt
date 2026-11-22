package ru.genesis.calendar.security

import kotlinx.coroutines.CancellationException

/** One repository lifetime. Retirement is permanent: a late crypto/network
 * continuation cannot repopulate its keys or publish decrypted rows after lock.
 * Java private-key objects are released, not promised to be physically erased. */
internal class MessagingKeyMemory{
    private val monitor=Any()
    @Volatile var retired=false
        private set
    private var heldIdentity:MessagingIdentity?=null;private var heldKey:ByteArray?=null
    fun check(){if(retired)throw CancellationException("E2EE_MESSAGE_CUSTODY_RETIRED")}
    var identity:MessagingIdentity?
        get()=synchronized(monitor){check();heldIdentity}
        set(value){synchronized(monitor){check();heldIdentity=value}}
    var key:ByteArray?
        get()=synchronized(monitor){check();heldKey}
        set(value){synchronized(monitor){
            if(retired){value?.fill(0);throw CancellationException("E2EE_MESSAGE_CUSTODY_RETIRED")}
            if(heldKey!==value)heldKey?.fill(0);heldKey=value
        }}
    fun publish(action:()->Unit)=synchronized(monitor){check();action()}
    fun retire(){synchronized(monitor){retired=true;heldKey?.fill(0);heldKey=null;heldIdentity=null}}
    override fun toString()="MessagingKeyMemory([redacted])"
}
