import {privateDeviceAccessBlocked} from './local-sign-out';
import {openMessagingIdentity,keyFingerprint,type MessagingIdentity} from './private-message-crypto';
import {privateAccountIsRequired,requirePrivateAccount} from './e2ee/product-session.ts';
import {E2eeMessageLocal,type MessagingLocalAccount} from './e2ee/message-local.ts';
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
async function packIdentity(value:MessagingIdentity){if(await keyFingerprint(value.publicKey)!==value.keyId)throw new Error('MESSAGING_KEY_MISMATCH');return{keyId:value.keyId,privateKey:await crypto.subtle.exportKey('jwk',value.privateKey)};}
async function unpackIdentity(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_MESSAGE_CELL_INVALID');const value=input as {keyId:unknown;privateKey:JsonWebKey};if(Object.keys(value).sort().join(',')!=='keyId,privateKey')throw new Error('E2EE_MESSAGE_CELL_INVALID');const identity=await openMessagingIdentity(value.privateKey);if(identity.keyId!==value.keyId)throw new Error('MESSAGING_KEY_MISMATCH');return identity;}
async function protectedIdentity(userId:string,identity?:MessagingIdentity,claim=false,account:MessagingLocalAccount=requirePrivateAccount(userId)){
 const name='identity:'+userId,storage=new E2eeMessageLocal(account);let saved=await storage.read(name);account.requireOpen();
 if(!saved){const original=await vault<MessagingIdentity>(name);account.requireOpen();const source=original??identity;if(!source)return undefined;saved=await storage.retain(name,await packIdentity(source),null);account.requireOpen();}
 const opened=await unpackIdentity(saved.value.value);account.requireOpen();
 if(identity&&!claim&&identity.keyId!==opened.keyId)throw new Error('E2EE_MESSAGE_KEY_REPLACEMENT_REVIEW_REQUIRED');return opened;
}
export const loadMessagingIdentity=(userId:string)=>privateAccountIsRequired(userId)?protectedIdentity(userId):vault<MessagingIdentity>('identity:'+userId);
export const saveMessagingIdentity=(userId:string,identity:MessagingIdentity)=>privateAccountIsRequired(userId)?protectedIdentity(userId,identity):vault('identity:'+userId,identity);
export const claimMessagingIdentity=(userId:string,identity:MessagingIdentity)=>privateAccountIsRequired(userId)?protectedIdentity(userId,identity,true):vault('identity:'+userId,identity,true);
async function protectedDevice(userId:string,device?:{id:string;identity:MessagingIdentity},account:MessagingLocalAccount=requirePrivateAccount(userId)){
 const name='messenger-device:'+userId,storage=new E2eeMessageLocal(account);let saved=await storage.read(name);account.requireOpen();
 if(!saved){const original=await vault<{id:string;identity:MessagingIdentity}>(name);account.requireOpen();const source=original??device;if(!source)return undefined;saved=await storage.retain(name,{id:source.id,identity:await packIdentity(source.identity)},null);account.requireOpen();}
 const value=saved.value.value as {id:unknown;identity:unknown};if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='id,identity'||typeof value.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id))throw new Error('E2EE_MESSAGE_CELL_INVALID');
 const identity=await unpackIdentity(value.identity);account.requireOpen();return{id:value.id,identity};
}
export const claimMessengerDevice=(userId:string,device:{id:string;identity:MessagingIdentity})=>privateAccountIsRequired(userId)?protectedDevice(userId,device):vault('messenger-device:'+userId,device,true);
async function protectedPin(userId:string,name:string,value?:string,account:MessagingLocalAccount=requirePrivateAccount(userId)){
 const storage=new E2eeMessageLocal(account);let saved=await storage.read(name);account.requireOpen();if(!saved){const original=await vault<string>(name);account.requireOpen();const source=original??value;if(source===undefined)return undefined;saved=await storage.retain(name,source,null);account.requireOpen();}
 if(typeof saved.value.value!=='string')throw new Error('E2EE_MESSAGE_CELL_INVALID');return saved.value.value;
}
export async function pinMessengerChat(userId:string,chatId:string,value:string):Promise<void>{const name='messenger-pin:'+userId+':'+chatId;if((privateAccountIsRequired(userId)?await protectedPin(userId,name,value):await vault(name,value,true))!==value)throw new Error('MESSENGER_DEVICE_CHANGED');}
async function readLegacyPending(userId:string,chatId:string){
 const name='messenger-pending:'+userId+':'+chatId,saved=await vault<{iv:Uint8Array;encrypted:ArrayBuffer}|null>(name);if(!saved)return null;
 const key=await vault<CryptoKey>('messenger-storage:'+userId);if(!key)throw new Error('KEY_STORAGE_UNAVAILABLE');const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv as BufferSource,additionalData:new TextEncoder().encode(name)},key,saved.encrypted);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}finally{new Uint8Array(bytes).fill(0);}
}
async function protectedPending(userId:string,chatId:string,value?:string|null,account:MessagingLocalAccount=requirePrivateAccount(userId)){
 const name='messenger-pending:'+userId+':'+chatId,storage=new E2eeMessageLocal(account);let saved=await storage.read(name);account.requireOpen();
 if(!saved){const original=await readLegacyPending(userId,chatId);account.requireOpen();saved=await storage.retain(name,original,null);account.requireOpen();}
 const prior=saved.value.value;if(prior!==null&&typeof prior!=='string')throw new Error('E2EE_MESSAGE_CELL_INVALID');
 if(value!==undefined&&value!==prior){
  if(prior!==null&&!chatId.startsWith('draft:')&&value!==null)throw new Error('E2EE_MESSAGE_PENDING_REVIEW_REQUIRED');
  // An edited draft is retained as inert content before replacement. It has
  // no automatic delivery path and survives a failed new save.
  if(prior!==null)await storage.retain(`${name}:history:${crypto.randomUUID()}`,prior,null);
  account.requireOpen();await storage.retain(name,value,saved.serial);account.requireOpen();return value;
 }return prior as string|null;
}
export async function messengerPending(userId:string,chatId:string,value?:string|null):Promise<string|null>{
  if(privateAccountIsRequired(userId))return protectedPending(userId,chatId,value);
  const name='messenger-pending:'+userId+':'+chatId;
  if(value===null){await vault(name,null);return null;}
  const key=await vault<CryptoKey>('messenger-storage:'+userId,await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),true);
  if(!key)throw new Error('KEY_STORAGE_UNAVAILABLE');
  if(value!==undefined){const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},key,new TextEncoder().encode(value));await vault(name,{iv,encrypted});return value;}
  const saved=await vault<{iv:Uint8Array;encrypted:ArrayBuffer}|null>(name);
  return saved?new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv as BufferSource,additionalData:new TextEncoder().encode(name)},key,saved.encrypted)):null;
}
/** Current web Messenger is the only writer of these composition/command cells.
 * Web Locks serialize the complete encrypted read/compare/write across tabs;
 * a different saved value is a conflict, never an instruction to replace it. */
