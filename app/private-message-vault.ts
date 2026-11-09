import {privateDeviceAccessBlocked} from './local-sign-out';
import type {MessagingIdentity} from './private-message-crypto';
const databaseName='genesis-private-messaging-v1';
let generation=0;
function openVault():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(databaseName,1);request.onupgradeneeded=()=>request.result.createObjectStore('keys');request.onerror=()=>reject(new Error('KEY_STORAGE_UNAVAILABLE'));request.onsuccess=()=>resolve(request.result);});}
async function vault<T>(key:string,value?:T,claim=false):Promise<T|undefined>{
  const epoch=generation;if(privateDeviceAccessBlocked())throw new Error('DEVICE_ACCESS_BLOCKED');
  const db=await openVault();if(epoch!==generation||privateDeviceAccessBlocked()){db.close();throw new Error('DEVICE_ACCESS_BLOCKED');}
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('keys',value===undefined?'readonly':'readwrite'),store=tx.objectStore('keys');
    const request=value===undefined||claim?store.get(key):store.put(value,key);let result:T|undefined;
    request.onsuccess=()=>{if(epoch!==generation||privateDeviceAccessBlocked()){tx.abort();return;}result=value===undefined||claim?request.result:value;if(claim&&!result){store.put(value,key);result=value;}};
    tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=tx.onerror=()=>{db.close();reject(new Error('KEY_STORAGE_UNAVAILABLE'));};
  });
}
export const loadMessagingIdentity=(userId:string)=>vault<MessagingIdentity>('identity:'+userId);
export const saveMessagingIdentity=(userId:string,identity:MessagingIdentity)=>vault('identity:'+userId,identity);
export const claimMessagingIdentity=(userId:string,identity:MessagingIdentity)=>vault('identity:'+userId,identity,true);
export const claimMessengerDevice=(userId:string,device:{id:string;identity:MessagingIdentity})=>vault('messenger-device:'+userId,device,true);
export async function pinMessengerChat(userId:string,chatId:string,value:string):Promise<void>{if(await vault('messenger-pin:'+userId+':'+chatId,value,true)!==value)throw new Error('MESSENGER_DEVICE_CHANGED');}
export async function messengerPending(userId:string,chatId:string,value?:string|null):Promise<string|null>{
  const name='messenger-pending:'+userId+':'+chatId;
  if(value===null){await vault(name,null);return null;}
  const key=await vault<CryptoKey>('messenger-storage:'+userId,await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),true);
  if(!key)throw new Error('KEY_STORAGE_UNAVAILABLE');
  if(value!==undefined){const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},key,new TextEncoder().encode(value));await vault(name,{iv,encrypted});return value;}
  const saved=await vault<{iv:Uint8Array;encrypted:ArrayBuffer}|null>(name);
  return saved?new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv as BufferSource,additionalData:new TextEncoder().encode(name)},key,saved.encrypted)):null;
}
export async function pinPeerKey(userId:string,peerId:string,keyId:string):Promise<void>{if(await vault('peer:'+userId+':'+peerId,keyId,true)!==keyId)throw new Error('PEER_KEY_CHANGED');}
export async function clearMessagingVault():Promise<void>{
  generation++;if(typeof indexedDB==='undefined')return;const db=await openVault();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('keys','readwrite');tx.objectStore('keys').clear();tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('KEY_CLEANUP_FAILED'));});}finally{db.close();}
}
