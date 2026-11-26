import type {UnlockedWebDevice} from './device-vault.ts';
import type {UnlockedE2eeVault} from './storage.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {PERSONAL_DEVICE_ENTRY_ID,validatePersonalDeviceEntryMarker} from './personal-device-entry.ts';
import {validatePrivateTransferJournal} from './shared-private-transfer.ts';
import {validatePrivateBulkJournal} from './shared-private-bulk.ts';
import {validatePrivateBulkRecovery} from './shared-bulk-recovery.ts';
import {inspectPrivateSharedWorkDraft} from './shared-work-private-journal.ts';
import {validatePersonalRestoreJournal} from './personal-content-restore.ts';
import {validateDomainRestoreJournal} from './domain-content-restore.ts';
import {validateSharedRestoreJournal} from './shared-content-restore.ts';
import {validateRecipientRequest,validateRecipientResponse} from './invitation-recipient.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {exactKeys} from './keys.ts';
import {E2EE_CHUNK_BYTES} from './files.ts';
import {validateRetainedProfileOriginal,retainedProfilePreferenceHistory} from './user-cache-retention.ts';
import {NATIVE_UI_PREFERENCES_ID,validateNativeUiPreferences} from './native-ui-preferences.ts';
import {LEGACY_STORAGE_INDEX,LEGACY_STORAGE_ORIGINAL_PREFIX,validateLegacyStorageIndex,validateLegacyStorageOriginal,legacyStorageOriginalId} from './legacy-storage-retirement.ts';

/** Read-only typed retention. No marker/receipt is imported as enrollment,
 * membership, retry, restored device keys or an executable archive command. */
