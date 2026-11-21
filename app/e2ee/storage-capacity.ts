import {snapshotE2eeValue} from './commands.ts';
import {exactKeys} from './keys.ts';

/** Numbers grant capacity only, never content, EOF, identity or recovery authority. */
export type E2eeProviderUsage=Readonly<{records:number;keyRecords:number;usageBytes:number;quotaBytes:number}>;
export type E2eeStorageBudget=Readonly<{maximumRecords:number;maximumKeyRecords:number;maximumUsageBytes:number;safetyBytes:number}>;
export type E2eeStorageGrowth=Readonly<{records:number;keyRecords:number;writeBytes:number;rewriteBytes:number}>;
const MAX=Number.MAX_SAFE_INTEGER;
function integer(value:unknown,minimum=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<minimum)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');}
function add(...values:number[]){let sum=0;for(const value of values){integer(value);if(value>MAX-sum)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');sum+=value;}return sum;}

/** No arbitrary new byte cap: producers retain their existing content limits.
 * Physical quota, all provider counts and a one-MiB reserve apply to every write. */
export const E2EE_PROVIDER_STORAGE_BUDGET:E2eeStorageBudget=Object.freeze({maximumRecords:10000,maximumKeyRecords:1000,maximumUsageBytes:MAX,safetyBytes:1024*1024});

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

/** Sizes come from the actual serialized ciphertext rows, including their keys.
 * Two prospective copies, old-row rewrite and page metadata are conservative
 * headroom, not an assertion about an engine's exact physical allocation. */
export function e2eeStorageWriteGrowth(source:readonly Readonly<{nextBytes:number|null;previousBytes:number|null}>[]){
 const rows=snapshotE2eeValue(source);if(!Array.isArray(rows)||rows.length<1||rows.length>10000)throw new Error('E2EE_STORAGE_ADMISSION_INVALID');
 let added=0,removed=0,writeBytes=0,rewriteBytes=0;
 for(const row of rows){
  exactKeys(row,['nextBytes','previousBytes']);if(row.nextBytes!==null)integer(row.nextBytes,1);if(row.previousBytes!==null)integer(row.previousBytes,1);
  if(row.previousBytes===null&&row.nextBytes!==null)added++;if(row.previousBytes!==null&&row.nextBytes===null)removed++;
  writeBytes=add(writeBytes,row.nextBytes??0,row.nextBytes??0,8192);rewriteBytes=add(rewriteBytes,row.previousBytes??0,8192);
 }
 return Object.freeze({added,removed,writeBytes,rewriteBytes});
}