export async function compareMessengerPending(userId:string,chatId:string,expected:string|null,next:string|null,current:()=>void):Promise<void>{
 current();if(typeof navigator==='undefined'||!navigator.locks)throw new Error('KEY_STORAGE_UNAVAILABLE');
 await navigator.locks.request('genesis-messenger-cell:'+userId+':'+chatId,async()=>{
  current();const saved=await messengerPending(userId,chatId);current();if(saved===next)return;
  if(saved!==expected)throw new Error('MESSENGER_DRAFT_CHANGED');await messengerPending(userId,chatId,next);current();
 });
}
export async function pinPeerKey(userId:string,peerId:string,keyId:string):Promise<void>{const name='peer:'+userId+':'+peerId;if((privateAccountIsRequired(userId)?await protectedPin(userId,name,keyId):await vault(name,keyId,true))!==keyId)throw new Error('PEER_KEY_CHANGED');}
/** Read-only legacy adoption before product access/activation. No raw key,
 * receipt or draft is uploaded; all original IDB records remain untouched. */
export async function adoptMessagingOriginals(account:MessagingLocalAccount){
 account.requireOpen();const db=await openVault();account.requireOpen();let keys:IDBValidKey[];
 try{keys=await new Promise<IDBValidKey[]>((resolve,reject)=>{const tx=db.transaction('keys','readonly'),request=tx.objectStore('keys').getAllKeys();let captured:IDBValidKey[]=[];request.onsuccess=()=>{if(request.result.length>10000){tx.abort();return;}captured=request.result;};tx.oncomplete=()=>resolve(captured);tx.onerror=tx.onabort=()=>reject(new Error('E2EE_MESSAGE_INVENTORY_INVALID'));});}finally{db.close();}
 account.requireOpen();const owner=account.ownerId;let total=0;
 for(const key of keys){if(typeof key!=='string')throw new Error('E2EE_MESSAGE_INVENTORY_INVALID');
  if(key==='identity:'+owner){await protectedIdentity(owner,undefined,false,account);}
  else if(key==='messenger-device:'+owner){await protectedDevice(owner,undefined,account);}
  else if(key.startsWith('messenger-pin:'+owner+':')||key.startsWith('peer:'+owner+':')){const value=await protectedPin(owner,key,undefined,account);total+=value?.length??0;}
  else if(key.startsWith('messenger-pending:'+owner+':')){const value=await protectedPending(owner,key.slice(('messenger-pending:'+owner+':').length),undefined,account);total+=value?.length??0;}
  account.requireOpen();if(total>64*1024*1024)throw new Error('E2EE_MESSAGE_INVENTORY_TOO_LARGE');
 }
}
export async function clearMessagingVault():Promise<void>{
  generation++;if(typeof indexedDB==='undefined')return;const db=await openVault();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('keys','readwrite');tx.objectStore('keys').clear();tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('KEY_CLEANUP_FAILED'));});}finally{db.close();}
}
