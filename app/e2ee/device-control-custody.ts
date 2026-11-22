import type {UnlockedWebDevice} from './device-vault.ts';
import type {UnlockedE2eeVault} from './storage.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {PERSONAL_DEVICE_ENTRY_ID,validatePersonalDeviceEntryMarker} from './personal-device-entry.ts';
import {inspectPrivateSharedWorkDraft} from './shared-work-private-journal.ts';
import {validatePersonalRestoreJournal} from './personal-content-restore.ts';
import {validateRecipientRequest,validateRecipientResponse} from './invitation-recipient.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {exactKeys} from './keys.ts';
import {E2EE_CHUNK_BYTES} from './files.ts';

/** Read-only typed retention. No marker/receipt is imported as enrollment,
 * membership, retry, restored device keys or an executable archive command. */
export async function inspectDeviceControlCustody(options:{device:UnlockedWebDevice;vault:Pick<UnlockedE2eeVault,'read'|'listLocal'>;personalScopeId:string|null;current:()=>void;claim:(domain:E2eeContext['domain'],id:string,scopeId:string,role:string)=>void}){
 const {device,vault,current,claim}=options,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 async function document<T>(id:string,validate:(value:unknown)=>T,scope:(value:T)=>string){
  const ids=new Set<string>(),reader={read:async(domain:E2eeContext['domain'],objectId:string)=>{const value=await vault.read(domain,objectId);current();if(value)ids.add(objectId);return value;}};
  const opened=await new E2eeDeviceDocument(device,id,validate,current,reader).load();current();if(!opened)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
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
 const markers=await vault.listLocal('draft',PERSONAL_DEVICE_ENTRY_ID);current();if(markers.some(id=>id!==PERSONAL_DEVICE_ENTRY_ID))throw new Error('E2EE_DEVICE_ACCESS_INVALID');
 if(markers.length)await document(PERSONAL_DEVICE_ENTRY_ID,value=>validatePersonalDeviceEntryMarker(value,device.ownerId),marker=>{
  if(!same(marker.target.authority,device.authorityPin)||options.personalScopeId!==null&&marker.target.scopeId!==options.personalScopeId)throw new Error('E2EE_AUTHORITY_CHANGED');return marker.target.scopeId;
 });
 for(const prefix of ['shared-work-private:','shared-work-history:']){const ids=await vault.listLocal('draft',prefix);current();if(ids.length>10000)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');for(const id of ids){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await document(id,input=>{const value=inspectPrivateSharedWorkDraft(input,device.ownerId),base=prefix+value.projectId+':'+value.purpose+':'+value.id;if(prefix==='shared-work-private:'?id!==base:!id.startsWith(base+':')||!/^[1-9][0-9]*$/.test(id.slice(base.length+1)))throw new Error('E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED');return value;},()=>options.personalScopeId!);}}
 const restores=await vault.listLocal('draft','personal-content-restore:');current();for(const id of restores){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('personal-content-restore:'.length);await document(id,value=>validatePersonalRestoreJournal(value,device.ownerId,intentId),()=>options.personalScopeId!);}
 const requests=await vault.listLocal('draft','invitation-recipient:');current();
 for(const id of requests){if(!options.personalScopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const intentId=id.slice('invitation-recipient:'.length);
  await document(id,input=>{const value=validateRecipientRequest(input,device.ownerId,intentId);if(value.result!==null){exactKeys(value.result,['intentId','response','pendingApproval']);const response=validateRecipientResponse(value.result.response,value.id);if(value.result.intentId!==intentId||value.result.pendingApproval!==value.accept||response.state!==(value.accept?'pending':'declined'))throw new Error('E2EE_INVITATION_RESPONSE_INVALID');}return value;},()=>options.personalScopeId!);
 }
}
