import {retainPrivateUserCache,userCachePreferenceOriginal} from '../last-user-cache.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {exactKeys} from './keys.ts';
import type {UnlockedWebDevice} from './device-vault.ts';

type ProfileOriginal={format:'genesis-profile-original-v1';ownerId:string;original:string;execution:'history-only'};
export function validateRetainedProfileOriginal(input:unknown,ownerId:string):ProfileOriginal{
 exactKeys(input,['format','ownerId','original','execution']);
 if(input.format!=='genesis-profile-original-v1'||input.ownerId!==ownerId||typeof input.original!=='string'||input.execution!=='history-only'
  ||userCachePreferenceOriginal(input.original,ownerId)===null)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 return input as ProfileOriginal;
}
/** Portable output contains preferences only. Authentication, entitlements and
 * technical identity in the byte-exact local original never leave custody. */
export async function retainedProfilePreferenceHistory(id:string,input:unknown,ownerId:string){
 const value=validateRetainedProfileOriginal(input,ownerId),bytes=new TextEncoder().encode(value.original);
 try{
  const hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  if(id!==`profile-original:${hash}`)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
  return{format:'genesis-private-profile-preferences-v1',ownerId,preferences:userCachePreferenceOriginal(value.original,ownerId),execution:'history-only'};
 }finally{bytes.fill(0);}
}

/** A remotely migrated account may still have an unsent profile on this device.
 * Keep its exact bytes locally under the independent vault key before removal;
 * this record never restores login, entitlements, ACL or executable jobs. */
export async function retainEncryptedUserCache(device:UnlockedWebDevice,current:()=>void){
 const check=()=>{current();device.requireOpen();};check();
 await retainPrivateUserCache(device.ownerId,async original=>{
  const bytes=new TextEncoder().encode(original);
  let hash:string;
  try{hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));check();}finally{bytes.fill(0);}
  const document=new E2eeDeviceDocument<ProfileOriginal>(device,`profile-original:${hash}`,input=>{
   const parsed=validateRetainedProfileOriginal(input,device.ownerId);
   if(parsed.original!==original)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');return parsed;
  },check);
  if(!await document.load())await document.save({format:'genesis-profile-original-v1',ownerId:device.ownerId,original,execution:'history-only'},null);
  check();const saved=await document.load();check();
  if(!saved||saved.value.original!==original)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 },check);
}