export async function inspectDeviceControlCustody(options:{device:Pick<UnlockedWebDevice,'ownerId'|'authorityPin'>;vault:Pick<UnlockedE2eeVault,'read'|'listLocal'>;personalScopeId:string|null;current:()=>void;claim:(domain:E2eeContext['domain'],id:string,scopeId:string,role:string)=>void}){
 const {device,vault,current,claim}=options,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 async function document<T>(id:string,validate:(value:unknown)=>T,scope:(value:T)=>string){
  const ids=new Set<string>(),reader={read:async(domain:E2eeContext['domain'],objectId:string)=>{const value=await vault.read(domain,objectId);current();if(value)ids.add(objectId);return value;}};
  const opened=await new E2eeDeviceDocument(null,id,validate,current,reader).load();current();if(!opened)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
  const scopeId=scope(opened.value),row=await vault.read('draft',id);current();if(!row||row.serial!==opened.serial)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
  try{const descriptor=parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_PRIVATE_DOCUMENT_CORRUPT',4*1024*1024) as Record<string,unknown>;
   if(descriptor.format==='genesis-device-document-v1'){
    exactKeys(descriptor,['format','size','hash','slots']);const prefix='device-doc:'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(id))));current();
    const slots=descriptor.slots as number[];for(let part=Math.ceil(Number(descriptor.size)/E2EE_CHUNK_BYTES);part<slots.length;part++){
     const objectId=prefix+':'+part,retained=await vault.read('draft',objectId);current();try{if(!retained||retained.serial!==slots[part]||retained.value.length<1||retained.value.length>E2EE_CHUNK_BYTES)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');ids.add(objectId);}finally{retained?.value.fill(0);}
    }
   }
  }finally{row.value.fill(0);}
  for(const objectId of ids)claim('draft',objectId,scopeId,'device-control-history');return opened.value;
 }
 const ui=await vault.listLocal('draft',NATIVE_UI_PREFERENCES_ID);current();if(ui.some(id=>id!==NATIVE_UI_PREFERENCES_ID))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 if(ui.length){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await document(NATIVE_UI_PREFERENCES_ID,value=>validateNativeUiPreferences(value,device.ownerId),()=>options.personalScopeId!);}
 const markers=await vault.listLocal('draft',PERSONAL_DEVICE_ENTRY_ID);current();if(markers.some(id=>id!==PERSONAL_DEVICE_ENTRY_ID))throw new Error('E2EE_DEVICE_ACCESS_INVALID');
 const retiredIndexes=await vault.listLocal('draft',LEGACY_STORAGE_INDEX);current();if(retiredIndexes.some(id=>id!==LEGACY_STORAGE_INDEX))throw new Error('E2EE_LEGACY_STORAGE_CORRUPT');
 const retiredOriginals=new Set(await vault.listLocal('draft',LEGACY_STORAGE_ORIGINAL_PREFIX));current();
 if(retiredIndexes.length||retiredOriginals.size){
  if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(retiredOriginals.size>10000)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
  if(retiredIndexes.length){const index=await document(LEGACY_STORAGE_INDEX,value=>validateLegacyStorageIndex(value,device.ownerId),()=>options.personalScopeId!);
   for(const row of index.entries)for(const id of row.originals)if(!retiredOriginals.has(id))throw new Error('E2EE_LEGACY_STORAGE_CORRUPT');
  }
  for(const id of retiredOriginals){const original=await document(id,value=>validateLegacyStorageOriginal(value,device.ownerId),()=>options.personalScopeId!);
   if(await legacyStorageOriginalId(original)!==id)throw new Error('E2EE_LEGACY_STORAGE_CORRUPT');current();
  }
 }
 for(const id of await vault.listLocal('draft','profile-original:')){
  current();if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const original=await document(id,value=>validateRetainedProfileOriginal(value,device.ownerId),()=>options.personalScopeId!);
  await retainedProfilePreferenceHistory(id,original,device.ownerId);current();
 }
 if(markers.length)await document(PERSONAL_DEVICE_ENTRY_ID,value=>validatePersonalDeviceEntryMarker(value,device.ownerId),marker=>{
  if(!same(marker.target.authority,device.authorityPin)||options.personalScopeId!==null&&marker.target.scopeId!==options.personalScopeId)throw new Error('E2EE_AUTHORITY_CHANGED');return marker.target.scopeId;
 });
 for(const prefix of ['shared-work-private:','shared-work-history:']){const ids=await vault.listLocal('draft',prefix);current();if(ids.length>10000)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');for(const id of ids){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await document(id,input=>{const value=inspectPrivateSharedWorkDraft(input,device.ownerId),base=prefix+value.projectId+':'+value.purpose+':'+value.id;if(prefix==='shared-work-private:'?id!==base:!id.startsWith(base+':')||!/^[1-9][0-9]*$/.test(id.slice(base.length+1)))throw new Error('E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED');return value;},()=>options.personalScopeId!);}}
 for(const prefix of ['shared-bulk-private:','shared-bulk-recovery:','shared-bulk-recovery-history:']){const ids=await vault.listLocal('draft',prefix);current();for(const id of ids){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await document(id,value=>{if(prefix==='shared-bulk-private:'){const parsed=validatePrivateBulkJournal(value,device.ownerId);if(id!==prefix+parsed.id)throw new Error('E2EE_PRIVATE_BULK_INVALID');return parsed;}if(prefix==='shared-bulk-recovery:'?id!==prefix+'v1':!/^[1-9][0-9]*$/.test(id.slice(prefix.length)))throw new Error('E2EE_PRIVATE_BULK_INVALID');return validatePrivateBulkRecovery(value,device.ownerId);},()=>options.personalScopeId!);}}
 for(const id of await vault.listLocal('draft','shared-transfer-private:')){current();if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await document(id,value=>{const parsed=validatePrivateTransferJournal(value,device.ownerId);if(id!=='shared-transfer-private:'+parsed.input.requestId)throw new Error('E2EE_TRANSFER_INVALID');return parsed;},()=>options.personalScopeId!);}
 const restores=await vault.listLocal('draft','personal-content-restore:');current();for(const id of restores){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('personal-content-restore:'.length);await document(id,value=>validatePersonalRestoreJournal(value,device.ownerId,intentId),()=>options.personalScopeId!);}
 for(const id of await vault.listLocal('draft','shared-content-restore:')){current();if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('shared-content-restore:'.length);await document(id,value=>validateSharedRestoreJournal(value,device.ownerId,intentId),()=>options.personalScopeId!);}
 for(const id of await vault.listLocal('draft','domain-content-restore:')){current();if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('domain-content-restore:'.length);await document(id,value=>validateDomainRestoreJournal(value,device.ownerId,intentId),()=>options.personalScopeId!);}
 const requests=await vault.listLocal('draft','invitation-recipient:');current();
 for(const id of requests){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('invitation-recipient:'.length);
  await document(id,input=>{const value=validateRecipientRequest(input,device.ownerId,intentId);if(value.result!==null){exactKeys(value.result,['intentId','response','pendingApproval']);const response=validateRecipientResponse(value.result.response,value.id);if(value.result.intentId!==intentId||value.result.pendingApproval!==value.accept||response.state!==(value.accept?'pending':'declined'))throw new Error('E2EE_INVITATION_RESPONSE_INVALID');}return value;},()=>options.personalScopeId!);
 }
}
