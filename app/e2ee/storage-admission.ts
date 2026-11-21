import {snapshotE2eeValue} from './commands.ts';
import {exactKeys} from './keys.ts';
import {UnlockedWebDevice} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';

/** Provider-wide capacity only. No content validation, EOF, trust or authority. */
export type E2eeProviderUsage=Readonly<{records:number;keyRecords:number;usageBytes:number;quotaBytes:number}>;
export type E2eeStorageBudget=Readonly<{maximumRecords:number;maximumKeyRecords:number;maximumUsageBytes:number;safetyBytes:number}>;
export type E2eeStorageGrowth=Readonly<{records:number;keyRecords:number;writeBytes:number;rewriteBytes:number}>;
const MAX=Number.MAX_SAFE_INTEGER;
function integer(value:unknown,minimum=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<minimum)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');}
function add(...values:number[]){let sum=0;for(const value of values){integer(value);if(value>MAX-sum)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');sum+=value;}return sum;}

/** Conservative write headroom, not a physical allocation promise. A concurrent
 * writer can still exhaust quota; the existing storage transaction must refuse
 * atomically and retain every previously accepted record. */
export function admitE2eeStorage(usageInput:E2eeProviderUsage,growthInput:E2eeStorageGrowth,budgetInput:E2eeStorageBudget):Readonly<{records:number;keyRecords:number;peakBytes:number}>{
 const usage=snapshotE2eeValue(usageInput),growth=snapshotE2eeValue(growthInput),budget=snapshotE2eeValue(budgetInput);
 exactKeys(usage,['records','keyRecords','usageBytes','quotaBytes']);exactKeys(growth,['records','keyRecords','writeBytes','rewriteBytes']);
 exactKeys(budget,['maximumRecords','maximumKeyRecords','maximumUsageBytes','safetyBytes']);
 for(const value of Object.values(usage))integer(value);for(const value of Object.values(growth))integer(value);for(const value of Object.values(budget))integer(value,1);
 if(budget.maximumRecords>10000||budget.maximumKeyRecords>1000)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');
 const records=add(usage.records,growth.records),keyRecords=add(usage.keyRecords,growth.keyRecords);
 const peakBytes=add(usage.usageBytes,growth.writeBytes,growth.rewriteBytes,budget.safetyBytes);
 if(records>budget.maximumRecords||keyRecords>budget.maximumKeyRecords||peakBytes>budget.maximumUsageBytes||peakBytes>usage.quotaBytes)throw new Error('E2EE_STORAGE_CAPACITY');
 return Object.freeze({records,keyRecords,peakBytes});
}

/** Actual IDB provider counts both stores in one readonly transaction. Browser
 * quota usage covers the entire origin, including caches and other contexts.
 * No ciphertext is decrypted or accumulated for this capacity measurement. */
export async function measureE2eeDeviceStorage(device:UnlockedWebDevice,assertCurrent:()=>void,
 estimate:()=>Promise<StorageEstimate>=()=>navigator.storage.estimate()):Promise<E2eeProviderUsage>{
 if(!(device instanceof UnlockedWebDevice))throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');
 const vault=device.vault,provider=vault.storage;
 const current=()=>{assertCurrent();if(device.vault!==vault||vault.storage!==provider||!(provider instanceof IndexedDbE2eeStorage))throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');device.requireOpen();vault.assertUnlocked();};
 current();if(!(provider instanceof IndexedDbE2eeStorage))throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');const counts=await provider.providerCounts();current();
 let measured:StorageEstimate;
 try{measured=snapshotE2eeValue(await estimate());}catch{current();throw new Error('E2EE_STORAGE_USAGE_UNAVAILABLE');}
 current();const usageBytes=measured.usage,quotaBytes=measured.quota;
 if(typeof usageBytes!=='number'||typeof quotaBytes!=='number'||!Number.isSafeInteger(usageBytes)||!Number.isSafeInteger(quotaBytes)||usageBytes<0||quotaBytes<0)throw new Error('E2EE_STORAGE_USAGE_UNAVAILABLE');
 return Object.freeze({records:counts.records,keyRecords:counts.keyRecords,usageBytes,quotaBytes});
}
