package ru.genesis.calendar.security

/** Provider-wide capacity only. No content, original EOF, device trust,
 * identity, membership or recovery authority is granted by these numbers. */
internal object E2eeStorageAdmission {
    class Usage(val records:Long,val keyRecords:Long,val usageBytes:Long,val quotaBytes:Long) {
        override fun toString()="E2eeStorageAdmission.Usage([redacted])"
    }
    class Budget(val maximumRecords:Long,val maximumKeyRecords:Long,val maximumUsageBytes:Long,val safetyBytes:Long)
    class Growth(val records:Long,val keyRecords:Long,val writeBytes:Long,val rewriteBytes:Long)
    class Admission(val records:Long,val keyRecords:Long,val peakBytes:Long)
    private const val MAX=9007199254740991L
    private fun valid(value:Long,minimum:Long=0){check(value in minimum..MAX){"E2EE_STORAGE_ADMISSION_INVALID"}}
    internal fun add(vararg values:Long):Long {
        var result=0L
        for(value in values){valid(value);check(value<=MAX-result){"E2EE_STORAGE_ADMISSION_INVALID"};result+=value}
        return result
    }
    /** Headroom is conservative, not an allocation guarantee. Concurrent
     * writers can exhaust quota; existing atomic storage refuses without
     * replacing previously accepted data. */
    fun admit(usage:Usage,growth:Growth,budget:Budget):Admission {
        listOf(usage.records,usage.keyRecords,usage.usageBytes,usage.quotaBytes,growth.records,growth.keyRecords,growth.writeBytes,growth.rewriteBytes).forEach{valid(it)}
        listOf(budget.maximumRecords,budget.maximumKeyRecords,budget.maximumUsageBytes,budget.safetyBytes).forEach{valid(it,1)}
        check(budget.maximumRecords<=10000&&budget.maximumKeyRecords<=1000){"E2EE_STORAGE_ADMISSION_INVALID"}
        val records=add(usage.records,growth.records);val keys=add(usage.keyRecords,growth.keyRecords)
        val peak=add(usage.usageBytes,growth.writeBytes,growth.rewriteBytes,budget.safetyBytes)
        check(records<=budget.maximumRecords&&keys<=budget.maximumKeyRecords&&peak<=budget.maximumUsageBytes&&peak<=usage.quotaBytes){"E2EE_STORAGE_CAPACITY"}
        return Admission(records,keys,peak)
    }
    /** Actual SQLite/owned encrypted-key-file provider. No alternate memory
     * store or arbitrary scope capability can impersonate the provider. */
    fun measure(device:UnlockedE2eeDevice,assertCurrent:()->Unit):Usage {
        assertCurrent();device.requireOpen();val usage=device.vault.providerUsage();assertCurrent();device.requireOpen();return usage
    }
}
