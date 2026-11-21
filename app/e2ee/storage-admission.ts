import {snapshotE2eeValue} from './commands.ts';
import {UnlockedWebDevice} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';
import type {E2eeProviderUsage} from './storage-capacity.ts';
export {admitE2eeStorage,type E2eeProviderUsage,type E2eeStorageBudget,type E2eeStorageGrowth} from './storage-capacity.ts';

/** Provider-wide capacity only. No content validation, EOF, trust or authority. */
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
