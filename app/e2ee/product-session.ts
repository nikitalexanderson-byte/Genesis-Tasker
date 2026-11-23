import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from './device-vault.ts';
import {IndexedDbE2eeStorage} from './storage.ts';
import {E2eeScopeClient,type ScopeTransport} from './scope-client.ts';
import {assertTechnical,exactKeys,recoverAuthority,publicDeviceKeys,forwardRoot,type RecoveryKit} from './keys.ts';
import {canonicalE2eeValue,signE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {verifyDeviceDirectory,type VerifiedDirectory} from './directory.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from './envelope.ts';
import {E2eeMembershipProduct,type MembershipTransport} from './membership-product.ts';
import {webMembershipAtomicStager} from './membership-atomic-web-stage.ts';
import type {MembershipAtomicStager} from './membership-atomic-stager.ts';
import type {E2eeSharedRecords} from './shared-records.ts';
import type {E2eeSharedBootstrap} from './shared-bootstrap.ts';

export type PrivateScopeSummary={scopeId:string;kind:'personal'|'project'|'space';resourceId:string;state:'preparing'|'uploading'|'verified'|'active'|'retirement'};
export type PrivateAccountStatus={pilotAllowed:boolean;cryptoProtocol:1;scopes:PrivateScopeSummary[]};
export type PrivateAccountTransport=ScopeTransport&{
 membership?:MembershipTransport;
 status:()=>Promise<unknown>;
 challenge:(scopeId:string,deviceId:string,keys:Awaited<ReturnType<typeof publicDeviceKeys>>)=>Promise<Record<string,WireValue>>;
};
export type PrivateAccountView=Readonly<{ownerId:string|null;phase:'closed'|'locked'|'unlocking'|'ready';reason:'unlock'|'recovery';language:string}>;
const listeners=new Set<()=>void>(),waiters=new Set<{ownerId:string;resolve:()=>void;reject:(error:Error)=>void}>();
const privateOwners=new Set<string>();
export const privateAccountIsRequired=(ownerId:string)=>privateOwners.has(ownerId);
export function markPrivateAccountOwner(ownerId:string){assertTechnical(ownerId);privateOwners.add(ownerId);}
let view:PrivateAccountView=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'}),active:WebPrivateAccount|null=null;
const notify=()=>{for(const listener of listeners)listener();};
export const privateAccountView=()=>view;
export const subscribePrivateAccount=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function privateAccountRequired(ownerId:string,language='en'){
 assertTechnical(ownerId);privateOwners.add(ownerId);if(active?.ownerId===ownerId){try{active.requireOpen();return;}catch{/* Locked capabilities are retired below. */}}
 if(view.ownerId!==null&&view.ownerId!==ownerId)closePrivateAccount();
 view=Object.freeze({ownerId,phase:'locked',reason:view.ownerId===ownerId?view.reason:'unlock',language});notify();
}
export function requirePrivateAccount(ownerId:string):WebPrivateAccount{
 if(!active||active.ownerId!==ownerId){privateAccountRequired(ownerId);throw new Error('E2EE_UNLOCK_REQUIRED');}
 active.requireOpen();return active;
}
export async function waitForPrivateAccount(ownerId:string,language='en',signal?:AbortSignal){
 privateAccountRequired(ownerId,language);if(active?.ownerId===ownerId&&view.phase==='ready')return;
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{waiters.delete(waiter);reject(new DOMException('Account unlock cancelled','AbortError'));};
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const fail=(error:Error)=>{signal?.removeEventListener('abort',abort);reject(error);};
  const waiter={ownerId,resolve:finish,reject:fail};waiters.add(waiter);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
}
export function closePrivateAccount(){
 const old=active;active=null;old?.close();
 view=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'});
 for(const waiter of waiters)waiter.reject(new Error('E2EE_ACCOUNT_CHANGED'));waiters.clear();notify();
}
export function validatePrivateAccountStatus(input:unknown):PrivateAccountStatus{
 exactKeys(input,['pilotAllowed','cryptoProtocol','scopes']);if(typeof input.pilotAllowed!=='boolean'||input.cryptoProtocol!==1||!Array.isArray(input.scopes)||input.scopes.length>4096)throw new Error('E2EE_INVALID_RESPONSE');
 const seen=new Set<string>();for(const scope of input.scopes){exactKeys(scope,['scopeId','kind','resourceId','state']);assertTechnical(scope.scopeId);assertTechnical(scope.resourceId);
  if(!['personal','project','space'].includes(String(scope.kind))||!['preparing','uploading','verified','active','retirement'].includes(String(scope.state))||seen.has(scope.scopeId))throw new Error('E2EE_INVALID_RESPONSE');seen.add(scope.scopeId);
 }return input as PrivateAccountStatus;
}
const validateStatus=validatePrivateAccountStatus;
/** Identity establishes the HTTP session. This capability additionally requires
 * independently entered recovery material or the durable device bundle, and
 * verifies the complete signed directory before opening any product object. */
export class WebPrivateAccount{
 readonly ownerId:string;readonly device:UnlockedWebDevice;readonly mode:'online'|'offline';
 #transport:PrivateAccountTransport;#current:()=>void;#closed=false;
 #clients=new Map<string,{client:E2eeScopeClient;directory:VerifiedDirectory}>();#cleanup:(()=>void)|null=null;
 #membershipAtomic:MembershipAtomicStager|null=null;
 #sharedRecords=new Map<string,{records:E2eeSharedRecords;bootstrap:E2eeSharedBootstrap}>();
 private constructor(ownerId:string,device:UnlockedWebDevice,transport:PrivateAccountTransport,current:()=>void,mode:'online'|'offline'='online'){
  this.ownerId=ownerId;this.device=device;this.#transport=transport;this.#current=current;this.mode=mode;
 }
 static async open(ownerId:string,secret:Uint8Array,transport:PrivateAccountTransport,current:()=>void,recoveryKit?:RecoveryKit){
  assertTechnical(ownerId);if(secret.length!==32)throw new Error('E2EE_UNLOCK_REQUIRED');const held=new Uint8Array(secret),storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage();
  let device:UnlockedWebDevice|undefined,account:WebPrivateAccount|undefined;
  try{
   current();const status=validateStatus(await transport.status());current();
   const personal=status.scopes.filter(scope=>scope.kind==='personal'&&scope.resourceId===ownerId);if(personal.length!==1)throw new Error('E2EE_PERSONAL_SCOPE_REQUIRED');
   const record=await keys.get(ownerId);current();
   if(record)device=await UnlockedWebDevice.unlock(ownerId,held,storage,keys);
   else{
    if(!recoveryKit)throw new Error('E2EE_RECOVERY_KIT_REQUIRED');
    // Pin comes from the user's saved kit. The server's kit is never a trust anchor.
    await recoverAuthority(ownerId,held,recoveryKit);current();
    device=await UnlockedWebDevice.provision(ownerId,held,recoveryKit,storage,keys);
   }
   current();account=new WebPrivateAccount(ownerId,device,transport,current);
   if(!record)await account.#recoverEnrollment(personal[0].scopeId,held,recoveryKit!);
   else{
    // A previous enrollment may have died after provisioning. Retrying uses
    // its durable packet, not a new identity or a replacement local root.
    const saved=await device.savedDirectory(personal[0].scopeId);current();
    if(!saved){if(!recoveryKit)throw new Error('E2EE_RECOVERY_KIT_REQUIRED');await account.#recoverEnrollment(personal[0].scopeId,held,recoveryKit);}
   }
   const personalClient=await account.openScope(personal[0],device.authorityPin,ownerId);current();
   if(personalClient.directory.state!=='active')throw new Error('E2EE_MIGRATION_RESUME_REQUIRED');
   const prior=await device.vault.read('key-check','product-account-index-v1');current();
   const index=new TextEncoder().encode(JSON.stringify({protocol:1,ownerId,personal:personal[0]}));
   try{await device.vault.write([{domain:'key-check',objectId:'product-account-index-v1',value:index,expected:prior?.serial??null}]);current();}finally{index.fill(0);prior?.value.fill(0);}
   return account;
  }catch(error){account?.close();device?.lock();throw error;}finally{held.fill(0);}
 }
 static async openOffline(ownerId:string,secret:Uint8Array,transport:PrivateAccountTransport,current:()=>void){
  assertTechnical(ownerId);const held=new Uint8Array(secret);let device:UnlockedWebDevice|undefined;
  try{
   current();device=await UnlockedWebDevice.unlock(ownerId,held,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());current();
   const row=await device.vault.read('key-check','product-account-index-v1');current();if(!row)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');
   let scope:PrivateScopeSummary;
   try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(row.value));exactKeys(value,['protocol','ownerId','personal']);
    if(value.protocol!==1||value.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const status=validateStatus({pilotAllowed:false,cryptoProtocol:1,scopes:[value.personal]});scope=status.scopes[0];
    if(scope.kind!=='personal'||scope.resourceId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   }finally{row.value.fill(0);}
   const account=new WebPrivateAccount(ownerId,device,transport,current,'offline'),client=new E2eeScopeClient(device,ownerId,scope.scopeId,device.authorityPin,transport),directory=await client.hydrateOffline();current();
   if(directory.kind!=='personal'||directory.resourceId!==ownerId||directory.state!=='active')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   account.#clients.set(scope.scopeId,{client,directory});return account;
  }catch(error){device?.lock();throw error;}finally{held.fill(0);}
 }
 requireOpen(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.#current();this.device.requireOpen();}
 async scopeSummaries(){this.requireOpen();if(this.mode==='offline')throw new Error('E2EE_ONLINE_REQUIRED');const status=validateStatus(await this.#transport.status());this.requireOpen();return structuredClone(status.scopes);}
 /** Discovery is only a candidate. Its authority becomes trusted only after
  * comparison outside this server and an explicit personal-vault decision. */
 async proposeSharedTrust(scopeId:string){
  const scope=(await this.scopeSummaries()).find(row=>row.scopeId===scopeId&&row.kind!=='personal');if(!scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const response=await this.#transport.directory(scopeId);this.requireOpen();const first=response.events[0]?.command;
  if(!first||first.action!=='bootstrap'||first.scopeId!==scopeId)throw new Error('E2EE_DIRECTORY_REQUIRED');
  const kit=first.payload.recoveryKit as unknown as RecoveryKit;
  const directory=await verifyDeviceDirectory(first.ownerId,scopeId,kit.authority,response.events);this.requireOpen();
  if(directory.kind!==scope.kind||directory.resourceId!==scope.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const proposal={scopeId,ownerId:directory.ownerId,kind:scope.kind as 'project'|'space',resourceId:scope.resourceId,authority:structuredClone(directory.recoveryKit.authority)};
  const {sharedScopeFingerprint}=await import('./shared-trust.ts');const fingerprint=await sharedScopeFingerprint(proposal);this.requireOpen();return{proposal,fingerprint};
 }
 close(){if(this.#closed)return;this.#closed=true;this.#cleanup?.();this.#cleanup=null;for(const value of this.#clients.values())value.client.close();this.#clients.clear();this.#sharedRecords.clear();this.#membershipAtomic=null;this.device.lock();}
 bindLifecycle(target:Window=window){
  this.requireOpen();const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`genesis-e2ee-lock:${this.ownerId}`);
  const lock=()=>{if(this.#closed)return;this.close();if(active===this){active=null;view=Object.freeze({...view,phase:'locked'});notify();}};
  const hidden=()=>{if(target.document.visibilityState!=='visible'){channel?.postMessage({locked:true});lock();}};
  if(channel)channel.onmessage=lock;
  target.addEventListener('pagehide',lock);target.addEventListener('genesis-local-session-ended',lock);target.document.addEventListener('visibilitychange',hidden);
  this.#cleanup=()=>{target.removeEventListener('pagehide',lock);target.removeEventListener('genesis-local-session-ended',lock);target.document.removeEventListener('visibilitychange',hidden);channel?.close();};hidden();
 }
 async openScope(scope:PrivateScopeSummary,pin:RecoveryKit['authority'],scopeOwner:string){
  this.requireOpen();const existing=this.#clients.get(scope.scopeId);
  if(existing){const known=existing.directory;if(known.kind!==scope.kind||known.resourceId!==scope.resourceId||known.ownerId!==scopeOwner||known.recoveryKit.authority.signingKey!==pin.signingKey||known.recoveryKit.authority.receivingKey!==pin.receivingKey)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   existing.directory=this.mode==='offline'?await existing.client.hydrateOffline():await existing.client.refresh();this.requireOpen();return existing;}
  this.requireOpen();const client=new E2eeScopeClient(this.device,scopeOwner,scope.scopeId,pin,this.#transport),directory=this.mode==='offline'?await client.hydrateOffline():await client.refresh();this.requireOpen();
  if(directory.kind!==scope.kind||directory.resourceId!==scope.resourceId||directory.ownerId!==scopeOwner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  this.#clients.get(scope.scopeId)?.client.close();this.#clients.set(scope.scopeId,{client,directory});return{client,directory};
 }
 personal(){this.requireOpen();const values=[...this.#clients.values()].filter(value=>value.directory.kind==='personal'&&value.directory.resourceId===this.ownerId);
  if(values.length!==1||values[0].directory.state!=='active')throw new Error('E2EE_MIGRATION_RESUME_REQUIRED');return values[0];}
 contentScopes(){this.requireOpen();return[...this.#clients.values()].map(value=>({client:value.client,scopeId:value.directory.scopeId,ownerId:value.directory.ownerId,kind:value.directory.kind,resourceId:value.directory.resourceId}));}
 shared(scopeId:string,kind:'project'|'space',resourceId:string){this.requireOpen();const value=this.#clients.get(scopeId);
  if(!value||value.directory.kind!==kind||value.directory.resourceId!==resourceId||value.directory.state!=='active')throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');return value;}
 async sharedRecords(scopeId:string,kind:'project'|'space',resourceId:string){this.shared(scopeId,kind,resourceId);const existing=this.#sharedRecords.get(scopeId);if(existing)return existing;
  const [{E2eeSharedRecords},{E2eeSharedBootstrap}]=await Promise.all([import('./shared-records.ts'),import('./shared-bootstrap.ts')]);this.shared(scopeId,kind,resourceId);const ready=this.#sharedRecords.get(scopeId);if(ready)return ready;
  const records=new E2eeSharedRecords(this,{scopeId,kind,resourceId}),bootstrap=new E2eeSharedBootstrap(this,records),value={records,bootstrap};this.#sharedRecords.set(scopeId,value);return value;
 }
 membershipAtomic(){this.requireOpen();if(this.mode!=='online'||!this.#transport.membership)throw new Error('E2EE_REFRESH_REQUIRED');
  return this.#membershipAtomic??=webMembershipAtomicStager(this.device,this.personal().client,this.#transport.membership,()=>this.requireOpen());
 }
 membership(){this.requireOpen();if(this.mode!=='online'||!this.#transport.membership)throw new Error('E2EE_REFRESH_REQUIRED');
  return new E2eeMembershipProduct(this.device,this.personal().client,this.#transport.membership,async scopeId=>{
   this.requireOpen();const value=this.#clients.get(scopeId);if(!value||value.directory.kind==='personal')throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');
   await value.client.refresh();this.requireOpen();return value.client;
  },()=>this.requireOpen());
 }
 async #recoverEnrollment(scopeId:string,secret:Uint8Array,kit:RecoveryKit){
  this.requireOpen();const authority=await recoverAuthority(this.ownerId,secret,kit);this.requireOpen();
  if(kit.authority.signingKey!==this.device.authorityPin.signingKey||kit.authority.receivingKey!==this.device.authorityPin.receivingKey)throw new Error('E2EE_AUTHORITY_CHANGED');
  const id=`enrollment:${scopeId}`,previous=await this.device.vault.read('outbox',id);this.requireOpen();let packet:SignedE2eeCommand;
  try{
    const response=await this.#transport.directory(scopeId);this.requireOpen();
    const frames=new Map<number,VerifiedDirectory>();const directory=await verifyDeviceDirectory(this.ownerId,scopeId,kit.authority,response.events,undefined,frame=>frames.set(frame.cryptoEpoch,frame));this.requireOpen();
    const publicKeys=await publicDeviceKeys(this.device.keys());this.requireOpen();
    const known=directory.devices.get(this.device.deviceId);
    if(known){if(known.revoked)throw new Error('E2EE_REVOKED_DEVICE');
     if(known.userId!==this.ownerId||known.signingKey!==publicKeys.signingKey||known.receivingKey!==publicKeys.receivingKey)throw new Error('E2EE_UNTRUSTED_DEVICE');
     await this.device.rememberDirectory(scopeId,kit.authority,response.events,this.ownerId);this.requireOpen();return;
    }
    if(previous){const old=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(previous.value)) as SignedE2eeCommand;
     if(old.command?.action!=='enroll'||old.command.deviceId!=='recovery'||old.command.ownerId!==this.ownerId||old.command.scopeId!==scopeId)throw new Error('E2EE_CORRUPT_OUTBOX');}
    // Challenges bind a particular login and expire. Renew after a restart,
    // retaining the exact prior packet; never regenerate the device/local root.
    const challenge=await this.#transport.challenge(scopeId,this.device.deviceId,publicKeys);this.requireOpen();
    exactKeys(challenge,['id','scopeId','userId','role','sessionHash','deviceId','signingKey','receivingKey','nonce','expiresAt']);
    if(challenge.scopeId!==scopeId||challenge.userId!==this.ownerId||challenge.role!=='owner'||challenge.deviceId!==this.device.deviceId
     ||challenge.signingKey!==publicKeys.signingKey||challenge.receivingKey!==publicKeys.receivingKey||typeof challenge.expiresAt!=='number'||challenge.expiresAt*1000<=Date.now())throw new Error('E2EE_CHALLENGE_INVALID');
    const prefix=new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge),proof=new Uint8Array(prefix.length+body.length);proof.set(prefix);proof.set(body,prefix.length);
    const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},this.device.keys().signing.privateKey,proof)));this.requireOpen();
    const grant=async(frame:VerifiedDirectory)=>forwardRoot(frame.recoveryCapsule,authority.receiving.privateKey,{ownerId:this.ownerId,scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:'recovery'},
     publicKeys.receivingKey,{ownerId:this.ownerId,scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:this.device.deviceId});
    const historyCapsules=[];for(const frame of frames.values())if(frame.cryptoEpoch<directory.cryptoEpoch)historyCapsules.push({cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,capsule:await grant(frame)});
    packet=await signE2eeCommand({protocol:1,ownerId:this.ownerId,scopeId,deviceId:'recovery',action:'enroll',expectedRevision:directory.checkpoint.revision,
     checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,operationId:crypto.randomUUID(),payload:{challenge,capsule:await grant(directory),historyCapsules,selfProof} as unknown as Record<string,WireValue>},authority.signing.privateKey);this.requireOpen();
    const bytes=new TextEncoder().encode(JSON.stringify(packet));try{await this.device.vault.write([
     ...(previous?[{domain:'local-snapshot' as const,objectId:`${id}:attempt:${previous.serial}`,value:previous.value,expected:null}]:[]),
     {domain:'outbox',objectId:id,value:bytes,expected:previous?.serial??null}]);}finally{bytes.fill(0);}
   let deliveryFailure:unknown;
   try{await this.#transport.command(packet);}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;deliveryFailure=error;}this.requireOpen();
   const finalResponse=await this.#transport.directory(scopeId);this.requireOpen();const finalDirectory=await this.device.rememberDirectory(scopeId,kit.authority,finalResponse.events,this.ownerId);this.requireOpen();
   const enrolled=finalDirectory.devices.get(this.device.deviceId),keys=await publicDeviceKeys(this.device.keys());
   if(!enrolled||enrolled.revoked||enrolled.userId!==this.ownerId||enrolled.signingKey!==keys.signingKey||enrolled.receivingKey!==keys.receivingKey){if(deliveryFailure)throw deliveryFailure;throw new Error('E2EE_UNTRUSTED_DEVICE');}
  }finally{previous?.value.fill(0);}
 }
}
export async function unlockPrivateAccount(secretText:string,transport:PrivateAccountTransport,current:()=>void,kit?:RecoveryKit,onOpen?:(account:WebPrivateAccount)=>Promise<void>,mode:'online'|'offline'='online'){
 const expected=view;if(!expected.ownerId||expected.phase!=='locked')throw new Error('E2EE_UNLOCK_REQUIRED');
 const secret=decodeE2eeBytes(secretText.trim(),32);view=Object.freeze({...expected,phase:'unlocking'});notify();
 let account:WebPrivateAccount|undefined;
 try{
  const check=()=>{current();if(view.ownerId!==expected.ownerId)throw new Error('E2EE_ACCOUNT_CHANGED');};
  account=mode==='offline'?await WebPrivateAccount.openOffline(expected.ownerId,secret,transport,check):await WebPrivateAccount.open(expected.ownerId,secret,transport,check,kit);check();account.bindLifecycle();account.requireOpen();
  const {adoptMessagingOriginals}=await import('../private-message-vault.ts');check();await adoptMessagingOriginals(account);check();account.requireOpen();
  await onOpen?.(account);check();account.requireOpen();active=account;
  view=Object.freeze({...expected,phase:'ready'});for(const waiter of [...waiters])if(waiter.ownerId===expected.ownerId){waiters.delete(waiter);waiter.resolve();}notify();
 }catch(error){account?.close();if(active===account)active=null;if(view.ownerId===expected.ownerId){view=Object.freeze({...expected,phase:'locked',reason:error instanceof Error&&error.message==='E2EE_RECOVERY_KIT_REQUIRED'?'recovery':expected.reason});notify();}throw error;}
 finally{secret.fill(0);}
}
